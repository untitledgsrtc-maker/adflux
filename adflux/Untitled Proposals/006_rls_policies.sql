-- =====================================================================
-- UNTITLED PROPOSALS — Migration 006: RLS Policies
-- Run AFTER all tables are created
-- =====================================================================

-- Enable RLS on all tables
alter table public.users enable row level security;
alter table public.team_members enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.media_types enable row level security;
alter table public.gsrtc_stations enable row level security;
alter table public.auto_districts enable row level security;
alter table public.auto_rate_master enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_line_items enable row level security;
alter table public.proposal_attachments enable row level security;
alter table public.proposal_versions enable row level security;
alter table public.proposal_followups enable row level security;
alter table public.proposal_receipts enable row level security;
alter table public.ref_no_counters enable row level security;
alter table public.order_pnl enable row level security;
alter table public.pnl_access_log enable row level security;
alter table public.audit_log enable row level security;

-- =====================================================================
-- USERS
-- =====================================================================
-- Everyone authenticated can read users (for dropdowns, signer selection)
create policy "users_select_authenticated"
  on public.users for select
  to authenticated
  using (true);

-- Only admin+ can insert new users (via app, not raw DB)
create policy "users_insert_admin"
  on public.users for insert
  to authenticated
  with check (public.is_admin_or_owner());

-- Admin+ can update; users can update themselves (limited fields enforced in app)
create policy "users_update_self_or_admin"
  on public.users for update
  to authenticated
  using (id = auth.uid() or public.is_admin_or_owner())
  with check (id = auth.uid() or public.is_admin_or_owner());

-- Only owner can change roles to 'owner' (enforced in app logic; policy allows owner)
-- No delete; use is_active = false

-- =====================================================================
-- TEAM MEMBERS
-- =====================================================================
create policy "team_select_all"
  on public.team_members for select to authenticated using (true);

create policy "team_write_admin"
  on public.team_members for all to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

-- =====================================================================
-- CLIENTS + CONTACTS
-- =====================================================================
create policy "clients_select_all"
  on public.clients for select to authenticated using (true);

create policy "clients_insert_authenticated"
  on public.clients for insert to authenticated
  with check (true);  -- Any user can create a client

create policy "clients_update_admin_or_creator"
  on public.clients for update to authenticated
  using (public.is_admin_or_owner() or created_by = auth.uid())
  with check (public.is_admin_or_owner() or created_by = auth.uid());

create policy "clients_delete_admin"
  on public.clients for delete to authenticated
  using (public.is_admin_or_owner());

create policy "contacts_select_all"
  on public.client_contacts for select to authenticated using (true);

create policy "contacts_write_authenticated"
  on public.client_contacts for all to authenticated
  using (true) with check (true);

-- =====================================================================
-- MASTERS (media, stations, districts, rates)
-- =====================================================================
create policy "media_select_all"
  on public.media_types for select to authenticated using (true);

create policy "media_write_admin"
  on public.media_types for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

create policy "gsrtc_select_all"
  on public.gsrtc_stations for select to authenticated using (true);

create policy "gsrtc_write_admin"
  on public.gsrtc_stations for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

create policy "districts_select_all"
  on public.auto_districts for select to authenticated using (true);

create policy "districts_write_admin"
  on public.auto_districts for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

create policy "auto_rate_select_all"
  on public.auto_rate_master for select to authenticated using (true);

create policy "auto_rate_write_admin"
  on public.auto_rate_master for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

-- =====================================================================
-- PROPOSALS
-- =====================================================================
-- Admin+ see all; users see only their own
create policy "proposals_select_own_or_admin"
  on public.proposals for select to authenticated
  using (public.is_admin_or_owner() or created_by = auth.uid());

create policy "proposals_insert_authenticated"
  on public.proposals for insert to authenticated
  with check (created_by = auth.uid());

-- Update rules enforced in app layer per status (DRAFT/SENT/etc.)
create policy "proposals_update_own_or_admin"
  on public.proposals for update to authenticated
  using (public.is_admin_or_owner() or created_by = auth.uid())
  with check (public.is_admin_or_owner() or created_by = auth.uid());

