-- supabase_phase98_a_quiet_hours_3_triggers.sql
--
-- Phase 98.A — close F-D010 quiet-hours gap on 3 push triggers.
--
-- BACKGROUND
-- ──────────
-- Phase 61.4 (`supabase_phase61_4_quiet_hours.sql`) added the
-- `is_push_allowed_now()` gate around `enqueue_push(...)` for the
-- 2 most chatty rep-facing triggers:
--   * tg_push_on_lead_task_insert (smart-task push)
--   * tg_push_on_followup_due     (follow-up CREATE push)
--   * enqueue_attendance_reminder (attendance flow)
--
-- 3 Phase 33W triggers were NEVER patched and still fire 24x7:
--   1. tg_push_on_lead_assign       (reassignment / new lead)
--   2. tg_push_on_payment_approved  (admin Approve click)
--   3. tg_push_on_quote_won         (status flips to 'won')
--
-- Live audit on 2026-05-28 confirmed `has_gate=false` on all three
-- via `pg_get_functiondef() ILIKE '%is_push_allowed_now%'`. Owner
-- reproduced the symptom 22 May 2026 ("Dhara got notification at
-- 23:21 IST"). Without a gate, admin actions late at night wake
-- reps mid-sleep.
--
-- FIX
-- ───
-- Re-create each of the 3 trigger functions with the SAME body as
-- Phase 33W EXCEPT the `PERFORM public.enqueue_push(...)` call is
-- wrapped in:
--
--   IF public.is_push_allowed_now() THEN
--     PERFORM public.enqueue_push(...);
--   END IF;
--
-- Matches the Phase 61.4 pattern byte-for-byte. No body logic
-- otherwise changes. Trigger DDL itself is untouched (no DROP
-- TRIGGER / CREATE TRIGGER — only the body of the function the
-- trigger calls).
--
-- IDEMPOTENCY
-- ───────────
-- `CREATE OR REPLACE FUNCTION` × 3 + `NOTIFY pgrst, 'reload schema'`.
-- No DROP TRIGGER. No data write. Re-runnable.
--
-- SCOPE
-- ─────
-- This migration closes F-D010 only. It does NOT touch:
--   * Body logic outside the wrap (counter math, payload text)
--   * tg_push_on_lead_task_insert (already gated by Phase 61.4)
--   * tg_push_on_followup_due     (already gated by Phase 61.4)
--   * enqueue_attendance_reminder (already gated by Phase 61.4)
--   * The trigger DDL (AFTER INSERT OR UPDATE) — unchanged
--   * `is_push_allowed_now()` itself — Phase 61.4 helper
--   * Any rep-side JS, Edge Function, or APK


-- ─── 1. tg_push_on_lead_assign ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_push_on_lead_assign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body  text;
BEGIN
  -- INSERT with assignee, OR UPDATE to a different assignee.
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL)
     OR (TG_OP = 'UPDATE'
         AND NEW.assigned_to IS NOT NULL
         AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    v_title := 'New lead: ' || COALESCE(NEW.name, NEW.company, 'unnamed');
    v_body  := COALESCE(NEW.company, '') ||
               CASE WHEN NEW.phone IS NOT NULL THEN ' · ' || NEW.phone ELSE '' END;
    -- Phase 98.A — quiet-hours gate.
    IF public.is_push_allowed_now() THEN
      PERFORM public.enqueue_push(
        NEW.assigned_to,
        v_title,
        v_body,
        '/leads/' || NEW.id::text,
        'lead-' || NEW.id::text
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;


-- ─── 2. tg_push_on_payment_approved ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_push_on_payment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote record;
  v_title text;
  v_body  text;
BEGIN
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;

  SELECT created_by, client_company, client_name, total_amount,
         COALESCE(quote_number, id::text) AS label
    INTO v_quote
    FROM quotes WHERE id = NEW.quote_id;
  IF NOT FOUND OR v_quote.created_by IS NULL THEN RETURN NEW; END IF;

  v_title := 'Payment received · ₹' || to_char(NEW.amount_received, 'FM99,99,99,999');
  v_body  := COALESCE(v_quote.client_company, v_quote.client_name, '') ||
             ' · ' || v_quote.label;
  -- Phase 98.A — quiet-hours gate.
  IF public.is_push_allowed_now() THEN
    PERFORM public.enqueue_push(
      v_quote.created_by,
      v_title,
      v_body,
      '/quotes/' || NEW.quote_id::text,
      'payment-' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END $$;


-- ─── 3. tg_push_on_quote_won ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_push_on_quote_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'won' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'won' THEN RETURN NEW; END IF;
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;

  -- Phase 98.A — quiet-hours gate.
  IF public.is_push_allowed_now() THEN
    PERFORM public.enqueue_push(
      NEW.created_by,
      'Quote Won · ₹' || to_char(NEW.total_amount, 'FM99,99,99,999'),
      COALESCE(NEW.client_company, NEW.client_name, '') || ' · ' ||
        COALESCE(NEW.quote_number, NEW.id::text) || ' — collect next',
      '/quotes/' || NEW.id::text,
      'won-' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END $$;


NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Run all 3 after applying. Each must return the expected result.
--
-- 1. All 5 push triggers now carry the quiet-hours gate (5 rows,
--    all `has_gate=true`):
--
--    SELECT proname,
--           pg_get_functiondef(oid) ILIKE '%is_push_allowed_now%' AS has_gate
--      FROM pg_proc
--     WHERE proname IN (
--         'tg_push_on_lead_assign',
--         'tg_push_on_payment_approved',
--         'tg_push_on_quote_won',
--         'tg_push_on_lead_task_insert',
--         'tg_push_on_followup_due'
--       )
--     ORDER BY proname;
--    -- Expected: 5 rows, has_gate=true on every row.
--
-- 2. The 3 trigger DDL bindings are still in place — function
--    rewrite did not detach the trigger:
--
--    SELECT t.tgname, c.relname AS table_name, p.proname AS function
--      FROM pg_trigger t
--      JOIN pg_class c ON c.oid = t.tgrelid
--      JOIN pg_proc  p ON p.oid = t.tgfoid
--     WHERE p.proname IN (
--         'tg_push_on_lead_assign',
--         'tg_push_on_payment_approved',
--         'tg_push_on_quote_won'
--       )
--       AND NOT t.tgisinternal
--     ORDER BY p.proname;
--    -- Expected: 3 rows, each binding the function to the right table.
--
-- 3. PostgREST schema reload landed:
--
--    SELECT 1;
--    -- Returns 1.


-- ───────────── ROLLBACK ─────────────
-- Re-apply ONLY if the quiet-hours gate is later shown to suppress
-- a legitimate push that owner WANTS at night. Restores the
-- Phase 33W function bodies byte-identical. Re-opens F-D010.
--
--   CREATE OR REPLACE FUNCTION public.tg_push_on_lead_assign() ...
--     (Phase 33W body with `PERFORM public.enqueue_push(...)` NOT
--      wrapped in `IF public.is_push_allowed_now() THEN ... END IF;`)
--
--   CREATE OR REPLACE FUNCTION public.tg_push_on_payment_approved() ...
--     (same restore)
--
--   CREATE OR REPLACE FUNCTION public.tg_push_on_quote_won() ...
--     (same restore)
--
--   NOTIFY pgrst, 'reload schema';
--
-- Full byte-identical rollback bodies live in
-- `supabase_phase33w_push_triggers.sql:103-197`. Paste from there
-- if rollback is needed.
