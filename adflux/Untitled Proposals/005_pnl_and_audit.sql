-- =====================================================================
-- UNTITLED PROPOSALS — Migration 005: P&L Module (Owner-Only)
-- No encryption (user decision); access controlled via RLS + 2FA at app layer
-- =====================================================================

-- =====================================================================
-- ORDER P&L (one row per WON proposal)
-- =====================================================================
create table if not exists public.order_pnl (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null unique references public.proposals(id),

  -- Expense breakdown
  dept_expense_percent numeric(5,2),        -- 30 / 40 / 50
  dept_expense_amount numeric(14,2),        -- auto-computed from % × order
  other_party_name text,
  other_party_amount numeric(14,2) default 0,
  vendor_name text,
  vendor_amount numeric(14,2) default 0,
  owner_additional_amount numeric(14,2) default 0,
  owner_additional_notes text,

  -- Computed (stored, not generated — because tds comes from receipts)
  computed_profit numeric(14,2),
  computed_margin_percent numeric(5,2),

  -- P&L status (separate from proposal.payment_status)
  pnl_status text not null default 'NEEDS_ENTRY'
    check (pnl_status in (
      'NEEDS_ENTRY', 'IN_PROGRESS', 'PAID', 'PARTIAL', 'OUTSTANDING', 'DISPUTED'
    )),
  credit_days int,                          -- auto-computed from invoice→payment dates

  last_edited_by uuid references public.users(id),
  last_edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_pnl_proposal on public.order_pnl(proposal_id);
create index idx_pnl_status on public.order_pnl(pnl_status);

-- Auto-create empty P&L row when proposal moves to WON
create or replace function public.auto_create_pnl_on_won()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'WON' and (old.status is null or old.status <> 'WON') then
    insert into public.order_pnl (proposal_id, pnl_status)
    values (new.id, 'NEEDS_ENTRY')
    on conflict (proposal_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_auto_create_pnl
  after insert or update of status on public.proposals
  for each row execute function public.auto_create_pnl_on_won();

-- Recompute profit whenever P&L row is edited
create or replace function public.recompute_pnl_profit()
returns trigger
language plpgsql
as $$
declare
  v_order_amount numeric(14,2);
  v_tds numeric(14,2);
  v_total_cost numeric(14,2);
begin
  -- Get order amount + TDS from linked proposal
  select
    coalesce(p.po_amount, p.total_amount),
    p.total_tds_deducted
  into v_order_amount, v_tds
  from public.proposals p
  where p.id = new.proposal_id;

  -- Auto-compute dept_expense_amount from % if % is set
  if new.dept_expense_percent is not null and v_order_amount is not null then
    new.dept_expense_amount := round(v_order_amount * new.dept_expense_percent / 100, 2);
  end if;

  -- Total cost = dept + other + vendor + owner_additional
  v_total_cost := coalesce(new.dept_expense_amount, 0)
                + coalesce(new.other_party_amount, 0)
                + coalesce(new.vendor_amount, 0)
                + coalesce(new.owner_additional_amount, 0);

  -- Profit = order_amount - total_cost - TDS
  new.computed_profit := coalesce(v_order_amount, 0) - v_total_cost - coalesce(v_tds, 0);

  if v_order_amount > 0 then
    new.computed_margin_percent := round(new.computed_profit / v_order_amount * 100, 2);
  end if;

  new.last_edited_at := now();
  return new;
end;
$$;

create trigger trg_pnl_recompute
  before update on public.order_pnl
  for each row execute function public.recompute_pnl_profit();

create trigger trg_pnl_recompute_insert
  before insert on public.order_pnl
  for each row execute function public.recompute_pnl_profit();

-- =====================================================================
-- P&L ACCESS LOG (never deletable — even by owner)
-- =====================================================================
create table if not exists public.pnl_access_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id),
  action text not null check (action in (
    'UNLOCK', 'VIEW_DASHBOARD', 'VIEW_ROW', 'EDIT', 'EXPORT', 'LOCK'
  )),
  proposal_id uuid references public.proposals(id),  -- nullable (dashboard has no specific proposal)
  ip_address text,
  user_agent text,
  metadata jsonb default '{}'::jsonb,
  accessed_at timestamptz not null default now()
);

create index idx_pnl_log_user on public.pnl_access_log(user_id, accessed_at desc);
create index idx_pnl_log_action on public.pnl_access_log(action, accessed_at desc);
create index idx_pnl_log_proposal on public.pnl_access_log(proposal_id)
  where proposal_id is not null;

-- =====================================================================
-- AUDIT LOG (for the rest of the system)
-- =====================================================================
create table if not exists public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_user on public.audit_log(user_id, created_at desc);
create index idx_audit_entity on public.audit_log(entity_type, entity_id);
