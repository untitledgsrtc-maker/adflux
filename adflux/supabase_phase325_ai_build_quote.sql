-- supabase_phase325_ai_build_quote.sql
-- Phase 2 · AI standard-rate quote (docs/superpowers/specs/2026-08-19-ai-quote-phase2-design.md).
--
-- The WhatsApp AI (api/wa/ai-reply.js), once it has UNDERSTOOD a PRIVATE customer's need,
-- explained the screens + CPM, and collected {cities, months}, emits a hidden
-- `QUOTE: cities=Surat,Rajkot; months=3` marker → the Edge endpoint strips it and calls this
-- RPC → this builds a REAL private-LED quote (UA-2026-NNNN, in the pipeline, lead-linked §11,
-- client-synced §12) at the published per-city standard rate, one line PER CITY = that city's
-- FULL SCREEN COMBO (all of a city's screens, never partial — owner rule). Multiple cities sum
-- in one quote. It returns a summary; the endpoint then renders the PDF + auto-sends it.
--
-- WHERE THE NUMBER COMES FROM: cities.offer_rate + cities.screens ONLY (the DB rate card) —
-- campaign_total(city) = round(offer_rate × cities.screens × months), the SAME formula as the
-- Private LED wizard (Step2Campaign calcTotal). The AI never supplies a rate OR a screen count.
-- GST = subtotal × 18% at the quote level (Private LED puts no per-line CGST/SGST).
--
-- §4 GOVERNMENT HARD-GATE (layer 2; layer 1 = the AI asks govt/private + never emits QUOTE for
-- a government lead). THIS RPC REFUSES when the lead's segment is GOVERNMENT — a govt body
-- getting a private-media quote from the AI is a §4 breach. Even if the AI is tricked, no govt
-- quote.
--
-- POSTURE (§55/§162/§324): SECURITY DEFINER, search_path pinned, whole body EXCEPTION-wrapped →
-- a build failure returns {ok:false,error:'internal'} and can NEVER break the AI reply (§45/§46).
-- REVOKED from PUBLIC/anon/authenticated + GRANT service_role ONLY — the sole caller is
-- ai-reply.js with the service key. ⚠ ai_build_quote MUST be added to the §211 re-lock list.
--
-- Idempotent + race-safe: a per-lead advisory lock serialises concurrent calls; a same-config
-- (same city-set + months) quote built in the last 10 min is RETURNED, not re-created (no dup
-- ref#). A genuinely different config = a new quote.

-- P0 (the review): quotes.source does NOT exist today. Add it (nullable) BEFORE the RPC uses it.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS source text;

CREATE OR REPLACE FUNCTION public.ai_build_quote(
  p_lead_id uuid,
  p_cities  text[],
  p_months  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seg        text;
  v_owner      uuid;
  v_owner_name text;
  v_lead_name  text;
  v_lead_co    text;
  v_lead_phone text;
  v_months     integer;
  v_c          text;
  v_city       record;
  v_found      boolean;
  v_match_n    integer;
  v_line       numeric;
  v_subtotal   numeric := 0;
  v_gst        numeric;
  v_total      numeric;
  v_resolved   jsonb   := '[]'::jsonb;   -- stash of resolved city lines
  v_names      text[]  := ARRAY[]::text[];
  v_quote_id   uuid;
  v_ref        text;
  v_existing   record;
  v_client_id  uuid;
  v_r          jsonb;
  v_out_cities jsonb   := '[]'::jsonb;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_lead');
  END IF;
  IF p_cities IS NULL OR array_length(p_cities, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_cities');
  END IF;

  -- race-safe: serialise concurrent builds for the SAME lead (kills the double-insert race).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_lead_id::text, 0));

  -- resolve lead + owner (TC-first, §113/§243)
  SELECT segment, COALESCE(telecaller_id, assigned_to), name, company, phone
    INTO v_seg, v_owner, v_lead_name, v_lead_co, v_lead_phone
    FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_lead');
  END IF;

  -- §4 GOVERNMENT HARD-GATE (layer 2). GOVERNMENT is authoritative when set.
  IF COALESCE(v_seg, 'PRIVATE') = 'GOVERNMENT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'govt_blocked');
  END IF;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_owner');
  END IF;

  v_months := LEAST(GREATEST(COALESCE(p_months, 1), 1), 12);

  -- Resolve EVERY city. EXACT (case-insensitive) name first; then a SAFE forgiving
  -- fallback for master-name vs spoken-name drift ("SURAT (CITY)" vs "Surat", case,
  -- spacing) — strip a trailing "(...)" qualifier + collapse spaces, and accept ONLY
  -- when it resolves to EXACTLY ONE active city (never guess between two → no mis-price
  -- on the live number). NO loose fuzzy/substring (would risk Surat→Surendranagar).
  -- Still unresolved → refuse (the endpoint then hands off gracefully, not silently).
  FOREACH v_c IN ARRAY p_cities LOOP
    IF btrim(COALESCE(v_c, '')) = '' THEN CONTINUE; END IF;
    SELECT id, name, grade, screens, monthly_rate, offer_rate, impressions_day, impressions_month
      INTO v_city
      FROM public.cities
     WHERE is_active = true AND lower(btrim(name)) = lower(btrim(v_c))
     LIMIT 1;
    v_found := FOUND;
    IF NOT v_found THEN
      SELECT count(*) INTO v_match_n
        FROM public.cities
       WHERE is_active = true
         AND lower(regexp_replace(btrim(name), '\s*\(.*\)\s*$', '')) = lower(btrim(v_c));
      IF v_match_n = 1 THEN
        SELECT id, name, grade, screens, monthly_rate, offer_rate, impressions_day, impressions_month
          INTO v_city
          FROM public.cities
         WHERE is_active = true
           AND lower(regexp_replace(btrim(name), '\s*\(.*\)\s*$', '')) = lower(btrim(v_c))
         LIMIT 1;
        v_found := FOUND;
      END IF;
    END IF;
    IF NOT v_found THEN
      RETURN jsonb_build_object('ok', false, 'error', 'city_not_found', 'city', v_c);
    END IF;
    IF COALESCE(v_city.offer_rate, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_rate', 'city', v_city.name);
    END IF;
    -- Dedup by RESOLVED city: a repeated city in p_cities (Surat,Surat / an alias that
    -- resolves to the same station) must NOT double-charge the quote nor be listed twice
    -- on the PDF. Skip a city already priced this call.
    IF lower(v_city.name) = ANY(v_names) THEN CONTINUE; END IF;

    v_line := round(v_city.offer_rate * GREATEST(COALESCE(v_city.screens, 1), 1) * v_months);
    v_subtotal := v_subtotal + v_line;
    v_names := v_names || lower(v_city.name);
    v_resolved := v_resolved || jsonb_build_object(
      'city_id', v_city.id, 'name', v_city.name, 'grade', v_city.grade,
      'screens', GREATEST(COALESCE(v_city.screens, 1), 1),
      'monthly_rate', v_city.monthly_rate, 'offer_rate', v_city.offer_rate,
      'imp_m', COALESCE(v_city.impressions_month, 0), 'imp_d', COALESCE(v_city.impressions_day, 0),
      'line', v_line);
  END LOOP;

  IF v_subtotal <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_cities');
  END IF;

  -- Idempotency: a same-config (same city-set + months) ai_quote for this lead in the last
  -- 10 min → return it, don't burn a new ref#. Race-safe via the advisory lock above.
  SELECT q.quote_number, q.total_amount, q.subtotal, q.gst_amount
    INTO v_existing
    FROM public.quotes q
   WHERE q.lead_id = p_lead_id
     AND q.source = 'ai_quote'
     AND q.duration_months = v_months
     AND q.created_at > now() - interval '10 minutes'
     AND ARRAY(SELECT lower(qc.city_name) FROM public.quote_cities qc WHERE qc.quote_id = q.id ORDER BY 1)
       = ARRAY(SELECT DISTINCT n FROM unnest(v_names) n ORDER BY 1)
   ORDER BY q.created_at DESC LIMIT 1;
  IF FOUND THEN
    FOR v_r IN SELECT * FROM jsonb_array_elements(v_resolved) LOOP
      v_out_cities := v_out_cities || jsonb_build_object(
        'name', v_r->>'name', 'screens', (v_r->>'screens')::int,
        'rate', (v_r->>'offer_rate')::numeric, 'total', (v_r->>'line')::numeric);
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'dedup', true, 'ref', v_existing.quote_number,
      'cities', v_out_cities, 'months', v_months,
      'subtotal', v_existing.subtotal, 'gst', v_existing.gst_amount, 'total', v_existing.total_amount);
  END IF;

  v_gst   := round(v_subtotal * 0.18);
  v_total := v_subtotal + v_gst;

  SELECT name INTO v_owner_name FROM public.users WHERE id = v_owner;

  -- 1. the quote row (quote_number stamped by the BEFORE-INSERT trigger → UA-2026-NNNN for
  --    media_type='LED_OTHER'; omit it). source='ai_quote' (filterable in the pipeline).
  INSERT INTO public.quotes
    (segment, media_type, rate_type, source, status, revenue_type,
     client_name, client_company, client_phone,
     created_by, sales_person_name, lead_id,
     duration_months, subtotal, gst_rate, gst_amount, total_amount)
  VALUES
    ('PRIVATE', 'LED_OTHER', 'AGENCY', 'ai_quote', 'sent', 'new',
     COALESCE(NULLIF(btrim(v_lead_name), ''), 'WhatsApp lead'), v_lead_co, v_lead_phone,
     v_owner, v_owner_name, p_lead_id,
     v_months, v_subtotal, 0.18, v_gst, v_total)
  RETURNING id, quote_number INTO v_quote_id, v_ref;

  -- 2. one LED city line PER city (whole-combo screens; ref_kind defaults 'CITY'; GST cols
  --    NULL; slots are wizard constants 100/10 — metadata only).
  FOR v_r IN SELECT * FROM jsonb_array_elements(v_resolved) LOOP
    INSERT INTO public.quote_cities
      (quote_id, city_id, city_name, screens, grade, listed_rate, offered_rate,
       campaign_total, duration_months, impressions_month, impressions_day,
       slot_seconds, slots_per_day)
    VALUES
      (v_quote_id, (v_r->>'city_id')::uuid, v_r->>'name', (v_r->>'screens')::int, v_r->>'grade',
       (v_r->>'monthly_rate')::numeric, (v_r->>'offer_rate')::numeric,
       (v_r->>'line')::numeric, v_months,
       (v_r->>'imp_m')::int, (v_r->>'imp_d')::int, 10, 100);
    v_out_cities := v_out_cities || jsonb_build_object(
      'name', v_r->>'name', 'screens', (v_r->>'screens')::int,
      'rate', (v_r->>'offer_rate')::numeric, 'total', (v_r->>'line')::numeric);
  END LOOP;

  -- 3. client sync (§12) — replicate syncClientFromQuote 'create': dedup by (btrim(phone),
  --    created_by). A WhatsApp lead always has a phone.
  IF v_lead_phone IS NOT NULL AND btrim(v_lead_phone) <> '' THEN
    SELECT id INTO v_client_id FROM public.clients
     WHERE btrim(phone) = btrim(v_lead_phone) AND created_by = v_owner LIMIT 1;
    IF FOUND THEN
      UPDATE public.clients
         SET name = COALESCE(NULLIF(btrim(v_lead_name), ''), name),
             company = COALESCE(v_lead_co, company),
             last_quote_at = now(),
             quote_count = COALESCE(quote_count, 0) + 1
       WHERE id = v_client_id;
    ELSE
      INSERT INTO public.clients
        (name, company, phone, created_by, first_quote_at, last_quote_at, quote_count, total_won_amount)
      VALUES
        (COALESCE(NULLIF(btrim(v_lead_name), ''), 'WhatsApp lead'), v_lead_co, btrim(v_lead_phone),
         v_owner, now(), now(), 1, 0);
    END IF;
  END IF;

  -- 4. §11 lead → QuoteSent + link + hot (buy intent). Does NOT touch cadence_paused (§53).
  UPDATE public.leads
     SET stage = 'QuoteSent', quote_id = v_quote_id, heat = 'hot', updated_at = now()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'ref', v_ref, 'cities', v_out_cities,
    'months', v_months, 'subtotal', v_subtotal, 'gst', v_gst, 'total', v_total);

EXCEPTION WHEN OTHERS THEN
  -- a build failure must NEVER break the AI reply (§45/§46).
  RETURN jsonb_build_object('ok', false, 'error', 'internal');
END;
$$;

REVOKE ALL     ON FUNCTION public.ai_build_quote(uuid, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ai_build_quote(uuid, text[], integer) TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect source_col=1, prosecdef=t, svc_can=t, auth_can=f:
--   SELECT count(*) AS source_col FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='quotes' AND column_name='source';
--   SELECT p.proname, p.prosecdef,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_can,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can
--     FROM pg_proc p WHERE p.proname = 'ai_build_quote';
-- Govt-gate smoke (should return govt_blocked, NO quote created):
--   SELECT public.ai_build_quote(
--     (SELECT id FROM public.leads WHERE segment='GOVERNMENT' LIMIT 1), ARRAY['Rajkot'], 3);
