-- ============================================================================
-- db/functions/handle_payment_update.sql — CANONICAL HOME (Phase 178 / Stage 2)
-- ============================================================================
--
-- ⭐ The ONE place handle_payment_update is allowed to live. EDIT THIS FILE to
--    change it; never re-paste it into a new phaseN file (§71). It lived in 2
--    files (phase2_additions, phase3c).
--
-- 💰 MONEY — fires on UPDATE of a payments row. Keeps monthly_sales_data (which
--    feeds incentive/salary) in sync when a payment's counted-ness changes: a row
--    "counts" when is_final_payment AND approval_status='approved'. It rebuilds the
--    OLD staff+month (removes the prior credit) and the NEW staff+month (adds the
--    new credit), covering approval flips, amount edits, and quote/staff/month
--    reassignment. Capture, not change — byte-for-byte the live function
--    (dumped 2026-06-24), zero DB run.
--
-- WIRING (live, single-fire): AFTER UPDATE trigger payments_update_recalc on
--    public.payments → this function (verified single trigger, enabled, 2026-06-24).
--    Trigger stays in the phase files; this canonical owns the body.
--
-- LOCKED CONTRACT: old_counted/new_counted = (is_final_payment AND approved). If
--    NEITHER side counted → no-op. Otherwise rebuild OLD side (if it counted) and
--    NEW side (if it counts) — rebuild_monthly_sales is idempotent, so the
--    same-staff+month path still rebuilds once to pick up amount/reassignment edits.
--    RETURN NEW. NOTE: rebuild_monthly_sales is itself still multi-copy (future
--    Stage-2 candidate); keep this caller in step with it.
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

CREATE OR REPLACE FUNCTION public.handle_payment_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  old_counted boolean;
  new_counted boolean;
  old_staff   uuid;
  new_staff   uuid;
  old_month   text;
  new_month   text;
BEGIN
  old_counted := (OLD.is_final_payment = true AND OLD.approval_status = 'approved');
  new_counted := (NEW.is_final_payment = true AND NEW.approval_status = 'approved');

  -- If the row never touched the ledger in either state, no work.
  IF NOT old_counted AND NOT new_counted THEN
    RETURN NEW;
  END IF;

  SELECT created_by INTO old_staff FROM quotes WHERE id = OLD.quote_id;
  SELECT created_by INTO new_staff FROM quotes WHERE id = NEW.quote_id;
  old_month := to_char(OLD.payment_date, 'YYYY-MM');
  new_month := to_char(NEW.payment_date, 'YYYY-MM');

  -- Rebuild OLD side (removes the previous credit cleanly)
  IF old_counted THEN
    PERFORM rebuild_monthly_sales(old_staff, old_month);
  END IF;

  -- Rebuild NEW side (adds the new credit; safe to call even
  -- when staff+month are identical to OLD — rebuild is idempotent)
  IF new_counted
     AND (NOT old_counted OR old_staff <> new_staff OR old_month <> new_month) THEN
    PERFORM rebuild_monthly_sales(new_staff, new_month);
  ELSIF new_counted THEN
    -- Same staff+month: still rebuild once to pick up amount /
    -- quote reassignment edge cases.
    PERFORM rebuild_monthly_sales(new_staff, new_month);
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY / TRIPWIRE — read-only. All five must be TRUE.
-- ============================================================================
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%old_counted%'                  AS old_counted_var,
--   pg_get_functiondef(p.oid) LIKE '%new_counted%'                  AS new_counted_var,
--   pg_get_functiondef(p.oid) LIKE '%NOT old_counted AND NOT new_counted%' AS neither_noop,
--   pg_get_functiondef(p.oid) LIKE '%rebuild_monthly_sales%'        AS rebuilds_ledger,
--   pg_get_functiondef(p.oid) LIKE '%RETURN NEW%'                   AS returns_new
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'handle_payment_update';
