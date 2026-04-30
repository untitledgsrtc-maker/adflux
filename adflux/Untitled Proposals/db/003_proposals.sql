-- =====================================================================
-- UNTITLED PROPOSALS — Migration 003: Proposals Core (UPDATED 2026-04-24)
--
-- CHANGES FROM ORIGINAL DRAFT:
--   - proposal_status enum: REMOVED 'APPROVED', 'LOST', 'CLOSED'
--   - proposal_status enum: ADDED 'CANCELLED', 'REJECTED' (kept 'EXPIRED')
--   - Added submission_mode_enum (PHYSICAL / EMAIL / COURIER)
--   - Added submission_mode column on proposals
--   - Added office_copy_url column on proposals (Google Drive link)
--   - Added expire_after_days column (default 120, per-proposal override)
--   - Added cancelled_at, cancelled_reason, rejected_at, rejected_reason columns
--   - Added expired_at column
--   - Added enforce_office_copy_on_sent() trigger
--   - HSN/SAC 998361 stored on proposals for receipt/invoice reference
--   - proposal_receipts receipt_no format changed to UA/RV/... (see 004)
-- =====================================================================

-- =====================================================================
-- PROPOSAL STATUS ENUM (final flow)
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_status') then
    create type public.proposal_status as enum (
      'DRAFT', 'SENT', 'WON',
      'PARTIAL_PAID', 'PAID',
      'CANCELLED', 'REJECTED', 'EXPIRED'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_language') then
    create type public.proposal_language as enum ('gu', 'en');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'submission_mode') then
    create type public.submission_mode as enum ('PHYSICAL', 'EMAIL', 'COURIER');
  end if;
end$$;

-- =====================================================================
-- REF NUMBER COUNTERS (atomic per series per FY)
-- series values: PROPOSAL, RECEIPT
-- media_code values: AUTO, GSRTC, RV (for receipt vouchers — shared across media)
-- =====================================================================
create table if not exists public.ref_no_counters (
  id uuid primary key default uuid_generate_v4(),
  series text not null,
  media_code text not null,
  financial_year text not null,
  last_number int not null default 0,
  updated_at timestamptz not null default now(),
  unique (series, media_code, financial_year)
);

