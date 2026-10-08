-- ============================================================================
-- Phase 350 - clear the inactive `test` ops account's 2 phone registrations
-- ============================================================================
-- WHY: Gohil and Gulshan have 0 rows in push_subscriptions although both use APK 0.96.19.
-- The inactive `test` account holds 2 android (fcm) tokens; the first sign-in on those phones
-- was `test`, and push_subscriptions has a unique endpoint index + self-only policy, so the
-- real users' save was blocked (error only console-warned in nativePush.saveFcmToken).
-- SCOPE: only the 2 rows owned by the inactive user named `test` (role operation_executive).
-- Backup first; UNDO restores them. Re-run is a no-op (guard aborts if the scope drifted).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public._bak_push_subs_p350 AS
  SELECT p.*, now() AS bak_at
    FROM public.push_subscriptions p
    JOIN public.users u ON u.id = p.user_id
   WHERE u.id = '42978055-569f-4041-bdf3-344737b10039'
     AND u.role = 'operation_executive' AND u.is_active = false;
ALTER TABLE public._bak_push_subs_p350 ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.push_subscriptions p
   USING public.users u
   WHERE u.id = p.user_id
     AND u.id = '42978055-569f-4041-bdf3-344737b10039'
     AND u.role = 'operation_executive' AND u.is_active = false
     AND p.id IN (SELECT id FROM public._bak_push_subs_p350);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Phase 350: removed % registration(s) of the inactive test account', n;
END $$;

-- VERIFY (expect 2, 0):
-- SELECT (SELECT count(*) FROM public._bak_push_subs_p350) AS backed_up,
--        (SELECT count(*) FROM public.push_subscriptions WHERE user_id='42978055-569f-4041-bdf3-344737b10039') AS test_rows_left;
-- UNDO:
-- INSERT INTO public.push_subscriptions (id,user_id,endpoint,p256dh,auth,user_agent,created_at,last_seen_at,platform,fcm_token)
--   SELECT id,user_id,endpoint,p256dh,auth,user_agent,created_at,last_seen_at,platform,fcm_token FROM public._bak_push_subs_p350 ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
