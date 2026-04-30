// =====================================================================
// Record a row in proposal_versions after every successful render so
// we have an audit trail of who generated which PDF when, and what the
// data snapshot looked like at that point.
// =====================================================================

import { getAdmin } from './supabaseAdmin.mjs';

export async function recordProposalVersion({ proposalId, generatedBy, dataSnapshot, pdfMainUrl = null }) {
  const admin = getAdmin();

  // Get next version_no atomically
  const { data: latest, error: latestErr } = await admin
    .from('proposal_versions')
    .select('version_no')
    .eq('proposal_id', proposalId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw latestErr;
  const versionNo = (latest?.version_no ?? 0) + 1;

  const { data, error } = await admin
    .from('proposal_versions')
    .insert({
      proposal_id: proposalId,
      version_no: versionNo,
      pdf_main_url: pdfMainUrl,
      generated_by: generatedBy,
      data_snapshot: dataSnapshot,
    })
    .select('id, version_no')
    .maybeSingle();
  if (error) throw error;
  return data;
}
