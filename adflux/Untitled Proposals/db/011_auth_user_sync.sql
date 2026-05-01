-- =====================================================================
-- UNTITLED PROPOSALS — Migration 011: Auto-sync auth.users → public.users
--
-- WHY: All RLS policies + role helpers (is_owner, is_admin_or_owner, etc.)
-- read from public.users. If a user signs in via Supabase Auth but has
-- no row in public.users, every policy check fails silently and the UI
-- shows empty data instead of the real "no row" cause.
--
-- This trigger inserts a public.users row whenever a new auth.users
-- row is created, with a safe default role of 'user'. The owner
-- promotes new users via SQL or the (future) Admin UI.
--
-- The first user (owner Brijesh) needs to be promoted manually after
-- signup — see install guide for the one-line SQL.
-- =====================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'user',                  -- safe default; owner promotes via SQL/Admin UI
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger lives on auth.users (Supabase's table). Idempotent if re-run.
drop trigger if exists trg_auth_user_sync on auth.users;
create trigger trg_auth_user_sync
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- =====================================================================
-- Backfill: if any existing auth.users rows lack a public.users row,
-- create them now. (Useful when this migration runs after some users
-- have already signed up.)
-- =====================================================================
insert into public.users (id, email, full_name, role, is_active)
select
  au.id,
  au.email,
  coalesce(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  'user',
  true
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null;
