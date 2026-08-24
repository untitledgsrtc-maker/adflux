-- supabase_wa_cadence.sql
-- WhatsApp Agent v2 — Batch 4: CLOSED-WINDOW follow-up CADENCE engine (§227).
-- ─────────────────────────────────────────────────────────────────────────
-- The owner's multi-day schedule: Day 2 · 4 · 7 · 9 · 15 · 25 · 30 → then a
-- Nurture every 30 days. Past the 24h window you can ONLY send Meta-APPROVED
-- TEMPLATES (one per day-slot, all different — followup_dayN + followup_nurture,
-- created by scripts/create-followup-cadence-templates.py). This engine maps
-- "days since the customer's last message" → the matching approved template,
-- one template per lead per day, and STOPS on any reply / Lost / Won / opt-out.
--
-- Ships OFF: whatsapp_accounts.ai_cadence_enabled DEFAULT false = master kill
-- switch. SUPERSEDES the §213 ai-quote-followup chase (turn that OFF when you
-- enable this — see the switch-over note at the bottom). Mirrors the §213
-- pattern (candidate fn → pg_net dispatch → Edge endpoint → send-template + mark;
-- secret PULLED from wa_ai_reply_dispatch so no literal secret is handled).
-- Additive, §45/§46-safe.

-- ── 1) master switch (OFF) + per-conversation progress markers ───────────────
ALTER TABLE public.whatsapp_accounts      ADD COLUMN IF NOT EXISTS ai_cadence_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS followup_stage   int NOT NULL DEFAULT 0;   -- last day-slot fired (0,2,4,7,9,15,25,30)
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS followup_last_at timestamptz;              -- when the last cadence template was sent

COMMENT ON COLUMN public.whatsapp_accounts.ai_cadence_enabled IS
  'Closed-window follow-up cadence on/off (supabase_wa_cadence.sql). Default false. Supersedes §213.';

-- avoid re-chasing leads the §213 chase already touched: start them at stage 9
-- (past the day 2–9 range §213 covered) so the cadence resumes at day 15+.
DO $$
BEGIN
  IF to_regclass('public.ai_quote_followups') IS NOT NULL THEN
    UPDATE public.whatsapp_conversations cv SET followup_stage = 9
     WHERE cv.followup_stage = 0
       AND EXISTS (SELECT 1 FROM public.ai_quote_followups f
                    WHERE f.lead_id = cv.lead_id AND COALESCE(f.sent_count,0) > 0);
  END IF;
END $$;

-- ── 2) the schedule (data, not code) — one row per distinct template ─────────
-- day = the day-slot for the active cadence; is_nurture row = the every-30d one.
-- preview_body is the §125.1 lockstep: it MUST match the live Meta template body
-- (edit both together) — the endpoint logs the substituted text for inbox clarity.
CREATE TABLE IF NOT EXISTS public.wa_cadence_templates (
  id serial PRIMARY KEY,
  day int,                                    -- active-slot day; NULL for nurture
  is_nurture boolean NOT NULL DEFAULT false,
  meta_template_name text NOT NULL UNIQUE,
  language text NOT NULL DEFAULT 'gu',
  preview_body text,
  is_active boolean NOT NULL DEFAULT true
);
-- at most ONE active nurture template can ever exist → the nurture branch of the
-- candidate fn can never fan out to a same-day double business-initiated send.
CREATE UNIQUE INDEX IF NOT EXISTS wa_cadence_one_active_nurture
  ON public.wa_cadence_templates ((true)) WHERE is_nurture AND is_active;
ALTER TABLE public.wa_cadence_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_cadence_templates_read  ON public.wa_cadence_templates;
CREATE POLICY wa_cadence_templates_read  ON public.wa_cadence_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS wa_cadence_templates_admin ON public.wa_cadence_templates;
CREATE POLICY wa_cadence_templates_admin ON public.wa_cadence_templates FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','co_owner')) WITH CHECK (public.get_my_role() IN ('admin','co_owner'));