create policy "proposals_delete_admin"
  on public.proposals for delete to authenticated
  using (public.is_admin_or_owner());

-- Line items follow proposal permissions
create policy "line_items_via_proposal"
  on public.proposal_line_items for all to authenticated
  using (exists (
    select 1 from public.proposals p
    where p.id = proposal_id
      and (public.is_admin_or_owner() or p.created_by = auth.uid())
  ))
  with check (exists (
    select 1 from public.proposals p
    where p.id = proposal_id
      and (public.is_admin_or_owner() or p.created_by = auth.uid())
  ));

create policy "attachments_via_proposal"
  on public.proposal_attachments for all to authenticated
  using (exists (
    select 1 from public.proposals p
    where p.id = proposal_id
      and (public.is_admin_or_owner() or p.created_by = auth.uid())
  ))
  with check (exists (
    select 1 from public.proposals p
    where p.id = proposal_id
      and (public.is_admin_or_owner() or p.created_by = auth.uid())
  ));

create policy "versions_via_proposal_read"
  on public.proposal_versions for select to authenticated
  using (exists (
    select 1 from public.proposals p
    where p.id = proposal_id
      and (public.is_admin_or_owner() or p.created_by = auth.uid())
  ));

create policy "versions_insert_authenticated"
  on public.proposal_versions for insert to authenticated
  with check (generated_by = auth.uid());

-- Followups
create policy "followups_via_proposal"
  on public.proposal_followups for all to authenticated
  using (exists (
    select 1 from public.proposals p
    where p.id = proposal_id
      and (public.is_admin_or_owner() or p.created_by = auth.uid())
  ))
  with check (exists (
    select 1 from public.proposals p
    where p.id = proposal_id
      and (public.is_admin_or_owner() or p.created_by = auth.uid())
  ));

-- =====================================================================
-- RECEIPTS (admin+ manages; users see own proposals' receipts)
-- =====================================================================
create policy "receipts_select_own_or_admin"
  on public.proposal_receipts for select to authenticated
  using (
    public.is_admin_or_owner()
    or exists (
      select 1 from public.proposals p
      where p.id = proposal_id and p.created_by = auth.uid()
    )
  );

create policy "receipts_insert_admin"
  on public.proposal_receipts for insert to authenticated
  with check (public.is_admin_or_owner());

create policy "receipts_update_admin"
  on public.proposal_receipts for update to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

create policy "receipts_delete_owner"
  on public.proposal_receipts for delete to authenticated
  using (public.is_owner());  -- Only OWNER can delete receipts

-- =====================================================================
-- REF NUMBER COUNTERS
-- =====================================================================
create policy "ref_counters_read_all"
  on public.ref_no_counters for select to authenticated using (true);

create policy "ref_counters_write_authenticated"
  on public.ref_no_counters for all to authenticated
  using (true) with check (true);

-- =====================================================================
-- P&L — OWNER ONLY (absolute)
-- =====================================================================
create policy "pnl_select_owner"
  on public.order_pnl for select to authenticated
  using (public.is_owner());

create policy "pnl_insert_owner_or_system"
  on public.order_pnl for insert to authenticated
  with check (public.is_owner());  -- trigger inserts run as security definer

create policy "pnl_update_owner"
  on public.order_pnl for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "pnl_delete_owner"
  on public.order_pnl for delete to authenticated
  using (public.is_owner());

-- =====================================================================
-- P&L ACCESS LOG — owner reads; anyone auth can insert; NO update/delete
-- =====================================================================
create policy "pnl_log_select_owner"
  on public.pnl_access_log for select to authenticated
  using (public.is_owner());

create policy "pnl_log_insert_authenticated"
  on public.pnl_access_log for insert to authenticated
  with check (user_id = auth.uid());

-- NO update policy (cannot edit logs)
-- NO delete policy (cannot delete logs — even owners)

-- =====================================================================
-- AUDIT LOG — admin+ read; anyone authenticated can insert; no update/delete
-- =====================================================================
create policy "audit_select_admin"
  on public.audit_log for select to authenticated
  using (public.is_admin_or_owner());

create policy "audit_insert_authenticated"
  on public.audit_log for insert to authenticated
  with check (true);

-- NO update, NO delete
