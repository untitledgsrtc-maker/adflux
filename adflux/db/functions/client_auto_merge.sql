-- =====================================================================
-- db/functions/client_auto_merge.sql  -  THE CANONICAL HOME (section 71/72)
-- Phase 345 (2026-10-06): ONE client row per phone number, merged automatically.
--
-- WHY (owner 2026-10-06, looking at /clients "Find duplicate clients - 2 groups":
--   "alway auto merger the clint"): the clients table was one row per
--   (phone, created_by). When Brijesh quoted a lead and then reassigned it to Rima, and
--   Rima quoted it again, the same company showed up twice (Anee Marcom: owner Brijesh +
--   owner Rima). Phone FORMATS also slipped past the old unique index ("81603 21686" vs
--   "+91 81603 21686" = the same Mayur client twice). The admin had to click "Keep this -
--   merge 1" by hand, and that button only deleted rows (counters were lost).
--
-- THE RULE (frozen - do NOT regress):
--   * The CLIENT KEY is the LAST 10 DIGITS of the phone (client_phone_key). Phones with
--     fewer than 10 or more than 14 digits have NO key (junk / two-numbers-in-one-field are
--     never auto-merged).
--   * There is at most ONE clients row per key (unique index in the phase 345 file).
--   * A second row for a key is never created: every insert / sync folds into the existing
--     row - counters ADD (quote_count, total_won_amount), first_quote_at = earliest,
--     last_quote_at = latest, blank fields are filled from the other row.
--   * OWNER of the merged row (_client_owner_for_key): (1) the current owner of the OPEN
--     lead on that phone (COALESCE(telecaller_id, assigned_to), active sales / agency /
--     telecaller / sales_manager), so a reassigned lead's client follows the lead (section
--     329); else (2) the creator of the most recent quote on that phone, only if an ACTIVE
--     sales / agency / telecaller / sales_manager (never admin, co_owner, ops or a former
--     rep); else (3) the caller-supplied fallback (callers pass NULL = keep the current
--     owner). Admin sees every row regardless.
--   * created_by on QUOTES is never touched (it drives the incentive). Only the CRM
--     clients row moves; each quote still carries its own client_* snapshot.
--   * Phone-less rows (government bodies) keep the old per-owner name match - they are NOT
--     merged across reps (a name is too loose to merge on).
--   * Quote saves must NEVER fail because of the client sync: sync_client_from_quote
--     returns silently when it may not act; the trigger folds instead of raising.
--
-- Run order: this file, THEN supabase_phase345_clients_auto_merge.sql (backup + triggers +
-- heal + unique index). Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. the key. IMMUTABLE so it can back an index. EXECUTE stays with PUBLIC on purpose:
--    index maintenance calls it as the inserting user.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_phone_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  -- 10..14 digits only (0091 + 10 digits is the longest real form). Longer = two numbers or an
  -- extension typed into one free-text field: NO key, never auto-merged (it would false-match).
  SELECT CASE
           WHEN length(regexp_replace(COALESCE(p, ''), '\D', '', 'g')) BETWEEN 10 AND 14
           THEN right(regexp_replace(p, '\D', '', 'g'), 10)
         END;
$fn$;

COMMENT ON FUNCTION public.client_phone_key(text) IS
  'Phase 345: last 10 digits of a phone with 10-14 digits, else NULL. The one-client-per-phone key.';

