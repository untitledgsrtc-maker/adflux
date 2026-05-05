-- =====================================================================
-- Phase 13 — AI Co-Pilot support objects
-- =====================================================================
-- 1. ai_runs table for cost/observability
-- 2. run_select() RPC — SECURITY INVOKER so RLS still applies to whoever
--    calls it (the Co-Pilot Edge Function passes the caller's JWT,
--    so when run_select executes the SELECT it does so as the user)
-- 3. RLS policies for ai_runs
-- =====================================================================

-- 1. ai_runs
CREATE TABLE IF NOT EXISTS public.ai_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type     text NOT NULL,
  input_json   jsonb,
  output_json  jsonb,
  model        text,
  tokens_in    int,
  tokens_out   int,
  cost_inr     numeric,
  success      boolean DEFAULT true,
  created_by   uuid REFERENCES public.users(id),
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_type_created ON public.ai_runs (run_type, created_at DESC);

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_runs_admin_all" ON public.ai_runs;
CREATE POLICY "ai_runs_admin_all" ON public.ai_runs FOR ALL
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "ai_runs_self_insert" ON public.ai_runs;
CREATE POLICY "ai_runs_self_insert" ON public.ai_runs FOR INSERT
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

-- 2. run_select() — read-only RPC for the Co-Pilot Edge Function
-- SECURITY INVOKER means the SELECT runs as the calling user, so RLS
-- still filters rows. The function itself rejects anything that isn't
-- a single SELECT.
CREATE OR REPLACE FUNCTION public.run_select(sql_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Hard rejects: anything that isn't a SELECT
  IF NOT (sql_text ~* '^\s*select\b') THEN
    RAISE EXCEPTION 'Only SELECT statements allowed';
  END IF;
  IF sql_text ~* '\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b' THEN
    RAISE EXCEPTION 'Write/DDL keywords are forbidden in run_select';
  END IF;

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 100) t', sql_text)
    INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_select(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY:
--   SELECT public.run_select('SELECT id, name FROM users LIMIT 5');
--   -- expect a jsonb array
--   SELECT public.run_select('DELETE FROM users');  -- expect: error
-- =====================================================================
