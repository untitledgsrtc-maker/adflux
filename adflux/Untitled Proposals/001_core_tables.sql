-- =====================================================================
-- UNTITLED PROPOSALS — Migration 001: Core Tables
-- Run this FIRST in Supabase SQL Editor
-- =====================================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =====================================================================
-- USERS (mirrors auth.users with app-level role + profile)
-- =====================================================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  role text not null check (role in ('owner', 'admin', 'user')),
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  -- P&L 2FA (owners only; Supabase Auth MFA handles the actual TOTP)
  totp_enrolled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index idx_users_role on public.users(role);
create index idx_users_active on public.users(is_active) where is_active = true;

-- Helper: get current user's role (used everywhere in RLS)
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

-- Helper: is current user owner or admin
create or replace function public.is_admin_or_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('owner', 'admin') and is_active = true
  )
$$;

-- Helper: is current user owner
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'owner' and is_active = true
  )
$$;

-- =====================================================================
-- TEAM MEMBERS (signers on documents; separate from app users)
-- =====================================================================
create table if not exists public.team_members (
  id uuid primary key default uuid_generate_v4(),
  name_en text not null,
  name_gu text not null,
  designation_en text not null,
  designation_gu text not null,
  mobile text not null,
  email text,
  signature_url text,     -- URL to PNG in Supabase Storage
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_team_active on public.team_members(is_active, display_order);

-- =====================================================================
-- CLIENTS (bilingual; govt or private)
-- =====================================================================
create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  name_en text not null,
  name_gu text not null,
  department_en text,
  department_gu text,
  address_en text,
  address_gu text,
  city text,
  pincode text,
  state text default 'Gujarat',
  gst_number text,
  pan_number text,
  is_government boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create index idx_clients_name_en on public.clients(name_en);
create index idx_clients_name_gu on public.clients(name_gu);
create index idx_clients_is_gov on public.clients(is_government);

-- =====================================================================
-- CLIENT CONTACTS (multiple per client)
-- =====================================================================
create table if not exists public.client_contacts (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  salutation text,               -- શ્રી / શ્રીમતી / માનનીય
  name_en text not null,
  name_gu text not null,
  designation_en text,
  designation_gu text,
  mobile text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_contacts_client on public.client_contacts(client_id);
-- Ensure only one primary contact per client
create unique index idx_contacts_one_primary on public.client_contacts(client_id)
  where is_primary = true;

-- =====================================================================
-- MEDIA TYPES (AUTO / GSRTC, extensible)
-- =====================================================================
create table if not exists public.media_types (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,          -- AUTO / GSRTC
  name_en text not null,
  name_gu text not null,
  description_en text,
  description_gu text,
  ref_prefix text not null,           -- AUTO / GSRTC (for ref numbers)
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- UPDATED_AT TRIGGER (reusable)
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger trg_team_members_updated_at
  before update on public.team_members
  for each row execute function public.set_updated_at();

create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();
