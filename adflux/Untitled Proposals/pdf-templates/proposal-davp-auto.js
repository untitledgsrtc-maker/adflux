// =====================================================================
// Proposal template: DAVP × AUTO (Auto Hood Advertising at govt rate)
//
// Key differences from agency-auto:
//   - DAVP rate is locked, sourced from "DAVP Approved Rate"
//   - Rate disclosure shows "as per DAVP norms"
//   - Per-rickshaw rate is highlighted as government-published
// =====================================================================

import { SHARED_CSS } from './shared/styles.js';
import {
  fmtInrPlain, fmtDateIn, esc,
  brandHeader, refStrip, clientBlock,
  signerBlock, totalsBlock, legalNotice, htmlDocument,
} from './shared/helpers.js';

export function render(data) {
  const {
    brand, proposal, client, contact, signer,
    lineItems, autoRate, copyKind = null,
  } = data;

  const lineRows = lineItems.map((li, i) => `
    <tr>
      <td class="right">${i + 1}</td>
      <td>
        <strong>${esc(li.location_name_snapshot)}</strong>
        ${li.location_name_gu_snapshot ? `<br><span class="gu muted">${esc(li.location_name_gu_snapshot)}</span>` : ''}
      </td>
      <td class="right">${esc(li.units)}</td>
      <td class="right">${li.duration_days} days</td>
      <td class="right">${fmtInrPlain(li.unit_rate_snapshot)}</td>
      <td class="right">${fmtInrPlain(li.line_subtotal)}</td>
    </tr>
  `).join('');

  const body = /* html */ `
    ${brandHeader(brand)}
    ${refStrip({ refNo: proposal.ref_no, date: proposal.proposal_date, copyKind })}

    <div class="row" style="display:flex; justify-content:space-between; align-items:flex-end">
      <h1>Proposal — Auto Hood Advertising</h1>
      <span class="davp-watermark">DAVP Approved Rate</span>
    </div>
    <p class="gu" style="font-size:11pt; color:var(--ink-mute)">પ્રપોઝલ — ઓટો રિક્ષા હૂડ જાહેરાત (DAVP દર)</p>

    ${clientBlock({ client, contact })}

    ${proposal.subject_en || proposal.subject_gu ? `
      <div class="subject">
        ${proposal.subject_gu ? `<div class="gu" style="margin-bottom:2pt"><strong>વિષય:</strong> ${esc(proposal.subject_gu)}</div>` : ''}
        ${proposal.subject_en ? `<div><strong>Subject:</strong> ${esc(proposal.subject_en)}</div>` : ''}
      </div>
    ` : ''}

    <h2>Rate basis</h2>
    <p class="muted">
      Rates below are quoted at the <strong>government-approved DAVP rate</strong>
      of <strong>${fmtInrPlain(autoRate.davp_per_rickshaw_rate)} per rickshaw</strong>
      for ${autoRate.campaign_duration_days} days, covering rear (${esc(autoRate.size_rear)}),
      left (${esc(autoRate.size_left)}) and right (${esc(autoRate.size_right)}) panels.
      Source: ${esc(autoRate.davp_source_reference || 'DAVP Approved Rate')}.
    </p>

    <h2>Line items</h2>
    <table>
      <thead>
        <tr>
          <th class="right">#</th>
          <th>District</th>
          <th class="right">Rickshaws</th>
          <th class="right">Duration</th>
          <th class="right">Rate (₹)</th>
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
