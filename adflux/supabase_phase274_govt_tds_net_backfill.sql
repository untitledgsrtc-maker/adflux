-- supabase_phase274_govt_tds_net_backfill.sql
-- Phase 274 (2026-08-21) — one-time fix for GOVT deals showing "PARTIAL" when they
-- are actually FULLY PAID, because the payment was entered as the NET cash (after
-- the government withheld TDS) instead of the GROSS invoice.
--
-- MODEL (unchanged): balance = total_amount − Σ approved amount_received. TDS is NOT
-- subtracted, so a deal closes only when amount_received = the GROSS invoice. The new
-- UI stores the gross (net + tds) going forward; this backfill corrects the deals
-- already entered as net.
--
-- ⚠ RUN PART 1 FIRST, READ THE LIST, then run PART 2. PART 2 is COMMENTED on purpose
-- so a wholesale paste can NOT apply it unreviewed. It writes to APPROVED payments on
-- WON deals and (correctly) MOVES MONEY:
--   • It sets amount_received = net + tds → the deal's recorded revenue rises by the
--     withheld TDS. This is the CORRECT value (the gross is the deal's true worth; TDS
--     is a withholding deposited to your PAN), but reported revenue + any incentive/
--     salary for those months will go UP by the TDS when it runs. Not a bug — expected.
--   • It sets is_final_payment = true so the now-fully-collected deal credits incentive
--     (rebuild_monthly_sales counts is_final approved payments). Without this the deal
--     would read fully-paid but never credit.
--
-- SAFE + TARGETED: only a SINGLE approved payment on the quote (a mis-entered full
-- payment is by definition the only one), where net < total and net + tds ≈ total.
-- Multi-milestone deals (net+tds ≠ full total per row) are intentionally NOT touched
-- — fix those in the UI (edit the payment → tap the TDS rate → Save). Idempotent
-- (after the fix amount_received = total → no longer matches).

-- ══════════════ PART 1 · DIAGNOSTIC — run this, review the rows ══════════════
SELECT q.quote_number, q.total_amount,
       p.amount_received       AS stored_net,
       p.tds_amount,
       (p.amount_received + p.tds_amount) AS becomes_gross,
       p.is_final_payment      AS final_now
FROM public.payments p
JOIN public.quotes q ON q.id = p.quote_id
WHERE q.segment = 'GOVERNMENT'
  AND q.status  = 'won'
  AND p.approval_status = 'approved'
  AND COALESCE(p.tds_amount, 0) > 0
  AND p.amount_received < q.total_amount
  AND abs((p.amount_received + p.tds_amount) - q.total_amount) < 2   -- net + tds = the full invoice
  AND NOT EXISTS (                                                    -- and it is the ONLY approved payment
        SELECT 1 FROM public.payments p2
        WHERE p2.quote_id = p.quote_id AND p2.id <> p.id AND p2.approval_status = 'approved')
ORDER BY q.quote_number;

-- ══════════════ PART 2 · THE FIX — uncomment ALL lines below, then run ══════════════
-- Each listed deal: amount_received → net + tds (closes to Fully Paid) + is_final = true.
--
-- UPDATE public.payments p
-- SET amount_received = p.amount_received + p.tds_amount,
--     is_final_payment = true
-- FROM public.quotes q
-- WHERE q.id = p.quote_id
--   AND q.segment = 'GOVERNMENT'
--   AND q.status  = 'won'
--   AND p.approval_status = 'approved'
--   AND COALESCE(p.tds_amount, 0) > 0
--   AND p.amount_received < q.total_amount
--   AND abs((p.amount_received + p.tds_amount) - q.total_amount) < 2
--   AND NOT EXISTS (
--         SELECT 1 FROM public.payments p2
--         WHERE p2.quote_id = p.quote_id AND p2.id <> p.id AND p2.approval_status = 'approved');
--
-- NOTIFY pgrst, 'reload schema';

-- ── VERIFY (after PART 2) — re-run PART 1's SELECT; expect 0 rows. ──
