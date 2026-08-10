-- supabase_phase87_user_avatars.sql
--
-- Phase 87.5 — rep profile picture.
--
-- Owner directive 24 May 2026:
--   "in profile that can see their full details while they submit
--    the offer and accept the offer by HR and i need that they
--    upload their profile pic"
--   "in map i want all person to be seen like this [reference map
--    pin with profile pic]"
--
-- Schema
--   users.profile_image_url text — public-bucket URL of the rep's
--                                   profile picture.
--
-- Storage
--   user-avatars bucket (public read, self-write only).
--   Path convention: user-avatars/<user_id>/<timestamp>.jpg
--
-- Idempotent. RLS allows rep to update OWN profile pic; admin /
-- co_owner can update any rep's pic (for HR onboarding).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_image_url text;

-- ─────────────────────────────────────────────────────────────────
-- Storage bucket — user-avatars
-- ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('user-avatars', 'user-avatars', true, 5242880)  -- 5 MB cap
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- Public SELECT — anyone with the link can view. Same as letterheads
-- + city-photos.
DROP POLICY IF EXISTS user_avatars_public_read ON storage.objects;
CREATE POLICY user_avatars_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'user-avatars');

-- INSERT — authenticated users only. Path must start with their own
-- user_id (`<auth.uid()>/...`).
DROP POLICY IF EXISTS user_avatars_self_insert ON storage.objects;
CREATE POLICY user_avatars_self_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND auth.uid() IS NOT NULL
    AND (
      -- Rep uploads under their own folder
      (storage.foldername(name))[1] = auth.uid()::text
      -- OR admin uploads on behalf of any rep
      OR public.get_my_role() IN ('admin', 'co_owner')
    )
  );

-- UPDATE — same gate (replace existing pic).
DROP POLICY IF EXISTS user_avatars_self_update ON storage.objects;
CREATE POLICY user_avatars_self_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'user-avatars'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.get_my_role() IN ('admin', 'co_owner')
    )
  )
  WITH CHECK (bucket_id = 'user-avatars');

-- DELETE — same gate.
DROP POLICY IF EXISTS user_avatars_self_delete ON storage.objects;
CREATE POLICY user_avatars_self_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'user-avatars'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.get_my_role() IN ('admin', 'co_owner')
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- users.profile_image_url — let rep update OWN row's URL.
-- ⚠ NEUTRALIZED 2026-08-07 (Sales Head P1, §72 consolidation). This was
-- the ORIGINAL NO-PIN policy (WITH CHECK id=auth.uid() only) — re-running
-- it would DROP the 12-pin canonical and re-open the F-100 self-grant P0
-- (a rep could then self-set role='admin', is_sales_head, everything). The
-- pinned column-lockdown is now the SINGLE canonical policy in
-- supabase_sales_head_manager_p1.sql. DROP+CREATE removed here so this
-- file can be safely re-run to re-provision the user-avatars bucket without
-- touching the users self-update policy.
-- ─────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';

-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='users'
--      AND column_name='profile_image_url';
--   → 1 row.
--
--   SELECT id, public, file_size_limit FROM storage.buckets
--    WHERE id = 'user-avatars';
--   → 1 row, public=true, file_size_limit=5242880.
--
--   SELECT polname FROM pg_policy
--    WHERE polrelid::text = 'storage.objects'
--      AND polname LIKE 'user_avatars_%';
--   → 4 rows.
