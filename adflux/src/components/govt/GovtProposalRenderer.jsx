// src/components/govt/GovtProposalRenderer.jsx
//
// Renders a Government proposal as a printable Gujarati letter.
// Used by both:
//   - the wizard's Step 5 (live preview while creating)
//   - the GovtProposalDetailV2 page (read-only view of saved proposal)
//
// Inputs:
//   template          : row from proposal_templates (has subject_line +
//                       body_html with {{placeholders}})
//   data              : { recipient_block, date, quantity, months,
//                          line_items, signer, etc. }
//   media_type        : 'AUTO_HOOD' | 'GSRTC_LED' — chooses which
//                       extra placeholders + which rate table format
//
// We render in HTML (not PDF) and rely on browser print + CSS @media
// print rules in govt.css to produce a print/PDF copy. True
// server-rendered PDFs are a follow-up sprint.

import {
  formatINREnglish,
  formatINRGujarati,
  toGujaratiDigits,
  formatDateGujarati,
} from '../../utils/gujaratiNumber'
import { renderTemplate } from '../../utils/renderTemplate'

const GST_PCT = 18

export function GovtProposalRenderer({
  template,
  data,
  signer,
  mediaType,
}) {
  if (!template) {
    return (
      <div className="govt-letter">
        <em>No template found for this segment + media. Seed proposal_templates first.</em>
      </div>
    )
  }

  const recipientHtml = (data.recipient_block || '')
    .split('\n').map(l => l.trim()).filter(Boolean).join('<br/>')

  const dateGu = formatDateGujarati(data.proposal_date || new Date())

  /* Build the per-media rate table HTML inline (the seeded body_html
     contains {{rate_table}} as a single-line placeholder so we can
     swap it cleanly). */
  const rateTableHtml = mediaType === 'AUTO_HOOD'
    ? renderAutoTable(data)
    : renderGsrtcTable(data)

  const signerHtml = renderSignerBlock(signer)

  const vars = {
    recipient:        recipientHtml,
    date:             dateGu,
    quantity:         toGujaratiDigits(formatINREnglish(data.auto_total_quantity || 0)),
    districts_count:  toGujaratiDigits(String(data.line_items?.length || 0)),
    months:           toGujaratiDigits(String(data.gsrtc_campaign_months || 1)),
    selected_stations: toGujaratiDigits(String(data.line_items?.length || 0)),
    rate_table:       rateTableHtml,
    signer_block:     signerHtml,
  }

  const renderedBody = renderTemplate(template.body_html, vars)

  return (
    <div className="govt-letter">
      {/* Top header — recipient block (top-left) and date (top-right) */}
      <div className="govt-letter__head">
        <div
          className="govt-letter__recipient"
          dangerouslySetInnerHTML={{ __html: recipientHtml }}
        />
        <div className="govt-letter__date">{dateGu}</div>
      </div>

      <div
        className="govt-letter__subject"
        dangerouslySetInnerHTML={{ __html: 'વિષય: ' + template.subject_line }}
      />

      <div
        className="govt-letter__body"
        dangerouslySetInnerHTML={{ __html: renderedBody }}
      />
    </div>
  )
}

/* ── helpers ────────────────────────────────────────────────────── */

function renderSignerBlock(signer) {
  if (!signer) return ''
  const name   = signer.name || ''
  const title  = signer.signature_title || ''
  const mobile = signer.signature_mobile ? `મો. ${signer.signature_mobile}` : ''
  // Right-aligned per standard Indian government letter format
  // (owner spec, 1 May 2026). Inline style ensures the alignment
  // also applies in the rasterized PDF where the .govt-letter__signer
  // class might not be loaded with the same overrides.
  return [
    '<div class="govt-letter__signer" style="text-align:right;">',
      'આપનો વિશ્વાસુ,<br/>',
      `${name}${title ? ` (${title})` : ''}<br/>`,
      'અનટાઇટલ્ડ એડવર્ટાઇઝિંગ',
    mobile ? `<br/>${mobile}` : '',
    '</div>',
  ].join('')
}

