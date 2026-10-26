-- Phase 524: record Claude API failures (credit finished / bad key / overloaded) so the admin dashboard can warn.
-- Written only by api/wa/ai-reply.js (service role). Read by admin / co_owner only.
CREATE TABLE IF NOT EXISTS public.ai_failures (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'wa_ai_reply',
  http_status int,
  detail text
);
CREATE INDEX IF NOT EXISTS idx_ai_failures_at ON public.ai_failures (at DESC);
ALTER TABLE public.ai_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_failures_admin_read ON public.ai_failures;
CREATE POLICY ai_failures_admin_read ON public.ai_failures FOR SELECT TO authenticated
  USING (COALESCE(public.get_my_role() IN ('admin','co_owner'), false));
REVOKE ALL ON public.ai_failures FROM anon, authenticated;
GRANT SELECT ON public.ai_failures TO authenticated;
NOTIFY pgrst, 'reload schema';
-- VERIFY: table present, RLS on, one policy
-- SELECT to_regclass('public.ai_failures') IS NOT NULL AS tbl, (SELECT relrowsecurity FROM pg_class WHERE oid='public.ai_failures'::regclass) AS rls, (SELECT count(*) FROM pg_policies WHERE tablename='ai_failures') AS pol;
