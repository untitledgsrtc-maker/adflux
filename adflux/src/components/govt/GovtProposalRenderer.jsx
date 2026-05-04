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
  company,    // Phase 10 — companies row for this segment. When null,
              // falls back to the previously hardcoded "અનટાઇટલ્ડ
              // એડવર્ટાઇઝિંગ" so existing rendered proposals still
              // look correct if the table isn't seeded yet.
}) {
  if (!template) {
    return (
      <div className="govt-letter">
        <em>No template found for this segment + media. Seed proposal_templates first.</em>
      </div>
    )
  }

  // Phase 11 — guard against company / quote segment mismatch.
  // A quote with segment=GOVERNMENT must render with the GOVERNMENT
  // company row (Untitled Advertising). If somehow the wrong row is
  // passed (e.g. cache bug, code refactor mistake), fail visibly here
  // rather than producing a printed letter with the wrong legal
  // entity's name and GSTIN. The renderer doesn't know the quote's
  // segment directly, but the template carries it on its record so
  // we can compare.
  if (company && template.segment && company.segment && company.segment !== template.segment) {
    return (
      <div className="govt-letter" style={{ minHeight: 'auto' }}>
        <strong style={{ color: '#b00020' }}>
          Render blocked — segment mismatch.
        </strong>
        <p style={{ marginTop: 8 }}>
          Template segment is <code>{template.segment}</code> but the company
          row passed in is <code>{company.segment}</code>. Refusing to render
          a proposal letter with the wrong legal entity. Reload the page; if
          this persists, the companies table seed is corrupt.
        </p>
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

  const signerHtml = renderSignerBlock(signer, company)

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

  // Phase 10b — letterhead background.
  //   When companies.letterhead_url is set we render the letter on top
  //   of the rasterized letterhead PNG (logo at top, footer text at
  //   bottom) so the printed/uploaded PDF matches the physical
  //   letterhead the business uses on paper. The base .govt-letter CSS
  //   already locks the container to A4 portrait (794×1123 @ 96dpi)
  //   via Phase 10c, so background-size:100% 100% always lines up.
  //
  //   Padding compensates for the empty zones in the PNGs so letter
  //   content never overlaps the printed header/footer:
  //     · government.png — empty zone is 7.3% – 91.1%  (top ~82px, bottom ~100px @ 1123px)
  //     · private.png    — empty zone is 8.9% – 93.5%  (top ~100px, bottom ~73px @ 1123px)
  //   Using 130px top + 130px bottom gives a small visual safety margin
  //   so a slightly long letter doesn't kiss the printed footer.
  const letterhead = company?.letterhead_url || ''
  const letterStyle = letterhead
    ? {
        backgroundImage:    `url(${letterhead})`,
        backgroundRepeat:   'no-repeat',
        backgroundSize:     '100% 100%',
        backgroundPosition: 'top center',
        paddingTop:    '130px',
        paddingRight:  '64px',
        paddingBottom: '130px',
        paddingLeft:   '64px',
      }
    : undefined

  return (
    <div className="govt-letter govt-letter--themed" style={letterStyle}>
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

function renderSignerBlock(signer, company) {
  if (!signer) return ''
  const name   = signer.name || ''
  const title  = signer.signature_title || ''
  const mobile = signer.signature_mobile ? `મો. ${signer.signature_mobile}` : ''
  // Phase 10 — pull the company line from companies table when
  // available; fall back to the legacy hardcoded Gujarati name so the
  // rendered output is identical if the companies table isn't seeded
  // yet (graceful degrade for environments where the migration hasn't
  // landed).
  const companyLine = (company?.name_gu || company?.short_name || company?.name || 'અનટાઇટલ્ડ એડવર્ટાઇઝિંગ')
  // Right-aligned per standard Indian government letter format
  // (owner spec, 1 May 2026). Inline style ensures the alignment
  // also applies in the rasterized PDF where the .govt-letter__signer
  // class might not be loaded with the same overrides.
  return [
    '<div class="govt-letter__signer" style="text-align:right;">',
      'આપનો વિશ્વાસુ,<br/>',
      `${name}${title ? ` (${title})` : ''}<br/>`,
      companyLine,
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
