-- supabase_phase323_lead_engagement_stats.sql
-- Phase 323 — per-lead engagement stats for the two new /leads columns:
--   • call_count           — total calls to the lead (call_logs, calls only)
--   • presentation_seconds — total in-app GSRTC presentation time (Phase 181)
--
-- The /leads list (§28 FROZEN) fetches these for the VISIBLE PAGE ONLY (~50 lead
-- ids), never all 6000+ rows, so the list load is unchanged (§45 no-slowdown).
-- Both aggregates hit an existing index: idx_call_logs_lead (call_logs.lead_id,
-- partial) + ps_lead_idx (presentation_sessions.lead_id). No new index needed.
--
-- SECURITY INVOKER: the caller's RLS applies — admin/co_owner see the true team
-- totals (call_logs_admin_all + ps_admin_all); a rep sees their own calls +
-- presentations to their own leads (call_logs_own + ps_self_all). No gating logic
-- to get wrong (§41/§150) — RLS does the scoping. Data is low-sensitivity counts.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.lead_engagement_stats(p_lead_ids uuid[])
RETURNS TABLE (lead_id uuid, call_count integer, presentation_seconds integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ids.id AS lead_id,
         COALESCE(c.cnt,  0)::int AS call_count,
         COALESCE(p.secs, 0)::int AS presentation_seconds
  FROM unnest(p_lead_ids) AS ids(id)
  LEFT JOIN (
    SELECT cl.lead_id, count(*) AS cnt
    FROM public.call_logs cl
    WHERE cl.lead_id = ANY(p_lead_ids)
    GROUP BY cl.lead_id
  ) c ON c.lead_id = ids.id
  LEFT JOIN (
    SELECT ps.lead_id, sum(ps.duration_seconds) AS secs
    FROM public.presentation_sessions ps
    WHERE ps.lead_id = ANY(p_lead_ids)
    GROUP BY ps.lead_id
  ) p ON p.lead_id = ids.id;
$$;

GRANT EXECUTE ON FUNCTION public.lead_engagement_stats(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY — pass a few real lead ids, expect one row each with the counts:
--   SELECT * FROM public.lead_engagement_stats(
--     ARRAY(SELECT id FROM public.leads ORDER BY created_at DESC LIMIT 5));
