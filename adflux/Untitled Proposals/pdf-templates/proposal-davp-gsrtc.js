// =====================================================================
// Proposal template: DAVP × GSRTC (LED screens at govt rate)
//
// GSRTC differs from auto in that:
//   - Pricing is per 10-second slot, sold by monthly_spots × months
//   - Each station has a category (A/B/C) that drives the slot rate
//   - We disclose both per-slot rate and total spots so the client
//     understands the math
// =====================================================================

import { SHARED_CSS } from './shared/styles.js';
import {
  fmtInrPlain, esc,
  brandHeader, refStrip, clientBlock,
  signerBlock, totalsBlock, legalNotice, htmlDocument,
} from './shared/helpers.js';

export function render(data) {
  const {
    brand, proposal, client, contact, signer,
    lineItems, copyKind = null,
  } = data;

  const lineRows = lineItems.map((li, i) => {
    const meta = li.meta_snapshot || {};
    return /* html */ `
      <tr>
        <td class="right">${i + 1}</td>
        <td>
          <strong>${esc(li.location_name_snapshot)}</strong>
          ${meta.category ? ` <span class="muted tiny">(Cat ${esc(meta.category)})</span>` : ''}
          ${li.location_name_gu_snapshot ? `<br><span class="gu muted">${esc(li.location_name_gu_snapshot)}</span>` : ''}
          ${meta.screens_count ? `<br><small>${esc(meta.screens_count)} screens · ${esc(meta.monthly_spots || '—')} spots/mo</small>` : ''}
        </td>
        <td class="right">${esc(li.units)}</td>
        <td class="right">${li.duration_days} days</td>
        <td class="right">${fmtInrPlain(li.unit_rate_snapshot)}</td>
        <td class="right">${fmtInrPlain(li.line_subtotal)}</td>
      </tr>
    `;
  }).join('');

  const body = /* html */ `
    ${brandHeader(brand)}
    ${refStrip({ refNo: proposal.ref_no, date: proposal.proposal_date, copyKind })}

    <div style="display:flex; justify-content:space-between; align-items:flex-end">
      <h1>Proposal — GSRTC LED Screen Advertising</h1>
      <span class="davp-watermark">DAVP Approved Rate</span>
    </div>
    <p class="gu" style="font-size:11pt; color:var(--ink-mute)">પ્રપોઝલ — GSRTC LED સ્ક્રીન જાહેરાત (DAVP દર)</p>

    ${clientBlock({ client, contact })}

    ${proposal.subject_en || proposal.subject_gu ? `
      <div class="subject">
        ${proposal.subject_gu ? `<div class="gu" style="margin-bottom:2pt"><strong>વિષય:</strong> ${esc(proposal.subject_gu)}</div>` : ''}
        ${proposal.subject_en ? `<div><strong>Subject:</strong> ${esc(proposal.subject_en)}</div>` : ''}
      </div>
    ` : ''}

    <h2>Rate basis</h2>
    <p class="muted">
      LED screen advertising at GSRTC bus stations across Gujarat, billed per
      <strong>10-second slot</strong> at the government-approved DAVP rate.
      Category A: ₹3.00/slot · Category B: ₹2.75/slot · Category C: ₹2.50/slot.
      Each unit below = total slots over the campaign duration.
    </p>

    <h2>Line items</h2>
    <table>
      <thead>
        <tr>
          <th class="right">#</th>
          <th>Station</th>
          <th class="right">Slots</th>
          <th class="right">Duration</th>
          <th class="right">Rate/slot (₹)</th>
          <th class="right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    ${totalsBlock(proposal)}

    ${legalNotice({ validityDays: 90 })}

    ${signerBlock({ signer })}
  `;

  return htmlDocument({
    title: `Proposal ${proposal.ref_no || ''} — ${client.name_en}`,
    css: SHARED_CSS,
    body,
  });
}