-- ---------------------------------------------------------------------
-- 2. who owns the merged client (see rule above). Internal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._client_owner_for_key(p_key text, p_fallback uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_owner uuid;
BEGIN
  IF p_key IS NULL THEN
    RETURN p_fallback;
  END IF;

  -- (1) the rep who owns the OPEN lead on this phone right now
  SELECT COALESCE(l.telecaller_id, l.assigned_to)
    INTO v_owner
    FROM public.leads l
    JOIN public.users u ON u.id = COALESCE(l.telecaller_id, l.assigned_to)
   WHERE public.client_phone_key(l.phone) = p_key
     AND l.stage NOT IN ('Won', 'Lost')
     AND u.is_active = true
     AND u.role IN ('sales', 'agency', 'telecaller', 'sales_manager')
   ORDER BY l.created_at ASC
   LIMIT 1;
  IF v_owner IS NOT NULL THEN
    RETURN v_owner;
  END IF;

  -- (2) the creator of the most recent quote on this phone - but ONLY an ACTIVE rep who has a
  --     Clients page (sales / agency / telecaller / sales_manager). An admin / co_owner / ops
  --     head / former rep must never receive a client: clients RLS gives reps only their own
  --     rows, so the client would vanish from every rep's page (and ping-pong on the next quote).
  SELECT q.created_by
    INTO v_owner
    FROM public.quotes q
    JOIN public.users u ON u.id = q.created_by
   WHERE u.is_active = true
     AND u.role IN ('sales', 'agency', 'telecaller', 'sales_manager')
     AND public.client_phone_key(q.client_phone) = p_key
   ORDER BY q.created_at DESC
   LIMIT 1;

  -- NULL when no evidence: callers then KEEP the current owner (or use their own fallback).
  RETURN COALESCE(v_owner, p_fallback);
END;
$fn$;

-- ---------------------------------------------------------------------
-- 3. fold ONE client row (given as a row value, e.g. NEW or a stored row) into the keeper.
--    Counters add; dates widen; blank fields fill. p_prefer_drop = the folded row carries
--    the NEWER typed values (a fresh insert) so its non-blank fields win. Internal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._client_fold_row(p_keep uuid, d public.clients, p_prefer_drop boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.clients k
     SET quote_count      = COALESCE(k.quote_count, 0)      + COALESCE(d.quote_count, 0),
         total_won_amount = COALESCE(k.total_won_amount, 0) + COALESCE(d.total_won_amount, 0),
         first_quote_at   = LEAST(k.first_quote_at, d.first_quote_at),
         last_quote_at    = GREATEST(k.last_quote_at, d.last_quote_at),
         -- 'Unknown' / 'WhatsApp lead' are placeholders (ai_build_quote writes the latter when a
         -- WhatsApp profile has no name): they never overwrite a real name.
         name    = CASE WHEN p_prefer_drop
                        THEN COALESCE(NULLIF(NULLIF(NULLIF(btrim(d.name), ''), 'Unknown'), 'WhatsApp lead'), k.name)
                        ELSE COALESCE(NULLIF(NULLIF(NULLIF(btrim(k.name), ''), 'Unknown'), 'WhatsApp lead'),
                                      NULLIF(btrim(d.name), ''), k.name) END,
         company = CASE WHEN p_prefer_drop THEN COALESCE(NULLIF(btrim(d.company), ''), k.company)
                        ELSE COALESCE(NULLIF(btrim(k.company), ''), NULLIF(btrim(d.company), '')) END,
         email   = CASE WHEN p_prefer_drop THEN COALESCE(NULLIF(btrim(d.email), ''), k.email)
                        ELSE COALESCE(NULLIF(btrim(k.email), ''), NULLIF(btrim(d.email), '')) END,
         gstin   = CASE WHEN p_prefer_drop THEN COALESCE(NULLIF(btrim(d.gstin), ''), k.gstin)
                        ELSE COALESCE(NULLIF(btrim(k.gstin), ''), NULLIF(btrim(d.gstin), '')) END,
         address = CASE WHEN p_prefer_drop THEN COALESCE(NULLIF(btrim(d.address), ''), k.address)
                        ELSE COALESCE(NULLIF(btrim(k.address), ''), NULLIF(btrim(d.address), '')) END,
         notes   = CASE WHEN p_prefer_drop THEN COALESCE(NULLIF(btrim(d.notes), ''), k.notes)
                        -- heal / manual merge: KEEP both people's notes (nothing is lost)
                        WHEN NULLIF(btrim(k.notes), '') IS NULL THEN NULLIF(btrim(d.notes), '')
                        WHEN NULLIF(btrim(d.notes), '') IS NULL OR btrim(d.notes) = btrim(k.notes) THEN k.notes
                        ELSE btrim(k.notes) || ' | ' || btrim(d.notes) END
   WHERE k.id = p_keep;
END;
$fn$;

-- fold a STORED row into the keeper and delete it (call_logs re-pointed first: its FK is
-- ON DELETE SET NULL and would otherwise orphan the call history). Internal.
CREATE OR REPLACE FUNCTION public._client_fold(p_keep uuid, p_drop uuid, p_prefer_drop boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d public.clients%ROWTYPE;
BEGIN
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RETURN;
  END IF;
  SELECT * INTO d FROM public.clients WHERE id = p_drop FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.call_logs SET client_id = p_keep WHERE client_id = p_drop;
  DELETE FROM public.clients WHERE id = p_drop;       -- first, so the keeper's owner/phone can never collide with it
  PERFORM public._client_fold_row(p_keep, d, p_prefer_drop);
END;
$fn$;

-- ---------------------------------------------------------------------
-- 4. BEFORE INSERT safety net on clients: a second row for a key is folded into the
--    existing one instead of being stored. Covers every writer - old cached app bundles,
--    ai_build_quote (WhatsApp quote builder), imports. RETURN NULL = "handled, skip insert".
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clients_absorb_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_key  text := public.client_phone_key(NEW.phone);
  v_keep uuid;
  v_role text;
  v_prefer boolean;
BEGIN
  IF v_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- CALLER GATE (security review P1): this trigger is SECURITY DEFINER and a RETURN NULL skips
  -- the table's RLS INSERT check. So a JWT caller (anon, or any signed-in role) must pass the
  -- SAME test the insert policy applies BEFORE we may fold into someone else's client; anyone
  -- who would be refused is handed back to RLS unchanged (RETURN NEW -> RLS rejects, as before).
  -- service_role / postgres / cron / ai_build_quote carry no anon|authenticated claim -> fold.
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') THEN
    SELECT u.role INTO v_role
      FROM public.users u
     WHERE u.id = auth.uid() AND u.is_active = true;
    IF v_role IS NULL
       OR NOT (v_role = 'admin'
               OR (v_role IN ('sales', 'agency', 'telecaller', 'sales_manager')
                   AND NEW.created_by = auth.uid())) THEN
      RETURN NEW;
    END IF;
    -- a rep's insert is ONE new quote at most; never let it shift another client's counters
    IF v_role <> 'admin' THEN
      NEW.quote_count      := LEAST(GREATEST(COALESCE(NEW.quote_count, 0), 0), 1);
      NEW.total_won_amount := GREATEST(COALESCE(NEW.total_won_amount, 0), 0);
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_phone:' || v_key, 0));

  SELECT c.id INTO v_keep
    FROM public.clients c
   WHERE public.client_phone_key(c.phone) = v_key
   ORDER BY c.last_quote_at DESC NULLS LAST, c.created_at ASC
   LIMIT 1
   FOR UPDATE;
  IF v_keep IS NULL THEN
    RETURN NEW;                                          -- first client for this phone
  END IF;

  -- The inserter's newer typed values win ONLY when it is the client's own owner, an admin, or a
  -- trusted DB caller (ai_build_quote / service). A different rep may only FILL BLANKS - never
  -- replace the verified GSTIN / address / email another rep keeps on the shared client.
  v_prefer := true;
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND v_role <> 'admin'
     AND (SELECT c.created_by FROM public.clients c WHERE c.id = v_keep) IS DISTINCT FROM NEW.created_by THEN
    v_prefer := false;
  END IF;
  PERFORM public._client_fold_row(v_keep, NEW, v_prefer);
  BEGIN
    -- Ownership moves ONLY on evidence (an open lead, or a quote on this phone). The inserter's
    -- own id is deliberately NOT a fallback: a bare insert with no lead/quote behind it must never
    -- take another rep's client (the keeper keeps its owner).
    UPDATE public.clients
       SET created_by = COALESCE(public._client_owner_for_key(v_key, NULL), created_by)
     WHERE id = v_keep;
  EXCEPTION WHEN unique_violation THEN
    NULL;                                                -- legacy exact-phone twin: keep the current owner
  END;
  RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------
-- 5. BEFORE UPDATE OF phone: editing a client's phone onto another client's phone.
--    Admin (or the same owner's own rows) -> merge the other row(s) into this one.
--    A rep onto another rep's client -> refuse with the SAME 23505 the form already
--    explains ("Another client already uses that phone number.").
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clients_phone_change_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_key   text := public.client_phone_key(NEW.phone);
  v_admin boolean;
  v_n     int;
  v_foreign int;
  v_cnt   bigint;
  v_won   numeric;
  v_first timestamptz;
  v_last  timestamptz;
BEGIN
  IF v_key IS NULL OR v_key IS NOT DISTINCT FROM public.client_phone_key(OLD.phone) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_phone:' || v_key, 0));

  SELECT count(*),
         count(*) FILTER (WHERE created_by IS DISTINCT FROM NEW.created_by),
         COALESCE(sum(quote_count), 0), COALESCE(sum(total_won_amount), 0),
         min(first_quote_at), max(last_quote_at)
    INTO v_n, v_foreign, v_cnt, v_won, v_first, v_last
    FROM public.clients
   WHERE public.client_phone_key(phone) = v_key AND id <> NEW.id;
  IF v_n = 0 THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.is_active)
    INTO v_admin;
  IF NOT (COALESCE(v_admin, false) OR auth.uid() IS NULL OR v_foreign = 0) THEN
    RAISE EXCEPTION 'Another client already uses that phone number.' USING ERRCODE = '23505';
  END IF;

  -- merge the other row(s) INTO this one (NEW is the row being written; no second UPDATE on it)
  -- fill this row's blank fields from the rows about to be deleted (nothing typed is lost)
  SELECT COALESCE(NULLIF(btrim(NEW.company), ''), max(NULLIF(btrim(o.company), ''))),
         COALESCE(NULLIF(btrim(NEW.email),   ''), max(NULLIF(btrim(o.email),   ''))),
         COALESCE(NULLIF(btrim(NEW.gstin),   ''), max(NULLIF(btrim(o.gstin),   ''))),
         COALESCE(NULLIF(btrim(NEW.address), ''), max(NULLIF(btrim(o.address), ''))),
         COALESCE(NULLIF(btrim(NEW.notes),   ''), max(NULLIF(btrim(o.notes),   '')))
    INTO NEW.company, NEW.email, NEW.gstin, NEW.address, NEW.notes
    FROM public.clients o
   WHERE public.client_phone_key(o.phone) = v_key AND o.id <> NEW.id;
  NEW.quote_count      := COALESCE(NEW.quote_count, 0) + v_cnt;
  NEW.total_won_amount := COALESCE(NEW.total_won_amount, 0) + v_won;
  NEW.first_quote_at   := LEAST(NEW.first_quote_at, v_first);
  NEW.last_quote_at    := GREATEST(NEW.last_quote_at, v_last);
  UPDATE public.call_logs SET client_id = NEW.id
   WHERE client_id IN (SELECT id FROM public.clients WHERE public.client_phone_key(phone) = v_key AND id <> NEW.id);
  DELETE FROM public.clients WHERE public.client_phone_key(phone) = v_key AND id <> NEW.id;
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------
-- 6. the app's client sync (replaces the client-side upsert in src/utils/syncClient.js).
--    Reads the SAVED quote (authoritative), finds the client by key across ALL owners,
--    folds any stray twin, and applies the same create / update / won semantics the JS had.
--    Only the quote's creator or an admin may call it for that quote; otherwise a no-op.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_client_from_quote(p_quote_id uuid, p_mode text DEFAULT 'create')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_mode    text := lower(COALESCE(p_mode, 'create'));
  q         public.quotes%ROWTYPE;
  c         public.clients%ROWTYPE;
  r         record;
  v_phone   text;
  v_company text;
  v_name    text;
  v_email   text;
  v_gst     text;
  v_addr    text;
  v_notes   text;
  v_key     text;
  v_lookup  text;
BEGIN
  IF v_uid IS NULL OR p_quote_id IS NULL OR v_mode NOT IN ('create', 'update', 'won') THEN
    RETURN;
  END IF;

  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND OR q.created_by IS NULL THEN
    RETURN;
  END IF;
  -- counters are display-only, but never count a 'won' that is not won
  IF v_mode = 'won' AND q.status IS DISTINCT FROM 'won' THEN
    RETURN;
  END IF;
  IF q.created_by <> v_uid
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.role = 'admin' AND u.is_active) THEN
    RETURN;
  END IF;

  v_phone   := btrim(COALESCE(q.client_phone, ''));
  v_company := btrim(COALESCE(q.client_company, ''));
  v_name    := btrim(COALESCE(q.client_name, ''));
  v_email   := btrim(COALESCE(q.client_email, ''));
  v_gst     := btrim(COALESCE(q.client_gst, ''));
  v_addr    := btrim(COALESCE(q.client_address, ''));
  v_notes   := btrim(COALESCE(q.client_notes, ''));
  IF v_phone = '' AND v_company = '' AND v_name = '' THEN
    RETURN;                                              -- nothing to identify a client by
  END IF;

  v_key := public.client_phone_key(v_phone);

  IF v_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('client_phone:' || v_key, 0));
    SELECT * INTO c FROM public.clients
     WHERE public.client_phone_key(phone) = v_key
     ORDER BY last_quote_at DESC NULLS LAST, created_at ASC
     LIMIT 1 FOR UPDATE;
  ELSIF v_phone = '' THEN
    -- phone-less (government bodies): same per-owner name match the JS always used
    v_lookup := lower(COALESCE(NULLIF(v_company, ''), v_name));
    PERFORM pg_advisory_xact_lock(hashtextextended('client_name:' || q.created_by::text || v_lookup, 0));
    SELECT * INTO c FROM public.clients
     WHERE created_by = q.created_by AND phone IS NULL
       AND (lower(COALESCE(company, '')) = v_lookup OR lower(COALESCE(name, '')) = v_lookup)
     LIMIT 1 FOR UPDATE;
  ELSE
    -- short / junk phone (< 10 digits): legacy exact (phone, owner) match, never merged across reps
    SELECT * INTO c FROM public.clients
     WHERE phone = v_phone AND created_by = q.created_by
     LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.clients
      (name, company, phone, email, gstin, address, notes, created_by,
       first_quote_at, last_quote_at, quote_count, total_won_amount)
    VALUES
      (COALESCE(NULLIF(v_name, ''), 'Unknown'), NULLIF(v_company, ''), NULLIF(v_phone, ''),
       NULLIF(v_email, ''), NULLIF(v_gst, ''), NULLIF(v_addr, ''), NULLIF(v_notes, ''),
       COALESCE(public._client_owner_for_key(v_key, q.created_by), q.created_by),
       now(), now(),
       CASE WHEN v_mode = 'update' THEN 0 ELSE 1 END,
       CASE WHEN v_mode = 'won' THEN COALESCE(q.total_amount, 0) ELSE 0 END);
    RETURN;
  END IF;

  -- self-heal: fold any stray twin of this key into the keeper (the unique index normally prevents it)
  IF v_key IS NOT NULL THEN
    FOR r IN SELECT id FROM public.clients
              WHERE public.client_phone_key(phone) = v_key AND id <> c.id LOOP
      PERFORM public._client_fold(c.id, r.id, false);
    END LOOP;
  END IF;

  UPDATE public.clients
     SET name    = CASE WHEN v_name IN ('', 'Unknown', 'WhatsApp lead') THEN name ELSE v_name END,
         company = COALESCE(NULLIF(v_company, ''), company),
         email   = COALESCE(NULLIF(v_email, ''), email),
         -- GSTIN goes on tax documents: replace a stored one only when the quote's creator is the
         -- client's owner; anyone else may only fill a blank (the Clients edit form corrects it).
         gstin   = CASE WHEN NULLIF(v_gst, '') IS NULL THEN gstin
                        WHEN NULLIF(btrim(gstin), '') IS NULL OR q.created_by = c.created_by THEN v_gst
                        ELSE gstin END,
         address = COALESCE(NULLIF(v_addr, ''), address),
         notes   = COALESCE(NULLIF(v_notes, ''), notes),
         last_quote_at    = now(),
         quote_count      = COALESCE(quote_count, 0)      + CASE WHEN v_mode = 'create' THEN 1 ELSE 0 END,
         total_won_amount = COALESCE(total_won_amount, 0) + CASE WHEN v_mode = 'won' THEN COALESCE(q.total_amount, 0) ELSE 0 END,
         -- ownership follows the lead on a NEW quote only; a status change or an edit never moves it
         created_by = CASE WHEN v_mode = 'create' AND v_key IS NOT NULL
                           THEN COALESCE(public._client_owner_for_key(v_key, NULL), created_by)
                           ELSE created_by END
   WHERE id = c.id;
EXCEPTION WHEN unique_violation THEN
  RETURN;                                                -- a client-sync hiccup must never fail the quote save
END;
$fn$;

-- ---------------------------------------------------------------------
-- 7. the manual merge button on /clients (phone-less / short-phone groups the key cannot see).
--    Admin only. Keeps counters (the old button just deleted rows).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_merge_clients(p_keep uuid, p_drop uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.is_active) THEN
    RAISE EXCEPTION 'Only an admin can merge clients.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_keep) THEN
    RAISE EXCEPTION 'The client to keep was not found.' USING ERRCODE = 'P0002';
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_drop, ARRAY[]::uuid[]) LOOP
    IF v_id IS DISTINCT FROM p_keep AND EXISTS (SELECT 1 FROM public.clients WHERE id = v_id) THEN
      PERFORM public._client_fold(p_keep, v_id, false);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.sync_client_from_quote(uuid, text) IS
  'Phase 345: the one client upsert. One row per phone key across all reps; owner follows the open lead on a new quote.';
