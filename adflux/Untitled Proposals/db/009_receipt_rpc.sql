-- =====================================================================
-- UNTITLED PROPOSALS — Migration 009: Receipt save RPC
--
-- Atomic receipt creation:
--   1. Validates the proposal exists and is WON / PARTIAL_PAID
--      (you can't add a receipt to a DRAFT or CANCELLED proposal)
--   2. Issues the receipt_no via next_ref_number(...) in the same txn
--   3. Snapshots client + proposal subject onto the receipt row
--   4. Inserts the receipt; the existing TDS-compute + payment-rollup
--      triggers fire as normal
--
-- Returns the inserted receipt as JSON so the caller can confirm.
-- =====================================================================

create or replace function public.create_receipt(
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_proposal record;
  v_fy text;
  v_seq int;
  v_receipt_no text;
  v_receipt_id uuid;
  v_inserted jsonb;
begin
  if v_uid is null then
    raise exception 'create_receipt: not authenticated';
  end if;
  select role into v_role from public.users where id = v_uid;
  if v_role not in ('owner', 'co_owner', 'admin') then
    raise exception 'create_receipt: forbidden (role=%)', v_role;
  end if;

  -- Required scalars
  if (p_receipt->>'proposal_id') is null then
    raise exception 'proposal_id required';
  end if;
  if (p_receipt->>'gross_amount') is null then
    raise exception 'gross_amount required';
  end if;
  if (p_receipt->>'payment_mode') is null then
    raise exception 'payment_mode required';
  end if;

  -- Lookup parent proposal for snapshots + state guard
  select id, ref_no, status,
         client_name_snapshot, client_name_gu_snapshot, client_gst_snapshot,
         subject_en
  into v_proposal
  from public.proposals
  where id = (p_receipt->>'proposal_id')::uuid;
  if v_proposal.id is null then
    raise exception 'create_receipt: proposal not found';
  end if;
  if v_proposal.status not in ('WON', 'PARTIAL_PAID', 'PAID') then
    raise exception 'create_receipt: proposal status is % (only WON / PARTIAL_PAID / PAID accept receipts)', v_proposal.status;
  end if;

  -- Issue receipt_no
  v_fy := public.fy_for_date(coalesce((p_receipt->>'receipt_date')::date, current_date));
  v_seq := public.next_ref_number('RECEIPT', 'RV', v_fy);
  v_receipt_no := format('UA/RV/%s/%s', v_fy, lpad(v_seq::text, 4, '0'));

  insert into public.proposal_receipts (
    receipt_no, proposal_id, receipt_date, receipt_type,
    gross_amount, tds_income_percent, tds_gst_percent,
    payment_mode, cheque_or_ref_no, cheque_date, bank_name,
    subject_to_realisation,
    hsn_sac_code, gst_percent_applied,
    client_name_snapshot, client_name_gu_snapshot, client_gst_snapshot,
    proposal_subject_snapshot, proposal_ref_snapshot,
    notes, created_by
  ) values (
    v_receipt_no,
    v_proposal.id,
    coalesce((p_receipt->>'receipt_date')::date, current_date),
    coalesce(p_receipt->>'receipt_type', 'ADVANCE'),
    (p_receipt->>'gross_amount')::numeric,
    coalesce((p_receipt->>'tds_income_percent')::numeric, 2),
    coalesce((p_receipt->>'tds_gst_percent')::numeric, 2),
    p_receipt->>'payment_mode',
    nullif(p_receipt->>'cheque_or_ref_no', ''),
    nullif(p_receipt->>'cheque_date', '')::date,
    nullif(p_receipt->>'bank_name', ''),
    coalesce((p_receipt->>'subject_to_realisation')::boolean, true),
    coalesce(p_receipt->>'hsn_sac_code', '998361'),
    coalesce((p_receipt->>'gst_percent_applied')::numeric, 18),
    v_proposal.client_name_snapshot,
    v_proposal.client_name_gu_snapshot,
    v_proposal.client_gst_snapshot,
    v_proposal.subject_en,
    v_proposal.ref_no,
    nullif(p_receipt->>'notes', ''),
    v_uid
  )
  returning id into v_receipt_id;

  select to_jsonb(r) into v_inserted from public.proposal_receipts r where r.id = v_receipt_id;
  return v_inserted;
end;
$$;

grant execute on function public.create_receipt(jsonb) to authenticated;
