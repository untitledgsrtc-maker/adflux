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

  /* Build the per-media rate table HTML.
     Phase 11d (rev9) — GSRTC table moved to its own page (page 2),
     mirroring the Auto Hood district list pattern. The rate table for
     20 stations + GST + grand total is too tall to fit alongside the
     cover letter body, and inline rendering caused mid-row page splits
     (Bhachau showed half on page 1 / half on page 2). On page 1 we
     keep just a one-line summary referencing the table on page 2.
     For AUTO_HOOD the rate table stays inline (the 5-row package
     summary fits comfortably with the body copy). */
  const isGsrtc = mediaType === 'GSRTC_LED'
  const rateTableHtml = isGsrtc
    ? `<p style="margin:8px 0;color:#111;"><em>GSRTC માન્ય રેટ ટેબલ — વિગતવાર યાદી પાછળના પાને દર્શાવેલ છે.</em></p>`
    : renderAutoTable(data)
  const gsrtcStationPageHtml = isGsrtc ? renderGsrtcTable(data) : ''

  // Phase 11d (rev12) — compute letterhead URL FIRST so the signer
  // block (and other downstream code) can branch on whether
  // letterhead is on. Previously this was declared lower in the
  // function and reading it from the signer block hit a TDZ
  // ReferenceError → blank-screen crash on the proposal page.
  const letterhead = (data.use_letterhead === false)
    ? ''
    : (company?.letterhead_url || '')
  const letterheadOn = !!letterhead

  // When letterhead is ON, the printed footer of the letterhead PNG
  // already shows company name + phone + address. Slim signer block
  // mode skips the duplicate company line + mobile.
  const signerHtml = renderSignerBlock(signer, company, letterheadOn)

  // Phase 11d (rev15) — bidan moved OFF page 1 to keep cover letter
  // strictly within the letterhead's empty zone. It now lives at the
  // bottom of page 2 (with the district/station list). Owner spec:
  // "covering letter in 1 page A4 size, city or station in 2nd page".
  const page2BidanHtml = renderBidanBlock(mediaType, data.bidan_items)

  const vars = {
    recipient:        recipientHtml,
    date:             dateGu,
    quantity:         toGujaratiDigits(formatINREnglish(data.auto_total_quantity || 0)),
    districts_count:  toGujaratiDigits(String(data.line_items?.length || 0)),
    months:           toGujaratiDigits(String(data.gsrtc_campaign_months || 1)),
    selected_stations: toGujaratiDigits(String(data.line_items?.length || 0)),
    rate_table:       rateTableHtml,
    signer_block:     signerHtml,
    // Phase 11d (rev15) — bidan removed from cover letter, lives on
    // page 2 instead. Empty string keeps the placeholder substitution
    // working without rendering anything.
    bidan_block:      '',
  }

  const renderedBody = renderTemplate(template.body_html, vars)

  // Phase 11d — for AUTO_HOOD, render the per-district allotment list
  // on a SEPARATE A4 page (owner spec, 4 May 2026: "list of auto should
  // be in next page, different from cover letter"). The cover letter is
  // the first .govt-letter div; the district list is a second sibling
  // .govt-letter div. Each is min-height 1123px (one A4 page) via base
  // CSS, so the rasterizer in proposalPdf.js naturally pages them.
  const districtListHtml = mediaType === 'AUTO_HOOD'
    ? renderDistrictListPage(data)
    : ''

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
  // letterhead variable is declared higher up (right after the rate
  // table block) so the signer renderer can read it without TDZ.
  const letterStyle = letterhead
    ? {
        backgroundImage:    `url(${letterhead})`,
        backgroundRepeat:   'no-repeat',
        backgroundSize:     '100% 100%',
        backgroundPosition: 'top center',
        // Phase 11d (rev14) — sized to the actual letterhead empty
        // zone. Header logo bottom at y=170 (7.3% of 1123), printed
        // footer top at y=1023 (91.1%). Padding-top 170 hugs the
        // header. Padding-bottom 130 leaves 30px clean gap above
        // the printed footer. Content area = 1123 - 300 = 823px,
        // which fits the Phase 11d writeup with the bidan now
        // collapsed to a single line.
        paddingTop:    '170px',
        paddingRight:  '70px',
        paddingBottom: '130px',
        paddingLeft:   '70px',
      }
    : {
        // Phase 11d (rev13) — when letterhead is OFF, leave generous
        // top + bottom whitespace (140px / 130px) so the rep can
        // print on a pre-printed letterhead paper without the
        // content overrunning the printed header/footer of that
        // physical paper. Side margins also bumped for cleaner look
        // on a printed sheet. Owner spec: "without letterhead need
        // some space in header so we can print on letterhead paper."
        paddingTop:    '140px',
        paddingRight:  '70px',
        paddingBottom: '130px',
        paddingLeft:   '70px',
      }

  // Phase 11d (rev5) — zero out trailing margin and border on the
  // rasterized output. Default .govt-letter has margin: 0 auto 18px
  // and border: 1px solid — those add 36-40px past 2×1123 = 2246px,
  // which the rasterizer's A4 slicer turns into a near-blank page 3.
  // We override both inline so the captured canvas is EXACTLY a clean
  // multiple of the A4 page height. Border still shows on the live
  // preview because v2.css's container styling provides visual frame.
  const pageBaseStyle = { margin: 0, border: 'none', borderRadius: 0 }
  const coverStyle = { ...pageBaseStyle, ...(letterStyle || {}) }

  return (
    <>
      {/* Page 1 — cover letter */}
      <div className="govt-letter govt-letter--themed" style={coverStyle}>
        {/* Phase 11d (rev7) — સંદર્ભ ક્રમાંક (reference number) line.
            Owner spec docx includes "સંદર્ભ ક્રમાંક: UA/GOVT/2026/____
            તારીખ: ____/____/૨૦૨૬" at the very top. Since the date
            already lives on the right of the recipient block, we put
            the quote number on the left of that same line so both
            top-of-letter identifiers sit on one row. Falls back to
            ref_number if quote_number is missing (legacy proposals). */}
        {(data.quote_number || data.ref_number) && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: 11.5,
            color: '#444',
            marginBottom: 14,
            paddingBottom: 6,
            borderBottom: '1px dashed #999',
          }}>
            <span>
              <strong>સંદર્ભ ક્રમાંક:</strong> {data.quote_number || data.ref_number}
            </span>
            <span>
              <strong>તારીખ:</strong> {dateGu}
            </span>
          </div>
        )}
        {/* Phase 11d (rev9) — date removed from this header. The
            સંદર્ભ ક્રમાંક block above already shows date on the right.
            Owner reported "2 time date" — duplicate render. */}
        <div className="govt-letter__head">
          <div
            className="govt-letter__recipient"
            dangerouslySetInnerHTML={{ __html: recipientHtml }}
          />
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

      {/* Page 2+ — extra detail page.
          • AUTO_HOOD → district allotment list
          • GSRTC_LED → station rate table
          Rendered with NO letterhead background — standard govt-letter
          convention is letterhead on page 1 only, plain on subsequent
          pages. Same zero-margin/border override so it doesn't create
          a phantom page 3 in the rasterized output. Phase 11d (rev9)
          extends the page-2 pattern to GSRTC so the 20-station rate
          table no longer splits mid-row across A4 boundaries. */}
      {/* Phase 11d (rev15) — page 2 also carries the bidan footer
          since it was removed from page 1 to keep the cover letter
          inside the letterhead's empty zone. */}
      {districtListHtml && (
        <div
          className="govt-letter"
          style={pageBaseStyle}
          dangerouslySetInnerHTML={{ __html: districtListHtml + page2BidanHtml }}
        />
      )}
      {gsrtcStationPageHtml && (
        <div
          className="govt-letter"
          style={pageBaseStyle}
          dangerouslySetInnerHTML={{ __html: gsrtcStationPageHtml + page2BidanHtml }}
        />
      )}
    </>
  )
}

