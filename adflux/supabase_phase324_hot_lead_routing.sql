-- supabase_phase324_hot_lead_routing.sql
-- Phase 1 · Hot-Lead Routing (docs/PLAN_hot_lead_routing.md).
--
-- ai-reply.js emits a hidden `HOT: quote` / `HOT: human` marker the moment a
-- WhatsApp lead shows buying intent → the Edge endpoint strips it and calls this
-- RPC → the lead goes hot AND a one-off "HOT — respond now" task lands in the
-- owning rep's follow-ups. That INSERT fires the existing tg_push_followup_due
-- push (§106) → ONE HOT alert to the rep's phone. The rep sees it in the red HOT
-- bucket pinned to the top of Follow-ups and connects directly.
--
-- SECURITY DEFINER (runs as postgres so the Edge service-role call can write
-- leads + follow_ups). REVOKED from PUBLIC/anon/authenticated + GRANT service_role
-- ONLY — the sole caller is ai-reply.js with the service key (§55/§162 posture);
-- no client role may flag a lead hot via rpc(). The whole body is EXCEPTION-wrapped
-- so a failure here can NEVER break the AI reply (§45/§46).
--
-- Idempotent: heat update is a no-op when already hot; the HOT task is spawned
-- only if no open HOT task exists for the lead → repeated hot signals don't pile
-- up tasks or double-push.
--
-- §71 ONE meaning of "hot": reuses leads.heat='hot' (auto-heat trigger §47.4 uses
-- the same value). Does NOT invent a second flag. The quote-vs-human split lives
-- only on the conversation's ai_paused (set by ai-reply.js), not on the lead.

CREATE OR REPLACE FUNCTION public.flag_lead_hot_from_wa(p_lead_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;   -- IST today (§47.9)
BEGIN
  IF p_lead_id IS NULL THEN RETURN; END IF;

  -- 1. Mark hot (idempotent). Do NOT touch cadence_paused — campaign leads stay
  --    paused on purpose (§53); waking the auto-chase / auto-Lost here is a bug.
  UPDATE public.leads
     SET heat = 'hot', updated_at = now()
   WHERE id = p_lead_id
     AND COALESCE(heat, '') <> 'hot';

  -- Owner = the rep the lead is already assigned to (TC-first — a WhatsApp lead
  -- lives on telecaller_id, §113/§243). Never route a HOT task to nobody.
  SELECT COALESCE(telecaller_id, assigned_to) INTO v_owner
    FROM public.leads WHERE id = p_lead_id;
  IF v_owner IS NULL THEN RETURN; END IF;

  -- 2. One-off HOT task, ONLY if no open HOT task already exists for this lead
  --    (idempotency — repeated hot signals don't pile up tasks / double-push).
  IF NOT EXISTS (
    SELECT 1 FROM public.follow_ups
     WHERE lead_id = p_lead_id AND is_done = false AND note LIKE 'HOT —%'
  ) THEN
    INSERT INTO public.follow_ups
      (lead_id, assigned_to, follow_up_date, follow_up_time, note,
       is_done, auto_generated, cadence_type)
    VALUES
      (p_lead_id, v_owner, v_today, NULL,                        -- §106: time NULL
       'HOT — ' || COALESCE(NULLIF(BTRIM(p_reason), ''), 'buying intent'),
       false, false, NULL);                                     -- one-off, not a cadence chase
    -- ↑ the INSERT fires tg_push_followup_due (§106) → ONE HOT alert to v_owner.
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Never break the AI reply on a hot-flag failure (§45/§46).
  NULL;
END;
$$;

REVOKE ALL     ON FUNCTION public.flag_lead_hot_from_wa(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flag_lead_hot_from_wa(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect prosecdef=t, svc_can=t, auth_can=f:
--   SELECT p.proname, p.prosecdef,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_can,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can
--     FROM pg_proc p
--    WHERE p.proname = 'flag_lead_hot_from_wa';