function renderAutoTable(data) {
  const qty = Number(data.auto_total_quantity || 0)
  const rate = Number(data.unit_rate ?? 825)
  const subtotal = qty * rate
  const gst      = Math.round(subtotal * GST_PCT / 100)
  const total    = subtotal + gst

  const rowQty   = toGujaratiDigits(formatINREnglish(qty))
  const rowRate  = toGujaratiDigits(formatINREnglish(rate)) + '/-'
  const rowSub   = toGujaratiDigits(formatINREnglish(subtotal)) + '/-'
  const rowGst   = toGujaratiDigits(formatINREnglish(gst)) + '/-'
  const rowTotal = toGujaratiDigits(formatINREnglish(total)) + '/-'

  return `
  <table class="govt-letter__table">
    <thead>
      <tr>
        <th>વિગત</th>
        <th>સાઇઝ</th>
        <th class="num">ઓટો રિક્ષાની સંખ્યા</th>
        <th class="num">DAVP ભાવ</th>
        <th class="num">કુલ રકમ</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>રિક્ષાની પાછળની બાજુ</td><td>4' × 3'</td><td class="num" rowspan="3">${rowQty}</td><td class="num" rowspan="3">${rowRate}</td><td class="num" rowspan="3">${rowSub}</td></tr>
      <tr><td>રિક્ષાની ડાબી બાજુ</td><td>2' × 2'</td></tr>
      <tr><td>રિક્ષાની જમણી બાજુ</td><td>2' × 2'</td></tr>
      <tr><td colspan="4">GST 18%</td><td class="num">${rowGst}</td></tr>
      <tr><td colspan="4"><strong>કુલ રકમ</strong></td><td class="num"><strong>${rowTotal}</strong></td></tr>
    </tbody>
  </table>`
}

function renderGsrtcTable(data) {
  const months = Number(data.gsrtc_campaign_months || 1)
  const items  = data.line_items || []
  let subtotal = 0
  let totalScreens = 0
  let totalDaily   = 0
  let totalMonthly = 0

  const rowsHtml = items.map((it, i) => {
    // Use per-row values if set; fall back to defaults
    const daily   = Number(it.daily_spots ?? 100)
    const days    = Number(it.days ?? 30)
    const dur     = Number(it.spot_duration_sec ?? 10)
    const screens = Number(it.screens || 0)
    const rate    = Number(it.unit_rate || 0)
    const monthly = screens * daily * days * rate
    const lineTotal = monthly * months
    subtotal     += lineTotal
    totalScreens += screens
    totalDaily   += daily * screens
    totalMonthly += daily * days * screens
    return `
      <tr>
        <td class="num">${toGujaratiDigits(String(i + 1))}</td>
        <td>${it.description || ''}</td>
        <td>${it.category || ''}</td>
        <td class="num">${toGujaratiDigits(String(screens))}</td>
        <td class="num">${toGujaratiDigits(String(daily))}</td>
        <td class="num">${toGujaratiDigits(String(dur))} સે.</td>
        <td class="num">${toGujaratiDigits(String(daily * days))}</td>
        <td class="num">${toGujaratiDigits(String(days))}</td>
        <td class="num">${toGujaratiDigits(formatINREnglish(rate))}</td>
        <td class="num">${toGujaratiDigits(formatINREnglish(monthly))}</td>
        <td class="num">${toGujaratiDigits(formatINREnglish(lineTotal))}</td>
      </tr>`
  }).join('')

  const gst   = Math.round(subtotal * GST_PCT / 100)
  const total = subtotal + gst

  return `
  <p style="margin-top:8px;color:#111;">
    <em>GSRTC માન્ય રેટ ટેબલ — ${toGujaratiDigits(String(months))} માસ માટે કેમ્પેઇન</em>
  </p>
  <table class="govt-letter__table">
    <thead>
      <tr>
        <th>ક્રમ</th>
        <th>બસ સ્ટેશન</th>
        <th>કેટેગરી</th>
        <th class="num">સ્ક્રીન્સ</th>
        <th class="num">દૈનિક</th>
        <th class="num">ડ્યુ.</th>
        <th class="num">માસિક સ્પોટ્સ</th>
        <th class="num">દિવસો</th>
        <th class="num">દર/સ્લોટ</th>
        <th class="num">માસિક કુલ</th>
        <th class="num">${toGujaratiDigits(String(months))} માસ કુલ</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr><td colspan="3"><strong>કુલ</strong></td><td class="num"><strong>${toGujaratiDigits(String(totalScreens))}</strong></td><td class="num">${toGujaratiDigits(String(totalDaily))}</td><td></td><td class="num">${toGujaratiDigits(String(totalMonthly))}</td><td colspan="3"></td><td class="num"><strong>${toGujaratiDigits(formatINREnglish(subtotal))}</strong></td></tr>
      <tr><td colspan="10">GST 18%</td><td class="num">${toGujaratiDigits(formatINREnglish(gst))}</td></tr>
      <tr><td colspan="10"><strong>ગ્રાન્ડ ટોટલ</strong></td><td class="num"><strong>${toGujaratiDigits(formatINREnglish(total))}</strong></td></tr>
    </tbody>
  </table>`
}
