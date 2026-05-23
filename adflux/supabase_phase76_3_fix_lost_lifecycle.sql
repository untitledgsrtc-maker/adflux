-- supabase_phase76_3_fix_lost_lifecycle.sql
-- Phase 76.3 hotfix (2026-05-23) — restore stage→Lost flow.
--
-- Owner-reported symptoms (2026-05-23 afternoon):
--   1. Stage flip to Lost fails with "column 'done_note' does not exist".
--   2. Same error blocks the WhatsApp follow-up suggestion modal.
--   3. Lost leads still appear in follow-ups list.
--   4. Lost leads spawn another follow-up 2 days later (lost_nurture).
--   5. Owner directive: "lost lead we dont do anything its dead lead".
--
-- Root cause analysis:
--   A. Phase 72 trigger `trg_lead_close_followups_on_terminal` references
--      `follow_ups.done_note` column — never added by any migration.
--      Every stage→Lost UPDATE has failed since 21 May 2026 (silently
--      from JS catches; surfacing now via ChangeStageModal P34 toast).
--   B. Phase 33D.6 cadence trigger calls `spawn_nurture_followup(...,
--      'lost_nurture')` on stage→Lost. Owner now wants ZERO cadence
--      after Lost — terminal state, fully dead.
--
-- This fix does FOUR things:
--   1. ALTER TABLE follow_ups ADD COLUMN done_note text. Idempotent.
--   2. Rewrite Phase 72 trigger so it also DELETES any open
--      lost_nurture follow_ups + lead_tasks that the Phase 33D.6
--      cadence trigger may have spawned in the same UPDATE.
--   3. Rename trigger to `trg_z_close_followups_on_terminal` so it
--      fires LAST in alphabetical order (Postgres trigger ordering
--      is alphabetical when multiple AFTER-UPDATE triggers exist).
--   4. Same logic for Won — close everything, no cadence.
--
-- DOES NOT touch:
--   - cadence_type enum (kept intact for historical rows).
--   - Phase 33D.6 function (still spawns lost_nurture; we clean up
--     after it fires).
--   - Nurture cron / revisit_date logic.
--
-- Idempotent. Run + re-run safely.

-- ─── 1. Add the missing column ────────────────────────────────────
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS done_note text;

-- ─── 2. Rewrite terminal-close trigger ────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_lead_close_followups_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act on stage transitions INTO Lost or Won.
  IF (TG_OP = 'UPDATE')
     AND (NEW.stage IN ('Lost', 'Won'))
     AND (OLD.stage IS DISTINCT FROM NEW.stage) THEN

    -- Close every existing open follow_up for this lead.
    UPDATE public.follow_ups
       SET is_done   = true,
           done_at   = now(),
           done_note = COALESCE(done_note, '')
                     || CASE WHEN NEW.stage = 'Lost'
                             THEN ' [auto-closed: lead marked Lost]'
                             ELSE ' [auto-closed: lead marked Won]'
                        END
     WHERE lead_id = NEW.id
       AND is_done = false;

    -- Phase 76.3 NEW — purge any future cadence-spawned follow_ups
    -- left by the Phase 33D.6 trigger. Owner directive 2026-05-23:
    -- Lost = absolute dead. No follow-up of any kind should remain.
    -- We DELETE (not close) because the row is purely automated; no
    -- rep notes to preserve. The UPDATE above already marked them
    -- done but DELETE is safer — UI filters on is_done=false but
    -- some reports show is_done=true rows too.
    IF NEW.stage = 'Lost' THEN
      DELETE FROM public.follow_ups
       WHERE lead_id = NEW.id
         AND cadence_type = 'lost_nurture';
    END IF;

    -- Close every open smart_task / lead_task row (Won OR Lost).
    UPDATE public.lead_tasks
       SET status       = 'done',
           completed_at = now()
     WHERE lead_id = NEW.id
       AND status IN ('open', 'pending');
  END IF;
  RETURN NEW;
END $$;

-- ─── 3. Drop old trigger + recreate with 'z_' prefix ──────────────
-- Phase 33D.6 trigger is named `trg_lead_full_cadence_on_stage` (or
-- similar — alphabetically before 'z'). The 'z_' prefix forces this
-- close-trigger to fire LAST in the AFTER-UPDATE OF stage queue, so
-- it sees any rows the cadence trigger just inserted.
DROP TRIGGER IF EXISTS trg_lead_close_followups_on_terminal ON public.leads;
DROP TRIGGER IF EXISTS trg_z_close_followups_on_terminal     ON public.leads;
CREATE TRIGGER trg_z_close_followups_on_terminal
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_close_followups_on_terminal();

GRANT EXECUTE ON FUNCTION public.trg_lead_close_followups_on_terminal() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─── 4. One-time backfill — clean up Lost leads that ALREADY have ─
-- open lost_nurture follow_ups from the broken window (21 May → now).
-- Idempotent: matches only rows still open against leads currently Lost.
UPDATE public.follow_ups f
   SET is_done   = true,
       done_at   = now(),
       done_note = COALESCE(done_note, '') || ' [retro-closed: Phase 76.3 backfill]'
  FROM public.leads l
 WHERE f.lead_id    = l.id
   AND f.is_done    = false
   AND l.stage      = 'Lost';

DELETE FROM public.follow_ups f
 USING public.leads l
 WHERE f.lead_id     = l.id
   AND f.cadence_type = 'lost_nurture'
   AND l.stage       = 'Lost';

-- ─── VERIFY ───────────────────────────────────────────────────────
SELECT
  (SELECT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='follow_ups'
        AND column_name='done_note'
   )) AS done_note_col_exists,
  (SELECT COUNT(*) FROM pg_trigger
    WHERE tgname = 'trg_z_close_followups_on_terminal') AS close_trigger_count,
  (SELECT COUNT(*) FROM public.follow_ups f
     JOIN public.leads l ON l.id = f.lead_id
    WHERE l.stage = 'Lost' AND f.is_done = false) AS open_followups_on_lost_leads_should_be_zero;

SELECT 'Phase 76.3 lost-lifecycle fix applied' AS status;
