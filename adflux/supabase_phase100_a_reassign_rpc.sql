-- supabase_phase100_a_reassign_rpc.sql
--
-- Phase 100.A — self-service lead reassign RPCs.
--
-- BACKGROUND
-- ──────────
-- Today only admin / co_owner can reassign leads. UI gates the
-- Reassign button on LeadsV2.jsx:543 + LeadDetailV2.jsx:1765 with
-- `isPrivileged`. Even if the UI gate were dropped, Phase 12 RLS
-- WITH CHECK on `leads_telecaller_own` + `leads_sales_own` would
-- block any rep UPDATE that flipped `telecaller_id` or
-- `assigned_to` to a different user — both clauses require
-- `<column> = auth.uid()` on the NEW row.
--
-- Owner directive 2026-05-29 — open self-service reassign with a
-- policy matrix:
--   - Admin / co_owner            → can reassign anything to anyone.
--   - TC                          → another TC OR sales / agency
--                                   / sales_manager (handoff).
--   - Sales / agency / SM         → another sales / agency / SM,
--                                   or back to TC on New/Working
--                                   /Nurture only.
--   - Non-admin                   → cannot pick admin / co_owner
--                                   as target.
--   - Non-admin                   → cannot reassign Won / Lost.
--   - All                         → no self-assign.
--   - Non-admin                   → max 5 reassigns/rep/day (IST).
--   - Non-admin                   → max 20 leads per bulk call.
--   - Cross-team                  → reason required (≥3 chars).
--   - Same-lane                   → reason optional.
--
-- This file ships ONE SQL migration. Phase 100.B (separate JS
-- sprint) will drop the UI gates + call these RPCs.
--
-- DECISIONS LOCKED IN THE PLAN
-- ────────────────────────────
--   Q1  YES — sales/agency/SM → TC allowed, but only on stage IN
--             ('New','Working','Nurture'). Closed-or-quote stages
--             blocked at trigger time.
--   Q2  Daily limit 5 reassigns/rep/day for non-admin. Admin
--       exempt. Counter reads from `reassign_audit` rows.
--   Q3  Bulk cap 20 leads per call for non-admin. Admin exempt.
--   Q4  PUSH DEFERRED to Phase 100.C. This file does NOT call
--       enqueue_push. Audit chain = `lead_activities`
--       status_change row + `reassign_audit` row.
--   Q5  Reason required for cross-team only.
--   Q6  Standard `lead_activities.status_change` row. No special
--       admin-override tag.
--   Q7  SQL first (this file). JS later (Phase 100.B).
--
-- IDEMPOTENCY
-- ───────────
-- CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
-- DROP POLICY IF EXISTS + CREATE POLICY + CREATE OR REPLACE
-- FUNCTION × 3 + GRANT/REVOKE + NOTIFY pgrst. Re-runnable.
--
-- SCOPE — UNTOUCHED
-- ─────────────────
--   * Phase 12 leads RLS policies — unchanged.
--   * Phase 34 lead_set_handoff_sla / lead_auto_assign — unchanged.
--   * Phase 99.A column repair UPDATE — already shipped.
--   * Phase 99.B + 99.B.1 trigger guard — unchanged.
--   * Phase 99.C JS hooks + LeadsV2 / ReassignModal / useLeads —
--     untouched by 100.A (Phase 100.B sprint).
--   * Phase 97.A2 REVOKE on enqueue_push — unchanged.
--   * Phase 98.E2 / 98.H / 98.H1 — unchanged.
--   * Phase 87.5b hr_offers RPCs — unchanged.
--   * All §28 frozen contracts — no SQL touches frozen surfaces.