COMMENT ON FUNCTION public.admin_merge_clients(uuid, uuid[]) IS
  'Phase 345: admin-only manual merge keeping counters. Auto-merge by phone is automatic; this is for phone-less groups.';

-- ---------------------------------------------------------------------
-- 8. grants. Internals and trigger functions are NOT callable by API roles
--    (a trigger function is only permission-checked at CREATE TRIGGER time).
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._client_owner_for_key(text, uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._client_fold_row(uuid, public.clients, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._client_fold(uuid, uuid, boolean)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clients_absorb_duplicate()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clients_phone_change_guard()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_client_from_quote(uuid, text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_merge_clients(uuid, uuid[])             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_client_from_quote(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_merge_clients(uuid, uuid[])  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY / TRIPWIRE (read-only; every column must be TRUE)
-- =====================================================================
-- SELECT
--   public.client_phone_key('+91 81603 21686') = '8160321686'
--     AND public.client_phone_key('09925464348') = '9925464348'
--     AND public.client_phone_key('12345') IS NULL AND public.client_phone_key(NULL) IS NULL AS key_ok,
--   (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
--      ('client_phone_key','_client_owner_for_key','_client_fold_row','_client_fold','clients_absorb_duplicate',
--       'clients_phone_change_guard','sync_client_from_quote','admin_merge_clients')) = 8              AS eight_functions,
--   NOT has_function_privilege('anon', 'public.sync_client_from_quote(uuid,text)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.admin_merge_clients(uuid,uuid[])', 'EXECUTE')
--     AND NOT has_function_privilege('authenticated', 'public._client_fold(uuid,uuid,boolean)', 'EXECUTE')
--     AND NOT has_function_privilege('authenticated', 'public._client_owner_for_key(text,uuid)', 'EXECUTE')   AS grants_locked,
--   has_function_privilege('authenticated', 'public.sync_client_from_quote(uuid,text)', 'EXECUTE')  AS rpc_callable,
--   (SELECT bool_and(prosecdef) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
--      ('_client_owner_for_key','_client_fold_row','_client_fold','clients_absorb_duplicate',
--       'clients_phone_change_guard','sync_client_from_quote','admin_merge_clients'))                AS all_definer,
--   pg_get_functiondef('public.sync_client_from_quote(uuid,text)'::regprocedure) LIKE '%q.created_by <> v_uid%'
--     AND pg_get_functiondef('public.sync_client_from_quote(uuid,text)'::regprocedure) LIKE '%_client_owner_for_key%'
--     AND pg_get_functiondef('public.clients_absorb_duplicate()'::regprocedure) LIKE '%RETURN NULL%'        AS text_intact;

-- =====================================================================
-- ROLLBACK (soft, no data touched): stop the folding and fall back to per-owner rows
--   DROP TRIGGER IF EXISTS trg_clients_absorb_duplicate ON public.clients;
--   DROP TRIGGER IF EXISTS trg_clients_phone_guard ON public.clients;
--   DROP INDEX IF EXISTS public.clients_phone_key_uk;
--   DROP FUNCTION IF EXISTS public.sync_client_from_quote(uuid, text);
-- The LAST line matters: the RPC itself still merges across owners until it is dropped. Once it
-- is gone the call errors "function not found" and src/utils/syncClient.js falls back to its
-- old per-owner upsert. Healed rows come back from public._bak_clients_p345 (see the phase file).
-- =====================================================================
