-- =====================================================================
-- UNTITLED PROPOSALS — Migration 004: Receipts / Payments
-- =====================================================================

-- =====================================================================
-- PROPOSAL RECEIPTS (advance receipts with TDS breakdown)
-- =====================================================================
create table if not exists public.proposal_receipts (
  id uuid primary key default uuid_generate_v4(),
  receipt_no text unique,                   -- UA/REC/GSRTC/2026-27/0001
  proposal_id uuid not null references public.proposals(id),

  receipt_date date not null default current_date,
  receipt_type text not null check (receipt_type in (
    'ADVANCE', 'PART_PAYMENT', 'FINAL_PAYMENT', 'FULL_PAYMENT'
  )),

  -- Amounts
  gross_amount numeric(14,2) not null,
  tds_income_percent numeric(5,2) not null default 2,
  tds_income_amount numeric(14,2) not null,
  tds_gst_percent numeric(5,2) not null default 2,
  tds_gst_amount numeric(14,2) not null,
  total_tds_amount numeric(14,2) generated always as
    (tds_income_amount + tds_gst_amount) stored,
  net_received_amount numeric(14,2) generated always as
    (gross_amount - tds_income_amount - tds_gst_amount) stored,

  -- Payment details
  payment_mode text not null check (payment_mode in (
    'CASH', 'CHEQUE', 'DRAFT', 'NEFT', 'RTGS', 'UPI'
  )),
  cheque_or_ref_no text,
  cheque_date date,
  bank_name text,
  subject_to_realisation boolean not null default true,

  -- Denormalized snapshots (for historical PDFs)
  client_name_snapshot text not null,
  client_name_gu_snapshot text not null,
  proposal_subject_snapshot text,
  proposal_ref_snapshot text,

  -- Generated receipt PDF
  pdf_url text,
  generated_at timestamptz,

  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_receipts_proposal on public.proposal_receipts(proposal_id);
create index idx_receipts_date on public.proposal_receipts(receipt_date desc);
create index idx_receipts_no on public.proposal_receipts(receipt_no);

create trigger trg_receipts_updated_at
  before update on public.proposal_receipts
  for each row execute function public.set_updated_at();

-- =====================================================================
-- PAYMENT ROLLUP TRIGGER
-- When a receipt is added/edited/deleted, update proposal totals
-- =====================================================================
create or replace function public.recompute_proposal_payment_rollup()
returns trigger
language plpgsql
as $$
declare
  v_proposal_id uuid;
  v_gross numeric(14,2);
  v_tds numeric(14,2);
  v_net numeric(14,2);
  v_expected numeric(14,2);
  v_outstanding numeric(14,2);
  v_status text;
begin
  -- Determine which proposal to update
  if tg_op = 'DELETE' then
    v_proposal_id := old.proposal_id;
  else
    v_proposal_id := new.proposal_id;
  end if;

  -- Aggregate across all receipts for this proposal
  select
    coalesce(sum(gross_amount), 0),
    coalesce(sum(total_tds_amount), 0),
    coalesce(sum(net_received_amount), 0)
  into v_gross, v_tds, v_net
  from public.proposal_receipts
  where proposal_id = v_proposal_id;

  -- Get expected amount (prefer PO amount over proposal total)
  select coalesce(po_amount, total_amount)
  into v_expected
  from public.proposals
  where id = v_proposal_id;

  v_outstanding := v_expected - v_gross;

  v_status := case
    when v_gross = 0 then 'NOT_STARTED'
    when v_gross >= v_expected then
      case when v_gross > v_expected then 'OVERPAID' else 'FULL' end
    else 'PARTIAL'
  end;

  update public.proposals
  set
    total_expected = v_expected,
    total_gross_received = v_gross,
    total_tds_deducted = v_tds,
    total_net_received = v_net,
    outstanding_balance = v_outstanding,
    payment_status = v_status,
    -- Auto-transition status if fully paid
    status = case
      when v_status = 'FULL' and status in ('WON', 'PARTIAL_PAID') then 'PAID'
      when v_status = 'PARTIAL' and status = 'WON' then 'PARTIAL_PAID'
      else status
    end
  where id = v_proposal_id;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

create trigger trg_receipt_rollup_ins
  after insert on public.proposal_receipts
  for each row execute function public.recompute_proposal_payment_rollup();

create trigger trg_receipt_rollup_upd
  after update on public.proposal_receipts
  for each row execute function public.recompute_proposal_payment_rollup();

create trigger trg_receipt_rollup_del
  after delete on public.proposal_receipts
  for each row execute function public.recompute_proposal_payment_rollup();
