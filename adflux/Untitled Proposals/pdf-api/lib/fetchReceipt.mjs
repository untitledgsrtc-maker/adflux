// =====================================================================
// Fetch a receipt + its parent proposal (for runningTotals) + signer.
// =====================================================================

import { getAdmin } from './supabaseAdmin.mjs';
import { brandFromEnv } from './brand.mjs';

export async function fetchReceiptRenderData(receiptId, { copyKind = null, signerOverride = null } = {}) {
  const admin = getAdmin();

  const { data: receipt, error: rErr } = await admin
    .from('proposal_receipts')
    .select('*')
    .eq('id', receiptId)
    .is('deleted_at', null)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!receipt) {
    const e = new Error(`Receipt ${receiptId} not found (or deleted)`);
    e.status = 404;
    throw e;
  }

  // Parent proposal — needed for the running-totals block on the
  // receipt voucher
  const { data: proposal, error: pErr } = await admin
    .from('proposals')
    .select('id, ref_no, total_expected, po_amount, total_amount, total_gross_received, total_tds_deducted, total_net_received, outstanding_balance, signer_name_snapshot, signer_name_gu_snapshot, signer_designation_snapshot, signer_designation_gu_snapshot, signer_mobile_snapshot')
    .eq('id', receipt.proposal_id)
    .maybeSingle();
  if (pErr) throw pErr;

  const signer = signerOverride ?? {
    name_en:        proposal?.signer_name_snapshot,
    name_gu:        proposal?.signer_name_gu_snapshot,
    designation_en: proposal?.signer_designation_snapshot,
    designation_gu: proposal?.signer_designation_gu_snapshot,
    mobile:         proposal?.signer_mobile_snapshot,
  };

  const expected = Number(proposal?.po_amount ?? proposal?.total_amount ?? receipt.gross_amount);
  const grossSoFar = Number(proposal?.total_gross_received ?? receipt.gross_amount);
  const runningTotals = {
    expected,
    gross:       grossSoFar,
    tds:         Number(proposal?.total_tds_deducted ?? 0),
    net:         Number(proposal?.total_net_received ?? receipt.net_received_amount),
    outstanding: Number(proposal?.outstanding_balance ?? (expected - grossSoFar)),
  };

  return {
    data: {
      brand: brandFromEnv(),
      receipt,
      signer,
      runningTotals,
      copyKind,
    },
  };
}

export async function fetchSettlementRenderData(proposalId, { copyKind = null } = {}) {
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

  const { data: receipts, error: rErr } = await admin
    .from('proposal_receipts')
    .select('*')
    .eq('proposal_id', proposalId)
    .is('deleted_at', null)
    .order('receipt_date', { ascending: true });
  if (rErr) throw rErr;

  const client = {
    name_en:    proposal.client_name_snapshot,
    name_gu:    proposal.client_name_gu_snapshot,
    gst_number: proposal.client_gst_snapshot,
  };
  const signer = {
    name_en:        proposal.signer_name_snapshot,
    name_gu:        proposal.signer_name_gu_snapshot,
    designation_en: proposal.signer_designation_snapshot,
    designation_gu: proposal.signer_designation_gu_snapshot,
    mobile:         proposal.signer_mobile_snapshot,
  };

  return {
    data: {
      brand: brandFromEnv(),
      proposal,
      client,
      signer,
      receipts,
      statementDate: new Date(),
      copyKind,
    },
  };
}
