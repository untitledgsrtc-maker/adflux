// =====================================================================
// Fetch a proposal + lines + (optional) auto rate row, then assemble
// the data object the template expects.
//
// Snapshots in the proposal row are the source of truth for client/
// signer data — we DO NOT join through to clients/team_members at
// render time, since the original master row may have been edited
// since the proposal was created.
// =====================================================================

import { getAdmin } from './supabaseAdmin.mjs';
import { brandFromEnv } from './brand.mjs';

export async function fetchProposalRenderData(proposalId, { copyKind = null } = {}) {
  const admin = getAdmin();

  const { data: proposal, error: pErr } = await admin
    .from('proposals')
    .select('*')
    .eq('id', proposalId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!proposal) {
    const e = new Error(`Proposal ${proposalId} not found`);
    e.status = 404;
    throw e;
  }

  const { data: lineItems, error: liErr } = await admin
    .from('proposal_line_items')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('line_order');
  if (liErr) throw liErr;
  if (!lineItems || lineItems.length === 0) {
    const e = new Error(`Proposal ${proposalId} has no line items`);
    e.status = 422;
    throw e;
  }

  // Auto rate (only needed for AUTO templates, but cheap to load)
  let autoRate = null;
  if (proposal.media_code === 'AUTO') {
    const { data, error } = await admin
      .from('auto_rate_master')
      .select('*')
      .is('effective_to', null)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    autoRate = data;
    if (!autoRate) {
      const e = new Error('No active row in auto_rate_master');
      e.status = 422;
      throw e;
    }
  }

  // Templates expect snapshots reshaped a bit
  const client = {
    name_en:       proposal.client_name_snapshot,
    name_gu:       proposal.client_name_gu_snapshot,
    department_en: proposal.client_department_snapshot,
    department_gu: proposal.client_department_gu_snapshot,
    address_en:    proposal.client_address_snapshot,
    address_gu:    proposal.client_address_gu_snapshot,
    gst_number:    proposal.client_gst_snapshot,
  };

  const contact = proposal.contact_name_snapshot ? {
    name_en:        proposal.contact_name_snapshot,
    name_gu:        proposal.contact_name_gu_snapshot,
    designation_en: proposal.contact_designation_snapshot,
    designation_gu: proposal.contact_designation_gu_snapshot,
  } : null;

  const signer = {
    name_en:        proposal.signer_name_snapshot,
    name_gu:        proposal.signer_name_gu_snapshot,
    designation_en: proposal.signer_designation_snapshot,
    designation_gu: proposal.signer_designation_gu_snapshot,
    mobile:         proposal.signer_mobile_snapshot,
  };

  // Templates also expect computed totals on the proposal object
  const proposalForTemplate = {
    ref_no:                  proposal.ref_no,
    proposal_date:           proposal.proposal_date,
    subject_en:              proposal.subject_en,
    subject_gu:              proposal.subject_gu,
    subtotal:                Number(proposal.subtotal),
    discountAmount:          Number(proposal.discount_amount || 0),
    gstPercent:              Number(proposal.gst_percent),
    gstAmount:               Number(proposal.gst_amount),
    totalAmount:             Number(proposal.total_amount),
    total_amount:            Number(proposal.total_amount),
    po_amount:               proposal.po_amount,
    po_number:               proposal.po_number,
    total_gross_received:    Number(proposal.total_gross_received || 0),
  };

  return {
    rateBasis: proposal.rate_type,        // 'DAVP' | 'AGENCY'
    media:     proposal.media_code,        // 'AUTO' | 'GSRTC'
    data: {
      brand:     brandFromEnv(),
      proposal:  proposalForTemplate,
      client,
      contact,
      signer,
      lineItems,
      autoRate,                            // null for GSRTC
      copyKind,
    },
  };
}
