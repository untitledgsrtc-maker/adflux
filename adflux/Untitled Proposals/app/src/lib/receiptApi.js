// =====================================================================
// Receipt module API surface — fetch + create + soft-delete + PDF.
// =====================================================================

import { supabase, callRpc } from './supabase';

export const qkRcpt = {
  receiptsByProposal: (proposalId) => ['receipts', 'by-proposal', proposalId],
  receipts: (filters) => ['receipts', 'list', filters || {}],
  receipt: (id) => ['receipts', id],
  proposalsForReceipt: () => ['proposals', 'receivable'],
};

/** All receipts for a proposal, newest first, deleted excluded. */
export async function fetchReceiptsByProposal(proposalId) {
  if (!proposalId) return [];
  const { data, error } = await supabase
    .from('proposal_receipts')
    .select('*')
    .eq('proposal_id', proposalId)
    .is('deleted_at', null)
    .order('receipt_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Cross-proposal receipt list with optional filters. */
export async function fetchReceipts({ from, to, paymentMode, includeDeleted = false } = {}) {
  let q = supabase.from('proposal_receipts').select('*').order('receipt_date', { ascending: false });
  if (!includeDeleted) q = q.is('deleted_at', null);
  if (from) q = q.gte('receipt_date', from);
  if (to)   q = q.lte('receipt_date', to);
  if (paymentMode) q = q.eq('payment_mode', paymentMode);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return data ?? [];
}

/** Proposals the user can add a receipt against (WON / PARTIAL_PAID). */
export async function fetchReceivableProposals() {
  const { data, error } = await supabase
    .from('proposals')
    .select('id, ref_no, client_name_snapshot, client_name_gu_snapshot, total_amount, po_amount, total_gross_received, outstanding_balance, payment_status, status, subject_en')
    .in('status', ['WON', 'PARTIAL_PAID', 'PAID'])
    .order('proposal_date', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

/** Atomic save via SECURITY DEFINER RPC. Returns the inserted row. */
export async function createReceipt(payload) {
  return callRpc('create_receipt', { p_receipt: payload });
}

/** Soft-delete (owner only, mandatory reason). */
export async function softDeleteReceipt(receiptId, reason) {
  return callRpc('soft_delete_receipt', { p_receipt_id: receiptId, p_reason: reason });
}

// --------------- PDF helpers (call the pdf-api Vercel function) ---------------

const PDF_BASE = import.meta.env.VITE_PDF_API_URL || '';

async function callPdfApi(endpoint, body) {
  if (!PDF_BASE) throw new Error('VITE_PDF_API_URL is not configured');
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) throw new Error('Not signed in');

  const res = await fetch(`${PDF_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `PDF API ${res.status}`;
    try {
      const err = await res.json();
      msg = err?.error || msg;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.blob();
}

export async function downloadProposalPdf(proposalId, copyKind = null) {
  const blob = await callPdfApi('/api/render-proposal', { proposal_id: proposalId, copy_kind: copyKind });
  triggerDownload(blob, `proposal-${proposalId}.pdf`);
}

export async function downloadReceiptPdf(receiptId, copyKind = null) {
  const blob = await callPdfApi('/api/render-receipt', { receipt_id: receiptId, copy_kind: copyKind });
  triggerDownload(blob, `receipt-${receiptId}.pdf`);
}

export async function downloadSettlementPdf(proposalId, copyKind = 'STATEMENT') {
  const blob = await callPdfApi('/api/render-settlement', { proposal_id: proposalId, copy_kind: copyKind });
  triggerDownload(blob, `settlement-${proposalId}.pdf`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick — Safari sometimes loses the blob if revoked too soon
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
