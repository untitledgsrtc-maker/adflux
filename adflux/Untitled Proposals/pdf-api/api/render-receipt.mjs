// =====================================================================
// POST /api/render-receipt
//
// Body: { receipt_id: uuid, copy_kind?: string }
// Auth: Bearer JWT
// Response: application/pdf
// =====================================================================

// _templates/ is created by `npm run sync-templates` (see scripts/sync-templates.mjs).
import { renderTemplate } from '../_templates/render.js';
import { fetchReceiptRenderData } from '../lib/fetchReceipt.mjs';
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

    const { receipt_id, copy_kind = null } = body || {};
    if (!receipt_id) return json({ error: 'receipt_id required' }, { status: 400, req });

    const { data } = await fetchReceiptRenderData(receipt_id, { copyKind: copy_kind });
    const html = renderTemplate({ kind: 'RECEIPT', data });
    const pdf  = await renderHtmlToPdf(html);

    const filename = `${data.receipt.receipt_no || 'receipt'}.pdf`.replace(/\//g, '-');
    return pdfResponse(pdf, filename, { req });
  } catch (err) {
    console.error('[render-receipt] error:', err);
    return errorResponse(err, req);
  }
}
