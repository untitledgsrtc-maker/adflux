-- supabase_phase100e_handed_off_view.sql
--
-- Phase 100.E (2026-07-15) — "leads you handed off" view for the sales rep.
--
-- Problem (owner): a sales rep reassigns a lead to a telecaller (Jayna), then
-- can't see it anymore (RLS — they no longer own it) → they lose track, and
-- Jayna's pile is huge so it dies. Stage 1 (the handoff landing task, edited
-- into _reassign_lead_apply in supabase_phase100_a_reassign_rpc.sql) puts it on
-- Jayna's to-do list + pings her. THIS is the sender's half: let the rep see
-- the leads they handed off + whether they're being worked.
--
-- SECURITY: SECURITY DEFINER (so it can read leads the rep no longer owns), but
-- HARD-SCOPED to `ra.caller_id = auth.uid()` — the rep sees ONLY the leads THEY
-- reassigned. A NULL auth.uid() (no JWT) matches no rows (NULL comparison), and
-- anon is REVOKED — so no cross-rep leak. Read-only. Additive: no existing
-- function/table/RLS touched (§45).

CREATE OR REPLACE FUNCTION public.my_handed_off_leads()
RETURNS TABLE (
  lead_id         uuid,
  lead_name       text,
  lead_company    text,
  new_owner_name  text,
  handed_off_at   timestamptz,
  stage           text,
  contacted_since boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  -- Latest handoff per lead by the CALLING rep, last 30 days.
  WITH my_handoffs AS (
    SELECT DISTINCT ON (ra.lead_id)
           ra.lead_id, ra.new_owner, ra.created_at
      FROM public.reassign_audit ra
     WHERE ra.caller_id = auth.uid()
       AND ra.created_at >= now() - interval '30 days'
     ORDER BY ra.lead_id, ra.created_at DESC
  )
  SELECT h.lead_id,
         l.name,
         l.company,
         u.name,
         h.created_at,
         l.stage,
         -- Worked since the handoff? A real activity (NOT the reassign's own
         -- status_change row) logged after the handoff timestamp.
         EXISTS (
           SELECT 1 FROM public.lead_activities la
            WHERE la.lead_id = h.lead_id
              AND la.activity_type <> 'status_change'
              AND la.created_at > h.created_at
         ) AS contacted_since
    FROM my_handoffs h
    JOIN public.leads l  ON l.id = h.lead_id
    LEFT JOIN public.users u ON u.id = h.new_owner
   WHERE l.stage NOT IN ('Won', 'Lost')   -- resolved leads drop off
   ORDER BY contacted_since ASC, h.created_at DESC;   -- neglected ones first
$$;

REVOKE EXECUTE ON FUNCTION public.my_handed_off_leads() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_handed_off_leads() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run as a rep who has reassigned leads in the last 30 days):
--   SELECT * FROM public.my_handed_off_leads();
--   → their handed-off leads, uncontacted (contacted_since=false) first.
-- VERIFY the scope (a rep sees ONLY their own):
--   the WHERE caller_id = auth.uid() guarantees it; anon can't call (REVOKE).
