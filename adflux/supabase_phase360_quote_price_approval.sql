-- supabase_phase360_quote_price_approval.sql   (v2, 2026-10-13)
--
-- Phase 360 - a private-LED quote with ANY line priced below Rs 600 PER SCREEN
-- (per month) must be approved by admin (or a Sales Head other than its author)
-- before it can be sent. Owner decisions 2026-10-13:
--   * the rep can edit + save while it waits, but cannot send it
--   * admin AND Sales Head can approve (never their own work)
--   * no reason is asked for a price change (frontend)
--
-- HOW IT WORKS (one definition, section 71)
--   quote_price_approvals   one row per approval request (pending / approved /
--                           rejected / superseded / grandfathered). Each row
--                           carries line_rates = {line_key: rate} for the
--                           low lines it covers.
--   qpa_low_lines()         the quote's lines under the floor (NULL rate = 0).
--   qpa_uncovered_lines()   the low lines NOT covered by an approved /
--                           grandfathered row. A line is covered when the row
--                           holds that line at a rate <= its current rate.
--                           PER LINE: approving "Surat at 550" never covers a
--                           different city, nor Surat lowered to 400.
--   qpa_recheck_quote()     THE rule. Called by statement triggers on
--                           quote_cities, so EVERY writer is covered: wizard
--                           create + edit, renew, copy-last, Sales Head edit,
--                           old app bundles.
--   qpa_status_gate         BEFORE UPDATE trigger on quotes: a quote with an
--                           uncovered low line cannot go draft -> sent (admin
--                           sending = approves).
--   qpa_notify_*            push to approvers on a new request, push to the
--                           rep on the decision (quiet-hours gated).
--
-- LINE KEY (lockstep with src/utils/quotePriceGate.js lineKey):
--   COALESCE(city_id::text, lower(btrim(city_name)), row id)
--
-- SCOPE: segment PRIVATE + media_type LED_OTHER only (Other Media + Govt use
-- other units). The 600 floor lives in qpa_price_floor() and in
-- src/utils/quotePriceGate.js PRICE_FLOOR - LOCKSTEP, change both.
--
-- STICKY REJECTION: once a request is rejected, saving the SAME (or a lower)
-- price again does NOT open a new request - the quote stays blocked. Raising a
-- low line above its rejected rate, or an admin save, re-opens the question.
--
-- GRANDFATHER: every private-LED quote that was already sent / won / lost
-- before 2026-10-12 14:15:21 UTC and has a line below 600 gets a
-- 'grandfathered' row at its saved line rates, so nothing floods the queue and
-- a plain re-save of an old quote needs no approval. Bounded by that instant
-- so a later re-run of this file can never silently clear a NEW low quote.
--
-- The trigger on quote_cities NEVER raises (the wizard writes the quote, then
-- its lines, with no transaction across them; a raise would leave an orphan).
-- It only records the request. The status gate is the only place that refuses.
--
-- KNOWN LIMITS (documented, by design): an old app bundle can still INSERT a
-- quote straight at status 'sent' (insert, not update) - it is flagged pending
-- after the fact and the app locks its share buttons; a rep can still download
-- the PDF by hand. A quote can also go draft -> won without 'sent'. This is a
-- process control, not a vault.
--
-- Idempotent. Re-runnable. Ends with a VERIFY block.

BEGIN;
SET LOCAL lock_timeout = '3s';   -- fail fast instead of queueing behind a long write

-- ============================ PART 0 · preflight ============================
DO $pre$
DECLARE v_missing text[] := ARRAY[]::text[]; n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['get_my_role','is_sales_head','is_lead_quote_owner','enqueue_push','is_push_allowed_now']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
                    WHERE s.nspname='public' AND p.proname=n) THEN
      v_missing := v_missing || n;
    END IF;
  END LOOP;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 360 aborted: missing function(s): %', array_to_string(v_missing, ', ');
  END IF;
  IF to_regclass('public.quotes') IS NULL OR to_regclass('public.quote_cities') IS NULL THEN
    RAISE EXCEPTION 'Phase 360 aborted: quotes / quote_cities missing';
  END IF;
END
$pre$;

-- ============================ PART 1 · table ============================
CREATE TABLE IF NOT EXISTS public.quote_price_approvals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      uuid        NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  requested_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  min_rate      numeric     NOT NULL,
  floor_rate    numeric     NOT NULL DEFAULT 600,
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','superseded','grandfathered')),
  decided_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- v2: the per-line snapshot this row covers
