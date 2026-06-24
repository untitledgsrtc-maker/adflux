-- ============================================================================
-- db/functions/handle_payment_delete.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place handle_payment_delete is allowed to live. EDIT THIS FILE to
--    change it; never re-paste it into a new phaseN file (§71). It lived in 2
--    files (phase2_additions, phase3c).
--
-- 💰 MONEY — fires on DELETE of a payments row. If the deleted row WAS a counted
--    sale (is_final_payment AND approval_status='approved'), it rebuilds that
--    staff+month's monthly_sales_data (removing the now-deleted credit), which
--    feeds incentive/salary. Capture, not change — byte-for-byte the live function
--    (dumped 2026-06-24), zero DB run.
--
-- WIRING (live, single-fire): BEFORE/AFTER DELETE trigger payments_delete_recalc on
--    public.payments → this function (verified single trigger, enabled, 2026-06-24).
--    Trigger stays in the phase files; this canonical owns the body.
--
-- LOCKED CONTRACT: only a row that WAS counted (is_final_payment + approved)
--    triggers a rebuild; everything else is a no-op. RETURN OLD.
--    NOTE: rebuild_monthly_sales is ITSELF still multi-copy (a future Stage-2
--    candidate) — keep this caller in step with whatever it becomes.
--
-- PROVENANCE: captured byte-for-byte from the LIVE DB 2026-06-24 via
--    pg_get_functiondef. Single signature (trigger fn). Running = NO-OP.
--
-- SUPERSEDES (Phase 178 removed the body from both):
--      phase2_additions.sql
--      supabase_phase3c.sql
--
-- REVERT: re-run this file. TRIPWIRE: VERIFY block at the bottom.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_payment_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  staff_uid uuid;
  month_str text;
BEGIN
  IF OLD.is_final_payment = true
     AND OLD.approval_status = 'approved' THEN
    SELECT created_by INTO staff_uid FROM quotes WHERE id = OLD.quote_id;
    month_str := to_char(OLD.payment_date, 'YYYY-MM');
    PERFORM rebuild_monthly_sales(staff_uid, month_str);
  END IF;
  RETURN OLD;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All four must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%is_final_payment = true%'      AS final_payment_gate,
--   pg_get_functiondef(p.oid) LIKE '%approval_status = ''approved''%' AS approved_gate,
--   pg_get_functiondef(p.oid) LIKE '%rebuild_monthly_sales%'         AS rebuilds_ledger,
--   pg_get_functiondef(p.oid) LIKE '%RETURN OLD%'                    AS returns_old
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'handle_payment_delete';
