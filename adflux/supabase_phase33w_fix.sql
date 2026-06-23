-- supabase_phase33w_fix.sql
--
-- Phase 33W fix — Supabase SQL editor can't run ALTER DATABASE SET
-- (permission denied 42501; only superuser). Hardcode the anon key
-- directly into enqueue_push() since anon keys are public-by-design
-- (every browser already has it).
--
-- Owner's anon key (from SQL Editor screenshot):
--   sb_publishable_9_MhDyQkqBES4KQjVQUgxQ_1OsEfoMY
--
-- Run this AFTER supabase_phase33w_push_triggers.sql. CREATE OR
-- REPLACE so it's safe to run on top.

-- -------------------------------------------------------------------------
-- enqueue_push REMOVED from this file (Phase 178).
-- Canonical: db/functions/enqueue_push.sql (push core; §97.A2 REVOKE baked in).
-- Do NOT re-add it here. Edit the canonical file only (§71).
-- -------------------------------------------------------------------------

-- enqueue_push GRANT removed (Phase 178): §97.A2 revoked EXECUTE from authenticated; the canonical (db/functions/enqueue_push.sql) enforces the revoke. Re-granting here would RE-OPEN the rep-to-rep push-spam hole.

-- VERIFY: should return a non-null request_id and your phone should
-- buzz within ~5 seconds.
--   SELECT public.enqueue_push(auth.uid(), 'Trigger test', 'From SQL function');
