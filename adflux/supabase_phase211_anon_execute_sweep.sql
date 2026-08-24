-- =====================================================================
-- Phase 211 — anon-execute lockdown (Supabase Security Advisor sweep)
-- 2026-07-06
--
-- THE FINDING: ~127 SECURITY DEFINER functions are executable by the
--   `anon` (unauthenticated) role — NOT via explicit grants, but via
--   Postgres's PUBLIC default (every function is runnable by everyone
--   unless revoked). Most are internal trigger fns (error out if poked)
--   or already-gated admin RPCs, so real exploitability is low — but the
--   correct posture is: anon can run NOTHING except the pre-login flow.
--
-- THE SWEEP (strip PUBLIC, restore authenticated, keep the exceptions):
--   1. REVOKE the blanket PUBLIC execute on every public function
--      (removes anon's inherited access on all ~127 at once).
--   2. GRANT execute back to `authenticated` on all of them — the app
--      ALWAYS calls RPCs as a signed-in user, so this keeps every rep /
--      admin / accounts flow working, unchanged.
--   3. RE-LOCK the functions that must NOT be authenticated-callable
--      either (already-closed holes: §97.A2 enqueue_push · §207 dedupe
--      pair · §209 regen). Step 2's blanket grant would have re-opened
--      them — this re-revokes.
--   4. KEEP the 3 pre-login (anon) offer-flow functions anon-executable
--      (the new-hire /offer/:token page calls them before login).
--
--   Steps 3 + 4 use dynamic lookups (oid::regprocedure) so we never
--   hand-type a signature — the 24-arg submit_offer_acceptance is exactly
--   the kind of overload where a typo silently targets the wrong function.
--
-- WHAT THIS DOES **NOT** DO (deliberate, owner-aware):
--   • It does NOT touch `authenticated` reachability beyond the 4 re-locks
--     — the advisor's SEPARATE "signed-in users can execute" warnings stay
--     (those functions are internal triggers / self-or-admin-gated RPCs;
--     revoking authenticated would break the app). Only the ANON category
--     is swept.
--   • It does NOT add ALTER DEFAULT PRIVILEGES. So a NEWLY created function
--     re-gets the PUBLIC default → re-introduces anon. Durability options
--     (decide separately): (a) re-run this file after adding functions, or
--     (b) `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON
--     FUNCTIONS FROM PUBLIC` — but then EVERY new RPC needs an explicit
--     `GRANT ... TO authenticated` or the app can't call it. Not done here
--     to avoid silently breaking future functions.
--
-- §45-safe: GRANT/REVOKE metadata only, no function body, no hot path.
-- Idempotent (re-runnable). service_role / postgres are never revoked
-- (owner + service_role keep execute on everything for triggers + cron).
-- =====================================================================

-- 1. Strip the blanket PUBLIC execute (this is HOW anon inherits access).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- 2. Restore execute for signed-in users (the app's real callers).
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- 3. Re-lock the already-closed holes from BOTH anon AND authenticated
--    (§97.A2 / §207 / §209). Dynamic → covers every overload, no typos.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      -- _reassign_lead_apply: §100.A revoked it (SECURITY DEFINER + trusts a
      -- caller-supplied p_caller_role → rep could pass 'admin'). Step 2's
      -- blanket grant would re-open it; re-lock here. No client calls it
      -- directly (only the reassign_lead / reassign_leads_bulk wrappers).
      -- ai_build_quote (§325) + flag_lead_hot_from_wa (§324): SECURITY DEFINER,
      -- REVOKED from authenticated (only ai-reply.js with the service key calls
      -- them). Step 2's blanket grant would re-open them; re-lock here.
      -- ai_quote_followup_* (AI quote follow-up): SECURITY DEFINER, REVOKED —
      -- only api/wa/ai-followup.js with the service key reaches them.
      AND p.proname IN ('enqueue_push', 'dedupe_all_phone_groups',
                        'dedupe_phone_lead_group', 'regen_payment_fu_notes',
                        '_reassign_lead_apply',
                        'ai_build_quote', 'flag_lead_hot_from_wa',
                        'ai_quote_followup_candidates', 'ai_quote_followup_mark',
                        'ai_quote_followup_dispatch',
                        'quote_nudge_candidates', 'quote_nudge_mark',
                        'quote_nudge_dispatch',
                        -- §227 cadence engine + quality watcher: SECURITY DEFINER, REVOKED —
                        -- only the service-role Edge endpoints reach them. Re-lock here so a
                        -- sweep re-run's blanket GRANT (step 2) can't re-open them (a rep could
                        -- otherwise fire followup_cadence_dispatch → off-schedule template blast).
                        'followup_cadence_candidates', 'followup_cadence_mark',
                        'followup_cadence_dispatch', 'wa_quality_watch_dispatch',
                        -- §225 Batch 2b ghosted-inbound recovery: re-fires ai-reply for
                        -- dropped dispatches. REVOKED — only the cron reaches it.
                        'wa_ai_recovery_dispatch')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- 4. Keep the 3 pre-login offer-flow functions anon-executable.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fetch_offer_by_token', 'is_open_offer_token', 'submit_offer_acceptance')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── VERIFY — read every row; each must match the // comment ─────────
-- A) anon is LOCKED OUT of sensitive functions (all false).
SELECT 'A. anon locked out (expect all false)' AS check,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('compute_monthly_salary','admin_create_user','approve_leave',
                    'enqueue_push','dedupe_all_phone_groups','reassign_lead','set_my_app_version')
ORDER BY p.proname;

-- B) the app's real RPCs STILL work for signed-in users (all true).
SELECT 'B. authenticated keeps app RPCs (expect all true)' AS check,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('compute_monthly_salary','monthly_score','my_chase_counts',
                    'record_checkin','set_my_app_version','tc_weekly_stats','team_dashboard_bundle')
ORDER BY p.proname;

-- C) the 3 pre-login offer-flow fns stay anon-executable (all true).
SELECT 'C. offer-flow still anon (expect all true)' AS check,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('fetch_offer_by_token','is_open_offer_token','submit_offer_acceptance')
ORDER BY p.proname;

-- D) the already-closed holes stay revoked from authenticated too (all false).
SELECT 'D. locked holes stay locked (expect all false)' AS check,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('enqueue_push','dedupe_all_phone_groups','dedupe_phone_lead_group',
                    'regen_payment_fu_notes','_reassign_lead_apply',
                    'ai_build_quote','flag_lead_hot_from_wa',
                    'ai_quote_followup_candidates','ai_quote_followup_mark',
                    'ai_quote_followup_dispatch',
                    'quote_nudge_candidates','quote_nudge_mark','quote_nudge_dispatch',
                    'followup_cadence_candidates','followup_cadence_mark',
                    'followup_cadence_dispatch','wa_quality_watch_dispatch',
                    'wa_ai_recovery_dispatch')
ORDER BY p.proname;

SELECT 'Phase 211 anon-execute sweep applied' AS status;
