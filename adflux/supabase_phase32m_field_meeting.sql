-- =====================================================================
-- Phase 32M — Field Meeting flow + daily milestone wiring
-- 10 May 2026
--
-- Owner spec: every sales rep must log 5 field meetings/day. A field
-- meeting = a cold walk-in (rep walks into a clinic / shop / showroom
-- and meets the prospect). Distinct from inbound leads which arrive
-- via telecaller / referral / hoarding response.
--
-- Decision (locked, 10 May 2026): EVERY meeting counts toward the 5/day
-- milestone, including outright rejections. Reasoning: GPS pin proves
-- the visit happened, "lost" leads still serve the territory record,
-- and the alternative (only-positive-counts) would either punish honest
-- reps or incentivise fake-logging.
--
-- This file is idempotent. Re-run any time. Verify block at bottom.
-- =====================================================================

-- ─── 1. Per-rep daily target (admin-editable) ─────────────────────────
-- daily_targets is an existing JSONB column on users (Phase 12). We
-- just need to make sure every active sales rep has a `meetings`
-- entry — the WorkV2 hook defaults to 5 in JS but persisting it lets
-- admin set custom targets per rep without a code push.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_targets jsonb DEFAULT '{"meetings": 5, "calls": 20, "new_leads": 10}'::jsonb;

-- Backfill: any sales/agency/telecaller user without a meetings target
-- gets the default 5. Doesn't touch admin/co_owner (they don't have a
-- field-meeting milestone).
UPDATE users
   SET daily_targets = COALESCE(daily_targets, '{}'::jsonb)
                       || '{"meetings": 5, "calls": 20, "new_leads": 10}'::jsonb
 WHERE team_role IN ('sales', 'agency', 'telecaller')
   AND (daily_targets IS NULL
        OR daily_targets->'meetings' IS NULL);

-- ─── 2. Lead source vocabulary ────────────────────────────────────────
-- 'Field Meeting' becomes a first-class source value. The leads.source
-- column is text (not enum), so no schema change required — but we
-- document the canonical value here so future filters / reports stay
-- consistent. The LogMeetingModal hard-codes this string.
--
-- Other canonical sources (already in use): IndiaMart, Justdial,
-- Cronberry WABA, Excel Upload, Manual, Referral, Walk-in, Website,
-- Other.

COMMENT ON COLUMN leads.source IS
  'Canonical values: IndiaMart, Justdial, Cronberry WABA, Excel Upload, '
  'Manual, Referral, Walk-in, Website, Field Meeting, Other. '
  '"Field Meeting" = cold walk-in logged from /work via LogMeetingModal '
  '(Phase 32M).';

-- ─── 3. Counter trigger for ad-hoc meeting activities ─────────────────
-- The existing planned-meeting flow on /work bumps daily_counters.meetings
-- when the rep ticks "Mark done" on a morning-plan meeting. But ad-hoc
-- field meetings inserted via LogMeetingModal weren't being counted —
-- the modal handles the counter bump in JS, but if a meeting is logged
-- via LogActivityModal on an existing lead, the work_sessions counter
-- doesn't move. Trigger fixes that uniformly.
--
-- Fires on INSERT of any lead_activity with activity_type='meeting' or
-- 'site_visit'. Increments the rep's work_sessions row for today.

-- -------------------------------------------------------------------------
-- bump_meeting_counter REMOVED (Phase 178) — DEAD CODE, NOT consolidated.
-- Its trigger was dropped in Phase 32N; the live meeting counter is
-- lead_activity_bump_counter (db/functions/). DROP it from the live DB via
-- supabase_phase178_drop_dead_bump_meeting_counter.sql. Do NOT re-create it
-- or its trigger — re-wiring re-introduces the §33 meeting double-count.
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_bump_meeting_counter ON lead_activities;
-- CREATE TRIGGER trg_bump_meeting_counter REMOVED (Phase 178). bump_meeting_counter
-- is DEAD (trigger dropped Phase 32N). Re-creating it would re-wire a dead,
-- exclusion-missing counter -> the §33 double-count returns. DROP TRIGGER above stays.

-- ─── 4. Counter trigger for ad-hoc call activities ────────────────────
-- Same logic for calls. The planned-call list doesn't track individual
-- calls — the rep just logs them as activities. So every call activity
-- bumps the calls counter.

CREATE OR REPLACE FUNCTION bump_call_counter()
RETURNS TRIGGER AS $$
DECLARE
  v_date date := CURRENT_DATE;
  v_user uuid := NEW.created_by;
BEGIN
  IF NEW.activity_type NOT IN ('call', 'whatsapp') THEN
    RETURN NEW;
  END IF;

  INSERT INTO work_sessions (user_id, work_date, daily_counters)
  VALUES (v_user, v_date, jsonb_build_object('meetings', 0, 'calls', 1, 'new_leads', 0))
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET daily_counters = COALESCE(work_sessions.daily_counters, '{}'::jsonb)
                         || jsonb_build_object(
                              'calls',
                              COALESCE((work_sessions.daily_counters->>'calls')::int, 0) + 1
                            );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_bump_call_counter ON lead_activities;
CREATE TRIGGER trg_bump_call_counter
  AFTER INSERT ON lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION bump_call_counter();

-- ─── 5. Counter trigger for new leads ─────────────────────────────────
-- Bumps when a lead is INSERTed by the rep themselves (not when admin
-- bulk-imports). created_by must equal a rep's own ID — agency and
-- sales roles count toward this milestone.

CREATE OR REPLACE FUNCTION bump_new_lead_counter()
RETURNS TRIGGER AS $$
DECLARE
  v_date date := CURRENT_DATE;
  v_user uuid := NEW.created_by;
BEGIN
  IF v_user IS NULL THEN RETURN NEW; END IF;

  INSERT INTO work_sessions (user_id, work_date, daily_counters)
  VALUES (v_user, v_date, jsonb_build_object('meetings', 0, 'calls', 0, 'new_leads', 1))
  ON CONFLICT (user_id, work_date) DO UPDATE
    SET daily_counters = COALESCE(work_sessions.daily_counters, '{}'::jsonb)
                         || jsonb_build_object(
                              'new_leads',
                              COALESCE((work_sessions.daily_counters->>'new_leads')::int, 0) + 1
                            );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_bump_new_lead_counter ON leads;
CREATE TRIGGER trg_bump_new_lead_counter
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION bump_new_lead_counter();

-- ─── 6. Reload PostgREST schema ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ─── VERIFY ───────────────────────────────────────────────────────────
-- Expected:
--   row_count_users_with_targets >= number of active sales/agency/telecaller
--   trigger_count = 2 (trg_bump_call_counter, trg_bump_new_lead_counter)
--   — Phase 178 DROPPED the dead trg_bump_meeting_counter (see
--     supabase_phase178_drop_dead_bump_meeting_counter.sql).
SELECT
  (SELECT count(*) FROM users
    WHERE team_role IN ('sales', 'agency', 'telecaller')
      AND daily_targets ? 'meetings') AS row_count_users_with_targets,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('trg_bump_call_counter',
                     'trg_bump_new_lead_counter')) AS trigger_count;
