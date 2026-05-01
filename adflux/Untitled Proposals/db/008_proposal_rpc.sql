-- =====================================================================
-- UNTITLED PROPOSALS — Migration 008: Proposal save RPC
--
-- Atomic insert of a proposal + its line items in a single transaction.
-- The wizard calls this on submit; if the line-item insert fails, the
-- proposal row rolls back too — no orphaned half-written records.
--
-- Also issues the ref_no by calling next_ref_number() inside the same
-- txn, so the counter and the proposal row stay in lock-step. If the
-- proposal insert fails, the counter has already incremented — that's
-- intentional (gap-tolerant numbering, never duplicate).
-- =====================================================================

create or replace function public.create_proposal_with_lines(
  p_proposal jsonb,         -- proposal row payload
  p_line_items jsonb        -- array of line item payloads
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_proposal_id uuid;
  v_ref_no text;
  v_seq int;
  v_fy text;
  v_media_code text;
  v_inserted jsonb;
  v_line jsonb;
  v_idx int := 0;
begin
  if v_uid is null then
    raise exception 'create_proposal_with_lines: not authenticated';
  end if;

  select role into v_role from public.users where id = v_uid;
  if v_role not in ('owner', 'co_owner', 'admin') then
    raise exception 'create_proposal_with_lines: forbidden (role=%)', v_role;
  end if;

  -- Required scalars
  v_media_code := p_proposal->>'media_code';
  if v_media_code is null then
    raise exception 'media_code is required';
  end if;

  -- Compute FY from proposal_date (default = today)
  v_fy := public.fy_for_date(coalesce((p_proposal->>'proposal_date')::date, current_date));

  -- Issue ref number atomically (or use the one the caller passed in,
  -- e.g. for re-saving a draft that already has a ref_no)
  if (p_proposal->>'ref_no') is null or (p_proposal->>'ref_no') = '' then
    v_seq := public.next_ref_number('PROPOSAL', v_media_code, v_fy);
    v_ref_no := format('UA/PROP/%s/%s/%s', v_media_code, v_fy, lpad(v_seq::text, 4, '0'));
  else
    v_ref_no := p_proposal->>'ref_no';
  end if;

  -- Insert proposal. We list columns explicitly (not jsonb_populate_record)
  -- so a stray field in the payload can't accidentally write to a column
  -- it shouldn't. Anything not in this list is ignored.
  insert into public.proposals (
    ref_no, media_id, media_code, language, rate_type,
    client_id, client_name_snapshot, client_name_gu_snapshot,
    client_department_snapshot, client_department_gu_snapshot,
    client_address_snapshot, client_address_gu_snapshot, client_gst_snapshot,
    client_contact_id, contact_name_snapshot, contact_name_gu_snapshot,
    contact_designation_snapshot, contact_designation_gu_snapshot,
    team_member_id, signer_name_snapshot, signer_name_gu_snapshot,
    signer_designation_snapshot, signer_designation_gu_snapshot, signer_mobile_snapshot,
    proposal_date, subject_en, subject_gu,
    campaign_duration_days, campaign_start_date, campaign_end_date,
    subtotal, gst_percent, gst_amount,
    discount_percent, discount_amount, discount_reason,
    total_amount, hsn_sac_code,
    expire_after_days,
    notes_internal, notes_client,
    status, created_by
  ) values (
    v_ref_no,
    (p_proposal->>'media_id')::uuid,
    v_media_code,
    coalesce((p_proposal->>'language')::proposal_language, 'gu'),
    coalesce((p_proposal->>'rate_type')::rate_type, 'DAVP'),
    (p_proposal->>'client_id')::uuid,
    p_proposal->>'client_name_snapshot',
    p_proposal->>'client_name_gu_snapshot',
    p_proposal->>'client_department_snapshot',
    p_proposal->>'client_department_gu_snapshot',
    p_proposal->>'client_address_snapshot',
    p_proposal->>'client_address_gu_snapshot',
    p_proposal->>'client_gst_snapshot',
    nullif(p_proposal->>'client_contact_id', '')::uuid,
    p_proposal->>'contact_name_snapshot',
    p_proposal->>'contact_name_gu_snapshot',
    p_proposal->>'contact_designation_snapshot',
    p_proposal->>'contact_designation_gu_snapshot',
    (p_proposal->>'team_member_id')::uuid,
    p_proposal->>'signer_name_snapshot',
    p_proposal->>'signer_name_gu_snapshot',
    p_proposal->>'signer_designation_snapshot',
    p_proposal->>'signer_designation_gu_snapshot',
    p_proposal->>'signer_mobile_snapshot',
    coalesce((p_proposal->>'proposal_date')::date, current_date),
    p_proposal->>'subject_en',
    p_proposal->>'subject_gu',
    coalesce((p_proposal->>'campaign_duration_days')::int, 30),
    nullif(p_proposal->>'campaign_start_date', '')::date,
    nullif(p_proposal->>'campaign_end_date', '')::date,
    coalesce((p_proposal->>'subtotal')::numeric, 0),
    coalesce((p_proposal->>'gst_percent')::numeric, 18),
    coalesce((p_proposal->>'gst_amount')::numeric, 0),
    coalesce((p_proposal->>'discount_percent')::numeric, 0),
    coalesce((p_proposal->>'discount_amount')::numeric, 0),
    p_proposal->>'discount_reason',
    coalesce((p_proposal->>'total_amount')::numeric, 0),
    coalesce(p_proposal->>'hsn_sac_code', '998361'),
    coalesce((p_proposal->>'expire_after_days')::int, 120),
    p_proposal->>'notes_internal',
    p_proposal->>'notes_client',
    coalesce((p_proposal->>'status')::proposal_status, 'DRAFT'),
    v_uid
  )
  returning id into v_proposal_id;

  -- Insert line items
  if jsonb_typeof(p_line_items) <> 'array' then
    raise exception 'p_line_items must be a JSON array (got %)', jsonb_typeof(p_line_items);
  end if;

  for v_line in select * from jsonb_array_elements(p_line_items) loop
    v_idx := v_idx + 1;
    insert into public.proposal_line_items (
      proposal_id, line_order, location_type,
      gsrtc_station_id, auto_district_id,
      location_name_snapshot, location_name_gu_snapshot,
      description_en, description_gu,
      units, duration_days,
      unit_rate_snapshot, rate_type_snapshot,
      meta_snapshot, line_subtotal
    ) values (
      v_proposal_id, v_idx, v_line->>'location_type',
      nullif(v_line->>'gsrtc_station_id', '')::uuid,
      nullif(v_line->>'auto_district_id', '')::uuid,
      v_line->>'location_name_snapshot',
      v_line->>'location_name_gu_snapshot',
      v_line->>'description_en',
      v_line->>'description_gu',
      (v_line->>'units')::int,
      coalesce((v_line->>'duration_days')::int, 30),
      (v_line->>'unit_rate_snapshot')::numeric,
      coalesce((v_line->>'rate_type_snapshot')::rate_type, (p_proposal->>'rate_type')::rate_type, 'DAVP'),
      coalesce(v_line->'meta_snapshot', '{}'::jsonb),
      (v_line->>'line_subtotal')::numeric
    );
  end loop;

  if v_idx = 0 then
    raise exception 'At least one line item is required';
  end if;

  -- Return the inserted proposal as JSON for the caller's UI
  select to_jsonb(p) into v_inserted from public.proposals p where p.id = v_proposal_id;
  return v_inserted;
end;
$$;

grant execute on function public.create_proposal_with_lines(jsonb, jsonb) to authenticated;

-- =====================================================================
-- Quick-add client RPC (used by the wizard's inline "+ New client"
-- modal — minimum-fields-only insert)
-- =====================================================================
create or replace function public.create_client_minimal(
  p_name_en text,
  p_name_gu text,
  p_is_government boolean default true,
  p_gst_number text default null,
  p_department_en text default null,
  p_department_gu text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_client_id uuid;
  v_inserted jsonb;
begin
  if v_uid is null then
    raise exception 'create_client_minimal: not authenticated';
  end if;

  select role into v_role from public.users where id = v_uid;
  if v_role not in ('owner', 'co_owner', 'admin') then
    raise exception 'create_client_minimal: forbidden (role=%)', v_role;
  end if;

  if p_name_en is null or p_name_en = '' then
    raise exception 'name_en is required';
  end if;
  if p_name_gu is null or p_name_gu = '' then
    raise exception 'name_gu is required';
  end if;

  insert into public.clients (
    name_en, name_gu, is_government, gst_number,
    department_en, department_gu, created_by
  ) values (
    p_name_en, p_name_gu, p_is_government, nullif(p_gst_number, ''),
    nullif(p_department_en, ''), nullif(p_department_gu, ''), v_uid
  )
  returning id into v_client_id;

  select to_jsonb(c) into v_inserted from public.clients c where c.id = v_client_id;
  return v_inserted;
end;
$$;

grant execute on function public.create_client_minimal(text, text, boolean, text, text, text) to authenticated;
