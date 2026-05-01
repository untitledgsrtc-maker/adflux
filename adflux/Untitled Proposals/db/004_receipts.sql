-- =====================================================================
-- UNTITLED PROPOSALS — Migration 004: Receipts (UPDATED 2026-04-24)
--
-- CHANGES FROM ORIGINAL DRAFT:
--   - receipt_no format changed: UA/RV/2026-27/0001 (Receipt Voucher per Rule 50 CGST)
--     was UA/REC/AUTO/2026-27/0001 — separated by media; now consolidated as RV
--   - PDF will be labeled "Advance Receipt / Receipt Voucher" (NOT "Tax Invoice cum Receipt")
--   - Tax invoice handled separately by accounting team (out of scope)
--   - TDS defaults pulled from clients table (default_tds_income_percent / _gst_percent)
--   - Added hsn_sac_code field (default 998361)
--   - Added receipt_voucher_for_invoice_ref field (placeholder for accounting team's reference)
-- =====================================================================

-- =====================================================================
-- PROPOSAL RECEIPTS (advance receipts with TDS breakdown)
-- =====================================================================
create table if not exists public.proposal_receipts (
  id uuid primary key default uuid_generate_v4(),
  receipt_no text unique,                   -- UA/RV/2026-27/0001
  proposal_id uuid not null references public.proposals(id),

  receipt_date date not null default current_date,
  receipt_type text not null default 'ADVANCE' check (receipt_type in (
    'ADVANCE', 'PART_PAYMENT', 'FINAL_PAYMENT', 'FULL_PAYMENT'
  )),

  -- Amounts
  gross_amount numeric(14,2) not null check (gross_amount > 0),
  tds_income_percent numeric(5,2) not null default 2 check (tds_income_percent >= 0 and tds_income_percent <= 100),
  tds_income_amount numeric(14,2) not null default 0,
  tds_gst_percent numeric(5,2) not null default 2 check (tds_gst_percent >= 0 and tds_gst_percent <= 100),
  tds_gst_amount numeric(14,2) not null default 0,
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

  -- Tax classification (for accounting team's tax invoice cross-reference)
  hsn_sac_code text not null default '998361',
  gst_percent_applied numeric(5,2) not null default 18,  -- nominal GST rate (info only on receipt voucher)

  -- Denormalized snapshots (for historical PDFs)
  client_name_snapshot text not null,
  client_name_gu_snapshot text not null,
  client_gst_snapshot text,
  proposal_subject_snapshot text,
  proposal_ref_snapshot text,

  -- Generated receipt PDF (Drive link or storage path)
  pdf_url text,
  generated_at timestamptz,

  -- Optional: accounting team's tax invoice reference once issued externally
  external_tax_invoice_no text,
  external_tax_invoice_date date,

  -- Soft delete via reason (per design: receipt delete requires typed reason)
  deleted_at timestamptz,
  deleted_by uuid references public.users(id),
  delete_reason text,

  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_receipts_proposal on public.proposal_receipts(proposal_id) where deleted_at is null;
create index idx_receipts_date on public.proposal_receipts(receipt_date desc);
create index idx_receipts_no on public.proposal_receipts(receipt_no);
create index idx_receipts_active on public.proposal_receipts(proposal_id) where deleted_at is null;

create trigger trg_receipts_updated_at
  before update on public.proposal_receipts
  for each row execute function public.set_updated_at();

-- =====================================================================
-- TRIGGER: auto-compute TDS amounts from percentages on insert/update
-- =====================================================================
create or replace function public.compute_receipt_tds_amounts()
returns trigger
language plpgsql
as $$
begin
  new.tds_income_amount := round(new.gross_amount * new.tds_income_percent / 100, 2);
  new.tds_gst_amount := round(new.gross_amount * new.tds_gst_percent / 100, 2);
  return new;
end;
$$;

create trigger trg_receipts_compute_tds_ins
  before insert on public.proposal_receipts
  for each row execute function public.compute_receipt_tds_amounts();

create trigger trg_receipts_compute_tds_upd
  before update on public.proposal_receipts
  for each row execute function public.compute_receipt_tds_amounts();

-- =====================================================================
-- PAYMENT ROLLUP TRIGGER
-- When a receipt is added/edited/soft-deleted, update proposal totals.
-- Uses deleted_at IS NULL to ignore soft-deleted receipts in aggregates.
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
  v_current_proposal_status proposal_status;
begin
  if tg_op = 'DELETE' then
    v_proposal_id := old.proposal_id;
  else
    v_proposal_id := new.proposal_id;
  end if;

  select
    coalesce(sum(gross_amount), 0),
    coalesce(sum(total_tds_amount), 0),
    coalesce(sum(net_received_amount), 0)
  into v_gross, v_tds, v_net
  from public.proposal_receipts
  where proposal_id = v_proposal_id and deleted_at is null;

  select coalesce(po_amount, total_amount), status
  into v_expected, v_current_proposal_status
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
    -- Auto-transition proposal status (only forward, only from WON/PARTIAL_PAID)
    status = case
      when v_status in ('FULL', 'OVERPAID') and v_current_proposal_status in ('WON', 'PARTIAL_PAID') then 'PAID'::proposal_status
      when v_status = 'PARTIAL' and v_current_proposal_status = 'WON' then 'PARTIAL_PAID'::proposal_status
      else v_current_proposal_status
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
