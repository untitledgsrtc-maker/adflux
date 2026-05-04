-- =====================================================================
-- ADFLUX → UNTITLED OS  •  PHASE 11b
-- Quote / payment immutability rails
-- =====================================================================
--
-- WHY:
--   Without these guards a sales rep can:
--     • Delete a won quote with approved payments → revenue vanishes
--       from the audit trail, commission calculation breaks
--     • Flip a sent proposal back to draft, edit the line items, send
--       again → original locked PDF stays in storage but reflects the
--       OLD numbers; the new render shows DIFFERENT numbers; client
--       and accounting see two different "official" quotes.
--     • Backdate a payment to a previous month so commission credits
--       to a higher-incentive payroll period.
--
-- DESIGN:
--   1. quotes_no_delete_after_draft trigger — only DRAFT quotes can be
--      deleted; admin can override via direct SQL but the app path is
--      blocked.
--   2. quotes_status_one_way trigger — once a quote leaves draft, it
--      cannot return. Allowed transitions:
--         draft → sent | lost
--         sent  → negotiating | won | lost
--         negotiating → won | lost
--         won   → (terminal)
--         lost  → (terminal — admin can re-open via SQL if needed)
--   3. payments_no_backdate trigger — payment_date must be ≤ today();
--      and ≥ quote.created_at to catch nonsense future-dated rows too.
--
-- IDEMPOTENT.
-- =====================================================================


-- 1) Block delete on non-draft quotes ------------------------------
CREATE OR REPLACE FUNCTION public.quotes_no_delete_after_draft()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'Quote % is in status %. Only DRAFT quotes can be deleted. '
      'To remove from active pipeline, mark Lost instead.',
      OLD.quote_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS quotes_block_delete ON public.quotes;
CREATE TRIGGER quotes_block_delete
  BEFORE DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_no_delete_after_draft();


-- 2) One-way status transitions ------------------------------------
--    Forward-only progression. Reverting requires a service-role SQL
--    edit (not via the app), which gives admin a manual override
--    without exposing it to the rep UI.
CREATE OR REPLACE FUNCTION public.quotes_status_one_way()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft'        AND NEW.status IN ('sent', 'lost')                  THEN ok := true; END IF;
  IF OLD.status = 'sent'         AND NEW.status IN ('negotiating', 'won', 'lost')    THEN ok := true; END IF;
  IF OLD.status = 'negotiating'  AND NEW.status IN ('won', 'lost')                   THEN ok := true; END IF;

  IF NOT ok THEN
    RAISE EXCEPTION
      'Status transition % → % is not allowed for quote %. '
      'Quotes progress one-way: draft → sent → negotiating/won/lost. '
      'To reopen, ask admin to reset via SQL.',
      OLD.status, NEW.status, OLD.quote_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS quotes_status_oneway ON public.quotes;
CREATE TRIGGER quotes_status_oneway
  BEFORE UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_status_one_way();


-- 3) Block backdated / future-dated payments -----------------------
CREATE OR REPLACE FUNCTION public.payments_no_backdate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_date IS NULL THEN
    RAISE EXCEPTION 'payment_date is required.'
      USING ERRCODE = 'not_null_violation';
  END IF;

  IF NEW.payment_date > current_date THEN
    RAISE EXCEPTION
      'payment_date % cannot be in the future (today is %).',
      NEW.payment_date, current_date
      USING ERRCODE = 'check_violation';
  END IF;

  -- Tolerance: allow up to 7 days before quote.created_at (e.g.
  -- advance receipt before quote was formally created in the system).
  -- Beyond that, the date is almost certainly an entry error.
  IF EXISTS (
    SELECT 1 FROM public.quotes q
     WHERE q.id = NEW.quote_id
       AND NEW.payment_date < q.created_at::date - INTERVAL '7 days'
  ) THEN
    RAISE EXCEPTION
      'payment_date % is more than 7 days before the quote was created. '
      'Backdating to a previous month is not allowed — fix the date or '
      'ask admin to override via SQL.',
      NEW.payment_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_no_backdate ON public.payments;
CREATE TRIGGER payments_no_backdate
  BEFORE INSERT OR UPDATE OF payment_date ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_no_backdate();


-- =====================================================================
-- VERIFY:
--
--   -- This should fail:
--   DELETE FROM public.quotes WHERE status = 'won' LIMIT 1;
--
--   -- This should fail:
--   UPDATE public.quotes SET status = 'draft' WHERE status = 'sent' LIMIT 1;
--
--   -- This should fail:
--   INSERT INTO public.payments (quote_id, payment_date, amount_received, approval_status)
--   VALUES ((SELECT id FROM quotes LIMIT 1), now() + INTERVAL '5 days', 1000, 'pending');
--
-- =====================================================================
