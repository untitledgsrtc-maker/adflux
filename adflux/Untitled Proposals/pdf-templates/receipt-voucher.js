// =====================================================================
// Receipt template: ADVANCE / PART_PAYMENT receipt voucher
//
// Format: Receipt Voucher per Rule 50 CGST Rules, 2017.
// The PDF is explicitly NOT a Tax Invoice — that's issued separately
// by the accounting team. We print "RECEIPT VOUCHER" prominently to
// avoid any mistaken use as proof-of-tax-paid by the recipient.
//
// Mandatory Rule 50 fields included:
//   - Supplier name/address/GSTIN
//   - Consecutive serial number (receipt_no)
//   - Date of issue
//   - Recipient name/address/GSTIN
//   - Description of advance (proposal subject + ref)
//   - Amount of advance
//   - Nominal GST rate disclosure (the actual tax invoice will carry the
//     CGST/SGST/IGST split based on place-of-supply)
//   - Place of supply (Gujarat / 24)
//   - Reverse charge: No
//   - Signature block
//
// TDS section: shows what the client is expected to deduct (income tax
// 194C @ 2% + GST TDS sec 51 @ 2% for govt clients). These are
// informational; legal liability for deduction sits with the deductor.
// =====================================================================

import { SHARED_CSS } from './shared/styles.js';
import {
  fmtInrPlain, esc,
  brandHeader, refStrip, signerBlock, htmlDocument,
} from './shared/helpers.js';

const RECEIPT_TYPE_LABEL = {
  ADVANCE:       { en: 'Advance Receipt',         gu: 'એડવાન્સ રસીદ' },
  PART_PAYMENT:  { en: 'Part-Payment Receipt',    gu: 'આંશિક ચુકવણી રસીદ' },
  FINAL_PAYMENT: { en: 'Final-Payment Receipt',   gu: 'અંતિમ ચુકવણી રસીદ' },
  FULL_PAYMENT:  { en: 'Full-Payment Receipt',    gu: 'સંપૂર્ણ ચુકવણી રસીદ' },
};

const PAYMENT_MODE_LABEL = {
  CASH:   'Cash',
  CHEQUE: 'Cheque',
  DRAFT:  'Demand Draft',
  NEFT:   'NEFT',
  RTGS:   'RTGS',
  UPI:    'UPI',
};