-- ────────────────────────────────────────────────────────────────
-- 1. reassign_audit table — historical chain + rate-limit source
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reassign_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id   uuid NOT NULL REFERENCES public.users(id),
  lead_id     uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  new_owner   uuid NOT NULL REFERENCES public.users(id),
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reassign_audit_caller_day
  ON public.reassign_audit (caller_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reassign_audit_lead
  ON public.reassign_audit (lead_id);

ALTER TABLE public.reassign_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reassign_audit_admin_all ON public.reassign_audit;
DROP POLICY IF EXISTS reassign_audit_self_read ON public.reassign_audit;

CREATE POLICY reassign_audit_admin_all ON public.reassign_audit
  FOR ALL
  USING (public.get_my_role() IN ('admin', 'co_owner'))
  WITH CHECK (public.get_my_role() IN ('admin', 'co_owner'));

CREATE POLICY reassign_audit_self_read ON public.reassign_audit
  FOR SELECT
  USING (caller_id = auth.uid());


-- ────────────────────────────────────────────────────────────────
-- 2. _reassign_lead_apply — internal helper.
-- Applies ONE reassignment. Does NOT enforce daily limit or
-- bulk cap (callers do that). Caller passes their own role + name
-- to avoid re-querying users on every iteration of the bulk path.
-- Returns jsonb {ok, lead_id, reason?}.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._reassign_lead_apply(
  p_caller       uuid,
  p_caller_role  text,
  p_caller_name  text,
  p_caller_team  text,
  p_lead_id      uuid,
  p_new_owner    uuid,
  p_reason       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_lane     text;
  v_target_role     text;
  v_target_team     text;
  v_target_active   boolean;
  v_target_segment  text;
  v_target_name     text;
  v_target_lane     text;
  v_lead_owner_tc   uuid;
  v_lead_owner_sa   uuid;
  v_lead_stage      text;
  v_lead_segment    text;
  v_lead_sales_ready timestamptz;
  v_lead_handoff    timestamptz;
  v_lead_name       text;
  v_cross_team      boolean;
  v_new_telecaller  uuid;
  v_new_assigned    uuid;
  v_new_sales_ready timestamptz;
  v_new_handoff     timestamptz;
  v_audit_notes     text;
BEGIN
  -- Caller lane derivation. Phase 100.A amendment W5 — sales_manager
  -- `team_role` overrides role='telecaller' into the sales lane.
  -- Pattern: a TC who is also the team's manager (e.g. Renuka role
  -- per CLAUDE.md §32) reassigning a lead should be treated as
  -- sales-lane for permission purposes, not as a TC. Owner directive
  -- 2026-05-29: "team_role='sales_manager' should be treated as
  -- sales lane even if role='telecaller'".
  v_caller_lane := CASE
    WHEN p_caller_role = 'telecaller' AND p_caller_team = 'sales_manager' THEN 'sales'
    WHEN p_caller_role = 'telecaller'                                     THEN 'tc'
    WHEN p_caller_role IN ('sales', 'agency')                             THEN 'sales'
    WHEN p_caller_role IN ('admin', 'co_owner')                           THEN 'admin'
    ELSE 'other'
  END;

  -- Self-assign block (universal).
  IF p_new_owner = p_caller THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'cannot reassign to self'
    );
  END IF;

  -- Target profile lookup.
  SELECT role, team_role, COALESCE(is_active, true), segment_access, name
    INTO v_target_role, v_target_team, v_target_active,
         v_target_segment, v_target_name
    FROM public.users
   WHERE id = p_new_owner;

  IF v_target_name IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'target not found'
    );
  END IF;

  IF NOT v_target_active THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'target not active'
    );
  END IF;

  -- Phase 100.A amendment W5 — same lane override applied to the
  -- target. Picking a sales_manager target is treated as same-lane
  -- for a sales/agency caller.
  v_target_lane := CASE
    WHEN v_target_role = 'telecaller' AND v_target_team = 'sales_manager' THEN 'sales'
    WHEN v_target_role = 'telecaller'                                     THEN 'tc'
    WHEN v_target_role IN ('sales', 'agency')                             THEN 'sales'
    WHEN v_target_role IN ('admin', 'co_owner')                           THEN 'admin'
    ELSE 'other'
  END;

  -- Non-admin cannot pick admin / co_owner as target.
  IF v_caller_lane <> 'admin' AND v_target_lane = 'admin' THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'cannot reassign to admin'
    );
  END IF;

  -- Lead row with FOR UPDATE lock so a concurrent stage change or
  -- another reassign serializes against this one.
  SELECT telecaller_id, assigned_to, stage, segment,
         sales_ready_at, handoff_sla_due_at, name
    INTO v_lead_owner_tc, v_lead_owner_sa, v_lead_stage, v_lead_segment,
         v_lead_sales_ready, v_lead_handoff, v_lead_name
    FROM public.leads
   WHERE id = p_lead_id
   FOR UPDATE;

  IF v_lead_name IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'lead not found'
    );
  END IF;

  -- Phase 100.A amendment W11 — §42 doctrine guard. Vishal
  -- (co_owner + government_partner) stays GOVERNMENT-scoped even
  -- inside this SECDEF context. SECDEF bypasses
  -- leads_govt_partner_read for the FOR UPDATE lookup above, so
  -- without this check Vishal could touch a PRIVATE lead by
  -- direct UUID. Surface today is low (no UI surfaces PRIVATE
  -- lead IDs to him) but doctrine is explicit and the guard is
  -- cheap. Same gate applied regardless of admin lane bypass
  -- since government_partner is a scope, not a privilege tier.
  IF p_caller_team = 'government_partner'
     AND v_lead_segment <> 'GOVERNMENT' THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'government_partner caller cannot touch non-GOVERNMENT leads'
    );
  END IF;

  -- Non-admin must currently own the lead.
  IF v_caller_lane <> 'admin' THEN
    IF v_lead_owner_tc IS DISTINCT FROM p_caller
       AND v_lead_owner_sa IS DISTINCT FROM p_caller THEN
      RETURN jsonb_build_object(
        'ok', false, 'lead_id', p_lead_id,
        'reason', 'not lead owner'
      );
    END IF;
  END IF;

  -- Non-admin cannot reassign Won / Lost.
  IF v_caller_lane <> 'admin'
     AND v_lead_stage IN ('Won', 'Lost') THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'cannot reassign closed lead'
    );
  END IF;

  -- Target segment access check (PRIVATE/GOVERNMENT/ALL).
  IF v_target_segment IS NOT NULL
     AND v_target_segment NOT IN ('ALL', v_lead_segment) THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'target segment access mismatch'
    );
  END IF;

  -- Q1 — sales → TC stage gate. Sales / agency caller reassigning
  -- back to TC is allowed only on New / Working / Nurture.
  IF v_caller_lane = 'sales'
     AND v_target_lane = 'tc'
     AND v_lead_stage NOT IN ('New', 'Working', 'Nurture') THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'sales→TC only allowed on New/Working/Nurture stages'
    );
  END IF;

  -- Other lane → lane combos.
  -- 'other' lane callers (hr, accounts, office_staff, staff) are
  -- blocked — they have no business reassigning leads.
  IF v_caller_lane = 'other' THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'role not allowed to reassign'
    );
  END IF;

  IF v_target_lane = 'other' THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'target role not eligible'
    );
  END IF;

  -- Cross-team detection.
  v_cross_team := (
    (v_caller_lane = 'tc'    AND v_target_lane = 'sales')
    OR (v_caller_lane = 'sales' AND v_target_lane = 'tc')
  );

  -- Q5 — reason required for cross-team.
  IF v_cross_team
     AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RETURN jsonb_build_object(
      'ok', false, 'lead_id', p_lead_id,
      'reason', 'reason required for cross-team reassign'
    );
  END IF;

  -- Determine column write (Phase 99.C mutual-exclusivity pattern).
  IF v_target_lane = 'tc' THEN
    v_new_telecaller := p_new_owner;
    v_new_assigned   := NULL;
  ELSE
    v_new_assigned   := p_new_owner;
    v_new_telecaller := NULL;
  END IF;

  -- Handoff stamp — TC → sales path. Stamps sales_ready_at +
  -- handoff_sla_due_at IF NULL. Phase 34 lead_set_handoff_sla
  -- trigger stamps these on stage→Working transitions; this is
  -- the defensive backstop for the case where the lead is already
  -- in Working but never had the stamp.
  IF v_caller_lane = 'tc' AND v_target_lane = 'sales' THEN
    v_new_sales_ready := COALESCE(v_lead_sales_ready, now());
    v_new_handoff     := COALESCE(
      v_lead_handoff,
      public.next_business_moment(v_new_sales_ready + interval '24 hours')
    );
  ELSE
    -- All other lane combos preserve the existing stamps
    -- (sales→TC keeps history per Q1.A decision).
    v_new_sales_ready := v_lead_sales_ready;
    v_new_handoff     := v_lead_handoff;
  END IF;

  -- Build audit notes.
  v_audit_notes := 'Reassigned by ' || p_caller_name
                || ' to ' || v_target_name;
  IF p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN
    v_audit_notes := v_audit_notes || '. ' || trim(p_reason);
  END IF;

  -- Insert the timeline row BEFORE the UPDATE (Phase 76.2.2
  -- ordering — the old owner still has SELECT access to the lead
  -- so RLS on lead_activities passes).
  INSERT INTO public.lead_activities (
    lead_id, activity_type, notes, created_by
  ) VALUES (
    p_lead_id, 'status_change', v_audit_notes, p_caller
  );

  -- Insert the reassign_audit row.
  INSERT INTO public.reassign_audit (
    caller_id, lead_id, new_owner, reason
  ) VALUES (
    p_caller, p_lead_id, p_new_owner, p_reason
  );

  -- Flip ownership.
  UPDATE public.leads
     SET telecaller_id      = v_new_telecaller,
         assigned_to        = v_new_assigned,
         sales_ready_at     = v_new_sales_ready,
         handoff_sla_due_at = v_new_handoff,
         updated_at         = now()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'ok', true,
    'lead_id', p_lead_id,
    'new_owner', p_new_owner,
    'new_owner_role', v_target_role
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 3. reassign_lead — single-lead public RPC.
-- Auths caller, enforces daily limit, calls _apply once.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reassign_lead(
  p_lead_id   uuid,
  p_new_owner uuid,
  p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_caller_role  text;
  v_caller_name  text;
  v_caller_team  text;
  v_today_count  int;
  v_today_ist    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be signed in'
      USING ERRCODE = '42501';
  END IF;

  -- Phase 100.A amendment W5 + W11 — fetch team_role too so
  -- _reassign_lead_apply can apply the SM lane override + the
  -- government_partner segment guard.
  SELECT role, name, team_role
    INTO v_caller_role, v_caller_name, v_caller_team
    FROM public.users
   WHERE id = v_caller;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'caller has no role on file'
      USING ERRCODE = '42501';
  END IF;

  -- Q2 — daily limit 5/rep for non-admin. Counter reads today's
  -- IST-anchored window from reassign_audit.
  IF v_caller_role NOT IN ('admin', 'co_owner') THEN
    SELECT count(*)
      INTO v_today_count
      FROM public.reassign_audit
     WHERE caller_id = v_caller
       AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = v_today_ist;

    IF v_today_count >= 5 THEN
      RAISE EXCEPTION 'daily reassign limit reached (5)'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN public._reassign_lead_apply(
    v_caller, v_caller_role, v_caller_name, v_caller_team,
    p_lead_id, p_new_owner, p_reason
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 4. reassign_leads_bulk — bulk public RPC.
-- Enforces bulk cap (20 for non-admin) and projects rate limit
-- across the batch BEFORE iterating. Returns per-row results.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reassign_leads_bulk(
  p_lead_ids  uuid[],
  p_new_owner uuid,
  p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_caller_role  text;
  v_caller_name  text;
  v_caller_team  text;
  v_today_count  int;
  v_today_ist    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_total        int;
  v_succeeded    int := 0;
  v_failed       int := 0;
  v_failures     jsonb := '[]'::jsonb;
  v_lead_id      uuid;
  v_result       jsonb;
  v_remaining    int;
  v_can_attempt  int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be signed in'
      USING ERRCODE = '42501';
  END IF;

  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) = 0 THEN
    RAISE EXCEPTION 'no leads provided'
      USING ERRCODE = '22023';
  END IF;

  -- Phase 100.A amendment W5 + W11 — fetch team_role too.
  SELECT role, name, team_role
    INTO v_caller_role, v_caller_name, v_caller_team
    FROM public.users
   WHERE id = v_caller;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'caller has no role on file'
      USING ERRCODE = '42501';
  END IF;

  v_total := array_length(p_lead_ids, 1);

  -- Q3 — bulk cap 20 for non-admin.
  IF v_caller_role NOT IN ('admin', 'co_owner') AND v_total > 20 THEN
    RAISE EXCEPTION 'bulk cap 20 reached (% requested)', v_total
      USING ERRCODE = '42501';
  END IF;

  -- Q2 — daily limit. For non-admin we project against today's
  -- count. If the batch would push past 5, only the first
  -- (5 - today_count) leads are attempted; the rest are recorded
  -- as failures so the caller sees exactly which ones didn't run.
  v_can_attempt := v_total;
  IF v_caller_role NOT IN ('admin', 'co_owner') THEN
    SELECT count(*)
      INTO v_today_count
      FROM public.reassign_audit
     WHERE caller_id = v_caller
       AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = v_today_ist;

    v_remaining := GREATEST(0, 5 - v_today_count);
    v_can_attempt := LEAST(v_total, v_remaining);

    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'daily reassign limit reached (5)'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Iterate the leads. The first v_can_attempt entries hit
  -- _apply; the rest (if any) are recorded as over-limit failures.
  FOR i IN 1..v_total LOOP
    v_lead_id := p_lead_ids[i];
    IF i <= v_can_attempt THEN
      v_result := public._reassign_lead_apply(
        v_caller, v_caller_role, v_caller_name, v_caller_team,
        v_lead_id, p_new_owner, p_reason
      );
      IF (v_result->>'ok')::boolean THEN
        v_succeeded := v_succeeded + 1;
      ELSE
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'lead_id', v_lead_id,
          'reason',  v_result->>'reason'
        );
      END IF;
    ELSE
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'lead_id', v_lead_id,
        'reason',  'daily reassign limit reached during this batch'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total',     v_total,
    'succeeded', v_succeeded,
    'failed',    v_failed,
    'failures',  v_failures
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 5. GRANT / REVOKE — same posture as Phase 97.A2 enqueue_push:
-- public can't call directly; authenticated can; anon and PUBLIC
-- explicitly revoked.
-- ────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public._reassign_lead_apply(uuid, text, text, text, uuid, uuid, text)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reassign_lead(uuid, uuid, text)                                  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reassign_lead(uuid, uuid, text)                                  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reassign_leads_bulk(uuid[], uuid, text)                          TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reassign_leads_bulk(uuid[], uuid, text)                          FROM PUBLIC, anon;


NOTIFY pgrst, 'reload schema';


-- ───────────── VERIFY ─────────────
-- Paste each query separately. Studio shows last result on multi-
-- statement.
--
-- V1 — table + indexes exist, RLS enabled, 2 policies:
--
--   SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'reassign_audit') AS has_table,
--          (SELECT count(*) FROM pg_indexes WHERE tablename = 'reassign_audit') AS index_count,
--          (SELECT relrowsecurity FROM pg_class WHERE relname = 'reassign_audit') AS rls_enabled,
--          (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.reassign_audit'::regclass) AS policy_count;
--
--   Expected: has_table=true, index_count=3 (PK + 2 explicit),
--             rls_enabled=true, policy_count=2.
--
-- V2 — all 3 functions exist with correct signatures:
--
--   SELECT proname, pg_get_function_arguments(oid) AS args,
--          prosecdef AS is_secdef
--     FROM pg_proc
--    WHERE proname IN ('_reassign_lead_apply', 'reassign_lead', 'reassign_leads_bulk')
--    ORDER BY proname;
--
--   Expected: 3 rows, all secdef=true, args match the file.
--
-- V3 — GRANT/REVOKE landed:
--
--   SELECT proname, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_can,
--                   has_function_privilege('anon', oid, 'EXECUTE')          AS anon_can,
--                   has_function_privilege('public', oid, 'EXECUTE')        AS public_can
--     FROM pg_proc
--    WHERE proname IN ('reassign_lead', 'reassign_leads_bulk', '_reassign_lead_apply')
--    ORDER BY proname;
--
--   Expected:
--     reassign_lead          auth_can=t, anon_can=f, public_can=f
--     reassign_leads_bulk    same as above
--     _reassign_lead_apply   all three = f (internal helper)
--
-- V4 — sanity admin smoke. Replace UUIDs with real values.
--      Pick a lead the admin owns or any test lead.
--
--   SELECT public.reassign_lead(
--     '<test_lead_uuid>'::uuid,
--     '<another_user_uuid>'::uuid,
--     'admin smoke test'
--   );
--
--   Expected: jsonb {ok: true, lead_id, new_owner, new_owner_role}.
--
--   Then verify the audit chain:
--
--   SELECT id, caller_id, lead_id, new_owner, reason, created_at
--     FROM public.reassign_audit
--    ORDER BY created_at DESC LIMIT 5;
--
--   SELECT activity_type, notes, created_by, created_at
--     FROM public.lead_activities
--    WHERE lead_id = '<test_lead_uuid>'::uuid
--    ORDER BY created_at DESC LIMIT 5;
--
--   Expected: 1 row in each, top row matches the smoke test.
--
-- V5 — sanity non-admin block. Use any TC's auth (sign in as
--      Rima in browser, then run via DevTools):
--
--   await window.supabase.rpc('reassign_lead', {
--     p_lead_id:   '<lead_not_owned_by_rima>',
--     p_new_owner: '<some_other_user>',
--     p_reason:    null
--   });
--
--   Expected: { error: { code: '42501', message: 'not lead owner' } }
--             OR jsonb {ok: false, reason: 'not lead owner'}
--             depending on which gate fires first.
--
-- V6 — schema reload landed:
--
--   SELECT 1;
--
--   Expected: 1.


-- ───────────── ROLLBACK ─────────────
-- Re-apply ONLY if a real regression appears. Drops all 3
-- functions + the reassign_audit table (CASCADE on table
-- removes the 2 policies too). Reverts to Phase 99 state where
-- only admin can reassign via direct UPDATE through ReassignModal.
--
-- Strip the leading "-- " from each line to execute.
--
-- DROP FUNCTION IF EXISTS public.reassign_leads_bulk(uuid[], uuid, text);
-- DROP FUNCTION IF EXISTS public.reassign_lead(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public._reassign_lead_apply(uuid, text, text, text, uuid, uuid, text);
-- DROP TABLE IF EXISTS public.reassign_audit CASCADE;
--
-- NOTIFY pgrst, 'reload schema';
