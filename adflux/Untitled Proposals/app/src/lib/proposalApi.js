// =====================================================================
// Proposal API surface — every Supabase call the wizard makes lives here.
// React Query keys are exported so the rest of the app can invalidate
// the same caches after a save.
// =====================================================================

import { supabase, callRpc } from './supabase';
import { buildProposalPayload, buildLineItemsPayload } from './proposalPayload';

// Re-export so existing call sites that imported from './proposalApi' still work.
export { buildProposalPayload, buildLineItemsPayload };

// ---------- query keys ----------
export const qk = {
  clients: () => ['clients'],
  client: (id) => ['clients', id],
  contacts: (clientId) => ['contacts', clientId],
  mediaTypes: () => ['media_types'],
  teamMembers: () => ['team_members'],
  autoDistricts: () => ['auto_districts'],
  gsrtcStations: () => ['gsrtc_stations'],
  autoRate: () => ['auto_rate_master', 'active'],
  proposals: () => ['proposals'],
  proposal: (id) => ['proposals', id],
};

// ---------- masters ----------
export async function fetchClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name_en, name_gu, department_en, department_gu, city, gst_number, is_government, default_tds_income_percent, default_tds_gst_percent')
    .order('name_en', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchClientContacts(clientId) {
  if (!clientId) return [];
  const { data, error } = await supabase
    .from('client_contacts')
    .select('*')
    .eq('client_id', clientId)
    .order('is_primary', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMediaTypes() {
  const { data, error } = await supabase
    .from('media_types')
    .select('*')
    .eq('is_active', true)
    .order('display_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchTeamMembers() {
  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .eq('is_active', true)
    .order('display_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchAutoDistricts() {
  const { data, error } = await supabase
    .from('auto_districts')
    .select('*')
    .eq('is_active', true)
    .order('serial_no');
  if (error) throw error;
  return data ?? [];
}

export async function fetchGsrtcStations() {
  const { data, error } = await supabase
    .from('gsrtc_stations')
    .select('*')
    .eq('is_active', true)
    .order('serial_no');
  if (error) throw error;
  return data ?? [];
}

export async function fetchActiveAutoRate() {
  // Only fetch the row whose effective_to is NULL (current rate).
  const { data, error } = await supabase
    .from('auto_rate_master')
    .select('*')
    .is('effective_to', null)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------- mutations ----------

/** Atomic save via SECURITY DEFINER RPC (see db/008_proposal_rpc.sql). */
export async function saveProposal(form, totals) {
  const proposal = buildProposalPayload(form, totals);
  const lineItems = buildLineItemsPayload(form.line_items);
  return callRpc('create_proposal_with_lines', {
    p_proposal: proposal,
    p_line_items: lineItems,
  });
}

/** Inline client-add modal helper. */
export async function quickAddClient({ name_en, name_gu, is_government = true, gst_number, department_en, department_gu }) {
  return callRpc('create_client_minimal', {
    p_name_en: name_en,
    p_name_gu: name_gu,
    p_is_government: !!is_government,
    p_gst_number: gst_number || null,
    p_department_en: department_en || null,
    p_department_gu: department_gu || null,
  });
}
