-- =====================================================================
-- supabase_phase130_push_hygiene.sql — batch 4 (push hygiene), SQL half
-- 2026-06-12  (JS half = commit b8de89d: alarm cancels + regen throttle)
--
-- 1. generate_lead_tasks: preserve snoozed rows + stop per-refocus push
--    spam (stable UUIDs via ON CONFLICT) + Phase 97.2 self-or-admin gate.
--    Canonical body base: supabase_phase34z48 (rules byte-preserved).
-- 2. Lead reassign now transfers OPEN follow_ups old owner -> new owner
--    (AFTER UPDATE OF assigned_to, telecaller_id) + one-time heal.
--    Push-silent by design: tg_push_followup_due fires only on
--    UPDATE OF follow_up_date, is_done (34Z.55) — not on assigned_to.
-- 3. push_followup_due_reminders: quiet-hours gate (98.A pattern),
--    per-row 'fu-due-<id>' tag (97.A400) preserved.
-- 4. Payments: auto-close open 'Payment collection%' follow_ups when a
--    quote reaches fully paid (phase118 outstanding semantics) + heal.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Trigger
-- bodies EXCEPTION-wrapped — a reassign / payment write can never fail
-- because of follow-up housekeeping. Frozen contracts untouched:
-- cadence types, followup_after_done (truth1), 128.3/129 pause-close,
-- 34Z.55 trigger DDL, enqueue_push.
-- =====================================================================


-- ─── 1. generate_lead_tasks — snooze-safe, push-stable, gated ────────
-- -------------------------------------------------------------------------
-- generate_lead_tasks REMOVED from this file (Phase 178 consolidation).
-- The ONE canonical version now lives in: db/functions/generate_lead_tasks.sql
-- Do NOT re-add it here. To change it, edit the canonical file only (§71).
-- -------------------------------------------------------------------------


-- ─── 2. Reassign transfers open follow_ups to the new owner ──────────
-- Catches EVERY owner-change path (reassign_lead RPC, campaign inbox
-- direct write, any future admin edit). Only rows assigned to the OLD
-- owner move (manual + auto — they belong to the lead). Rows assigned
-- to someone who REMAINS an owner (e.g. TC kept while sales changes)
-- stay put. Quote-tied payment FUs have lead_id NULL -> untouched.
CREATE OR REPLACE FUNCTION public.lead_owner_change_transfer_followups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_owner uuid;
BEGIN
  v_new_owner := COALESCE(NEW.assigned_to, NEW.telecaller_id);
  IF v_new_owner IS NULL THEN
    RETURN NEW;                       -- never transfer to nobody
  END IF;
  IF NEW.assigned_to   IS NOT DISTINCT FROM OLD.assigned_to
     AND NEW.telecaller_id IS NOT DISTINCT FROM OLD.telecaller_id THEN
    RETURN NEW;                       -- defensive: no real owner change
  END IF;

  -- EXCEPTION-wrapped: a reassign must never fail on FU housekeeping.
  BEGIN
    UPDATE public.follow_ups fu
       SET assigned_to = v_new_owner
     WHERE fu.lead_id = NEW.id
       AND fu.is_done = false
       AND fu.assigned_to IS NOT NULL
       AND fu.assigned_to IN (OLD.assigned_to, OLD.telecaller_id)
       AND fu.assigned_to IS DISTINCT FROM NEW.assigned_to
       AND fu.assigned_to IS DISTINCT FROM NEW.telecaller_id;
    -- Push note: tg_push_followup_due is UPDATE OF follow_up_date,
    -- is_done (34Z.55) -> this UPDATE fires NO push. The new owner is
    -- told via the existing quiet-hours-gated reassign push, and the
    -- fu-due cron / morning digest read assigned_to live from now on.
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_owner_change_transfer_followups skipped for lead %: %',
                  NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_owner_change_transfer_fu ON public.leads;
CREATE TRIGGER trg_lead_owner_change_transfer_fu
  AFTER UPDATE OF assigned_to, telecaller_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_owner_change_transfer_followups();

-- One-time heal: open lead-tied FUs whose assignee is no longer ANY
-- current owner of the lead -> current owner. assigned_to-only UPDATE
-- (fires neither tg_push_followup_due nor followup_after_done).
UPDATE public.follow_ups fu
   SET assigned_to = COALESCE(l.assigned_to, l.telecaller_id)
  FROM public.leads l
 WHERE l.id = fu.lead_id
   AND fu.is_done = false
   AND fu.assigned_to IS NOT NULL
   AND COALESCE(l.assigned_to, l.telecaller_id) IS NOT NULL
   AND fu.assigned_to IS DISTINCT FROM l.assigned_to
   AND fu.assigned_to IS DISTINCT FROM l.telecaller_id;


-- ─── 3. push_followup_due_reminders — quiet-hours gate (98.A) ────────
-- Body = Phase 97.A400 (per-row 'fu-due-<id>' tag) + the gate. Early
-- return: rows due inside quiet hours stay unstamped and their 5-min
-- window passes -> dropped, same net effect as the 98.A trigger gates;
-- the 9:30 IST morning push still rolls up anything open.
-- -------------------------------------------------------------------------
-- push_followup_due_reminders REMOVED from this file (Phase 178).
-- Canonical: db/functions/push_followup_due_reminders.sql (cron; quiet-hours + per-row tag).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.push_followup_due_reminders() TO authenticated;


