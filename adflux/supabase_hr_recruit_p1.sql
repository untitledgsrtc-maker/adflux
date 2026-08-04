-- =============================================================================
-- supabase_hr_recruit_p1.sql
-- Phase 281 — HR module, Recruit (P1). Spec: docs/HR_ONBOARDING_RECRUITMENT_SPEC.md §B.
--
-- Owner directive (2026-08-04): HR gets a recruitment surface — candidates +
-- resume storage + shortlist pipeline + call logging (call LOGS, NO audio,
-- mirrors the telecaller pattern).
--
-- ADDITIVE + §45-safe: two NEW hr_* tables + a NEW private storage bucket.
-- ZERO touch to leads / quotes / payments / payroll / any live flow.
--
-- ACCESS (§30 HR back-office doctrine): admin + co_owner + hr = FULL. No one
-- else — reps/agency/telecaller/accounts get NOTHING (recruitment is HR-only).
-- Every gate is get_my_role() IN (...): in an RLS USING/WITH CHECK a NULL role
-- evaluates to NULL → row excluded / insert rejected = fail-closed (§41 is the
-- PL/pgSQL IF trap; RLS predicates fail closed on NULL by design).
--
-- Idempotent (§8): re-runnable. Bundled one file per §154.
-- =============================================================================

-- ── part 1/4 · hr_candidates ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hr_candidates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  phone              text,
  email              text,
  role_applied       text,
  stage              text NOT NULL DEFAULT 'applied'
                       CHECK (stage IN ('applied','shortlisted','interview','hired','rejected')),
  resume_path        text,          -- storage path in candidate-resumes (private; served via signed URL)
  source             text,          -- Referral / Naukri / WhatsApp / Walk-in / ...
  notes              text,
  rating             int CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  converted_user_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,  -- set when a hired candidate becomes a team member
  created_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_candidates ADD COLUMN IF NOT EXISTS resume_path       text;
ALTER TABLE public.hr_candidates ADD COLUMN IF NOT EXISTS converted_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hr_candidates_stage      ON public.hr_candidates (stage);
CREATE INDEX IF NOT EXISTS idx_hr_candidates_created_at ON public.hr_candidates (created_at DESC);

DROP TRIGGER IF EXISTS trg_hr_candidates_touch ON public.hr_candidates;
CREATE TRIGGER trg_hr_candidates_touch
  BEFORE UPDATE ON public.hr_candidates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── part 2/4 · hr_candidate_calls (call LOGS — no audio, mirrors telecaller) ──
CREATE TABLE IF NOT EXISTS public.hr_candidate_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id     uuid NOT NULL REFERENCES public.hr_candidates(id) ON DELETE CASCADE,
  called_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  call_at          timestamptz NOT NULL DEFAULT now(),
  duration_seconds int,
  outcome          text CHECK (outcome IS NULL OR outcome IN
                     ('connected','no_answer','callback','not_interested','shortlisted','rejected')),
  notes            text
);

CREATE INDEX IF NOT EXISTS idx_hr_candidate_calls_candidate ON public.hr_candidate_calls (candidate_id, call_at DESC);

-- ── part 3/4 · RLS (admin + co_owner + hr = FULL; no one else) ───────────────
ALTER TABLE public.hr_candidates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_candidate_calls ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_candidates      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_candidate_calls TO authenticated;

DROP POLICY IF EXISTS hr_candidates_hr_all ON public.hr_candidates;
CREATE POLICY hr_candidates_hr_all ON public.hr_candidates
  FOR ALL
  USING      (public.get_my_role() IN ('admin','co_owner','hr'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner','hr'));

DROP POLICY IF EXISTS hr_candidate_calls_hr_all ON public.hr_candidate_calls;
CREATE POLICY hr_candidate_calls_hr_all ON public.hr_candidate_calls
  FOR ALL
  USING      (public.get_my_role() IN ('admin','co_owner','hr'))
  WITH CHECK (public.get_my_role() IN ('admin','co_owner','hr'));

-- ── part 4/4 · candidate-resumes bucket (PRIVATE; HR upload + signed-URL read)─
-- Private (public=false): NO public URL is ever minted; downloads go through
-- createSignedUrl (client), which needs SELECT on the object → the HR SELECT
-- policy below. HR uploads → INSERT policy. 10 MB cap (resumes are PDFs/docs).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('candidate-resumes', 'candidate-resumes', false, 10485760)
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS candidate_resumes_hr_read   ON storage.objects;
CREATE POLICY candidate_resumes_hr_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'candidate-resumes' AND public.get_my_role() IN ('admin','co_owner','hr'));

DROP POLICY IF EXISTS candidate_resumes_hr_insert ON storage.objects;
CREATE POLICY candidate_resumes_hr_insert ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'candidate-resumes' AND public.get_my_role() IN ('admin','co_owner','hr'));

DROP POLICY IF EXISTS candidate_resumes_hr_update ON storage.objects;
CREATE POLICY candidate_resumes_hr_update ON storage.objects
  FOR UPDATE
  USING      (bucket_id = 'candidate-resumes' AND public.get_my_role() IN ('admin','co_owner','hr'))
  WITH CHECK (bucket_id = 'candidate-resumes' AND public.get_my_role() IN ('admin','co_owner','hr'));

DROP POLICY IF EXISTS candidate_resumes_hr_delete ON storage.objects;
CREATE POLICY candidate_resumes_hr_delete ON storage.objects
  FOR DELETE
  USING (bucket_id = 'candidate-resumes' AND public.get_my_role() IN ('admin','co_owner','hr'));

-- ── part 5/5 · per-candidate call-count RPC (server-side aggregate) ───────────
-- §66/§274 doctrine: NEVER pull raw call rows to the client and count them —
-- PostgREST caps an unpaginated select at ~1000 rows (a .limit() above the cap
-- does NOT override it), so a client-side count silently undercounts once total
-- calls exceed ~1000. This returns ONE row per candidate (bounded by candidate
-- count) with a server-side COUNT + latest outcome. SECURITY INVOKER → the
-- caller's hr_candidate_calls RLS applies (HR/admin/co_owner only; anyone else
-- gets 0 rows = fail-closed), exposing nothing new.
CREATE OR REPLACE FUNCTION public.hr_candidate_call_counts()
RETURNS TABLE (candidate_id uuid, call_count bigint, last_outcome text)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT c.candidate_id,
         count(*)                                             AS call_count,
         (array_agg(c.outcome ORDER BY c.call_at DESC))[1]    AS last_outcome
    FROM public.hr_candidate_calls c
   GROUP BY c.candidate_id;
$$;

GRANT EXECUTE ON FUNCTION public.hr_candidate_call_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY ───────────────────────────────────────────────────────────────────
-- Expect: tables=2, rls_on=2, table_policies=2, private_bucket=1,
--         storage_policies=4, count_rpc=1.
SELECT
  (SELECT count(*) FROM pg_tables
     WHERE schemaname='public' AND tablename IN ('hr_candidates','hr_candidate_calls'))                 AS tables,
  (SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
     WHERE t.schemaname='public' AND t.tablename IN ('hr_candidates','hr_candidate_calls')
       AND c.relrowsecurity)                                                                            AS rls_on,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename IN ('hr_candidates','hr_candidate_calls'))                 AS table_policies,
  (SELECT count(*) FROM storage.buckets WHERE id='candidate-resumes' AND public=false)                 AS private_bucket,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'candidate_resumes_%')      AS storage_policies,
  (SELECT count(*) FROM pg_proc WHERE proname='hr_candidate_call_counts')                              AS count_rpc;