ALTER TABLE public.quote_price_approvals
  ADD COLUMN IF NOT EXISTS line_rates jsonb NOT NULL DEFAULT '{}'::jsonb;

-- one open request per quote
CREATE UNIQUE INDEX IF NOT EXISTS qpa_one_pending_per_quote
  ON public.quote_price_approvals (quote_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS qpa_quote_idx
  ON public.quote_price_approvals (quote_id);
CREATE INDEX IF NOT EXISTS qpa_pending_created_idx
  ON public.quote_price_approvals (created_at DESC) WHERE status = 'pending';

-- ============================ PART 2 · the floor + the line helpers ============================
CREATE OR REPLACE FUNCTION public.qpa_price_floor()
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 600::numeric $$;

-- ONE definition of a line's identity (mirrored in quotePriceGate.js lineKey).
CREATE OR REPLACE FUNCTION public.qpa_line_key(p_city_id uuid, p_city_name text, p_row_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_city_id::text, NULLIF(lower(btrim(p_city_name)), ''), p_row_id::text)
$$;

-- {line_key: rate} for the lines under the floor. A NULL rate counts as 0.
CREATE OR REPLACE FUNCTION public.qpa_low_lines(p_quote_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(s.k, s.r), '{}'::jsonb)
    FROM (
      SELECT public.qpa_line_key(c.city_id, c.city_name, c.id) AS k,
             min(COALESCE(c.offered_rate, 0))                  AS r
        FROM public.quote_cities c
       WHERE c.quote_id = p_quote_id
       GROUP BY 1
      HAVING min(COALESCE(c.offered_rate, 0)) < public.qpa_price_floor()
    ) s
$$;

-- the low lines no approved / grandfathered row covers (covered = the row holds
-- that line at a rate <= the line's current rate)
CREATE OR REPLACE FUNCTION public.qpa_uncovered_lines(p_quote_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(l.key, l.value::numeric), '{}'::jsonb)
    FROM jsonb_each_text(public.qpa_low_lines(p_quote_id)) l
   WHERE NOT EXISTS (
           SELECT 1 FROM public.quote_price_approvals a
            WHERE a.quote_id = p_quote_id
              AND a.status IN ('approved','grandfathered')
              AND (a.line_rates ->> l.key) IS NOT NULL
              AND (a.line_rates ->> l.key)::numeric <= l.value::numeric)
$$;

-- lowest uncovered rate, NULL when nothing needs approval
CREATE OR REPLACE FUNCTION public.qpa_uncovered_min(p_quote_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT min(value::numeric) FROM jsonb_each_text(public.qpa_uncovered_lines(p_quote_id))
$$;

-- an ACTIVE Sales Head (is_sales_head alone ignores is_active). Policies run as
-- the caller, so authenticated must be able to execute it.
CREATE OR REPLACE FUNCTION public.qpa_is_active_head()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT u.is_sales_head AND u.is_active
                     FROM public.users u WHERE u.id = auth.uid()), false)
$$;

-- ============================ PART 3 · RLS + privileges ============================
ALTER TABLE public.quote_price_approvals ENABLE ROW LEVEL SECURITY;

-- Supabase hands every new table ALL privileges to authenticated (incl.
-- TRUNCATE, which RLS never checks). Take them all back, give back only what
-- the screens use: read, and decide (status + note). Inserts / line_rates /
-- everything else are done by the SECURITY DEFINER rule, never by a client.
REVOKE ALL ON public.quote_price_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.quote_price_approvals TO authenticated;
GRANT UPDATE (status, decision_note) ON public.quote_price_approvals TO authenticated;
GRANT ALL ON public.quote_price_approvals TO service_role;

DROP POLICY IF EXISTS qpa_admin_all ON public.quote_price_approvals;
CREATE POLICY qpa_admin_all ON public.quote_price_approvals
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- an ACTIVE Sales Head sees every request (to approve) ...
DROP POLICY IF EXISTS qpa_sales_head_read ON public.quote_price_approvals;
CREATE POLICY qpa_sales_head_read ON public.quote_price_approvals
  FOR SELECT TO authenticated
  USING (public.qpa_is_active_head());

-- ... and can decide a pending one, but never her own work: not a request she
-- raised, not a quote she created.
DROP POLICY IF EXISTS qpa_sales_head_decide ON public.quote_price_approvals;
CREATE POLICY qpa_sales_head_decide ON public.quote_price_approvals
  FOR UPDATE TO authenticated
  USING (
    public.qpa_is_active_head()
    AND status = 'pending'
    AND requested_by IS DISTINCT FROM auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.quotes q
                     WHERE q.id = quote_price_approvals.quote_id
                       AND q.created_by = auth.uid())
  )
  WITH CHECK (public.qpa_is_active_head() AND status IN ('approved','rejected'));