export function render(data) {
  const {
    brand, receipt, signer, copyKind = null,
    runningTotals = null,         // { gross, tds, net, expected, outstanding }
  } = data;

  const typeLabel = RECEIPT_TYPE_LABEL[receipt.receipt_type] || RECEIPT_TYPE_LABEL.ADVANCE;

  // Rule 50 / payment-detail rows
  const paymentDetailRows = [];
  paymentDetailRows.push(['Mode of Payment', esc(PAYMENT_MODE_LABEL[receipt.payment_mode] || receipt.payment_mode)]);
  if (receipt.cheque_or_ref_no) {
    paymentDetailRows.push(['Cheque / Reference No.', esc(receipt.cheque_or_ref_no)]);
  }
  if (receipt.cheque_date) {
    paymentDetailRows.push(['Cheque Date', esc(receipt.cheque_date)]);
  }
  if (receipt.bank_name) {
    paymentDetailRows.push(['Bank', esc(receipt.bank_name)]);
  }
  if (receipt.subject_to_realisation && (receipt.payment_mode === 'CHEQUE' || receipt.payment_mode === 'DRAFT')) {
    paymentDetailRows.push(['Note', '<em>Subject to realisation</em>']);
  }

  const paymentRowsHtml = paymentDetailRows.map(
    ([k, v]) => `<tr><td class="muted" style="width:35%">${k}</td><td>${v}</td></tr>`
  ).join('');

  const runningTotalsHtml = runningTotals ? /* html */ `
    <h3>Cumulative payment status (this proposal)</h3>
    <table class="totals" style="width:75%">
      <tr><td class="right muted">Proposal value (PO / quoted)</td>
          <td class="right">${fmtInrPlain(runningTotals.expected)}</td></tr>
      <tr><td class="right muted">Total gross received (incl. this receipt)</td>
          <td class="right">${fmtInrPlain(runningTotals.gross)}</td></tr>
      <tr><td class="right muted">Total TDS deducted by client</td>
          <td class="right">${fmtInrPlain(runningTotals.tds)}</td></tr>
      <tr><td class="right muted">Total net received in bank</td>
          <td class="right">${fmtInrPlain(runningTotals.net)}</td></tr>
      <tr class="grand"><td class="right">Outstanding balance</td>
          <td class="right">${fmtInrPlain(runningTotals.outstanding)}</td></tr>
    </table>
  ` : '';

  const externalRefHtml = receipt.external_tax_invoice_no ? /* html */ `
    <p class="tiny muted" style="margin-top:6pt">
      Cross-reference: This receipt voucher relates to Tax Invoice
      <strong>${esc(receipt.external_tax_invoice_no)}</strong>${
        receipt.external_tax_invoice_date ? ` dated <strong>${esc(receipt.external_tax_invoice_date)}</strong>` : ''
      } issued separately by the accounting team.
    </p>
  ` : `
    <p class="tiny muted" style="margin-top:6pt">
      Note: This is a Receipt Voucher under Rule 50 of the CGST Rules, 2017
      and is <strong>not a Tax Invoice</strong>. A Tax Invoice will be issued
      separately on completion of the supply.
    </p>
  `;

  const body = /* html */ `
    ${brandHeader(brand)}
    ${refStrip({ refNo: receipt.receipt_no, date: receipt.receipt_date, copyKind })}

    <div style="display:flex; justify-content:space-between; align-items:flex-end">
      <h1>Receipt Voucher</h1>
      <span class="stamp">${esc(typeLabel.en)}</span>
    </div>
    <p class="gu" style="font-size:11pt; color:var(--ink-mute)">
      રસીદ વાઉચર — ${esc(typeLabel.gu)}
    </p>

    <h2>Received from</h2>
    <div>
      <strong class="gu">${esc(receipt.client_name_gu_snapshot)}</strong><br>
      <strong>${esc(receipt.client_name_snapshot)}</strong>
      ${receipt.client_gst_snapshot ? `<br><span class="muted tiny">GSTIN: ${esc(receipt.client_gst_snapshot)}</span>` : ''}
    </div>

    <h2>Towards</h2>
    <p>
      <span class="muted">Proposal Ref:</span>
      <strong>${esc(receipt.proposal_ref_snapshot || '—')}</strong>
      ${receipt.proposal_subject_snapshot ? `<br><span class="muted">Subject:</span> ${esc(receipt.proposal_subject_snapshot)}` : ''}
    </p>

    <h2>Amount received</h2>
    <table class="totals" style="width:75%">
      <tr>
        <td class="right muted">Gross amount received</td>
        <td class="right">${fmtInrPlain(receipt.gross_amount)}</td>
      </tr>
      <tr>
        <td class="right muted">Less: TDS — Income Tax (sec 194C) @ ${esc(receipt.tds_income_percent)}%</td>
        <td class="right">− ${fmtInrPlain(receipt.tds_income_amount)}</td>
      </tr>
      <tr>
        <td class="right muted">Less: TDS — GST (sec 51) @ ${esc(receipt.tds_gst_percent)}%</td>
        <td class="right">− ${fmtInrPlain(receipt.tds_gst_amount)}</td>
      </tr>
      <tr class="grand">
        <td class="right">
          <span class="gu">નેટ રકમ બેંકમાં જમા</span> /
          Net amount credited to bank (₹)
        </td>
        <td class="right">${fmtInrPlain(receipt.net_received_amount)}</td>
      </tr>
    </table>

    <h2>Payment particulars</h2>
    <table>
      <tbody>${paymentRowsHtml}</tbody>
    </table>

    <h2>Tax classification (informational)</h2>
    <table>
      <tbody>
        <tr>
          <td class="muted" style="width:35%">HSN / SAC</td>
          <td><strong>${esc(receipt.hsn_sac_code || '998361')}</strong> — Advertising services</td>
        </tr>
        <tr>
          <td class="muted">Nominal GST rate</td>
          <td>${esc(receipt.gst_percent_applied)}% (CGST/SGST or IGST split as per place-of-supply, on Tax Invoice)</td>
        </tr>
        <tr>
          <td class="muted">Place of supply</td>
          <td>Gujarat (State Code 24)</td>
        </tr>
        <tr>
          <td class="muted">Reverse charge</td>
          <td>No</td>
        </tr>
      </tbody>
    </table>

    ${externalRefHtml}

    ${runningTotalsHtml}

    ${receipt.notes ? `
      <h3>Notes</h3>
      <p class="muted">${esc(receipt.notes)}</p>
    ` : ''}

    <div class="notice">
      <div class="gu" style="margin-bottom: 4pt">
        નોંધ: આ રસીદ વાઉચર છે, ટેક્સ ઈન્વૉઇસ નથી. કરના નિયમો અનુસાર TDS કપાત
        ગ્રાહક દ્વારા કરવામાં આવશે. કરપાત્ર બિલ અલગથી ઈશ્યૂ કરવામાં આવશે.
      </div>
      <div>
        Note: This is a Receipt Voucher (CGST Rule 50) acknowledging payment
        received. TDS deduction (where applicable) is the deductor's
        responsibility under Sec 194C of the Income Tax Act and Sec 51 of
        the CGST Act. A separate Tax Invoice for the underlying supply will
        be raised by the accounting team.
      </div>
    </div>

    ${signerBlock({ signer })}
  `;

  return htmlDocument({
    title: `Receipt ${receipt.receipt_no || ''} — ${receipt.client_name_snapshot}`,
    css: SHARED_CSS,
    body,
  });
}