-- ─── 4. Fully-paid quote auto-closes payment-collection FUs ──────────
-- Creator: phase33g (3 FUs on Won, quote_id set, lead_id NULL, note
-- 'Payment collection%'). Outstanding semantics mirror phase118
-- my_chase_counts: approved-or-legacy-NULL payments vs total_amount.
-- Close-side cascade is safe: tg_push_followup_due early-returns on
-- is_done=true; followup_after_done early-returns on lead_id NULL.
CREATE OR REPLACE FUNCTION public.payment_close_collection_followups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_paid  numeric;
BEGIN
  IF NEW.quote_id IS NULL THEN RETURN NEW; END IF;

  -- EXCEPTION-wrapped: a payment insert/approval must never fail here.
  BEGIN
    SELECT q.total_amount INTO v_total
      FROM public.quotes q
     WHERE q.id = NEW.quote_id;
    IF NOT FOUND OR COALESCE(v_total, 0) <= 0 THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(p.amount_received), 0) INTO v_paid
      FROM public.payments p
     WHERE p.quote_id = NEW.quote_id
       AND (p.approval_status IS NULL OR p.approval_status = 'approved');

    IF v_paid >= v_total THEN
      UPDATE public.follow_ups
         SET is_done   = true,
             done_at   = COALESCE(done_at, now()),
             done_note = COALESCE(done_note, 'Auto-closed: quote fully paid')
       WHERE quote_id = NEW.quote_id
         AND is_done = false
         AND note LIKE 'Payment collection%';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'payment_close_collection_followups skipped for quote %: %',
                  NEW.quote_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_close_collection_fu ON public.payments;
CREATE TRIGGER trg_payment_close_collection_fu
  AFTER INSERT OR UPDATE OF approval_status, amount_received ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_close_collection_followups();

-- One-time heal: close open payment FUs on quotes ALREADY fully paid.
UPDATE public.follow_ups fu
   SET is_done   = true,
       done_at   = COALESCE(fu.done_at, now()),
       done_note = COALESCE(fu.done_note, 'Auto-closed: quote fully paid (heal)')
  FROM public.quotes q
 WHERE q.id = fu.quote_id
   AND fu.is_done = false
   AND fu.note LIKE 'Payment collection%'
   AND COALESCE(q.total_amount, 0) > 0
   AND COALESCE(
         (SELECT SUM(p.amount_received)
            FROM public.payments p
           WHERE p.quote_id = q.id
             AND (p.approval_status IS NULL OR p.approval_status = 'approved')),
         0
       ) >= q.total_amount;


-- ─── self-register ───────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase130_push_hygiene.sql',
            'Batch 4 - smart-task snooze/push/gate + reassign FU transfer + quiet-hours fu-due cron + payment FU auto-close')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────────
-- 1. generate_lead_tasks hygiene (expect: has_gate=t, deletes_open_only=t,
--    snooze_wipe_gone=t):
SELECT
  pg_get_functiondef(p.oid) ILIKE '%_assert_self_or_admin%'                 AS has_gate,
  pg_get_functiondef(p.oid) ILIKE '%status = ''open''%'                     AS deletes_open_only,
  pg_get_functiondef(p.oid) NOT ILIKE '%NOT IN (''done'', ''skipped'')%'    AS snooze_wipe_gone
FROM pg_proc p
WHERE p.proname = 'generate_lead_tasks'
  AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';

-- 2. New triggers present (expect: transfer_trg=1, pay_close_trg=1):
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_lead_owner_change_transfer_fu') AS transfer_trg,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_payment_close_collection_fu')   AS pay_close_trg;

-- 3. Quiet-hours gate + A400 tag both in the cron fn (expect: t, t):
SELECT
  pg_get_functiondef(oid) ILIKE '%is_push_allowed_now%' AS cron_gated,
  pg_get_functiondef(oid) ILIKE '%fu-due-%'             AS a400_tag_kept
FROM pg_proc WHERE proname = 'push_followup_due_reminders';

-- 4. Heals landed (expect: orphan_fus=0, paid_open_fus=0):
SELECT
  (SELECT count(*)
     FROM public.follow_ups fu
     JOIN public.leads l ON l.id = fu.lead_id
    WHERE fu.is_done = false
      AND fu.assigned_to IS NOT NULL
      AND COALESCE(l.assigned_to, l.telecaller_id) IS NOT NULL
      AND fu.assigned_to IS DISTINCT FROM l.assigned_to
      AND fu.assigned_to IS DISTINCT FROM l.telecaller_id) AS orphan_fus,
  (SELECT count(*)
     FROM public.follow_ups fu
     JOIN public.quotes q ON q.id = fu.quote_id
    WHERE fu.is_done = false
      AND fu.note LIKE 'Payment collection%'
      AND COALESCE(q.total_amount, 0) > 0
      AND COALESCE(
            (SELECT SUM(p.amount_received)
               FROM public.payments p
              WHERE p.quote_id = q.id
                AND (p.approval_status IS NULL OR p.approval_status = 'approved')),
            0
          ) >= q.total_amount) AS paid_open_fus;

SELECT 'Phase 130 push hygiene applied' AS status;
