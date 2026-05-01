-- =====================================================================
-- UNTITLED PROPOSALS — Migration 002: Masters (Rate Cards)
-- Supports DUAL rate model: DAVP (government) + AGENCY (commercial)
-- =====================================================================

-- =====================================================================
-- GSRTC STATIONS (effective-dated, versioned)
-- =====================================================================
create table if not exists public.gsrtc_stations (
  id uuid primary key default uuid_generate_v4(),
  serial_no int not null,                      -- 1–20, display order
  station_name_en text not null,
  station_name_gu text not null,
  category text not null check (category in ('A', 'B', 'C')),
  screens_count int not null,
  daily_spots int not null default 100,
  spot_duration_sec int not null default 10,
  monthly_spots int not null,                  -- 800 / 1000 / 1500 (from your sheet)
  loop_time_min int not null default 5,
  days_per_month int not null default 30,
  -- DAVP rates (government proposals)
  davp_per_slot_rate numeric(10,2) not null,   -- 2.50 / 2.75 / 3.00
  davp_monthly_total numeric(12,2) generated always as (monthly_spots * davp_per_slot_rate) stored,
  -- Agency rates (commercial proposals — from Adflux pricing)
  agency_monthly_rate numeric(12,2),           -- 650 / 850 per month
  agency_rack_rate numeric(12,2),              -- 1800 / 2250 crossed-out rate
  image_url text,
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_gsrtc_active on public.gsrtc_stations(is_active, serial_no);
create index idx_gsrtc_category on public.gsrtc_stations(category);

create trigger trg_gsrtc_stations_updated_at
  before update on public.gsrtc_stations
  for each row execute function public.set_updated_at();

-- =====================================================================
-- AUTO DISTRICTS (33 districts of Gujarat)
-- =====================================================================
create table if not exists public.auto_districts (
  id uuid primary key default uuid_generate_v4(),
  serial_no int not null,
  district_name_en text not null,
  district_name_gu text not null,
  available_rickshaw_count int not null,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_districts_active on public.auto_districts(is_active, serial_no);

create trigger trg_auto_districts_updated_at
  before update on public.auto_districts
  for each row execute function public.set_updated_at();

-- =====================================================================
-- AUTO RATE MASTER (one active row at a time; history preserved)
-- DAVP-locked per-rickshaw rate for all 3 sides combined
-- =====================================================================
create table if not exists public.auto_rate_master (
  id uuid primary key default uuid_generate_v4(),
  size_rear text not null default E'4\' × 3\'',
  size_left text not null default E'2\' × 2\'',
  size_right text not null default E'2\' × 2\'',
  -- DAVP rate (government)
  davp_per_rickshaw_rate numeric(10,2) not null,      -- 825
  davp_source_reference text,                         -- DAVP circular no.
  davp_is_locked boolean not null default true,       -- UI warns before edit
  -- Agency rate (commercial)
  agency_per_rickshaw_rate numeric(10,2),             -- agency's own rate
  campaign_duration_days int not null default 30,
  effective_from date not null default current_date,
  effective_to date,
  updated_by uuid references public.users(id),
  update_reason text,                                 -- required if DAVP rate changed
  created_at timestamptz not null default now()
);

create index idx_auto_rate_effective on public.auto_rate_master(effective_from desc)
  where effective_to is null;

-- =====================================================================
-- RATE TYPE ENUM (used across proposals + line items)
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rate_type') then
    create type public.rate_type as enum ('DAVP', 'AGENCY');
  end if;
end$$;
