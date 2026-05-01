-- =====================================================================
-- UNTITLED PROPOSALS — Migration 005: P&L + Audit (UPDATED 2026-04-24)
--
-- CHANGES FROM ORIGINAL DRAFT:
--   - dept_expense_percent / dept_expense_amount  →  partner_commission_*
--     (legitimate vendor with paper trail: invoices + bank transfers + TDS 194C)
--   - Added monthly_admin_expenses table (Brijesh-only writes; visible to co_owner)
--   - Consolidated P&L math: sum business profits − total admin expenses
--     (NO revenue-ratio allocation — owner explicitly chose simpler model)
--   - pnl_access_log: immutable audit trail of every P&L view (TOTP-gated)
--   - audit_log: append-only history for receipts, P&L edits, status overrides
--   - All sensitive writes go through SECURITY DEFINER functions so RLS
--     can stay tight without triggers needing elevated rights.
-- =====================================================================

-- =====================================================================
-- PROPOSAL P&L (one row per WON proposal; auto-created by trigger)
-- =====================================================================
create table if not exists public.proposal_pnl (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null unique references public.proposals(id) on delete cascade,

  -- Revenue side (mirrors the proposal totals, snapshotted at PAID time)
  gross_revenue numeric(14,2) not null default 0,            -- sum of receipts.gross_amount
  total_tds_deducted numeric(14,2) not null default 0,
  net_revenue numeric(14,2) not null default 0,              -- gross - tds (cash in hand)

  -- Direct cost: media owner payout (GSRTC slot rent OR auto-rickshaw owner payout)
  media_owner_payout numeric(14,2) not null default 0,
  media_owner_notes text,

  -- Direct cost: production (printing, mounting, installation)
  production_cost numeric(14,2) not null default 0,
  production_notes text,

  -- Partner commission (legitimate paid-out commission to a referring partner/sales channel)
  -- Stored both as % (for quick edits) and as resolved amount (for ledger).
  -- This is NOT a tax dodge — actual invoice + bank transfer + 194C TDS apply.
  partner_commission_percent numeric(5,2) not null default 0
    check (partner_commission_percent >= 0 and partner_commission_percent <= 100),
  partner_commission_amount numeric(14,2) not null default 0,
  partner_name text,                       -- who received the commission
  partner_invoice_ref text,                -- their invoice number
  partner_payment_ref text,                -- our bank UTR / cheque no
  partner_tds_deducted numeric(14,2) not null default 0,

  -- Other direct costs (catch-all for one-off project costs)
  other_direct_cost numeric(14,2) not null default 0,
  other_direct_cost_notes text,

  -- Computed: gross profit on this proposal alone (BEFORE shared admin expenses)
  -- = net_revenue - media_owner_payout - production_cost
  --   - partner_commission_amount - other_direct_cost
  business_profit numeric(14,2) generated always as (
    net_revenue
    - media_owner_payout
    - production_cost
    - partner_commission_amount
    - other_direct_cost
  ) stored,

  -- Workflow
  is_finalized boolean not null default false,           -- locks the row from edits
  finalized_at timestamptz,
  finalized_by uuid references public.users(id),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

create index idx_pnl_proposal on public.proposal_pnl(proposal_id);
create index idx_pnl_finalized on public.proposal_pnl(is_finalized);

create trigger trg_pnl_updated_at
  before update on public.proposal_pnl
  for each row execute function public.set_updated_at();

-- =====================================================================
-- TRIGGER: auto-resolve partner_commission_amount from %
-- (always recompute on insert/update so % and amount stay in sync)
-- =====================================================================
create or replace function public.resolve_partner_commission()
returns trigger
language plpgsql
as $$
begin
  -- If user edits %, derive amount from net_revenue
  -- (commission is on net cash received, not gross — owner's call)
  new.partner_commission_amount :=
    round(new.net_revenue * new.partner_commission_percent / 100, 2);
  return new;
end;
$$;

create trigger trg_pnl_resolve_commission_ins
  before insert on public.proposal_pnl
  for each row execute function public.resolve_partner_commission();

create trigger trg_pnl_resolve_commission_upd
  before update on public.proposal_pnl
  for each row execute function public.resolve_partner_commission();

-- =====================================================================
-- TRIGGER: auto-create P&L row when proposal hits WON
-- (idempotent — does nothing if a row already exists)
-- =====================================================================
create or replace function public.auto_create_pnl_on_won()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'WON'::proposal_status
     and (old.status is null or old.status != 'WON'::proposal_status)
  then
    insert into public.proposal_pnl (proposal_id, gross_revenue, total_tds_deducted, net_revenue)
    values (
      new.id,
      coalesce(new.total_gross_received, 0),
      coalesce(new.total_tds_deducted, 0),
      coalesce(new.total_net_received, 0)
    )
    on conflict (proposal_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_proposals_auto_pnl
  after update of status on public.proposals
  for each row execute function public.auto_create_pnl_on_won();

-- =====================================================================
-- TRIGGER: keep P&L revenue snapshot fresh whenever proposal totals change
-- (triggered after the receipt rollup recomputes totals on the proposal)
-- Skip if P&L is finalized.
-- =====================================================================
create or replace function public.sync_pnl_revenue_from_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.proposal_pnl
  set
    gross_revenue = coalesce(new.total_gross_received, 0),
    total_tds_deducted = coalesce(new.total_tds_deducted, 0),
    net_revenue = coalesce(new.total_net_received, 0)
  where proposal_id = new.id and is_finalized = false;
  return new;
end;
$$;

create trigger trg_proposals_sync_pnl
  after update of total_gross_received, total_tds_deducted, total_net_received
  on public.proposals
  for each row execute function public.sync_pnl_revenue_from_proposal();

-- =====================================================================
-- MONTHLY ADMIN EXPENSES (overheads — not tied to a specific proposal)
-- Brijesh-only writes; co_owner can read.
-- expense_type is a controlled dropdown (REQUIRED) so we can analyze
-- where the money goes by category over time.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_expense_type') then
    create type public.admin_expense_type as enum (
      'salary',
      'rent',
      'electricity',
      'internet',
      'phone',
      'vehicle_fuel',
      'accounting_ca_fees',
      'office_supplies',
      'travel',
      'insurance',
      'software_subscriptions',
      'bank_charges',
      'marketing',
      'other'
    );
  end if;
end$$;

create table if not exists public.monthly_admin_expenses (
  id uuid primary key default uuid_generate_v4(),
  expense_month date not null,                            -- always store first-of-month
  expense_type public.admin_expense_type not null,
  amount numeric(14,2) not null check (amount > 0),
  description text,                                       -- optional free text
  paid_date date,                                         -- optional
  payment_ref text,                                       -- optional UTR / cheque no
  vendor_name text,                                       -- optional
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Normalize expense_month to first-of-month so aggregation by month is clean.
create or replace function public.normalize_expense_month()
returns trigger
language plpgsql
as $$
begin
  new.expense_month := date_trunc('month', new.expense_month)::date;
  return new;
end;
$$;

create trigger trg_admin_expenses_normalize_ins
  before insert on public.monthly_admin_expenses
  for each row execute function public.normalize_expense_month();

create trigger trg_admin_expenses_normalize_upd
  before update on public.monthly_admin_expenses
  for each row execute function public.normalize_expense_month();

create trigger trg_admin_expenses_updated_at
  before update on public.monthly_admin_expenses
  for each row execute function public.set_updated_at();

create index idx_admin_exp_month on public.monthly_admin_expenses(expense_month desc);
create index idx_admin_exp_type on public.monthly_admin_expenses(expense_type);
create index idx_admin_exp_month_type on public.monthly_admin_expenses(expense_month, expense_type);

-- =====================================================================
-- VIEW: consolidated P&L summary per FY
-- Math (per owner spec):
--   total_business_profit = SUM(proposal_pnl.business_profit)  for the FY
--   total_admin_expenses  = SUM(monthly_admin_expenses.amount) for the FY
--   final_profit          = total_business_profit − total_admin_expenses
-- No revenue-ratio split. One number for the whole agency.
-- =====================================================================
create or replace view public.v_pnl_summary_fy as
with fy_proposals as (
  select
    public.fy_for_date(p.created_at::date) as fy_label,
    pnl.business_profit,
    pnl.gross_revenue,
    pnl.net_revenue,
    pnl.media_owner_payout,
    pnl.production_cost,
    pnl.partner_commission_amount,
    pnl.other_direct_cost
  from public.proposal_pnl pnl
  join public.proposals p on p.id = pnl.proposal_id
),
fy_business as (
  select
    fy_label,
    count(*) as won_proposals_count,
    sum(gross_revenue) as gross_revenue,
    sum(net_revenue) as net_revenue,
    sum(media_owner_payout) as media_owner_payout_total,
    sum(production_cost) as production_cost_total,
    sum(partner_commission_amount) as partner_commission_total,
    sum(other_direct_cost) as other_direct_cost_total,
    sum(business_profit) as total_business_profit
  from fy_proposals
  group by fy_label
),
fy_admin as (
  select
    public.fy_for_date(expense_month) as fy_label,
    sum(amount) as total_admin_expenses
  from public.monthly_admin_expenses
  group by public.fy_for_date(expense_month)
)
select
  coalesce(b.fy_label, a.fy_label) as fy_label,
  coalesce(b.won_proposals_count, 0) as won_proposals_count,
  coalesce(b.gross_revenue, 0) as gross_revenue,
  coalesce(b.net_revenue, 0) as net_revenue,
  coalesce(b.media_owner_payout_total, 0) as media_owner_payout_total,
  coalesce(b.production_cost_total, 0) as production_cost_total,
  coalesce(b.partner_commission_total, 0) as partner_commission_total,
  coalesce(b.other_direct_cost_total, 0) as other_direct_cost_total,
  coalesce(b.total_business_profit, 0) as total_business_profit,
  coalesce(a.total_admin_expenses, 0) as total_admin_expenses,
  coalesce(b.total_business_profit, 0) - coalesce(a.total_admin_expenses, 0) as final_profit
from fy_business b
full outer join fy_admin a on a.fy_label = b.fy_label
order by fy_label desc;

-- =====================================================================
-- VIEW: per-month admin expense rollup by category (for the dashboard)
-- =====================================================================
create or replace view public.v_admin_expenses_monthly as
select
  expense_month,
  expense_type,
  count(*) as line_count,
  sum(amount) as total_amount
from public.monthly_admin_expenses
group by expense_month, expense_type
order by expense_month desc, expense_type;

-- =====================================================================
-- P&L ACCESS LOG (immutable — every view of P&L data is recorded)
-- Inserted by the SECURITY DEFINER fetch RPC after a successful TOTP step-up.
-- No update / delete policies; rows are append-only by design.
-- =====================================================================
create table if not exists public.pnl_access_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id),
  user_email text not null,                  -- snapshot in case user is later renamed
  user_role text not null,                   -- snapshot of role at access time
  access_type text not null check (access_type in (
    'VIEW_SUMMARY', 'VIEW_PROPOSAL_PNL', 'VIEW_ADMIN_EXPENSES',
    'EXPORT_PDF', 'EXPORT_CSV',
    'EDIT_PROPOSAL_PNL', 'EDIT_ADMIN_EXPENSE',
    'FINALIZE_PNL'
  )),
  proposal_id uuid references public.proposals(id),
  admin_expense_id uuid references public.monthly_admin_expenses(id),
  fy_label text,                             -- e.g. '2026-27'
  ip_address inet,
  user_agent text,
  totp_verified_at timestamptz,              -- when the user passed step-up MFA in this session
  details jsonb,                             -- arbitrary context (filters, totals at that moment)
  accessed_at timestamptz not null default now()
);

create index idx_pnl_log_user on public.pnl_access_log(user_id, accessed_at desc);
create index idx_pnl_log_type on public.pnl_access_log(access_type, accessed_at desc);
create index idx_pnl_log_proposal on public.pnl_access_log(proposal_id) where proposal_id is not null;
create index idx_pnl_log_recent on public.pnl_access_log(accessed_at desc);

-- =====================================================================
-- AUDIT LOG (immutable — receipts, P&L edits, status overrides, user changes)
-- =====================================================================
create table if not exists public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  entity_type text not null check (entity_type in (
    'PROPOSAL', 'RECEIPT', 'PNL', 'ADMIN_EXPENSE',
    'CLIENT', 'USER', 'GSRTC_STATION', 'AUTO_DISTRICT', 'AUTO_RATE'
  )),
  entity_id uuid not null,
  action text not null check (action in (
    'CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'STATUS_CHANGE',
    'PDF_GENERATED', 'PDF_DOWNLOADED', 'EMAIL_SENT',
    'FINALIZE', 'UNFINALIZE', 'ROLE_CHANGE', 'MFA_RESET'
  )),
  performed_by uuid references public.users(id),
  performed_by_email text,
  performed_by_role text,
  before_data jsonb,
  after_data jsonb,
  reason text,                               -- required for SOFT_DELETE on receipts
  ip_address inet,
  user_agent text,
  performed_at timestamptz not null default now()
);

create index idx_audit_entity on public.audit_log(entity_type, entity_id, performed_at desc);
create index idx_audit_user on public.audit_log(performed_by, performed_at desc);
create index idx_audit_action on public.audit_log(action, performed_at desc);
create index idx_audit_recent on public.audit_log(performed_at desc);

-- =====================================================================
-- TRIGGER: auto-write audit_log entry when receipt is soft-deleted
-- (delete_reason is captured because the UI requires it before submit)
-- =====================================================================
create or replace function public.audit_receipt_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text;
begin
  -- Detect transition into soft-deleted
  if old.deleted_at is null and new.deleted_at is not null then
    select email, role into v_email, v_role
    from public.users where id = new.deleted_by;

    insert into public.audit_log (
      entity_type, entity_id, action,
      performed_by, performed_by_email, performed_by_role,
      before_data, after_data, reason
    )
    values (
      'RECEIPT', new.id, 'SOFT_DELETE',
      new.deleted_by, v_email, v_role,
      to_jsonb(old), to_jsonb(new), new.delete_reason
    );
  end if;
  return new;
end;
$$;

create trigger trg_receipt_audit_soft_delete
  after update on public.proposal_receipts
  for each row execute function public.audit_receipt_soft_delete();

-- =====================================================================
-- TRIGGER: auto-write audit_log entry on proposal status change
-- =====================================================================
create or replace function public.audit_proposal_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text;
  v_user_id uuid;
begin
  if old.status is distinct from new.status then
    v_user_id := auth.uid();
    if v_user_id is not null then
      select email, role into v_email, v_role
      from public.users where id = v_user_id;
    end if;

    insert into public.audit_log (
      entity_type, entity_id, action,
      performed_by, performed_by_email, performed_by_role,
      before_data, after_data
    )
    values (
      'PROPOSAL', new.id, 'STATUS_CHANGE',
      v_user_id, v_email, v_role,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger trg_proposal_audit_status
  after update of status on public.proposals
  for each row execute function public.audit_proposal_status_change();

-- =====================================================================
-- HELPER: log a P&L access event (called from the API after TOTP step-up)
-- =====================================================================
create or replace function public.log_pnl_access(
  p_access_type text,
  p_proposal_id uuid default null,
  p_admin_expense_id uuid default null,
  p_fy_label text default null,
  p_totp_verified_at timestamptz default null,
  p_ip inet default null,
  p_user_agent text default null,
  p_details jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_email text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'log_pnl_access: not authenticated';
  end if;

  select email, role into v_email, v_role
  from public.users where id = auth.uid();

  if v_role not in ('owner', 'co_owner') then
    raise exception 'log_pnl_access: caller is not owner or co_owner';
  end if;

  insert into public.pnl_access_log (
    user_id, user_email, user_role, access_type,
    proposal_id, admin_expense_id, fy_label,
    ip_address, user_agent, totp_verified_at, details
  )
  values (
    auth.uid(), v_email, v_role, p_access_type,
    p_proposal_id, p_admin_expense_id, p_fy_label,
    p_ip, p_user_agent, p_totp_verified_at, p_details
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- =====================================================================
-- HELPER: soft-delete a receipt with mandatory reason
-- (the only sanctioned way to remove a receipt; UI calls this RPC)
-- =====================================================================
create or replace function public.soft_delete_receipt(
  p_receipt_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_receipt: not authenticated';
  end if;

  if not public.is_owner() then
    raise exception 'soft_delete_receipt: only the owner may delete receipts';
  end if;

  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'soft_delete_receipt: a reason of at least 5 characters is required';
  end if;

  update public.proposal_receipts
  set
    deleted_at = now(),
    deleted_by = auth.uid(),
    delete_reason = p_reason
  where id = p_receipt_id and deleted_at is null;

  if not found then
    raise exception 'soft_delete_receipt: receipt not found or already deleted';
  end if;
end;
$$;
