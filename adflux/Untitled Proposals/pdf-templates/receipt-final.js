// =====================================================================
// Receipt template: FINAL SETTLEMENT STATEMENT
//
// Generated when a proposal is fully paid. NOT a single receipt — it
// summarises every receipt against a proposal in one audit-ready
// statement. The accounting team uses this to reconcile against the
// underlying tax invoice.
//
// Distinct from receipt-voucher.js (which renders ONE receipt). This
// renders the complete payment ledger for ONE PROPOSAL.
//
// Stamp: "PAID IN FULL" if outstanding == 0, otherwise omitted (the
// API should refuse to render this template if the proposal isn't
// fully closed out).
// =====================================================================

import { SHARED_CSS } from './shared/styles.js';
import {
  fmtInrPlain, fmtDateIn, esc,
  brandHeader, refStrip, signerBlock, htmlDocument,
} from './shared/helpers.js';

const PAYMENT_MODE_SHORT = {
  CASH:   'Cash',
  CHEQUE: 'Cheque',
  DRAFT:  'DD',
  NEFT:   'NEFT',
  RTGS:   'RTGS',
  UPI:    'UPI',
};

export function render(data) {
  const {
    brand, proposal, client, signer, copyKind = null,
    receipts = [],            // array, chronological, deleted_at IS NULL only
    statementDate = new Date(),
  } = data;

  // Defensive sums — don't trust the caller blindly. The proposal row's
  // totals should match these; if they don't, that's a bug worth surfacing.
  const sumGross = receipts.reduce((s, r) => s + Number(r.gross_amount || 0), 0);
  const sumTdsIncome = receipts.reduce((s, r) => s + Number(r.tds_income_amount || 0), 0);
  const sumTdsGst = receipts.reduce((s, r) => s + Number(r.tds_gst_amount || 0), 0);
  const sumTds = sumTdsIncome + sumTdsGst;
  const sumNet = receipts.reduce((s, r) => s + Number(r.net_received_amount || 0), 0);

  const expected = Number(proposal.po_amount || proposal.total_amount || 0);
  const outstanding = Number((expected - sumGross).toFixed(2));
  const isPaidInFull = outstanding <= 0;

  const receiptRows = receipts.map((r, i) => /* html */ `
    <tr>
      <td class="right">${i + 1}</td>
      <td>${fmtDateIn(r.receipt_date)}</td>
      <td><strong>${esc(r.receipt_no || '—')}</strong></td>
      <td>${esc(r.receipt_type)}</td>
      <td>${esc(PAYMENT_MODE_SHORT[r.payment_mode] || r.payment_mode)}${
        r.cheque_or_ref_no ? `<br><small class="muted">${esc(r.cheque_or_ref_no)}</small>` : ''
      }</td>
      <td class="right">${fmtInrPlain(r.gross_amount)}</td>
      <td class="right">${fmtInrPlain((Number(r.tds_income_amount || 0) + Number(r.tds_gst_amount || 0)))}</td>
      <td class="right">${fmtInrPlain(r.net_received_amount)}</td>
    </tr>
  `).join('');

  // If sums-from-receipts diverge from proposal-rollup, show a
  // reconciliation note (operations should investigate).
  const rollupGross = Number(proposal.total_gross_received || 0);
  const driftHtml = (Math.abs(rollupGross - sumGross) > 0.01) ? /* html */ `
    <div class="notice" style="border-color: #b45309; background: #fef6e7">
      <strong>⚠ Reconciliation note:</strong> Proposal rollup shows
      ${fmtInrPlain(rollupGross)} gross received, but the sum of receipts
      printed below is ${fmtInrPlain(sumGross)}. Difference:
      ${fmtInrPlain(rollupGross - sumGross)}. Investigate before relying
      on this statement for accounting.
    </div>
  ` : '';

  const stampHtml = isPaidInFull
    ? `<span class="stamp" style="font-size:11pt; padding:4pt 12pt">Paid in Full</span>`
    : `<span class="stamp" style="font-size:11pt; padding:4pt 12pt; border-color:#b45309; color:#b45309">Statement (open balance)</span>`;

  const body = /* html */ `
    ${brandHeader(brand)}
    ${refStrip({
      refNo: proposal.ref_no,
      date: statementDate,
      copyKind: copyKind || 'STATEMENT',
    })}

    <div style="display:flex; justify-content:space-between; align-items:flex-end">
      <h1>Final Settlement Statement</h1>
      ${stampHtml}
    </div>
    <p class="gu" style="font-size:11pt; color:var(--ink-mute)">
      અંતિમ સેટલમેન્ટ સ્ટેટમેન્ટ — ${isPaidInFull ? 'સંપૂર્ણ ચૂકવણી' : 'સ્ટેટમેન્ટ (બાકી રકમ)'}
    </p>

    ${driftHtml}

    <h2>Customer</h2>
    <div>
      <strong class="gu">${esc(client.name_gu)}</strong><br>
      <strong>${esc(client.name_en)}</strong>
      ${client.gst_number ? `<br><span class="muted tiny">GSTIN: ${esc(client.gst_number)}</span>` : ''}
    </div>

    <h2>Proposal</h2>
    <table>
      <tbody>
        <tr>
          <td class="muted" style="width:30%">Reference</td>
          <td><strong>${esc(proposal.ref_no || '—')}</strong></td>
        </tr>
        <tr>
          <td class="muted">Proposal date</td>
          <td>${fmtDateIn(proposal.proposal_date)}</td>
        </tr>
        ${proposal.subject_en ? `
          <tr>
            <td class="muted">Subject</td>
            <td>${esc(proposal.subject_en)}</td>
          </tr>
        ` : ''}
        <tr>
          <td class="muted">Quoted value</td>
          <td>${fmtInrPlain(proposal.total_amount)}</td>
        </tr>
        ${proposal.po_amount ? `
          <tr>
            <td class="muted">PO value</td>
            <td><strong>${fmtInrPlain(proposal.po_amount)}</strong>${proposal.po_number ? ` (PO ${esc(proposal.po_number)})` : ''}</td>
          </tr>
        ` : ''}
      </tbody>
    </table>

    <h2>Receipts (chronological)</h2>
    <table>
      <thead>
        <tr>
          <th class="right">#</th>
          <th>Date</th>
          <th>Receipt No.</th>
          <th>Type</th>
          <th>Mode</th>
          <th class="right">Gross (₹)</th>
          <th class="right">TDS (₹)</th>
          <th class="right">Net (₹)</th>
        </tr>
      </thead>
      <tbody>${receiptRows || '<tr><td colspan="8" class="muted center">No receipts on file</td></tr>'}</tbody>
      <tfoot>
        <tr style="font-weight:600; background: var(--bg-tint)">
          <td colspan="5" class="right">Totals</td>
          <td class="right">${fmtInrPlain(sumGross)}</td>
          <td class="right">${fmtInrPlain(sumTds)}</td>
          <td class="right">${fmtInrPlain(sumNet)}</td>
        </tr>
      </tfoot>
    </table>

    <h2>Reconciliation</h2>
    <table class="totals" style="width:65%">
      <tr><td class="right muted">Proposal value (PO / quoted)</td>
          <td class="right">${fmtInrPlain(expected)}</td></tr>
      <tr><td class="right muted">Total gross received</td>
          <td class="right">${fmtInrPlain(sumGross)}</td></tr>
      <tr><td class="right muted">Total TDS deducted by client</td>
          <td class="right">${fmtInrPlain(sumTds)}</td></tr>
      <tr><td class="right muted">Total net credited to bank</td>
          <td class="right">${fmtInrPlain(sumNet)}</td></tr>
      <tr class="grand">
        <td class="right">
          <span class="gu">${isPaidInFull ? 'કુલ બાકી રકમ' : 'બાકી રકમ'}</span> /
          Outstanding (₹)
        </td>
        <td class="right">${fmtInrPlain(outstanding)}</td>
      </tr>
    </table>

    <div class="notice">
      <div class="gu" style="margin-bottom: 4pt">
        નોંધ: આ સ્ટેટમેન્ટ ઉપરોક્ત પ્રપોઝલ સામે પ્રાપ્ત તમામ ચુકવણીઓની
        સંપૂર્ણ યાદી છે. કરપાત્ર બિલ અલગથી ઈશ્યૂ કરવામાં આવેલ છે.
      </div>
      <div>
        Note: This statement consolidates all payments received against
        the above proposal. It is <strong>not a Tax Invoice</strong>.
        Tax Invoices are issued separately by the accounting team.
        TDS amounts shown are as deducted by the client; the corresponding
        Form 26AS / Form 16A should be reconciled by the deductor.
      </div>
    </div>

    ${signerBlock({ signer })}
  `;

  return htmlDocument({
    title: `Settlement ${proposal.ref_no || ''} — ${client.name_en}`,
    css: SHARED_CSS,
    body,
  });
}
