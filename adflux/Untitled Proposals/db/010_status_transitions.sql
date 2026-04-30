-- =====================================================================
-- UNTITLED PROPOSALS — Migration 010: Status-transition RPC
--
-- One SECURITY DEFINER RPC per "interesting" transition. We don't let
-- the UI write status directly because:
--   1. The DB triggers (enforce_office_copy_on_sent, enforce_po_for_won,
--      set_terminal_state_timestamps) raise on missing required fields,
--      but the UI gets a generic Postgres error. Wrapping the update in
--      an RPC lets us return clean, typed errors.
--   2. We can guard against illegal transitions (e.g. PAID → DRAFT) at
--      the RPC layer rather than relying on DB CHECK constraints alone.
--   3. Audit log entries (audit_proposal_status_change trigger) only
--      capture the change; the RPC can also stash the human reason.
--
-- Allowed transitions (forward only, plus terminal states):
--   DRAFT       → SENT, CANCELLED
--   SENT        → WON, REJECTED, CANCELLED  (EXPIRED is set by cron)
--   WON         → PARTIAL_PAID, PAID, CANCELLED
--   PARTIAL_PAID→ PAID, CANCELLED
--   PAID        → (terminal, no transitions)
--   REJECTED    → (terminal)
--   CANCELLED   → (terminal)
--   EXPIRED     → SENT (revive, optional)
--
-- The PARTIAL_PAID and PAID transitions are NOT exposed via this RPC
-- because the receipt-rollup trigger handles them automatically. UI
-- shouldn't be able to set them by hand.
-- =====================================================================

create or replace function public.transition_proposal_status(
  p_proposal_id uuid,
  p_new_status text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_current public.proposal_status;
  v_new public.proposal_status;
  v_inserted jsonb;
begin
  if v_uid is null then
    raise exception 'transition_proposal_status: not authenticated';
  end if;
  select role into v_role from public.users where id = v_uid;
  if v_role not in ('owner', 'co_owner', 'admin') then
    raise exception 'transition_proposal_status: forbidden (role=%)', v_role;
  end if;

  -- Validate new status string
  begin
    v_new := p_new_status::public.proposal_status;
  exception when invalid_text_representation then
    raise exception 'Invalid status "%". Allowed: DRAFT, SENT, WON, PARTIAL_PAID, PAID, CANCELLED, REJECTED, EXPIRED', p_new_status;
  end;

  -- Block UI from setting payment-rollup states directly
  if v_new in ('PARTIAL_PAID', 'PAID') then
    raise exception 'PARTIAL_PAID and PAID are managed by the receipt-rollup trigger. Add a receipt instead.';
  end if;

  -- Block UI from setting EXPIRED directly (cron's job)
  if v_new = 'EXPIRED' then
    raise exception 'EXPIRED is set by the auto-expiry cron. Use REJECTED or CANCELLED if you need to close manually.';
  end if;

  select status into v_current from public.proposals where id = p_proposal_id;
  if v_current is null then
    raise exception 'Proposal % not found', p_proposal_id;
  end if;

  -- Allowed transition table (forward + terminal closures)
  if not (
       (v_current = 'DRAFT'        and v_new in ('SENT', 'CANCELLED'))
    or (v_current = 'SENT'         and v_new in ('WON', 'REJECTED', 'CANCELLED'))
    or (v_current = 'WON'          and v_new in ('CANCELLED'))
    or (v_current = 'PARTIAL_PAID' and v_new in ('CANCELLED'))
    or (v_current = 'EXPIRED'      and v_new in ('SENT'))
  ) then
    raise exception 'Transition % → % is not allowed', v_current, v_new;
  end if;

  -- Apply payload + status. Each transition takes specific fields.
  if v_new = 'SENT' then
    update public.proposals set
      status = v_new,
      submission_mode = nullif(p_payload->>'submission_mode', '')::public.submission_mode,
      office_copy_url = nullif(p_payload->>'office_copy_url', '')
    where id = p_proposal_id;

  elsif v_new = 'WON' then
    update public.proposals set
      status = v_new,
      po_number  = nullif(p_payload->>'po_number', ''),
      po_date    = nullif(p_payload->>'po_date', '')::date,
      po_amount  = (p_payload->>'po_amount')::numeric,
      po_file_url= nullif(p_payload->>'po_file_url', '')
    where id = p_proposal_id;

  elsif v_new = 'REJECTED' then
    update public.proposals set
      status = v_new,
      rejected_reason = nullif(p_payload->>'rejected_reason', '')
    where id = p_proposal_id;

  elsif v_new = 'CANCELLED' then
    if (p_payload->>'cancelled_reason') is null
       or length(trim(p_payload->>'cancelled_reason')) < 5 then
      raise exception 'cancelled_reason of at least 5 characters is required';
    end if;
    update public.proposals set
      status = v_new,
      cancelled_reason = p_payload->>'cancelled_reason'
    where id = p_proposal_id;

  end if;

  select to_jsonb(p) into v_inserted from public.proposals p where p.id = p_proposal_id;
  return v_inserted;
end;
$$;

grant execute on function public.transition_proposal_status(uuid, text, jsonb) to authenticated;
