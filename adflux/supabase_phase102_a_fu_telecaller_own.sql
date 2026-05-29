-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 102.A SQL
-- Telecaller follow_ups self-UPDATE RLS policy
-- 2026-05-29 (Brijesh Solanki)
-- =====================================================================
--
-- WHY (audit finding F-R200 from role-workflow-impact-auditor,
--      2026-05-29):
--   Dhara reports FollowUpsV2 shows 56 due even after she closed
--   today's calls. Audit found:
--   - public.follow_ups carries fu_admin_all (admin / co_owner full
--     access — Phase 33D.4 supabase_phase33d4_auto_lead_followup.sql)
--   - and fu_sales_own (sales / agency on own-assigned rows — Phase
--     4e / Phase 11g supabase_phase11g_storage_lockdown.sql:127).
--   - TELECALLER HAS NO OWN-ROW POLICY. Phase 11g stripped
--     'telecaller' out of the fu_sales_own role-list.
--   - PostCallOutcomeModal close UPDATE silently no-ops for TC role
--     ({ data:null, error:null }). is_done stays false. The 56-due
--     count never decrements after Dhara saves the modal.
--   - Phase 102.A JSX (PostCallOutcomeModal close-scope widening)
--     does NOT fix this — RLS still gates which rows actually flip.
--
-- WHAT THIS FILE DOES (idempotent):
--   1. Adds fu_telecaller_own — FOR ALL to authenticated, scoped to
--      role='telecaller' AND assigned_to=auth.uid(). Mirrors the
--      fu_sales_own shape exactly, just on a different role.
--   2. Reloads PostgREST schema cache so the policy goes live without
--      a connection cycle.
--
-- WHAT THIS FILE DOES NOT TOUCH:
--   - fu_admin_all (Phase 33D.4 — admin / co_owner full access)
--   - fu_sales_own (Phase 4e / Phase 11g — sales / agency self)
--   - follow_ups table schema (no column add / drop / rename)
--   - trg_followup_after_done cadence trigger (Phase 33D.6)
--   - trg_z_close_followups_on_terminal stage trigger (Phase 76.3)
--   - sales_manager / hr / accounts / office_staff roles (no policy
--     added — they don't open the modal today)
--
-- DEPENDENCY:
--   - public.get_my_role() helper (Phase 5+). Returns the caller's
--     users.role text or NULL. Used by every RLS policy in this DB.
--
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- (1) Policy
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "fu_telecaller_own" ON public.follow_ups;

CREATE POLICY "fu_telecaller_own" ON public.follow_ups
  FOR ALL TO authenticated
  USING      (public.get_my_role() = 'telecaller' AND assigned_to = auth.uid())
  WITH CHECK (public.get_my_role() = 'telecaller' AND assigned_to = auth.uid());


-- ─────────────────────────────────────────────────────────────────────
-- (2) Refresh PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- VERIFY (paste each block in Studio after applying)
-- =====================================================================
--
-- V1: policy present
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='follow_ups'
--      AND policyname='fu_telecaller_own';
--   Expected: 1
--
-- V2: full policy set on follow_ups
--   SELECT policyname FROM pg_policies
--    WHERE schemaname='public' AND tablename='follow_ups'
--    ORDER BY policyname;
--   Expected (3 rows or more): 'fu_admin_all', 'fu_sales_own',
--                              'fu_telecaller_own' (plus any read
--                              policies that already exist).
--
-- V3 (smoke as Dhara — SELECT):
--   Sign in as Dhara via the Studio Auth → Impersonate, then run:
--     SELECT count(*) FROM public.follow_ups
--      WHERE assigned_to = auth.uid() AND is_done = false;
--   Expected: matches probe (a) from the audit (e.g. 56).
--
-- V4 (smoke as Dhara — UPDATE single row):
--   Pick one row id from V3 (call it <FU-ID>). As Dhara:
--     UPDATE public.follow_ups
--        SET is_done = true, done_at = now()
--      WHERE id = '<FU-ID>'::uuid
--      RETURNING id, is_done, done_at;
--   Expected: 1 row returned with is_done=true.
--   (Pre-fix this UPDATE silently returned 0 rows.)
--
-- V5 (smoke as Dhara — bulk clear overdue ghost, OPTIONAL):
--   This is the one-time backfill that clears Dhara's 56-row noise
--   so she can confirm Phase 102.A widening works in subsequent
--   modal saves. Owner-controlled; don't run unless probe (a) +
--   probe (b) confirm overdue bucket > 0.
--     UPDATE public.follow_ups
--        SET is_done = true, done_at = now()
--      WHERE assigned_to = '<DHARA-UUID>'::uuid
--        AND is_done = false
--        AND follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
--      RETURNING id;
--   Expected: N rows (the overdue bucket from probe (b)).
--   This runs the cadence re-spawn trigger N times — accept the
--   trigger churn (it's the same trigger that fires today; this
--   is the first time TC has been able to fire it).
--
-- =====================================================================
-- ROLLBACK (paste in Studio only if VERIFY fails)
-- =====================================================================
--
-- a) Drop the new policy
--   DROP POLICY IF EXISTS "fu_telecaller_own" ON public.follow_ups;
--
-- b) Refresh PostgREST
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
