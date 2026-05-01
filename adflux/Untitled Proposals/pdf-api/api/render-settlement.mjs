// =====================================================================
// POST /api/render-settlement
//
// Body: { proposal_id: uuid, copy_kind?: string }
// Auth: Bearer JWT
// Response: application/pdf
//
// Generates the final-settlement statement (one PDF, lists every
// receipt against the proposal). Allowed even when balance > 0;
// the template will mark it "Statement (open balance)" instead of
// "Paid in Full".
// =====================================================================

// _templates/ is created by `npm run sync-templates` (see scripts/sync-templates.mjs).
import { renderTemplate } from '../_templates/render.js';
import { fetchSettlementRenderData } from '../lib/fetchReceipt.mjs';
import { renderHtmlToPdf } from '../lib/renderToPdf.mjs';
import { verifyCaller } from '../lib/supabaseAdmin.mjs';
import { preflight, pdfResponse, errorResponse, json } from '../lib/respond.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405, req });

  try {
    await verifyCaller(req);

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Body must be JSON' }, { status: 400, req }); }

    const { proposal_id, copy_kind = 'STATEMENT' } = body || {};
    if (!proposal_id) return json({ error: 'proposal_id required' }, { status: 400, req });

    const { data } = await fetchSettlementRenderData(proposal_id, { copyKind: copy_kind });
    const html = renderTemplate({ kind: 'SETTLEMENT', data });
    const pdf  = await renderHtmlToPdf(html);

    const filename = `settlement-${data.proposal.ref_no || proposal_id}.pdf`.replace(/\//g, '-');
    return pdfResponse(pdf, filename, { req });
  } catch (err) {
    console.error('[render-settlement] error:', err);
    return errorResponse(err, req);
  }
}
