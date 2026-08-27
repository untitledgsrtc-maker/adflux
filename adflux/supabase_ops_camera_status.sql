-- supabase_ops_camera_status.sql
-- OPERATIONS — capture the per-screen CAMERA status (the AI-audience camera).
-- The aiadflux screen carries cameras[].status (Active/Inactive); the sync now
-- writes it so the per-screen list can show a screen badge + a camera badge.
-- Additive nullable column (null = no camera / unknown). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ops_screens
  ADD COLUMN IF NOT EXISTS camera_active boolean;   -- true=Active, false=Inactive, null=no camera

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect col_present = 1
-- SELECT count(*) AS col_present FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='ops_screens' AND column_name='camera_active';
