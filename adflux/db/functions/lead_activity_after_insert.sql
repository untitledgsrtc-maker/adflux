-- ============================================================================
-- db/functions/lead_activity_after_insert.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place lead_activity_after_insert is allowed to live. EDIT THIS FILE
--    to change it; never re-paste it into a new phaseN file (§71). It lived in 5
--    files (phase12, 31b, 34b, 34z2, 34z17 — the auto-Lost evolution).
--
-- WHAT IT DOES: AFTER-INSERT trigger on lead_activities. Two jobs:
--    1. On any contact activity (call/whatsapp/email/meeting/site_visit) it bumps
--       leads.contact_attempts_count + sets last_contact_at. (This feeds the
--       stale-leads banner + the smart-task engine — don't break it.)
--    2. SOFT auto-Lost SUGGESTION: at >=15 failed attempts (outcome null/neutral/
--       negative) on a still-open lead it sets auto_lost_suggested=true. It does
--       NOT flip the stage — the rep decides via the LeadDetailV2 banner (§26
--       Sprint F item 10 softened the old hard auto-Lost). Frozen-adjacent (§28
--       lead lifecycle) → guardian before any change.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-23 via
--    pg_get_functiondef. Single signature (trigger fn, no args). The live body is
--    the threshold-15 soft-suggest version. Running this file is a NO-OP.
--
-- ⚠ This is a PLAIN trigger fn — NOT SECURITY DEFINER, NO SET search_path (that
--    is how it runs live). Do NOT "harden" it with DEFINER/search_path unless the
--    owner asks — it only writes leads the firing user can already reach via RLS.
--
-- TRIGGER WIRING lives in supabase_phase12_m1_m7_foundation.sql
--    (trg_lead_activity_after_insert) — NOT here; the later auto-Lost files also
--    re-create the same trigger idempotently. This canonical owns the body only.
--
-- SUPERSEDES (Phase 178 removed the body from each; triggers / siblings stay):
--      supabase_phase12_m1_m7_foundation.sql        (keeps 6 fns + its triggers)
--      supabase_phase31b_auto_lost_fix.sql
--      supabase_phase34b_soft_auto_lost.sql         (keeps dismiss_auto_lost RPC)
--      supabase_phase34z2_auto_lost_threshold_15.sql
--      supabase_phase34z17_auto_lost_cleanup.sql
--
-- LOCKED CONTRACTS in the body (a diff that changes any is owner-sign-off):
--    • threshold = 15 attempts (NOT 3 — §26 Sprint F softened it).
--    • SOFT only — sets auto_lost_suggested, NEVER stage='Lost' directly.
--    • stage guard: only suggest when stage NOT IN ('Won','Lost','Nurture').
--    • maintains contact_attempts_count + last_contact_at on every contact row.
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_activity_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_attempts int;
  v_suggested boolean;
BEGIN
  IF NEW.activity_type IN ('call','whatsapp','email','meeting','site_visit') THEN
    UPDATE public.leads
       SET contact_attempts_count = contact_attempts_count + 1,
           last_contact_at        = COALESCE(NEW.created_at, now()),
           updated_at             = now()
     WHERE id = NEW.lead_id
     RETURNING contact_attempts_count, auto_lost_suggested
       INTO v_attempts, v_suggested;

    IF v_attempts >= 15
       AND (NEW.outcome IS NULL OR NEW.outcome IN ('neutral','negative'))
       AND v_suggested IS NOT TRUE THEN
      UPDATE public.leads
         SET auto_lost_suggested    = true,
             auto_lost_suggested_at = now(),
             updated_at             = now()
       WHERE id = NEW.lead_id
         AND stage NOT IN ('Won','Lost','Nurture');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only, run any time. All five must be TRUE.
-- A FALSE = an older copy was re-run and changed a locked behaviour → re-run this.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%contact_attempts_count%'        AS maintains_attempts,
--   pg_get_functiondef(p.oid) LIKE '%last_contact_at%'               AS maintains_last_contact,
--   pg_get_functiondef(p.oid) LIKE '%auto_lost_suggested%'           AS soft_suggest_only,
--   pg_get_functiondef(p.oid) LIKE '%>= 15%'                         AS threshold_15,
--   pg_get_functiondef(p.oid) LIKE '%NOT IN (''Won'',''Lost'',''Nurture'')%' AS stage_guard
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'lead_activity_after_insert';
