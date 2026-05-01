// =====================================================================
// P&L module API surface — read views, write proposal_pnl + admin
// expenses, log every access via log_pnl_access RPC.
// =====================================================================

import { supabase, callRpc } from './supabase';

export const ADMIN_EXPENSE_TYPES = [
  'salary', 'rent', 'electricity', 'internet', 'phone', 'vehicle_fuel',
  'accounting_ca_fees', 'office_supplies', 'travel', 'insurance',
  'software_subscriptions', 'bank_charges', 'marketing', 'other',
];

export const qkPnL = {
  summaryFy: () => ['pnl', 'summary-fy'],
  proposalPnl: (id) => ['pnl', 'proposal', id],
  proposalPnlList: () => ['pnl', 'proposal-list'],
  adminExpenses: (filters) => ['pnl', 'admin-expenses', filters || {}],
  adminMonthly: () => ['pnl', 'admin-monthly'],
  accessLog: (filters) => ['pnl', 'access-log', filters || {}],
};

// ---------- Audit log helper ----------
async function logAccess(accessType, opts = {}) {
  try {
    await callRpc('log_pnl_access', {
      p_access_type: accessType,
      p_proposal_id: opts.proposalId ?? null,
      p_admin_expense_id: opts.adminExpenseId ?? null,
      p_fy_label: opts.fyLabel ?? null,
      p_totp_verified_at: opts.totpVerifiedAt ?? null,
      p_user_agent: navigator?.userAgent ?? null,
      p_details: opts.details ?? null,
    });
  } catch (err) {
    // Never let an audit-log failure break the underlying read.
    // Surface to console so we notice in dev.
    console.warn('[pnl] log_pnl_access failed:', err.message);
  }
}

// ---------- Summary view ----------
export async function fetchPnLSummaryFy({ totpVerifiedAt }) {
  const { data, error } = await supabase
    .from('v_pnl_summary_fy')
    .select('*');
  if (error) throw error;
  await logAccess('VIEW_SUMMARY', { totpVerifiedAt });
  return data ?? [];
}

// ---------- Per-proposal P&L ----------
export async function fetchProposalPnLList({ totpVerifiedAt }) {
  // Join through to proposals for ref + client name display
  const { data, error } = await supabase
    .from('proposal_pnl')
    .select('*, proposals:proposal_id(ref_no, client_name_snapshot, client_name_gu_snapshot, status, payment_status)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  await logAccess('VIEW_PROPOSAL_PNL', { totpVerifiedAt });
  return data ?? [];
}

export async function fetchProposalPnL(proposalId, { totpVerifiedAt }) {
  const { data, error } = await supabase
    .from('proposal_pnl')
    .select('*, proposals:proposal_id(ref_no, client_name_snapshot, client_name_gu_snapshot, total_amount, po_amount, total_gross_received, status, payment_status)')
    .eq('proposal_id', proposalId)
    .maybeSingle();
  if (error) throw error;
  await logAccess('VIEW_PROPOSAL_PNL', { proposalId, totpVerifiedAt });
  return data;
}

export async function updateProposalPnL(proposalId, patch, { totpVerifiedAt } = {}) {
  // Owner-only RLS will enforce this; UI also gates the button.
  const { data, error } = await supabase
    .from('proposal_pnl')
    .update(patch)
    .eq('proposal_id', proposalId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  await logAccess('EDIT_PROPOSAL_PNL', { proposalId, totpVerifiedAt, details: patch });
  return data;
}

export async function finalizeProposalPnL(proposalId, { totpVerifiedAt } = {}) {
  const { data, error } = await supabase
    .from('proposal_pnl')
    .update({
      is_finalized: true,
      finalized_at: new Date().toISOString(),
    })
    .eq('proposal_id', proposalId)
    .eq('is_finalized', false)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  await logAccess('FINALIZE_PNL', { proposalId, totpVerifiedAt });
  return data;
}

// ---------- Monthly admin expenses ----------
export async function fetchAdminExpenses({ from, to, type } = {}, { totpVerifiedAt } = {}) {
  let q = supabase.from('monthly_admin_expenses').select('*').order('expense_month', { ascending: false }).order('created_at', { ascending: false });
  if (from) q = q.gte('expense_month', from);
  if (to)   q = q.lte('expense_month', to);
  if (type) q = q.eq('expense_type', type);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  await logAccess('VIEW_ADMIN_EXPENSES', { totpVerifiedAt, details: { from, to, type } });
  return data ?? [];
}

export async function fetchAdminExpenseMonthly({ totpVerifiedAt } = {}) {
  const { data, error } = await supabase
    .from('v_admin_expenses_monthly')
    .select('*')
    .limit(120);   // ~10 years of 12-month buckets
  if (error) throw error;
  await logAccess('VIEW_ADMIN_EXPENSES', { totpVerifiedAt });
  return data ?? [];
}

export async function createAdminExpense(payload, { totpVerifiedAt } = {}) {
  const { data, error } = await supabase
    .from('monthly_admin_expenses')
    .insert(payload)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  await logAccess('EDIT_ADMIN_EXPENSE', { totpVerifiedAt, adminExpenseId: data?.id, details: payload });
  return data;
}

export async function updateAdminExpense(id, patch, { totpVerifiedAt } = {}) {
  const { data, error } = await supabase
    .from('monthly_admin_expenses')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  await logAccess('EDIT_ADMIN_EXPENSE', { adminExpenseId: id, totpVerifiedAt, details: patch });
  return data;
}

export async function deleteAdminExpense(id, { totpVerifiedAt } = {}) {
  const { error } = await supabase
    .from('monthly_admin_expenses')
    .delete()
    .eq('id', id);
  if (error) throw error;
  await logAccess('EDIT_ADMIN_EXPENSE', { adminExpenseId: id, totpVerifiedAt, details: { deleted: true } });
}

// ---------- Access log viewer ----------
export async function fetchAccessLog({ from, to, accessType, userId, limit = 200 } = {}) {
  let q = supabase.from('pnl_access_log').select('*').order('accessed_at', { ascending: false });
  if (from) q = q.gte('accessed_at', from);
  if (to)   q = q.lte('accessed_at', to);
  if (accessType) q = q.eq('access_type', accessType);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q.limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ---------- Pure helpers (testable) ----------

/**
 * Compute business profit from the P&L row's component fields.
 * Mirrors the DB generated column:
 *   business_profit = net_revenue - media_owner_payout - production_cost
 *                     - partner_commission_amount - other_direct_cost
 * Used in the editor for live preview before save.
 */
export function calcBusinessProfit({
  net_revenue = 0,
  media_owner_payout = 0,
  production_cost = 0,
  partner_commission_amount = 0,
  other_direct_cost = 0,
} = {}) {
  const round2 = (n) => {
    const v = Number(n) || 0;
    const sign = v < 0 ? -1 : 1;
    const abs = Math.abs(v);
    return sign * Math.round((abs + Number.EPSILON) * 100) / 100;
  };
  return round2(
    Number(net_revenue || 0)
    - Number(media_owner_payout || 0)
    - Number(production_cost || 0)
    - Number(partner_commission_amount || 0)
    - Number(other_direct_cost || 0)
  );
}

/** Resolve commission amount from % × net_revenue (mirrors DB trigger). */
export function calcPartnerCommissionAmount(netRevenue, percent) {
  const round2 = (n) => {
    const v = Number(n) || 0;
    const sign = v < 0 ? -1 : 1;
    const abs = Math.abs(v);
    return sign * Math.round((abs + Number.EPSILON) * 100) / 100;
  };
  return round2(Number(netRevenue || 0) * Number(percent || 0) / 100);
}
