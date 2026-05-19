-- supabase_phase56l_call_direction.sql
-- Phase 56l — call log direction (outgoing / incoming / missed)
-- 19 May 2026
--
-- Owner directive (19 May 2026):
--   "when person call back but we not received it shuld be missed call"
--   "per lead log and per representative log"
--   "this is just reference purpose only" + showed Cronberry screens
--   with OUTGOING / INCOMING / MISSED counts.
--
-- Until now `call_logs` only held outgoing rows written by Phase 35.0
-- callAudit at the tel-tap moment. There's no way to know whether a
-- call_logs entry was placed by the rep or received from the customer.
-- The Capacitor wrapper (Phase 56c CallLog plugin) reads the Android
-- system call log, which carries an explicit TYPE column for each
-- direction. Surface it on our side so:
--   • Lead detail Call History shows in / out / missed per customer.
--   • Per-rep dashboard counts outgoing vs incoming vs missed.
--   • Auto-cadence + score logic can distinguish "rep called" from
--     "customer called back" later.
--
-- Schema change:
--   1. New column `direction` text NOT NULL DEFAULT 'outgoing'
--      with CHECK enum.
--   2. Existing rows are all from tel-tap audit → DEFAULT 'outgoing'
--      back-populates correctly. No manual UPDATE needed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP+CREATE constraint.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outgoing';

ALTER TABLE public.call_logs
  DROP CONSTRAINT IF EXISTS call_logs_direction_check;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_direction_check
  CHECK (direction IN ('outgoing', 'incoming', 'missed'));

-- Index for the per-rep page + per-lead filter queries.
CREATE INDEX IF NOT EXISTS idx_call_logs_user_direction
  ON public.call_logs (user_id, direction, call_at DESC);


NOTIFY pgrst, 'reload schema';


-- ─── VERIFY ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='call_logs'
      AND column_name='direction')                                  AS direction_col,
  (SELECT count(*) FROM information_schema.check_constraints
    WHERE constraint_schema='public'
      AND constraint_name='call_logs_direction_check')              AS direction_check_present,
  (SELECT count(*) FROM public.call_logs WHERE direction='outgoing') AS existing_outgoing_rows;
-- Expected: 1 · 1 · <all your current rows>