INSERT INTO public.wa_cadence_templates (day, is_nurture, meta_template_name, preview_body) VALUES
  (2,  false, 'followup_day2',  'નમસ્તે {{1}} 🙏 તાજેતરમાં તમે GSRTC LED સ્ક્રીન વિશે પૂછ્યું હતું. હજુ રસ હોય તો કઈ *સિટી* અને કેટલા *મહિના* — એટલું આ મેસેજ પર *જવાબ* આપો, હું તરત વિગત મોકલી આપું. 👍'),
  (4,  false, 'followup_day4',  'નમસ્તે {{1}} 👋 GSRTC LED સાથે તમારી જાહેરાત *માપી* શકાય છે — દરેક સ્ક્રીન પર QR, દરેક સ્કેન એક ટ્રેક થયેલ લીડ. તમારી સિટી માટે આંકડા જોઈએ? આ મેસેજ પર *જવાબ* આપો.'),
  (7,  false, 'followup_day7',  'નમસ્તે {{1}} 🙏 હજુ GSRTC LED સ્ક્રીન વિચારી રહ્યા છો? સાચી *સ્ટેશન* પસંદ કરવામાં હું મદદ કરી શકું — બસ આ મેસેજ પર *જવાબ* આપો.'),
  (9,  false, 'followup_day9',  'નમસ્તે {{1}} 👋 ગુજરાતના *20 GSRTC બસ સ્ટેશન* પર LED સ્ક્રીન — મહિને લાખો લોકો જુએ. તમારા બ્રાન્ડ માટે વિગત જોઈએ? આ મેસેજ પર *જવાબ* આપો.'),
  (15, false, 'followup_day15', 'નમસ્તે {{1}} 🙏 ફક્ત યાદ કરાવવા — GSRTC LED હજુ મનમાં હોય તો, તમે તૈયાર હો ત્યારે હું *ભાવપત્રક* બનાવી આપું. આ મેસેજ પર *જવાબ* આપો.'),
  (25, false, 'followup_day25', 'નમસ્તે {{1}} 👋 તમારી સિટી માટે અમારી GSRTC LED સ્ક્રીન હજુ ઉપલબ્ધ છે — વિગત જોઈએ તો આ મેસેજ પર *જવાબ* આપો.'),
  (30, false, 'followup_day30', 'નમસ્તે {{1}} 🙏 GSRTC LED વિશે એક છેલ્લી નોંધ — તમારી સિટી માટે *ભાવપત્રક* જોઈએ તો ફક્ત *સિટી* + *મહિના* જણાવો. આ મેસેજ પર *જવાબ* આપો.'),
  (NULL, true, 'followup_nurture', 'નમસ્તે {{1}} 👋 GSRTC LED — ગુજરાતના બસ સ્ટેશન પર *માપી શકાય એવી* આઉટડોર જાહેરાત. જ્યારે પણ કેમ્પેન પ્લાન કરો, અમે અહીં છીએ. કોઈ પ્રશ્ન હોય તો *જવાબ* આપો.')
ON CONFLICT (meta_template_name) DO NOTHING;

-- ── 3) candidates — days-since-last-inbound → the due template ────────────────
-- Window CLOSED (>24h). Engaged (AI already replied). Skips Lost/Won/opt-out/DNC/
-- paused. ≤1 template/lead/day via BOTH followup_last_at AND a template-message
-- guard (independent, so a lost mark can't re-send). Active: the HIGHEST unfired
-- slot ≤ days_since (catch-up, never a burst). Nurture: stage 30 + 30d since last.
CREATE OR REPLACE FUNCTION public.followup_cadence_candidates()
RETURNS TABLE (conversation_id uuid, customer_wa_id text, phone_number_id text, lead_name text,
               meta_template_name text, language text, preview_body text, new_stage int)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH eligible AS (
    SELECT cv.id AS conversation_id, cv.customer_wa_id, a.phone_number_id, COALESCE(l.name,'') AS lead_name,
           COALESCE(cv.followup_stage,0) AS stage, cv.followup_last_at AS last_at,
           EXTRACT(EPOCH FROM (now() - cv.last_inbound_at)) / 86400.0 AS days_since
    FROM public.whatsapp_conversations cv
    JOIN public.whatsapp_accounts a ON a.id = cv.whatsapp_account_id
    JOIN public.leads l             ON l.id = cv.lead_id
    WHERE a.ai_cadence_enabled = true
      AND a.phone_number_id IS NOT NULL
      AND cv.customer_wa_id ~ '^[0-9]{10,15}$'
      AND COALESCE(cv.ai_paused,false) = false
      AND cv.last_inbound_at IS NOT NULL
      AND cv.last_inbound_at <= now() - interval '24 hours'      -- window CLOSED (template territory)
      AND cv.last_inbound_at >  now() - interval '400 days'      -- sane horizon (stop chasing forever)
      AND COALESCE(l.wa_opt_out,false)  = false
      AND COALESCE(l.do_not_call,false) = false
      AND COALESCE(l.stage,'') NOT IN ('Lost','Won')             -- not-interested/lost/won → no follow-up
      AND EXISTS (SELECT 1 FROM public.whatsapp_messages m
                   WHERE m.conversation_id=cv.id AND m.direction='out')  -- engaged (AI replied)
      AND (cv.followup_last_at IS NULL OR cv.followup_last_at <= now() - interval '20 hours')  -- ≤1/day (marker)
      AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m           -- ≤1/day (message log, dup-proof)
                       WHERE m.conversation_id=cv.id AND m.type='template'
                         AND m.at > now() - interval '20 hours')
  )
  SELECT e.conversation_id, e.customer_wa_id, e.phone_number_id, e.lead_name,
         t.meta_template_name, t.language, t.preview_body, t.day AS new_stage
  FROM eligible e
  JOIN LATERAL (
    SELECT ct.meta_template_name, ct.language, ct.preview_body, ct.day
    FROM public.wa_cadence_templates ct
    WHERE ct.is_active AND NOT ct.is_nurture AND ct.day > e.stage AND e.days_since >= ct.day
    ORDER BY ct.day DESC LIMIT 1
  ) t ON true
  WHERE e.stage < 30
  UNION ALL
  SELECT e.conversation_id, e.customer_wa_id, e.phone_number_id, e.lead_name,
         n.meta_template_name, n.language, n.preview_body, 30 AS new_stage
  FROM eligible e
  JOIN LATERAL (
    SELECT ct.meta_template_name, ct.language, ct.preview_body
    FROM public.wa_cadence_templates ct
    WHERE ct.is_nurture AND ct.is_active
    ORDER BY ct.id LIMIT 1                 -- exactly ONE nurture row per conversation (never a same-day double)
  ) n ON true
  WHERE e.stage >= 30 AND (e.last_at IS NULL OR e.last_at <= now() - interval '30 days')
  LIMIT 200;
