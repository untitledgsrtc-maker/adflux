-- =====================================================================
-- Phase 566 — close 3 security holes found in the 17 Nov 2026 audit
-- =====================================================================
-- (1) _bak_users_p489 (staff emails / WhatsApp numbers) and
--     _bak_work_sessions_p482 had Row Level Security OFF and were readable by
--     the public anon key. Turn RLS on with NO policy + revoke API grants.
--     (Backups are only ever restored by the owner running SQL as postgres.)
-- (2) create_payment_collection_followups(uuid) and recompute_daily_calls(uuid,
--     date) are SECURITY DEFINER with no caller check but were executable by
--     anon + authenticated. Every caller is a SECURITY DEFINER trigger function
--     (tg_quote_won_payment_followups, call_log_calls_recount_on_delete,
--     lead_activity_calls_recount_on_delete); no cron, no src/api caller
--     (verified 17 Nov). Same pattern as Phase 97.A2 (enqueue_push).
-- (3) offer-letters bucket (public; candidate upload page inserts as anon) had
--     NO size limit: cap at 5 MB (largest existing file is 151 KB).
-- ADDITIVE / idempotent. No app code change.
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['_bak_users_p489','_bak_work_sessions_p482'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_payment_collection_followups(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_daily_calls(uuid, date)        FROM PUBLIC, anon, authenticated;

UPDATE storage.buckets SET file_size_limit = 5242880
 WHERE id = 'offer-letters' AND (file_size_limit IS NULL OR file_size_limit > 5242880);

NOTIFY pgrst, 'reload schema';

-- VERIFY: expect rls_on=2, anon_table_read=false, fn_anon=false, fn_auth=false, bucket_limit=5242880
SELECT
  (SELECT count(*) FROM pg_class WHERE relname IN ('_bak_users_p489','_bak_work_sessions_p482') AND relrowsecurity) AS rls_on,
  has_table_privilege('anon', 'public._bak_users_p489', 'select') AS anon_table_read,
  has_function_privilege('anon', 'public.recompute_daily_calls(uuid,date)', 'execute')
    OR has_function_privilege('anon', 'public.create_payment_collection_followups(uuid)', 'execute') AS fn_anon,
  has_function_privilege('authenticated', 'public.recompute_daily_calls(uuid,date)', 'execute')
    OR has_function_privilege('authenticated', 'public.create_payment_collection_followups(uuid)', 'execute') AS fn_auth,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'offer-letters') AS bucket_limit;
