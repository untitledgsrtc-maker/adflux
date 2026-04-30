-- =====================================================================
-- UNTITLED PROPOSALS — Migration 003: Proposals Core
-- =====================================================================

-- =====================================================================
-- PROPOSAL STATUS ENUM
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_status') then
    create type public.proposal_status as enum (
      'DRAFT', 'SENT', 'APPROVED', 'WON',
      'PARTIAL_PAID', 'PAID', 'LOST', 'EXPIRED', 'CLOSED'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_language') then
    create type public.proposal_language as enum ('gu', 'en');
  end if;
end$$;

-- =====================================================================
-- REF NUMBER COUNTERS (atomic per series per FY)
-- =====================================================================
create table if not exists public.ref_no_counters (
  id uuid primary key default uuid_generate_v4(),
  series text not null,                    -- PROPOSAL or RECEIPT
  media_code text not null,                -- AUTO / GSRTC
  financial_year text not null,            -- "2026-27"
  last_number int not null default 0,
  updated_at timestamptz not null default now(),
  unique (series, media_code, financial_year)
);

-- Atomic increment function for ref numbers
create or replace function public.next_ref_number(
  p_series text,
  p_media_code text,
  p_financial_year text
)
returns int
language plpgsql
as $$
declare
  v_next int;
begin
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

-- =====================================================================
-- PROPOSALS (main record)
-- =====================================================================
create table if not exists public.proposals (
  id uuid primary key default uuid_generate_v4(),
  ref_no text unique,                      -- UA/AUTO/2026-27/0001 (null until first PDF)
  media_id uuid not null references public.media_types(id),
  media_code text not null,                -- denormalized for fast queries
  language proposal_language not null,
  rate_type rate_type not null default 'DAVP',

  -- Client (with denormalized snapshots — Adflux convention)
  client_id uuid not null references public.clients(id),
  client_name_snapshot text not null,
  client_name_gu_snapshot text not null,
  client_department_snapshot text,
  client_department_gu_snapshot text,
  client_address_snapshot text,
  client_address_gu_snapshot text,

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

  -- Status
  status proposal_status not null default 'DRAFT',
  sent_at timestamptz,
  approved_at timestamptz,
  lost_at timestamptz,
  lost_reason text,

  -- PO (required for WON transition — enforced via trigger)
  po_number text,
  po_date date,
  po_amount numeric(14,2),
  po_file_url text,                        -- Supabase Storage
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

  -- Link to CRM quote (optional)
  crm_quote_id uuid,

  -- Regeneration link
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

create trigger trg_proposals_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

-- Enforce PO fields before WON transition
create or replace function public.enforce_po_for_won()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'WON' and (
    new.po_number is null or new.po_date is null
    or new.po_amount is null or new.po_file_url is null
  ) then
    raise exception 'PO details (number, date, amount, file) are required before marking proposal as WON';
  end if;
  return new;
end;
$$;

create trigger trg_proposals_po_check
  before update on public.proposals
  for each row execute function public.enforce_po_for_won();

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
  -- Reference to master (nullable for CUSTOM)
  gsrtc_station_id uuid references public.gsrtc_stations(id),
  auto_district_id uuid references public.auto_districts(id),

  -- Snapshots (frozen at creation; masters can change later without affecting this)
  location_name_snapshot text not null,
  location_name_gu_snapshot text,
  description_en text,
  description_gu text,
  units int not null,                       -- screens / rickshaws / placements
  duration_days int not null default 30,
  unit_rate_snapshot numeric(10,2) not null,
  rate_type_snapshot rate_type not null,
  -- JSON blob for media-specific fields (monthly_spots, placement, etc.)
  meta_snapshot jsonb default '{}'::jsonb,

  line_subtotal numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create index idx_line_items_proposal on public.proposal_line_items(proposal_id, line_order);

-- =====================================================================
-- PROPOSAL ATTACHMENTS (Phase 1: filename convention in Drive)
-- =====================================================================
create table if not exists public.proposal_attachments (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  doc_code text not null,                   -- DAVP_LETTER / RATE_SHEET / etc.
  title_en text not null,
  title_gu text,
  storage_path text not null,               -- Supabase Storage path
  is_included boolean not null default true,
  order_in_pdf int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_attachments_proposal on public.proposal_attachments(proposal_id, order_in_pdf);

-- =====================================================================
-- PROPOSAL VERSIONS (every regeneration archived)
-- =====================================================================
create table if not exists public.proposal_versions (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  version_no int not null,
  pdf_main_url text,                        -- proposal without attachments
  pdf_merged_url text,                      -- proposal + attachments
  generated_at timestamptz not null default now(),
  generated_by uuid not null references public.users(id),
  data_snapshot jsonb,                      -- full proposal state at this moment
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

-- Update proposal rollups when followup added
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
