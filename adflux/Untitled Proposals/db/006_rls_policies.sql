-- =====================================================================
-- UNTITLED PROPOSALS — Migration 006: RLS Policies (UPDATED 2026-04-24)
--
-- ROLE MODEL (4 roles):
--   owner      → Brijesh: full read/write everywhere; sole P&L editor;
--                only one who can delete receipts, add users, edit users,
--                edit master rates, write monthly_admin_expenses.
--   co_owner   → Vishal:  full read/write on operational data (proposals,
--                receipts, clients); READ-only on P&L + monthly admin
--                expenses (sees the numbers, can't change them).
--   admin      → operations staff: full read/write on operational data;
--                NO P&L access at all (not even read).
--   user       → limited staff: read-only on proposals/clients;
--                no payments / receipts / P&L.
--
-- Sensitive surfaces (P&L, admin expenses) are also gated by TOTP step-up
-- in the API layer; RLS here is the second wall.
-- =====================================================================

-- =====================================================================
-- ENABLE RLS on every public table
-- =====================================================================
alter table public.users                     enable row level security;
alter table public.team_members              enable row level security;
alter table public.clients                   enable row level security;
alter table public.client_contacts           enable row level security;
alter table public.media_types               enable row level security;
alter table public.gsrtc_stations            enable row level security;
alter table public.auto_districts            enable row level security;
alter table public.auto_rate_master          enable row level security;
alter table public.proposals                 enable row level security;
alter table public.proposal_line_items       enable row level security;
alter table public.proposal_attachments      enable row level security;
alter table public.proposal_versions         enable row level security;
alter table public.proposal_followups        enable row level security;
alter table public.proposal_receipts         enable row level security;
alter table public.ref_no_counters           enable row level security;
alter table public.proposal_pnl              enable row level security;
alter table public.monthly_admin_expenses    enable row level security;
alter table public.pnl_access_log            enable row level security;
alter table public.audit_log                 enable row level security;

-- =====================================================================
-- USERS
-- Everyone can read their own row + the basic profile of teammates
-- (needed for "created_by" lookups and the avatar in headers).
-- Only the owner may write to public.users.
-- =====================================================================
drop policy if exists users_self_read on public.users;
create policy users_self_read
  on public.users for select
  to authenticated
  using (true);

drop policy if exists users_owner_write on public.users;
create policy users_owner_write
  on public.users for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- =====================================================================
-- TEAM MEMBERS (signers on PDFs — operational reference data)
-- =====================================================================
drop policy if exists team_read on public.team_members;
create policy team_read
  on public.team_members for select
  to authenticated
  using (true);

drop policy if exists team_admin_write on public.team_members;
create policy team_admin_write
  on public.team_members for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

-- =====================================================================
-- CLIENTS + CONTACTS
-- All authenticated users can read; only admin+ can write.
-- =====================================================================
drop policy if exists clients_read on public.clients;
create policy clients_read
  on public.clients for select
  to authenticated
  using (true);

drop policy if exists clients_admin_write on public.clients;
create policy clients_admin_write
  on public.clients for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

drop policy if exists contacts_read on public.client_contacts;
create policy contacts_read
  on public.client_contacts for select
  to authenticated
  using (true);

drop policy if exists contacts_admin_write on public.client_contacts;
create policy contacts_admin_write
  on public.client_contacts for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

-- =====================================================================
-- MASTERS: media_types, gsrtc_stations, auto_districts, auto_rate_master
-- All authenticated users can read.
-- Only owner may edit master rates (DAVP rates are locked by policy).
-- =====================================================================
drop policy if exists media_types_read on public.media_types;
create policy media_types_read
  on public.media_types for select
  to authenticated
  using (true);

drop policy if exists media_types_owner_write on public.media_types;
create policy media_types_owner_write
  on public.media_types for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists gsrtc_read on public.gsrtc_stations;
create policy gsrtc_read
  on public.gsrtc_stations for select
  to authenticated
  using (true);

drop policy if exists gsrtc_admin_write on public.gsrtc_stations;
create policy gsrtc_admin_write
  on public.gsrtc_stations for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

drop policy if exists districts_read on public.auto_districts;
create policy districts_read
  on public.auto_districts for select
  to authenticated
  using (true);

drop policy if exists districts_admin_write on public.auto_districts;
create policy districts_admin_write
  on public.auto_districts for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

drop policy if exists auto_rate_read on public.auto_rate_master;
create policy auto_rate_read
  on public.auto_rate_master for select
  to authenticated
  using (true);

drop policy if exists auto_rate_owner_write on public.auto_rate_master;
create policy auto_rate_owner_write
  on public.auto_rate_master for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- =====================================================================
-- PROPOSALS
-- Read: everyone authenticated (incl. role 'user')
-- Write (insert/update): admin+ (owner, co_owner, admin)
-- Delete: owner only (we never hard-delete in practice; CANCELLED is the path)
-- =====================================================================
drop policy if exists proposals_read on public.proposals;
create policy proposals_read
  on public.proposals for select
  to authenticated
  using (true);

drop policy if exists proposals_admin_insert on public.proposals;
create policy proposals_admin_insert
  on public.proposals for insert
  to authenticated
  with check (public.is_admin_or_owner());

drop policy if exists proposals_admin_update on public.proposals;
create policy proposals_admin_update
  on public.proposals for update
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

drop policy if exists proposals_owner_delete on public.proposals;
create policy proposals_owner_delete
  on public.proposals for delete
  to authenticated
  using (public.is_owner());

-- =====================================================================
-- PROPOSAL LINE ITEMS
-- Same as proposals: read all, write admin+, delete owner.
-- =====================================================================
drop policy if exists line_items_read on public.proposal_line_items;
create policy line_items_read
  on public.proposal_line_items for select
  to authenticated
  using (true);

drop policy if exists line_items_admin_write on public.proposal_line_items;
create policy line_items_admin_write
  on public.proposal_line_items for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

-- =====================================================================
-- PROPOSAL ATTACHMENTS (Drive links to brochures, rate cards, etc.)
-- Same as line items: read all, write admin+.
-- =====================================================================
drop policy if exists attachments_read on public.proposal_attachments;
create policy attachments_read
  on public.proposal_attachments for select
  to authenticated
  using (true);

drop policy if exists attachments_admin_write on public.proposal_attachments;
create policy attachments_admin_write
  on public.proposal_attachments for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

-- =====================================================================
-- PROPOSAL VERSIONS (PDF generation history)
-- Read: all. Insert: admin+ (every PDF generation creates a row).
-- No update or delete (history is immutable).
-- =====================================================================
drop policy if exists versions_read on public.proposal_versions;
create policy versions_read
  on public.proposal_versions for select
  to authenticated
  using (true);

drop policy if exists versions_admin_insert on public.proposal_versions;
create policy versions_admin_insert
  on public.proposal_versions for insert
  to authenticated
  with check (public.is_admin_or_owner());

-- =====================================================================
-- REF NUMBER COUNTERS
-- Read: all (UI may show next preview number).
-- Direct writes blocked — only the SECURITY DEFINER next_ref_number()
-- RPC may mutate this table.
-- =====================================================================
drop policy if exists ref_counters_read on public.ref_no_counters;
create policy ref_counters_read
  on public.ref_no_counters for select
  to authenticated
  using (true);

-- (No INSERT/UPDATE/DELETE policies — direct mutation is denied.)

-- =====================================================================
-- PROPOSAL FOLLOWUPS
-- Read: all. Write: admin+ (operations team logs follow-ups).
-- =====================================================================
drop policy if exists followups_read on public.proposal_followups;
create policy followups_read
  on public.proposal_followups for select
  to authenticated
  using (true);

drop policy if exists followups_admin_write on public.proposal_followups;
create policy followups_admin_write
  on public.proposal_followups for all
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

-- =====================================================================
-- PROPOSAL RECEIPTS
-- Read: all (so the proposals list can show payment status).
-- Insert: admin+.
-- Update: admin+ — but UI never lets you set deleted_at directly;
--         deletion goes through soft_delete_receipt() RPC which is
--         security-definer + owner-only.
-- Hard DELETE: nobody (no policy = denied; we only soft-delete).
-- =====================================================================
drop policy if exists receipts_read on public.proposal_receipts;
create policy receipts_read
  on public.proposal_receipts for select
  to authenticated
  using (true);

drop policy if exists receipts_admin_insert on public.proposal_receipts;
create policy receipts_admin_insert
  on public.proposal_receipts for insert
  to authenticated
  with check (public.is_admin_or_owner());

drop policy if exists receipts_admin_update on public.proposal_receipts;
create policy receipts_admin_update
  on public.proposal_receipts for update
  to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

-- (Deliberately no DELETE policy — hard delete is denied.)

-- =====================================================================
-- PROPOSAL P&L
-- Read: owner + co_owner only (Vishal must SEE every field, per spec).
-- Write: owner ONLY (Brijesh is the sole P&L editor).
-- =====================================================================
drop policy if exists pnl_owner_co_read on public.proposal_pnl;
create policy pnl_owner_co_read
  on public.proposal_pnl for select
  to authenticated
  using (public.is_owner_or_co_owner());

drop policy if exists pnl_owner_write on public.proposal_pnl;
create policy pnl_owner_write
  on public.proposal_pnl for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- =====================================================================
-- MONTHLY ADMIN EXPENSES
-- Read: owner + co_owner (visibility for Vishal so he can see overheads).
-- Write: owner ONLY.
-- =====================================================================
drop policy if exists admin_exp_owner_co_read on public.monthly_admin_expenses;
create policy admin_exp_owner_co_read
  on public.monthly_admin_expenses for select
  to authenticated
  using (public.is_owner_or_co_owner());

drop policy if exists admin_exp_owner_write on public.monthly_admin_expenses;
create policy admin_exp_owner_write
  on public.monthly_admin_expenses for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- =====================================================================
-- PNL ACCESS LOG
-- Read: owner only (Brijesh audits who looked at P&L).
-- Insert: only via SECURITY DEFINER function log_pnl_access().
-- No update/delete policies → append-only at the DB layer.
-- =====================================================================
drop policy if exists pnl_log_owner_read on public.pnl_access_log;
create policy pnl_log_owner_read
  on public.pnl_access_log for select
  to authenticated
  using (public.is_owner());

-- (No INSERT policy — direct inserts are blocked. Only the SECURITY DEFINER
--  RPC log_pnl_access() can write, and it runs with elevated privileges.)

-- =====================================================================
-- AUDIT LOG
-- Read: owner + co_owner (full audit transparency for both leads).
-- No write policies → triggers (SECURITY DEFINER) are the only writers.
-- =====================================================================
drop policy if exists audit_owner_co_read on public.audit_log;
create policy audit_owner_co_read
  on public.audit_log for select
  to authenticated
  using (public.is_owner_or_co_owner());

-- =====================================================================
-- VIEWS — RLS doesn't apply directly to views; permissions cascade from
-- the underlying tables. v_pnl_summary_fy and v_admin_expenses_monthly
-- both read from proposal_pnl + monthly_admin_expenses, which already
-- restrict reads to owner+co_owner — so views inherit that gating.
-- We still GRANT explicitly for clarity.
-- =====================================================================
grant select on public.v_pnl_summary_fy to authenticated;
grant select on public.v_admin_expenses_monthly to authenticated;

-- =====================================================================
-- RPC GRANTS (functions are SECURITY DEFINER but we still grant EXECUTE
-- to authenticated; the functions enforce role checks internally)
-- =====================================================================
grant execute on function public.log_pnl_access(
  text, uuid, uuid, text, timestamptz, inet, text, jsonb
) to authenticated;

grant execute on function public.soft_delete_receipt(uuid, text) to authenticated;

grant execute on function public.next_ref_number(text, text, text) to authenticated;
grant execute on function public.fy_for_date(date) to authenticated;
grant execute on function public.expire_stale_proposals() to authenticated;

grant execute on function public.get_my_role() to authenticated;
grant execute on function public.is_admin_or_owner() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_owner_or_co_owner() to authenticated;