-- Atomic increment function
create or replace function public.next_ref_number(
  p_series text,
  p_media_code text,
  p_financial_year text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  if auth.uid() is null then
    raise exception 'next_ref_number: not authenticated';
  end if;

  insert into public.ref_no_counters (series, media_code, financial_year, last_number)
  values (p_series, p_media_code, p_financial_year, 1)
  on conflict (series, media_code, financial_year)
  do update set
    last_number = ref_no_counters.last_number + 1,
    updated_at = now()
  returning last_number into v_next;

  return v_next;
end;
$$;

-- Helper: compute Indian FY string from a date (Apr–Mar)
create or replace function public.fy_for_date(d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from d) >= 4 then
      to_char(d, 'YYYY') || '-' || substring(to_char(d + interval '1 year', 'YYYY') from 3 for 2)
    else
      to_char(d - interval '1 year', 'YYYY') || '-' || substring(to_char(d, 'YYYY') from 3 for 2)
  end
$$;

-- =====================================================================
-- PROPOSALS (main record)
-- =====================================================================
create table if not exists public.proposals (
  id uuid primary key default uuid_generate_v4(),
  ref_no text unique,
  media_id uuid not null references public.media_types(id),
  media_code text not null,
  language proposal_language not null,
  rate_type rate_type not null default 'DAVP',

  -- Client (with denormalized snapshots)
  client_id uuid not null references public.clients(id),
  client_name_snapshot text not null,
  client_name_gu_snapshot text not null,
  client_department_snapshot text,
  client_department_gu_snapshot text,
  client_address_snapshot text,
  client_address_gu_snapshot text,
  client_gst_snapshot text,

  -- Contact snapshot
  client_contact_id uuid references public.client_contacts(id),
  contact_name_snapshot text,
  contact_name_gu_snapshot text,
  contact_designation_snapshot text,
  contact_designation_gu_snapshot text,

  -- Signer snapshot
  team_member_id uuid not null references public.team_members(id),
  signer_name_snapshot text not null,
  signer_name_gu_snapshot text not null,
  signer_designation_snapshot text,
  signer_designation_gu_snapshot text,
  signer_mobile_snapshot text,

  -- Proposal details
  proposal_date date not null default current_date,
  subject_en text,
  subject_gu text,
  campaign_duration_days int not null default 30,
  campaign_start_date date,
  campaign_end_date date,

  -- Financials
  subtotal numeric(14,2) not null default 0,
  gst_percent numeric(5,2) not null default 18,
  gst_amount numeric(14,2) not null default 0,
  discount_percent numeric(5,2) default 0,
  discount_amount numeric(14,2) default 0,
  discount_reason text,
  total_amount numeric(14,2) not null default 0,
  hsn_sac_code text not null default '998361',  -- advertising services

  -- Status
  status proposal_status not null default 'DRAFT',
  sent_at timestamptz,

  -- Submission tracking (for SENT transition)
  submission_mode submission_mode,  -- required when transitioning to SENT
  office_copy_url text,              -- Google Drive link; required if PHYSICAL

  -- Auto-expiry
  expire_after_days int not null default 120,  -- per-proposal override
  expired_at timestamptz,

  -- Terminal states
  cancelled_at timestamptz,
  cancelled_reason text,  -- required when cancelling
  rejected_at timestamptz,
  rejected_reason text,   -- optional

  -- PO (required for WON transition)
  po_number text,
  po_date date,
  po_amount numeric(14,2),
  po_file_url text,  -- Google Drive link
  po_received_at timestamptz,

  -- Payment rollups (auto-updated via trigger from proposal_receipts)
  total_expected numeric(14,2) not null default 0,
  total_gross_received numeric(14,2) not null default 0,
  total_tds_deducted numeric(14,2) not null default 0,
  total_net_received numeric(14,2) not null default 0,
  outstanding_balance numeric(14,2) not null default 0,
  payment_status text not null default 'NOT_STARTED'
    check (payment_status in ('NOT_STARTED', 'PARTIAL', 'FULL', 'OVERPAID')),

  -- Follow-ups (rollups)
  next_followup_date date,
  last_followup_at timestamptz,
  followup_count int not null default 0,

  -- Regeneration link (for "Regenerate as new")
  regenerated_from_proposal_id uuid references public.proposals(id),

  -- Internal notes
  notes_internal text,
  notes_client text,

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_proposals_status on public.proposals(status);
create index idx_proposals_media on public.proposals(media_code);
create index idx_proposals_client on public.proposals(client_id);
create index idx_proposals_date on public.proposals(proposal_date desc);
create index idx_proposals_ref on public.proposals(ref_no);
create index idx_proposals_followup on public.proposals(next_followup_date)
  where next_followup_date is not null;
create index idx_proposals_created_by on public.proposals(created_by);
create index idx_proposals_sent_stale on public.proposals(sent_at)
  where status = 'SENT';

create trigger trg_proposals_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

-- =====================================================================
-- TRIGGER: enforce PO fields before WON transition
-- =====================================================================
create or replace function public.enforce_po_for_won()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'WON' and (old.status is null or old.status <> 'WON') then
    if new.po_number is null or new.po_date is null
       or new.po_amount is null or new.po_file_url is null then
      raise exception 'PO details (number, date, amount, file URL) are required before marking proposal as WON';
    end if;
    if new.po_received_at is null then
      new.po_received_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_proposals_po_check
  before update on public.proposals
  for each row execute function public.enforce_po_for_won();

-- =====================================================================
-- TRIGGER: enforce office_copy_url for SENT when PHYSICAL submission
-- =====================================================================
create or replace function public.enforce_office_copy_on_sent()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'SENT' and (old.status is null or old.status <> 'SENT') then
    if new.submission_mode is null then
      raise exception 'submission_mode (PHYSICAL/EMAIL/COURIER) is required when marking proposal as SENT';
    end if;
    if new.submission_mode = 'PHYSICAL' and (new.office_copy_url is null or new.office_copy_url = '') then
      raise exception 'office_copy_url (Google Drive link) is required for PHYSICAL submissions';
    end if;
    if new.sent_at is null then
      new.sent_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_proposals_office_copy_check
  before update on public.proposals
  for each row execute function public.enforce_office_copy_on_sent();

-- =====================================================================
-- TRIGGER: populate cancelled_at / rejected_at / expired_at automatically
-- =====================================================================
create or replace function public.set_terminal_state_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'CANCELLED' and (old.status is null or old.status <> 'CANCELLED') then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    if new.cancelled_reason is null or new.cancelled_reason = '' then
      raise exception 'cancelled_reason is required when cancelling a proposal';
    end if;
  end if;
  if new.status = 'REJECTED' and (old.status is null or old.status <> 'REJECTED') then
    new.rejected_at := coalesce(new.rejected_at, now());
  end if;
  if new.status = 'EXPIRED' and (old.status is null or old.status <> 'EXPIRED') then
    new.expired_at := coalesce(new.expired_at, now());
  end if;
  return new;
end;
$$;

create trigger trg_proposals_terminal_states
  before update on public.proposals
  for each row execute function public.set_terminal_state_timestamps();

-- =====================================================================
-- PROPOSAL LINE ITEMS (frozen snapshots)
-- =====================================================================
create table if not exists public.proposal_line_items (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  line_order int not null,
  location_type text not null check (location_type in (
    'GSRTC_STATION', 'AUTO_DISTRICT', 'AUTO_FULL_STATE', 'CUSTOM'
  )),
  gsrtc_station_id uuid references public.gsrtc_stations(id),
  auto_district_id uuid references public.auto_districts(id),

  location_name_snapshot text not null,
  location_name_gu_snapshot text,
  description_en text,
  description_gu text,
  units int not null,
  duration_days int not null default 30,
  unit_rate_snapshot numeric(10,2) not null,
  rate_type_snapshot rate_type not null,
  meta_snapshot jsonb default '{}'::jsonb,

  line_subtotal numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create index idx_line_items_proposal on public.proposal_line_items(proposal_id, line_order);

-- =====================================================================
-- PROPOSAL ATTACHMENTS (Phase 1: Drive link reference pattern)
-- =====================================================================
create table if not exists public.proposal_attachments (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  doc_code text not null,
  title_en text not null,
  title_gu text,
  drive_url text,  -- Google Drive link (preferred)
  storage_path text,  -- fallback to Supabase Storage if needed
  is_included boolean not null default true,
  order_in_pdf int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_attachments_proposal on public.proposal_attachments(proposal_id, order_in_pdf);

-- =====================================================================
-- PROPOSAL VERSIONS (every PDF generation archived)
-- =====================================================================
create table if not exists public.proposal_versions (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  version_no int not null,
  pdf_main_url text,
  pdf_merged_url text,
  generated_at timestamptz not null default now(),
  generated_by uuid not null references public.users(id),
  data_snapshot jsonb,
  unique (proposal_id, version_no)
);

create index idx_versions_proposal on public.proposal_versions(proposal_id, version_no desc);

-- =====================================================================
-- PROPOSAL FOLLOWUPS
-- =====================================================================
create table if not exists public.proposal_followups (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  followup_date date not null default current_date,
  followup_type text not null check (followup_type in (
    'CALL', 'EMAIL', 'WHATSAPP', 'VISIT'
  )),
  notes text not null,
  outcome text,
  next_followup_date date,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index idx_followups_proposal on public.proposal_followups(proposal_id, followup_date desc);
create index idx_followups_next on public.proposal_followups(next_followup_date)
  where next_followup_date is not null;

-- Update proposal rollups when followup added (also counts as activity for auto-expiry)
create or replace function public.update_proposal_followup_rollup()
returns trigger
language plpgsql
as $$
begin
  update public.proposals
  set
    next_followup_date = new.next_followup_date,
    last_followup_at = new.created_at,
    followup_count = followup_count + 1
  where id = new.proposal_id;
  return new;
end;
$$;

create trigger trg_followup_rollup
  after insert on public.proposal_followups
  for each row execute function public.update_proposal_followup_rollup();

-- =====================================================================
-- FUNCTION: auto-expire stale SENT proposals (called by cron)
-- Transitions SENT → EXPIRED if no activity for expire_after_days.
-- "Activity" = last_followup_at OR updated_at, whichever is later.
-- =====================================================================
create or replace function public.expire_stale_proposals()
returns int
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  update public.proposals
  set status = 'EXPIRED', expired_at = now()
  where status = 'SENT'
    and greatest(
      coalesce(last_followup_at, sent_at, updated_at),
      coalesce(sent_at, updated_at)
    ) < now() - make_interval(days => expire_after_days);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
