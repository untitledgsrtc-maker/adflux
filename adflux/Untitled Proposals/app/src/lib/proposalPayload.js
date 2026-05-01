// =====================================================================
// Pure payload builders — no Supabase or React deps. Easy to unit-test.
// Splits the wizard form + computed totals into the exact JSON shape
// that create_proposal_with_lines RPC expects.
// =====================================================================

/**
 * Build the proposal row payload from the wizard form + the related
 * master snapshots. Pure function so the Review screen can preview the
 * exact JSON that will be sent.
 */
export function buildProposalPayload(form, totals) {
  const client   = form.client_snapshot   ?? {};
  const contact  = form.contact_snapshot  ?? null;
  const signer   = form.signer_snapshot   ?? {};

  return {
    media_id:               form.media_id,
    media_code:             form.media_code,
    language:               form.language,
    rate_type:              form.rate_type,

    client_id:              form.client_id,
    client_name_snapshot:           client.name_en,
    client_name_gu_snapshot:        client.name_gu,
    client_department_snapshot:     client.department_en ?? null,
    client_department_gu_snapshot:  client.department_gu ?? null,
    client_address_snapshot:        client.address_en ?? null,
    client_address_gu_snapshot:     client.address_gu ?? null,
    client_gst_snapshot:            client.gst_number ?? null,

    client_contact_id:              form.client_contact_id ?? '',
    contact_name_snapshot:          contact?.name_en ?? null,
    contact_name_gu_snapshot:       contact?.name_gu ?? null,
    contact_designation_snapshot:   contact?.designation_en ?? null,
    contact_designation_gu_snapshot:contact?.designation_gu ?? null,

    team_member_id:                 form.team_member_id,
    signer_name_snapshot:           signer.name_en,
    signer_name_gu_snapshot:        signer.name_gu,
    signer_designation_snapshot:    signer.designation_en ?? null,
    signer_designation_gu_snapshot: signer.designation_gu ?? null,
    signer_mobile_snapshot:         signer.mobile ?? null,

    proposal_date:           form.proposal_date,
    subject_en:              form.subject_en,
    subject_gu:              form.subject_gu,
    campaign_duration_days:  form.campaign_duration_days,
    campaign_start_date:     form.campaign_start_date || '',
    campaign_end_date:       form.campaign_end_date || '',

    subtotal:        totals.subtotal,
    gst_percent:     form.gst_percent,
    gst_amount:      totals.gstAmount,
    discount_percent:form.discount_percent || 0,
    discount_amount: totals.discountAmount || 0,
    discount_reason: form.discount_reason || null,
    total_amount:    totals.totalAmount,
    hsn_sac_code:    '998361',

    expire_after_days: form.expire_after_days || 120,
    notes_internal:    form.notes_internal || null,
    notes_client:      form.notes_client || null,
    status:            'DRAFT',
  };
}

/** Strip transient UI fields from line items before sending. */
export function buildLineItemsPayload(lineItems) {
  return lineItems.map((li) => ({
    location_type:           li.location_type,
    gsrtc_station_id:        li.gsrtc_station_id ?? '',
    auto_district_id:        li.auto_district_id ?? '',
    location_name_snapshot:  li.location_name_snapshot,
    location_name_gu_snapshot: li.location_name_gu_snapshot ?? null,
    description_en:          li.description_en ?? null,
    description_gu:          li.description_gu ?? null,
    units:                   li.units,
    duration_days:           li.duration_days,
    unit_rate_snapshot:      li.unit_rate_snapshot,
    rate_type_snapshot:      li.rate_type_snapshot,
    meta_snapshot:           li.meta_snapshot ?? {},
    line_subtotal:           li.line_subtotal,
  }));
}
