-- ============================================================================
-- db/functions/duplicate_quote.sql - CANONICAL HOME (section 71)
-- ============================================================================
-- Phase 637 (20-11-2026, owner: "duplicate the quote option" on the Quotes list).
-- Copies a quote + its line items (quote_cities) into a NEW DRAFT owned by the caller:
--   fresh number (generate_quote_number trigger), status draft, today's proposal date;
--   NOT copied: payments, price approvals, follow-ups, costs (quote_costs = actual vendor
--   spend of the old campaign), locked PDF, won/lost dates, expiry.
-- SECURITY INVOKER: the caller's own RLS decides what they may read and insert.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.duplicate_quote(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_new uuid;
BEGIN
  INSERT INTO public.quotes (
    client_name, client_company, client_phone, client_email, client_gst, client_address, client_notes,
    duration_months, duration_mult, subtotal, gst_amount, total_amount, revenue_type, status,
    created_by, sales_person_name, campaign_start_date, campaign_end_date, gst_rate, segment, media_type,
    rate_type, signer_user_id, auto_total_quantity, gsrtc_campaign_months, recipient_block, proposal_date,
    attachments_checklist, signer_mobile_override, lead_id, proposal_language, govt_commission_percent, source)
  SELECT
    q.client_name, q.client_company, q.client_phone, q.client_email, q.client_gst, q.client_address, q.client_notes,
    q.duration_months, q.duration_mult, q.subtotal, q.gst_amount, q.total_amount, q.revenue_type, 'draft',
    auth.uid(), COALESCE((SELECT u.name FROM public.users u WHERE u.id = auth.uid()), q.sales_person_name),
    q.campaign_start_date, q.campaign_end_date, q.gst_rate, q.segment, q.media_type,
    q.rate_type, q.signer_user_id, q.auto_total_quantity, q.gsrtc_campaign_months, q.recipient_block,
    (now() AT TIME ZONE 'Asia/Kolkata')::date,
    q.attachments_checklist, q.signer_mobile_override, q.lead_id, q.proposal_language, q.govt_commission_percent, q.source
  FROM public.quotes q WHERE q.id = p_quote_id
  RETURNING id INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'Quote not found or not visible to you'; END IF;

  INSERT INTO public.quote_cities (
    quote_id, city_id, city_name, screens, grade, listed_rate, offered_rate, override_reason, campaign_total,
    duration_months, slot_seconds, slots_per_day, slots_override_reason, ref_kind, ref_id, description, qty,
    unit_rate, amount, daily_spots_override, days_override, spot_duration_sec_override, hsn_sac, cgst_pct,
    sgst_pct, cgst_amount, sgst_amount, rate_override, impressions_month, impressions_day, duration_days)
  SELECT
    v_new, city_id, city_name, screens, grade, listed_rate, offered_rate, override_reason, campaign_total,
    duration_months, slot_seconds, slots_per_day, slots_override_reason, ref_kind, ref_id, description, qty,
    unit_rate, amount, daily_spots_override, days_override, spot_duration_sec_override, hsn_sac, cgst_pct,
    sgst_pct, cgst_amount, sgst_amount, rate_override, impressions_month, impressions_day, duration_days
  FROM public.quote_cities WHERE quote_id = p_quote_id;

  RETURN v_new;
END $function$;

REVOKE ALL ON FUNCTION public.duplicate_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_quote(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- VERIFY: SELECT to_regprocedure('public.duplicate_quote(uuid)') IS NOT NULL;  -- t