$$;

-- ── 4) mark — advance the stage + stamp last_at (send-then-mark, §213) ────────
CREATE OR REPLACE FUNCTION public.followup_cadence_mark(p_conversation_id uuid, p_new_stage int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.whatsapp_conversations
  SET followup_stage = GREATEST(COALESCE(followup_stage,0), p_new_stage), followup_last_at = now()
  WHERE id = p_conversation_id;
$$;

REVOKE ALL ON FUNCTION public.followup_cadence_candidates()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.followup_cadence_mark(uuid,int)    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.followup_cadence_candidates()   TO service_role;
GRANT EXECUTE ON FUNCTION public.followup_cadence_mark(uuid,int) TO service_role;

-- ── 5) dispatch — pg_net POST; x-ai-secret PULLED from wa_ai_reply_dispatch ──
DO $do$
DECLARE v_def text; v_secret text;
BEGIN
  v_def := pg_get_functiondef('public.wa_ai_reply_dispatch'::regproc);
  v_secret := substring(v_def from $re$x-ai-secret'[^']*'([^']+)'$re$);
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'could not read AI_REPLY_SECRET from wa_ai_reply_dispatch';
  END IF;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.followup_cadence_dispatch()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, extensions, pg_temp AS $body$
    BEGIN
      PERFORM net.http_post(
        url     := 'https://app.untitledad.in/api/wa/followup-cadence',
        headers := jsonb_build_object('Content-Type','application/json','x-ai-secret', %L),
        body    := '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN NULL;
    END; $body$;
  $fn$, v_secret);
  EXECUTE 'REVOKE ALL ON FUNCTION public.followup_cadence_dispatch() FROM PUBLIC, anon, authenticated';
END $do$;

-- ── 6) cron — once/day 10:00 IST (04:30 UTC) Mon–Sat; endpoint re-gates hours + Sunday. ──
SELECT cron.schedule('followup-cadence', '30 4 * * 1-6', $$SELECT public.followup_cadence_dispatch();$$);

NOTIFY pgrst, 'reload schema';

-- ── SWITCH-OVER (when the followup_* templates are ACTIVE on Meta) ────────────
-- 1) turn OFF the old §213 chase so a lead can't get 2 template systems:
--      UPDATE public.whatsapp_accounts SET ai_followup_enabled=false WHERE purpose='marketing';
--      (optional) SELECT cron.unschedule('ai-quote-followup');
-- 2) turn ON the cadence:
--      UPDATE public.whatsapp_accounts SET ai_cadence_enabled=true WHERE purpose='marketing';
-- KILL SWITCH anytime: UPDATE public.whatsapp_accounts SET ai_cadence_enabled=false WHERE purpose='marketing';

-- ── VERIFY — expect cadence_col 1 · stage_col 1 · tpl_rows 8 · cand_fn t · cron_job 1 · enabled 0 ──
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='whatsapp_accounts' AND column_name='ai_cadence_enabled') AS cadence_col,
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='whatsapp_conversations' AND column_name='followup_stage') AS stage_col,
--   (SELECT count(*) FROM public.wa_cadence_templates) AS tpl_rows,
--   to_regprocedure('public.followup_cadence_candidates()') IS NOT NULL AS cand_fn,
--   (SELECT count(*) FROM cron.job WHERE jobname='followup-cadence') AS cron_job,
--   (SELECT count(*) FROM public.whatsapp_accounts WHERE ai_cadence_enabled) AS enabled;