-- a rep sees the state of requests on quotes she created / raised / owns the lead of
DROP POLICY IF EXISTS qpa_owner_read ON public.quote_price_approvals;
CREATE POLICY qpa_owner_read ON public.quote_price_approvals
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.quotes q
                WHERE q.id = quote_price_approvals.quote_id
                  AND q.created_by = auth.uid())
    OR public.is_lead_quote_owner(quote_price_approvals.quote_id)
  );

-- ============================ PART 4 · row guard ============================
-- Identity never changes; only a pending row can be decided; a decision is
-- stamped from the caller, never from the payload and freezes the snapshot.
-- While a row stays pending the rule may refresh min_rate / line_rates /
-- requested_by in place (the latest editor owns the request).
-- A frozen row may still change in exactly two ways: user deletion nulls
-- requested_by / decided_by (FK SET NULL), and the one-time line_rates backfill.
CREATE OR REPLACE FUNCTION public.qpa_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    IF (to_jsonb(NEW) - 'requested_by' - 'decided_by' - 'line_rates')
         = (to_jsonb(OLD) - 'requested_by' - 'decided_by' - 'line_rates')
       AND (NEW.requested_by IS NULL OR NEW.requested_by IS NOT DISTINCT FROM OLD.requested_by)
       AND (NEW.decided_by   IS NULL OR NEW.decided_by   IS NOT DISTINCT FROM OLD.decided_by)
       AND (NEW.line_rates = OLD.line_rates OR OLD.line_rates = '{}'::jsonb)
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'This price request is already % and cannot be changed.', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.quote_id   := OLD.quote_id;
  NEW.created_at := OLD.created_at;

  IF NEW.status = 'pending' THEN
    RETURN NEW;                       -- in-place refresh by the rule
  ELSIF NEW.status IN ('approved','rejected') THEN
    IF NEW.status = 'rejected' AND btrim(COALESCE(NEW.decision_note,'')) = '' THEN
      RAISE EXCEPTION 'A reason is required to reject a price request.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.requested_by := OLD.requested_by;
    NEW.min_rate     := OLD.min_rate;
    NEW.floor_rate   := OLD.floor_rate;
    NEW.line_rates   := OLD.line_rates;
    NEW.decided_by   := auth.uid();
    NEW.decided_at   := now();
  ELSIF NEW.status = 'superseded' THEN
    NEW.decided_at := now();
  ELSE
    RAISE EXCEPTION 'Invalid price-request status %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_qpa_before_update ON public.quote_price_approvals;
CREATE TRIGGER trg_qpa_before_update
  BEFORE UPDATE ON public.quote_price_approvals
  FOR EACH ROW EXECUTE FUNCTION public.qpa_before_update();

-- ---- one-time backfill of rows written by v1 (no snapshot yet) ----
-- (runs AFTER the guard above is the v2 one: the v1 guard refuses to touch a frozen row)
-- Equivalent to v1 semantics: a row covered every current low line whose rate
-- is >= the row's min_rate. Idempotent: only touches rows still at '{}'.
UPDATE public.quote_price_approvals a
   SET line_rates = COALESCE((
         SELECT jsonb_object_agg(l.key, l.value::numeric)
           FROM jsonb_each_text(public.qpa_low_lines(a.quote_id)) l
          WHERE l.value::numeric >= a.min_rate), '{}'::jsonb)
 WHERE a.line_rates = '{}'::jsonb
   AND a.status IN ('approved','grandfathered','pending','rejected');