/* ── helpers ────────────────────────────────────────────────────── */

function renderSignerBlock(signer, company, letterheadOn = false) {
  if (!signer) return ''
  const name   = signer.name || ''
  const title  = signer.signature_title || ''
  const mobile = signer.signature_mobile ? `મો. ${signer.signature_mobile}` : ''
  const companyLine = (company?.name_gu || company?.short_name || company?.name || 'અનટાઇટલ્ડ એડવર્ટાઇઝિંગ')

  // Phase 11d (rev12) — when letterhead is ON, the printed footer of
  // the letterhead PNG already shows company name + phone + address.
  // Showing those again in the signer block creates duplicate ink and
  // crowds the bottom of the page. Letterhead-mode signer block:
  // just the courtesy + name + title. No company line, no mobile.
  if (letterheadOn) {
    return [
      '<div class="govt-letter__signer" style="text-align:right;margin-top:18px;">',
        'આપનો વિશ્વાસુ,<br/>',
        `${name}${title ? ` (${title})` : ''}`,
      '</div>',
    ].join('')
  }

  // Plain mode (no letterhead): include the full block since there's
  // no printed footer to provide the company info.
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
  // Renders ONLY the rate summary (5 rows). The per-district allotment
  // list lives on a separate A4 page — see renderDistrictListPage.
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
        <th class="num">CBC ભાવ</th>
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

/* Phase 11d — Bidan (enclosure list) block.
   Renders the standard "બિડાણ:" footer that closes a Gujarati govt
   letter. Items are media-type-specific (different attachments are
   relevant for AUTO_HOOD vs GSRTC_LED). Outputs raw HTML inserted via
   {{bidan_block}} placeholder; styling lives in govt.css if needed.
   Owner spec (4 May 2026 docx): bidan must appear at the END of every
   letter when generating PDF or printing. */
function renderBidanBlock(mediaType, dynamicItems) {
  // Phase 11d (rev14) — collapsed to single comma-separated line.
  // The previous 6-line numbered list pushed the cover letter past
  // 860px (the available content height when letterhead background
  // is on, which eats top + bottom space). The recipient's own copy
  // shows the actual attachments anyway; this line is a quick
  // index. Single-line format saves ~100px and prevents bidan from
  // colliding with the letterhead's printed footer.
  const fallback = mediaType === 'AUTO_HOOD'
    ? [
        'CBC (પૂર્વે DAVP) મંજૂર દરપત્રકની નકલ',
        'જિલ્લાવાર ઓટો રિક્ષાઓની યાદી',
        'કંપની પ્રોફાઇલ',
      ]
    : [
        'GSRTC ભાવ-પત્રકની નકલ',
        'ભાવ-દરખાસ્તની નકલ',
        '૨૦ બસ ડેપો યાદી',
      ]

  const items = (Array.isArray(dynamicItems) && dynamicItems.length > 0)
    ? dynamicItems
    : fallback

  return [
    '<p style="margin:10px 0 0;font-size:11.5px;line-height:1.5;">',
      '<strong>બિડાણ:</strong> ',
      items.join(', '),
    '</p>',
  ].join('')
}

/* Phase 11d — district allotment list page (Auto Hood only).
   Returns a complete `.govt-letter` div containing the per-district
   table. Rendered as a SECOND A4 page after the cover letter.
   Empty when line_items is empty (won't render the second page).

   Data shape note — line_items has been through several rewrites; we
   accept any of these field names so the renderer works for both:
     • saved quotes from quote_cities  (description, qty)
     • normalized live quotes          (description, allocated_qty)
     • raw wizard preview              (district_name_gu/en, allocated_qty)
*/
function renderDistrictListPage(data) {
  // Phase 11d (rev 3) — compact table sized to fit 33 districts on a
  // single A4 page.
  //   Math: page height 1123px @ 96dpi, with 56px top+bottom padding
  //   on the host .govt-letter, content area = 1011px.
  //   Heading + thead + tfoot ~ 110px, leaves 901px for 33 rows = 27px
  //   each. We use 19px rows (4px vertical padding × 11.5px font ×
  //   1.3 line-height) so the table comfortably fits with margin to
  //   spare. Centered, max-width 540 for printed look.
  const items = Array.isArray(data.line_items) ? data.line_items : []
  if (items.length === 0) return ''

  const totalQty = Number(data.auto_total_quantity || 0)
  // Phase 11d (rev7) — bumped from 4px/11.5px/1.35 to 5px/12px/1.4
  // because Gujarati script has tall ascenders ("ફ", "ભ", "મ") and
  // long descenders ("્") that were colliding between rows at 19px
  // total height. New row height: 5+5+12*1.4 = ~27px × 33 rows = 891px,
  // fits the 1011px content area with 80px to spare for heading/total.
  // Explicit color:#111 on EVERY cell (cascade was getting overridden
  // by dark-theme variables in the rasterized output).
  const cellStyle = 'padding:5px 10px;font-size:12px;line-height:1.4;border:1px solid #444;color:#111;background:#fff;'
  const headStyle = cellStyle + 'background:#f5f5f5;font-weight:700;'

  const rowsHtml = items.map((it, i) => {
    // Phase 11d (rev6) — Gujarati FIRST. The wizard saves English
    // names into description/city_name, but the parent loader (govt
    // detail page useEffect) joins auto_districts and surfaces
    // district_name_gu. Owner spec: "AUTO LIST IN GUJRATI NOT
    // ENGLISH". Fall back to English forms only if no Gujarati is
    // available (e.g., a custom district that's not in the master).
    const name =
      it.district_name_gu ||
      it.district_name ||
      it.description ||
      it.city_name ||
      it.district_name_en ||
      '—'
    const qty = Number(it.allocated_qty ?? it.qty ?? it.quantity ?? 0)
    return `
      <tr>
        <td style="${cellStyle}text-align:center;">${toGujaratiDigits(String(i + 1))}</td>
        <td style="${cellStyle}">${name}</td>
        <td style="${cellStyle}text-align:right;">${toGujaratiDigits(formatINREnglish(qty))}</td>
      </tr>`
  }).join('')

  return `
  <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;text-align:center;color:#111;">
    *ગુજરાત – ઓટો રિક્ષા જિલ્લા પ્રમાણેનું લિસ્ટ*
  </h2>
  <table style="border-collapse:collapse;width:100%;max-width:540px;margin:0 auto;background:#fff;color:#111;">
    <thead>
      <tr>
        <th style="${headStyle}width:50px;text-align:center;">ક્રમ</th>
        <th style="${headStyle}text-align:left;">જિલ્લો</th>
        <th style="${headStyle}width:140px;text-align:right;">ઓટો રિક્ષાની સંખ્યા</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr>
        <td colspan="2" style="${cellStyle}font-weight:700;">કુલ</td>
        <td style="${cellStyle}font-weight:700;text-align:right;">${toGujaratiDigits(formatINREnglish(totalQty))}</td>
      </tr>
    </tbody>
  </table>`
}

// Phase 11d (rev8) — decimal-preserving formatter for the rate
// column. The previous code used formatINREnglish which calls
// .toFixed(0) → 2.75 became "3" for every row, making all stations
// look identical. This formatter keeps up to 2 decimals when the
// number isn't a whole rupee, drops them when it is.
function formatRateGu(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '૦'
  // Whole numbers print without decimals (3 not 3.00).
  // Fractional rates print with 2 decimals (2.75, 2.50).
  const out = (num % 1 === 0) ? String(Math.round(num)) : num.toFixed(2)
  return toGujaratiDigits(out)
}

function renderGsrtcTable(data) {
  const months = Number(data.gsrtc_campaign_months || 1)
  const items  = data.line_items || []
  let subtotal = 0
  let totalScreens = 0
  let totalDaily   = 0
  let totalMonthly = 0

  // Phase 11d (rev8) — explicit cell styling so the table renders
  // cleanly in the rasterized PDF (the .govt-letter__table CSS
  // sometimes loses through the cascade in the off-screen capture
  // wrapper). Compact font + tight padding so 11 columns fit A4 width.
  const cellStyle = 'padding:5px 6px;font-size:10.5px;line-height:1.35;border:1px solid #444;color:#111;background:#fff;vertical-align:middle;'
  const headStyle = cellStyle + 'background:#f5f5f5;font-weight:700;text-align:center;'
  const numCell   = cellStyle + 'text-align:right;font-variant-numeric:tabular-nums;'

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
        <td style="${cellStyle}text-align:center;">${toGujaratiDigits(String(i + 1))}</td>
        <td style="${cellStyle}">${it.description || ''}</td>
        <td style="${cellStyle}text-align:center;">${it.category || ''}</td>
        <td style="${numCell}">${toGujaratiDigits(String(screens))}</td>
        <td style="${numCell}">${toGujaratiDigits(String(daily))}</td>
        <td style="${numCell}">${toGujaratiDigits(String(dur))} સે.</td>
        <td style="${numCell}">${toGujaratiDigits(String(daily * days))}</td>
        <td style="${numCell}">${toGujaratiDigits(String(days))}</td>
        <td style="${numCell}">${formatRateGu(rate)}</td>
        <td style="${numCell}">${toGujaratiDigits(formatINREnglish(monthly))}</td>
        <td style="${numCell}">${toGujaratiDigits(formatINREnglish(lineTotal))}</td>
      </tr>`
  }).join('')

  const gst   = Math.round(subtotal * GST_PCT / 100)
  const total = subtotal + gst

  return `
  <p style="margin:8px 0 4px;color:#111;font-size:12px;">
    <em>GSRTC માન્ય રેટ ટેબલ — ${toGujaratiDigits(String(months))} માસ માટે કેમ્પેઇન</em>
  </p>
  <table style="border-collapse:collapse;width:100%;background:#fff;color:#111;table-layout:fixed;">
    <thead>
      <tr>
        <th style="${headStyle}width:32px;">ક્રમ</th>
        <th style="${headStyle}text-align:left;">બસ સ્ટેશન</th>
        <th style="${headStyle}width:42px;">કેટ.</th>
        <th style="${headStyle}width:46px;">સ્ક્રીન</th>
        <th style="${headStyle}width:42px;">દૈનિક</th>
        <th style="${headStyle}width:54px;">સ્પોટ ડ્યુ.</th>
        <th style="${headStyle}width:60px;">માસિક સ્પોટ</th>
        <th style="${headStyle}width:42px;">દિવસો</th>
        <th style="${headStyle}width:60px;">દર/સ્લોટ</th>
        <th style="${headStyle}width:74px;">માસિક કુલ</th>
        <th style="${headStyle}width:80px;">${toGujaratiDigits(String(months))} માસ કુલ</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr>
        <td colspan="3" style="${cellStyle}font-weight:700;text-align:right;">કુલ</td>
        <td style="${numCell}font-weight:700;">${toGujaratiDigits(String(totalScreens))}</td>
        <td style="${numCell}">${toGujaratiDigits(String(totalDaily))}</td>
        <td style="${cellStyle}"></td>
        <td style="${numCell}">${toGujaratiDigits(String(totalMonthly))}</td>
        <td colspan="3" style="${cellStyle}"></td>
        <td style="${numCell}font-weight:700;">${toGujaratiDigits(formatINREnglish(subtotal))}</td>
      </tr>
      <tr>
        <td colspan="10" style="${cellStyle}text-align:right;">GST 18%</td>
        <td style="${numCell}">${toGujaratiDigits(formatINREnglish(gst))}</td>
      </tr>
      <tr>
        <td colspan="10" style="${cellStyle}font-weight:700;text-align:right;">ગ્રાન્ડ ટોટલ</td>
        <td style="${numCell}font-weight:700;">${toGujaratiDigits(formatINREnglish(total))}</td>
      </tr>
    </tbody>
  </table>`
}
