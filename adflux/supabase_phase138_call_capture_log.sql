-- =====================================================================
-- PHASE 138 — call-capture diagnostic log (instrumentation, NOT a fix)
-- 2026-06-12
--
-- ~46% of connected calls save duration_seconds=0/NULL (kirti: 7 real /
-- 6 connected-but-0s / 16 taps). The duration has been "fixed" 3x and
-- keeps regressing because the away-timer fallback DOESN'T FIRE on the
-- APK (tapping tel: doesn't reliably background the WebView → the
-- visibilitychange/appStateChange signal never flips → timer records
-- null). We will NOT patch a 4th time blind.
--
-- This is INSTRUMENTATION ONLY: one row per call attempt recording what
-- EVERY capture branch returned, so ONE DAY of real data proves the
-- exact failure mode before we touch the native code + rebuild the APK.
--
-- §45-safe: a NEW table, NO triggers on any live table, NO change to the
-- capture logic. The JS writes are fire-and-forget (never block a save).
-- Admin reads; service/authenticated self-writes own rows.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.call_capture_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  user_id             uuid REFERENCES public.users(id),
  lead_id             uuid,
  call_log_id         uuid,
  phone_last10        text,
  -- device CallLog read (Phase 65 / native plugin)
  device_permission   text,          -- 'granted' | 'denied' | 'prompt' | 'web' | 'error'
  device_read_found   boolean,
  device_read_seconds int,
  -- away-timer (Phase 116 / 126.2 / 128.4)
  app_backgrounded    boolean,        -- did the WebView actually background?
  bg_signal           text,           -- 'appState' | 'visibility' | 'none'
  timer_seconds       int,
  -- patch context
  patch_path          text,          -- 'auto60' | 'modal_save' | 'resume_sweep'
  outcome_at_patch    text,          -- was the row still 'no_answer'?
  -- the result that matters
  final_seconds       int,
  counted             boolean,        -- final >= 10 (counts toward the 50)
  note                text
);

CREATE INDEX IF NOT EXISTS idx_call_capture_log_user_date
  ON public.call_capture_log (user_id, created_at DESC);

ALTER TABLE public.call_capture_log ENABLE ROW LEVEL SECURITY;

-- admin / co_owner read all; everyone authenticated inserts + reads own.
DROP POLICY IF EXISTS ccl_admin_read ON public.call_capture_log;
CREATE POLICY ccl_admin_read ON public.call_capture_log
  FOR SELECT USING (public.get_my_role() IN ('admin','co_owner'));

DROP POLICY IF EXISTS ccl_self_read ON public.call_capture_log;
CREATE POLICY ccl_self_read ON public.call_capture_log
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS ccl_self_insert ON public.call_capture_log;
CREATE POLICY ccl_self_insert ON public.call_capture_log
  FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- self-register
DO $$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (name, note)
    VALUES ('supabase_phase138_call_capture_log.sql',
            'Diagnostic log of every call-duration capture branch (instrumentation only)')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — expect table_present=1, policies=3 ─────────────────────
SELECT
  (SELECT count(*) FROM pg_tables WHERE tablename='call_capture_log')             AS table_present,
  (SELECT count(*) FROM pg_policies WHERE tablename='call_capture_log')           AS policies;

SELECT 'Phase 138 call-capture log created' AS status;