-- ============================ PART 5 · THE RULE ============================
CREATE OR REPLACE FUNCTION public.qpa_recheck_quote(p_quote_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_floor numeric := public.qpa_price_floor();
  v_seg   text;
  v_media text;
  v_uid   uuid := auth.uid();
  v_low   jsonb;
  v_unc   jsonb;
  v_min   numeric;
BEGIN
  SELECT segment, media_type INTO v_seg, v_media FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_seg IS DISTINCT FROM 'PRIVATE' OR v_media IS DISTINCT FROM 'LED_OTHER' THEN RETURN; END IF;

  -- mid-edit (the wizard deleted the lines, the insert follows): leave state alone
  IF NOT EXISTS (SELECT 1 FROM public.quote_cities WHERE quote_id = p_quote_id) THEN RETURN; END IF;

  v_low := public.qpa_low_lines(p_quote_id);

  -- nothing under the floor now -> any open request is moot
  IF v_low = '{}'::jsonb THEN
    UPDATE public.quote_price_approvals SET status = 'superseded'
     WHERE quote_id = p_quote_id AND status = 'pending';
    RETURN;
  END IF;

  v_unc := public.qpa_uncovered_lines(p_quote_id);

  -- the approver saved it: that is the approval (one row, only when something
  -- is actually uncovered, so repeated admin saves do not pile up rows)
  IF public.get_my_role() = 'admin' THEN
    UPDATE public.quote_price_approvals SET status = 'superseded'
     WHERE quote_id = p_quote_id AND status = 'pending';
    IF v_unc <> '{}'::jsonb THEN
      SELECT min(value::numeric) INTO v_min FROM jsonb_each_text(v_low);
      INSERT INTO public.quote_price_approvals
        (quote_id, requested_by, min_rate, floor_rate, line_rates, status, decided_by, decided_at, decision_note)
      VALUES (p_quote_id, v_uid, v_min, v_floor, v_low, 'approved', v_uid, now(), 'Saved by admin');
    END IF;
    RETURN;
  END IF;

  -- every low line is already approved at this price or lower
  IF v_unc = '{}'::jsonb THEN
    UPDATE public.quote_price_approvals SET status = 'superseded'
     WHERE quote_id = p_quote_id AND status = 'pending';
    RETURN;
  END IF;

  -- sticky rejection: a rejected request already covers this exact ask (every
  -- uncovered line is held by it at a rate >= the current one) -> do not re-ask
  IF EXISTS (
       SELECT 1 FROM public.quote_price_approvals r
        WHERE r.quote_id = p_quote_id AND r.status = 'rejected'
          AND NOT EXISTS (
                SELECT 1 FROM jsonb_each_text(v_unc) u
                 WHERE (r.line_rates ->> u.key) IS NULL
                    OR u.value::numeric > (r.line_rates ->> u.key)::numeric)
     ) THEN
    UPDATE public.quote_price_approvals SET status = 'superseded'
     WHERE quote_id = p_quote_id AND status = 'pending';
    RETURN;
  END IF;

  -- needs approval: open one request, or refresh the open one in place
  SELECT min(value::numeric) INTO v_min FROM jsonb_each_text(v_unc);
  INSERT INTO public.quote_price_approvals AS t
    (quote_id, requested_by, min_rate, floor_rate, line_rates)
  VALUES (p_quote_id, v_uid, v_min, v_floor, v_low)
  ON CONFLICT (quote_id) WHERE status = 'pending'
  DO UPDATE SET min_rate     = EXCLUDED.min_rate,
                floor_rate   = EXCLUDED.floor_rate,
                line_rates   = EXCLUDED.line_rates,
                requested_by = COALESCE(EXCLUDED.requested_by, t.requested_by)
          WHERE t.min_rate   IS DISTINCT FROM EXCLUDED.min_rate
             OR t.line_rates IS DISTINCT FROM EXCLUDED.line_rates;
END $$;

-- statement-level triggers on quote_cities. They NEVER raise.
CREATE OR REPLACE FUNCTION public.qpa_lines_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR r IN SELECT DISTINCT quote_id FROM old_rows WHERE quote_id IS NOT NULL LOOP
      PERFORM public.qpa_recheck_quote(r.quote_id);
    END LOOP;
  ELSE
    FOR r IN SELECT DISTINCT quote_id FROM new_rows WHERE quote_id IS NOT NULL LOOP
      PERFORM public.qpa_recheck_quote(r.quote_id);
    END LOOP;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'qpa_lines_changed failed (ignored): %', SQLERRM;
  RETURN NULL;
END $$;

-- The quote_cities / quotes triggers are created only when missing: their
-- definition has not changed since v1 and re-creating them would take a lock
-- on two hot tables for nothing.
DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qpa_lines_ins'
                   AND tgrelid = 'public.quote_cities'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_qpa_lines_ins
      AFTER INSERT ON public.quote_cities
      REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT EXECUTE FUNCTION public.qpa_lines_changed();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qpa_lines_upd'
                   AND tgrelid = 'public.quote_cities'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_qpa_lines_upd
      AFTER UPDATE ON public.quote_cities
      REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT EXECUTE FUNCTION public.qpa_lines_changed();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qpa_lines_del'
                   AND tgrelid = 'public.quote_cities'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_qpa_lines_del
      AFTER DELETE ON public.quote_cities
      REFERENCING OLD TABLE AS old_rows
      FOR EACH STATEMENT EXECUTE FUNCTION public.qpa_lines_changed();
  END IF;
END
$trg$;

-- ============================ PART 6 · send gate ============================
-- Computed from the quote's CURRENT lines, not from a pending row, so a REJECTED
-- request (no pending row left) still blocks, and a missing row cannot let a
-- low-priced quote through. The wizard replaces the lines BEFORE it promotes
-- the status (WizardShell edit order, Phase 360), so the gate sees fresh prices.
CREATE OR REPLACE FUNCTION public.qpa_status_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_min numeric;
BEGIN
  -- only an app user moving a quote INTO 'sent'; SQL / service role pass.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.segment IS DISTINCT FROM 'PRIVATE' OR NEW.media_type IS DISTINCT FROM 'LED_OTHER' THEN
    RETURN NEW;
  END IF;

  v_min := public.qpa_uncovered_min(NEW.id);
  IF v_min IS NULL THEN RETURN NEW; END IF;       -- nothing under the floor, or all covered

  IF public.get_my_role() = 'admin' THEN
    -- the approver sending it is the approval (records an 'approved' row)
    PERFORM public.qpa_recheck_quote(NEW.id);
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Waiting for admin approval: this quote has a price below Rs % per screen. You can send it once it is approved.',
    public.qpa_price_floor()::int
    USING ERRCODE = 'check_violation';
END $$;

DO $trg2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qpa_status_gate'
                   AND tgrelid = 'public.quotes'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_qpa_status_gate
      BEFORE UPDATE OF status ON public.quotes
      FOR EACH ROW
      WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent')
      EXECUTE FUNCTION public.qpa_status_gate();
  END IF;
END
$trg2$;

-- Moving a quote INTO or OUT OF the private-LED scope would dodge the rule
-- (flip to Other Media, send, flip back; or create as Other Media and flip in).
-- Nobody does this on purpose in the app (the wizards re-send equal values), so
-- only admin may change it. No effect when the values do not change.
CREATE OR REPLACE FUNCTION public.qpa_media_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;                       -- SQL / service role
  IF OLD.segment IS NOT DISTINCT FROM NEW.segment
     AND OLD.media_type IS NOT DISTINCT FROM NEW.media_type THEN RETURN NEW; END IF;
  IF NOT ((OLD.segment = 'PRIVATE' AND OLD.media_type = 'LED_OTHER')
       OR (NEW.segment = 'PRIVATE' AND NEW.media_type = 'LED_OTHER')) THEN RETURN NEW; END IF;
  IF public.get_my_role() = 'admin' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Only admin can change a quote between private LED and another media type.'
    USING ERRCODE = 'check_violation';
END $$;

-- a quote that is won or lost has no price question left: close any open request
CREATE OR REPLACE FUNCTION public.qpa_supersede_on_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.quote_price_approvals SET status = 'superseded'
   WHERE quote_id = NEW.id AND status = 'pending';
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'qpa_supersede_on_close failed (ignored): %', SQLERRM;
  RETURN NULL;
END $$;

DO $trg3$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qpa_media_guard'
                   AND tgrelid = 'public.quotes'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_qpa_media_guard
      BEFORE UPDATE OF segment, media_type ON public.quotes
      FOR EACH ROW EXECUTE FUNCTION public.qpa_media_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qpa_supersede_on_close'
                   AND tgrelid = 'public.quotes'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_qpa_supersede_on_close
      AFTER UPDATE OF status ON public.quotes
      FOR EACH ROW
      WHEN (NEW.status IN ('won','lost') AND OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION public.qpa_supersede_on_close();
  END IF;
END
$trg3$;

-- ============================ PART 7 · push ============================
-- Pull-only is how payments work; a held quote blocks a rep who is waiting, so
-- approvers also get a push. Quiet-hours gated, never fails the write. The
-- request tag is per QUOTE so repeated asks on one quote collapse into a single
-- tray entry; the page itself is the authority.
CREATE OR REPLACE FUNCTION public.qpa_notify_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_client text; v_rep text; r record;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  IF NOT public.is_push_allowed_now() THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(client_company,''), client_name, '-'), sales_person_name
    INTO v_client, v_rep
    FROM public.quotes WHERE id = NEW.quote_id;

  FOR r IN
    SELECT u.id, (u.role = 'admin') AS is_admin
      FROM public.users u
     WHERE u.is_active
       AND (u.role = 'admin' OR u.is_sales_head = true)
       AND u.id IS DISTINCT FROM NEW.requested_by
  LOOP
    PERFORM public.enqueue_push(
      r.id,
      'Quote needs price approval',
      v_client || ' - from Rs ' || to_char(NEW.min_rate, 'FM999999990') || '/screen'
        || COALESCE(' - ' || v_rep, ''),
      CASE WHEN r.is_admin THEN '/pending-approvals' ELSE '/quote-approvals' END,
      'qpa-' || NEW.quote_id::text
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'qpa_notify_request failed (ignored): %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_qpa_notify_request ON public.quote_price_approvals;
CREATE TRIGGER trg_qpa_notify_request
  AFTER INSERT ON public.quote_price_approvals
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.qpa_notify_request();

CREATE OR REPLACE FUNCTION public.qpa_notify_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_num text; v_creator uuid; v_title text; v_body text; v_to uuid;
BEGIN
  IF NOT public.is_push_allowed_now() THEN RETURN NEW; END IF;
  SELECT quote_number, created_by INTO v_num, v_creator FROM public.quotes WHERE id = NEW.quote_id;

  IF NEW.status = 'approved' THEN
    v_title := 'Quote price approved';
    v_body  := COALESCE(v_num, 'Quote') || ' - you can send it now';
  ELSE
    v_title := 'Quote price rejected';
    v_body  := COALESCE(v_num, 'Quote') || ' - ' || COALESCE(left(NEW.decision_note, 80), 'please revise the price');
  END IF;

  FOR v_to IN
    SELECT DISTINCT x FROM unnest(ARRAY[NEW.requested_by, v_creator]) AS x
     WHERE x IS NOT NULL AND x IS DISTINCT FROM NEW.decided_by
  LOOP
    PERFORM public.enqueue_push(v_to, v_title, v_body, '/quotes/' || NEW.quote_id::text, 'qpad-' || NEW.id::text);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'qpa_notify_decision failed (ignored): %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_qpa_notify_decision ON public.quote_price_approvals;
CREATE TRIGGER trg_qpa_notify_decision
  AFTER UPDATE OF status ON public.quote_price_approvals
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status IN ('approved','rejected'))
  EXECUTE FUNCTION public.qpa_notify_decision();

-- ============================ PART 8 · lock the functions ============================
-- Trigger functions need no grant to fire. Nothing here is client-callable
-- except qpa_is_active_head (a policy helper that returns the caller's own flag)
-- and the pure helpers qpa_price_floor / qpa_line_key.
-- Every name in this list MUST also be in supabase_phase211_anon_execute_sweep.sql.
REVOKE EXECUTE ON FUNCTION public.qpa_before_update()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_recheck_quote(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_lines_changed()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_status_gate()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_media_guard()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_supersede_on_close()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_notify_request()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_notify_decision()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_low_lines(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_uncovered_lines(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qpa_uncovered_min(uuid)       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.qpa_recheck_quote(uuid)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.qpa_low_lines(uuid)           TO service_role;
GRANT  EXECUTE ON FUNCTION public.qpa_uncovered_lines(uuid)     TO service_role;
GRANT  EXECUTE ON FUNCTION public.qpa_uncovered_min(uuid)       TO service_role;
REVOKE EXECUTE ON FUNCTION public.qpa_is_active_head()          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.qpa_is_active_head()          TO authenticated, service_role;

-- ============================ PART 9 · realtime ============================
DO $rt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'quote_price_approvals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_price_approvals;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'realtime publication add skipped: %', SQLERRM;
END
$rt$;

-- ============================ PART 10 · grandfather ============================
-- Quotes that were already out the door before the rule are allowed at their
-- saved line rates. Bounded by the first apply instant so a re-run of this
-- file can never silently clear a NEW low-priced quote; drafts are not
-- grandfathered (they never reached a client). Idempotent: only quotes with
-- no row yet.
INSERT INTO public.quote_price_approvals
  (quote_id, requested_by, min_rate, floor_rate, line_rates, status, decided_at, decision_note)
SELECT q.id, q.created_by,
       (SELECT min(v.value::numeric) FROM jsonb_each_text(lr.l) v),
       public.qpa_price_floor(), lr.l, 'grandfathered', now(),
       'Existing quote - allowed at its saved price (before price approval began)'
  FROM public.quotes q
 CROSS JOIN LATERAL (SELECT public.qpa_low_lines(q.id) AS l) lr
 WHERE q.segment = 'PRIVATE' AND q.media_type = 'LED_OTHER'
   AND q.created_at <= TIMESTAMPTZ '2026-10-12 14:15:21+00'
   AND q.status <> 'draft'
   AND lr.l <> '{}'::jsonb
   AND NOT EXISTS (SELECT 1 FROM public.quote_price_approvals a WHERE a.quote_id = q.id);

-- ============================ PART 11 · server send gate ============================
-- ONE definition of "this quote's price is under the floor and not cleared" for the
-- server-side senders that run as the service role and so skip RLS and the status
-- trigger: api/wa/send.js (inbox "send quote") and api/wa/team-assistant.js
-- (SENDPDF). They call this and refuse with 409 when it returns true. The caller
-- exempts admin itself (an admin sending IS the approval). service_role only.
CREATE OR REPLACE FUNCTION public.qpa_quote_send_blocked(p_quote_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT q.segment = 'PRIVATE' AND q.media_type = 'LED_OTHER'
       AND public.qpa_uncovered_min(q.id) IS NOT NULL
      FROM public.quotes q
     WHERE q.id = p_quote_id
  ), false)
$$;
REVOKE EXECUTE ON FUNCTION public.qpa_quote_send_blocked(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.qpa_quote_send_blocked(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================ VERIFY ============================
-- expected: table_present 1 | line_rates_col 1 | rls_on true | policies 4 | triggers_core 8
--           fns_locked true | auth_privs_ok true | backfilled 0 | unprotected 0
-- SELECT
--   (to_regclass('public.quote_price_approvals') IS NOT NULL)::int                       AS table_present,
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
--      AND table_name='quote_price_approvals' AND column_name='line_rates')              AS line_rates_col,
--   (SELECT relrowsecurity FROM pg_class WHERE oid='public.quote_price_approvals'::regclass) AS rls_on,
--   (SELECT count(*) FROM pg_policies WHERE tablename='quote_price_approvals')           AS policies,
--   (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
--      ('trg_qpa_lines_ins','trg_qpa_lines_upd','trg_qpa_lines_del','trg_qpa_status_gate','trg_qpa_before_update',
--       'trg_qpa_media_guard','trg_qpa_supersede_on_close','trg_qpa_notify_request'))   AS triggers_core,
--   (SELECT bool_and(NOT has_function_privilege('anon', p.oid,'EXECUTE')
--                AND NOT has_function_privilege('authenticated', p.oid,'EXECUTE'))
--      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND p.proname IN ('qpa_before_update','qpa_recheck_quote','qpa_lines_changed',
--       'qpa_status_gate','qpa_media_guard','qpa_supersede_on_close','qpa_notify_request','qpa_notify_decision',
--       'qpa_low_lines','qpa_uncovered_lines','qpa_uncovered_min','qpa_quote_send_blocked')) AS fns_locked,
--   (SELECT NOT (has_table_privilege('authenticated','public.quote_price_approvals','INSERT')
--             OR has_table_privilege('authenticated','public.quote_price_approvals','DELETE')
--             OR has_table_privilege('authenticated','public.quote_price_approvals','TRUNCATE')
--             OR has_table_privilege('anon','public.quote_price_approvals','SELECT')))   AS auth_privs_ok,
--   (SELECT count(*) FROM public.quote_price_approvals
--     WHERE status IN ('approved','grandfathered') AND line_rates = '{}'::jsonb
--       AND public.qpa_low_lines(quote_id) <> '{}'::jsonb)                               AS backfilled_gap,
--   (SELECT count(*) FROM public.quotes q
--     WHERE q.segment='PRIVATE' AND q.media_type='LED_OTHER' AND q.status <> 'draft'
--       AND public.qpa_low_lines(q.id) <> '{}'::jsonb
--       AND NOT EXISTS (SELECT 1 FROM public.quote_price_approvals a WHERE a.quote_id=q.id)) AS unprotected;
