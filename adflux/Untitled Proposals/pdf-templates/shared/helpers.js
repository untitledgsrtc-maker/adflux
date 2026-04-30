// =====================================================================
// PDF template helpers — formatting + small partials shared across
// every template. Pure functions. ESM only (the API is ESM too).
// =====================================================================

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const INR_PLAIN = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export const fmtInr      = (n) => (n == null ? '—' : INR.format(Number(n)));
export const fmtInrPlain = (n) => (n == null ? '—' : INR_PLAIN.format(Number(n)));

export function fmtDateIn(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = date.getFullYear();
  return `${dd}-${mm}-${yy}`;
}

/** Escape user-controlled strings so they can't break out of HTML. */
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render brand header (top of every doc). */
export function brandHeader({ brandName, brandNameGu, gstin, pan, hsn }) {
  return /* html */ `
    <div class="brand">
      <div>
        <div class="brand__name">${esc(brandName)}</div>
        <div class="brand__name-gu gu">${esc(brandNameGu)}</div>
      </div>
      <div class="brand__meta">
        Vadodara · Gandhinagar, Gujarat · India<br>
        GSTIN: <strong>${esc(gstin)}</strong> · PAN: <strong>${esc(pan)}</strong><br>
        HSN/SAC: <strong>${esc(hsn)}</strong> (advertising services)<br>
        E-mail: untitledadvertising@gmail.com
      </div>
    </div>
  `;
}

/** Render the ref/date/copy strip beneath the brand header. */
export function refStrip({ refNo, date, copyKind }) {
  const stamp = copyKind ? `<span class="stamp">${esc(copyKind)}</span>` : '';
  return /* html */ `
    <div class="refstrip">
      <div>Ref: <strong>${esc(refNo || '(draft)')}</strong></div>
      <div>${stamp}</div>
      <div>Date: <strong>${fmtDateIn(date)}</strong></div>
    </div>
  `;
}

/** Render the To: client block. */
export function clientBlock({ client, contact }) {
  const contactLine = contact?.name_en
    ? `<br><span class="muted">Kind attention:</span> ${esc(contact.salutation || '')} ${esc(contact.name_en)} <span class="gu">(${esc(contact.name_gu || '')})</span>${
        contact.designation_en ? `, <span class="muted">${esc(contact.designation_en)}</span>` : ''
      }`
    : '';
  const dept = client.department_en
    ? `<br><span class="gu">${esc(client.department_gu || '')}</span><br>${esc(client.department_en)}`
    : '';
  const addr = client.address_en
    ? `<br><span class="muted">${esc(client.address_en)}${client.city ? ', ' + esc(client.city) : ''}${client.pincode ? ' - ' + esc(client.pincode) : ''}</span>`
    : '';
  const gst = client.gst_number
    ? `<br><span class="muted tiny">GSTIN: ${esc(client.gst_number)}</span>`
    : '';

  return /* html */ `
    <div style="margin-top: 6pt">
      <strong>To,</strong><br>
      <strong class="gu">${esc(client.name_gu)}</strong><br>
      <strong>${esc(client.name_en)}</strong>
      ${dept}${addr}${gst}${contactLine}
    </div>
  `;
}

/** Render the signer block. */
export function signerBlock({ signer }) {
  return /* html */ `
    <div class="signer">
      <div>
        <strong class="gu">આપનો વિશ્વાસુ,</strong><br>
        <small>Yours faithfully,</small>
        <div style="height: 36pt"></div>
        <strong class="gu">${esc(signer.name_gu)}</strong><br>
        <strong>${esc(signer.name_en)}</strong><br>
        <span class="gu muted">${esc(signer.designation_gu || '')}</span> /
        <span class="muted">${esc(signer.designation_en || '')}</span>
        ${signer.mobile ? `<br><small>Mob: ${esc(signer.mobile)}</small>` : ''}
      </div>
      <div style="text-align:right">
        <small class="muted">For office use only</small>
        <div style="height: 36pt"></div>
        <small>Stamp &amp; Signature</small>
      </div>
    </div>
  `;
}

/** Render totals table for a proposal. */
export function totalsBlock({ subtotal, discountAmount, gstPercent, gstAmount, totalAmount }) {
  const discountRow = discountAmount > 0
    ? `<tr><td class="right muted">Discount</td><td class="right">− ${fmtInrPlain(discountAmount)}</td></tr>`
    : '';
  return /* html */ `
    <table class="totals">
      <tr><td class="right muted">Subtotal</td><td class="right">${fmtInrPlain(subtotal)}</td></tr>
      ${discountRow}
      <tr><td class="right muted">GST @ ${esc(gstPercent)}%</td><td class="right">${fmtInrPlain(gstAmount)}</td></tr>
      <tr class="grand"><td class="right"><span class="gu">કુલ રકમ</span> / Total Amount (₹)</td><td class="right">${fmtInrPlain(totalAmount)}</td></tr>
    </table>
  `;
}

/** Render the legal/payment notice strip at the bottom. */
export function legalNotice({ validityDays = 90 } = {}) {
  return /* html */ `
    <div class="notice">
      <div class="gu" style="margin-bottom: 4pt">
        નોંધ: આ દસ્તાવેજ ${validityDays} દિવસ માટે માન્ય છે. ચુકવણી DD / NEFT / RTGS / UPI દ્વારા
        સ્વીકારવામાં આવશે. કરના નિયમો અનુસાર TDS @ ૨% (આવકવેરા, કલમ ૧૯૪C) અને ૨% (GST, કલમ ૫૧)
        કાપવાનો છે.
      </div>
      <div>
        Note: This document is valid for ${validityDays} days. Payments accepted via DD / NEFT / RTGS / UPI.
        TDS @ 2% (Income Tax sec 194C) and 2% (GST sec 51) is applicable as per law.
        HSN/SAC 998361 (advertising services).
      </div>
    </div>
  `;
}

/** Wrap a body in the boilerplate <html><head><style>…shared CSS…</style>… */
export function htmlDocument({ title, css, body }) {
  return /* html */ `<!DOCTYPE html>
<html lang="gu">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}
