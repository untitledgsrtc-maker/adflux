// =====================================================================
// POST /api/render-proposal
//
// Body: { proposal_id: uuid, copy_kind?: 'ORIGINAL'|'CUSTOMER COPY'|'OFFICE COPY' }
// Auth: Bearer JWT (Supabase access token from the app)
//
// Response: application/pdf (binary)
// Side effect: inserts a row in proposal_versions
// =====================================================================

// _templates/ is created by `npm run sync-templates` (see scripts/sync-templates.mjs).
// Vercel runs `vercel-build` automatically, which calls the sync script.
import { renderTemplate } from '../_templates/render.js';
import { fetchProposalRenderData } from '../lib/fetchProposal.mjs';
import { renderHtmlToPdf } from '../lib/renderToPdf.mjs';
import { recordProposalVersion } from '../lib/version.mjs';
import { verifyCaller } from '../lib/supabaseAdmin.mjs';
import { preflight, pdfResponse, errorResponse, json } from '../lib/respond.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405, req });

  try {
    const caller = await verifyCaller(req);

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Body must be JSON' }, { status: 400, req }); }

    const { proposal_id, copy_kind = null } = body || {};
    if (!proposal_id) return json({ error: 'proposal_id required' }, { status: 400, req });

    const { rateBasis, media, data } = await fetchProposalRenderData(proposal_id, { copyKind: copy_kind });
    const html = renderTemplate({ kind: 'PROPOSAL', rateBasis, media, data });
    const pdf  = await renderHtmlToPdf(html);

    // Audit row (best-effort — don't fail the response if version insert fails)
    try {
      await recordProposalVersion({
        proposalId: proposal_id,
        generatedBy: caller.user.id,
        dataSnapshot: { copy_kind, rate_basis: rateBasis, media, ref_no: data.proposal.ref_no },
      });
    } catch (versionErr) {
      console.warn('[render-proposal] proposal_versions insert failed:', versionErr.message);
    }

    const filename = `${data.proposal.ref_no || 'proposal'}.pdf`.replace(/\//g, '-');
    return pdfResponse(pdf, filename, { req });
  } catch (err) {
    console.error('[render-proposal] error:', err);
    return errorResponse(err, req);
  }
}
