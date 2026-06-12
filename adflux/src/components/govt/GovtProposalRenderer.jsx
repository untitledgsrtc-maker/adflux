// src/components/govt/GovtProposalRenderer.jsx
//
// Renders a Government proposal as a printable letter.
// Used by both:
//   - the wizard's Step 5 (live preview while creating)
//   - the GovtProposalDetailV2 page (read-only view of saved proposal)
//
// Inputs:
//   template          : row from proposal_templates (has subject_line +
//                       body_html with {{placeholders}} + a `language`
//                       field — 'gu' (default) or 'en')
//   data              : { recipient_block, date, quantity, months,
//                          line_items, signer, etc. }
//   media_type        : 'AUTO_HOOD' | 'GSRTC_LED' — chooses which
//                       extra placeholders + which rate table format
//
// Phase 140 (2026-06-12) — LANGUAGE SWITCH. The letter was Gujarati-only:
// every label, table header, the digits, and the date were hardcoded
// Gujarati. Owner wants the same 2 govt media in English too (default
// stays Gujarati). We thread a `lang` derived from template.language
// through the whole renderer. When lang==='gu' the output is BYTE-
// IDENTICAL to before (every gu branch is the original literal); when
// 'en' the labels come from the STR table, digits stay English, and the
// date prints DD/MM/YYYY. The body + subject themselves come from the
// language-matched proposal_templates row (Phase 140 SQL seeds the en row).
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

// Phase 140 — per-language label table. gu values are the original
// hardcoded literals (unchanged); en is the parallel English copy. The
// owner-supplied English letters (Auto 2.docx / Gsrtc 2.docx) drive the
// body + subject via the en proposal_templates row; THIS table covers
// the structural labels the renderer itself produces.
const STR = {
  gu: {
    to:              'પ્રતિ,',
    subjectPrefix:   'વિષય: ',
    refLabel:        'સંદર્ભ ક્રમાંક:',
    dateLabel:       'તારીખ:',
    yoursFaithfully: 'આપનો વિશ્વાસુ,',
    mob:             'મો.',
    enclosure:       'બિડાણ:',
    autoHead:        ['વિગત', 'સાઇઝ', 'ઓટો રિક્ષાની સંખ્યા', 'CBC ભાવ (દર મહિને)', 'મહિના', 'કુલ રકમ'],
    autoRows:        ['રિક્ષાની પાછળની બાજુ', 'રિક્ષાની ડાબી બાજુ', 'રિક્ષાની જમણી બાજુ'],
    gst:             'GST 18%',
    totalAmount:     'કુલ રકમ',
    gsrtcInlineNote: 'GSRTC માન્ય રેટ ટેબલ — વિગતવાર યાદી પાછળના પાને દર્શાવેલ છે.',
    districtTitle:   '*ગુજરાત – ઓટો રિક્ષા જિલ્લા પ્રમાણેનું લિસ્ટ*',
    distHead:        ['ક્રમ', 'જિલ્લો', 'ઓટો રિક્ષાની સંખ્યા'],
    total:           'કુલ',
    gsrtcHead:       ['ક્રમ', 'બસ સ્ટેશન', 'કેટ.', 'સ્ક્રીન', 'દૈનિક', 'સ્પોટ ડ્યુ.', 'માસિક સ્પોટ', 'દિવસો'],
    gsrtcSlotHead:   '૧ સ્લોટ (૧૦ સે.)<br/>નો ભાવ',
    gsrtcMonthly:    'માસિક કુલ',
    grandTotal:      'ગ્રાન્ડ ટોટલ',
    sec:             'સે.',
    bidanAuto:       ['CBC (પૂર્વે DAVP) મંજૂર દરપત્રકની નકલ', 'જિલ્લાવાર ઓટો રિક્ષાઓની યાદી', 'કંપની પ્રોફાઇલ'],
    bidanGsrtc:      ['GSRTC ભાવ-પત્રકની નકલ', 'ભાવ-દરખાસ્તની નકલ', '૨૦ બસ ડેપો યાદી'],
    companyFallback: 'અનટાઇટલ્ડ એડવર્ટાઇઝિંગ',
    gsrtcCaption:    (m) => `GSRTC માન્ય રેટ ટેબલ — ${m} માસ માટે કેમ્પેઇન`,
    monthsTotal:     (m) => `${m} માસ કુલ`,
  },
  en: {
    to:              'To,',
    subjectPrefix:   'Subject: ',
    refLabel:        'Ref No.:',
    dateLabel:       'Date:',
    yoursFaithfully: 'Yours faithfully,',
    mob:             'Md.',
    enclosure:       'Enclosure:',
    autoHead:        ['Detail', 'Size', 'Number of Auto Rickshaws', 'DAVP Price (per month)', 'Months', 'Total Amount'],
    autoRows:        ['Rear side of Rickshaw', 'Left side of Rickshaw', 'Right side of Rickshaw'],
    gst:             'GST 18%',
    totalAmount:     'Total Amount',
    gsrtcInlineNote: 'GSRTC approved rate table — detailed list shown on the next page.',
    districtTitle:   'Gujarat — District-wise Auto Rickshaw List',
    distHead:        ['No.', 'District', 'Number of Auto Rickshaws'],
    total:           'Total',
    gsrtcHead:       ['No.', 'Bus Station', 'Cat.', 'Screens', 'Daily', 'Spot Dur.', 'Monthly Spots', 'Days'],
    gsrtcSlotHead:   '1 slot (10 s)<br/>price',
    gsrtcMonthly:    'Monthly Total',
    grandTotal:      'Grand Total',
    sec:             's',
    bidanAuto:       ['Copy of CBC (formerly DAVP) approved rate list', 'District-wise auto rickshaw list', 'Company profile'],
    bidanGsrtc:      ['Copy of GSRTC price list', 'Copy of our price proposal', 'List of 20 bus depots'],
    companyFallback: 'Untitled Advertising',
    gsrtcCaption:    (m) => `GSRTC approved rate table — campaign for ${m} month(s)`,
    monthsTotal:     (m) => `${m} month total`,
  },
}

// Phase 140 — digit + date + rate helpers that respect language. For gu
// they reproduce the original Gujarati-digit behaviour; for en they keep
// the value as-is (English digits, Indian-comma grouping from
// formatINREnglish).
const numL = (s, lang) => (lang === 'en' ? String(s) : toGujaratiDigits(String(s)))

function fmtDateL(d, lang) {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  if (lang === 'en') {
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${date.getFullYear()}`
  }
  return formatDateGujarati(date)
}

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

  // Phase 140 — language derived from the matched template row. Default
  // 'gu' for every existing/Gujarati proposal → byte-identical output.
  const lang = template.language === 'en' ? 'en' : 'gu'
  const S = STR[lang]

  // Phase 18b — owner spec: the salutation prefix ("પ્રતિ," / "To,") is
  // ALWAYS on its own line, followed by designation / department /
  // building / address each on a separate line. We strip a leading
  // prefix from the first stored line and prepend it as its own line so
  // the output is always:
  //   પ્રતિ,  /  To,
  //   મેનેજિંગ ડિરેક્ટર,
  //   ગુજરાત લાઇવલિહૂડ પ્રોમોશન કંપની લિમિટેડ,
  //   …
  const _recipLines = (data.recipient_block || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  // Phase 140 — strip the language-appropriate leading salutation.
  const stripTestRe = lang === 'en' ? /^To[,\s]?/i : /^પ્રતિ[,\s]?/
  const stripRe     = lang === 'en' ? /^To[,\s]+/i : /^પ્રતિ[,\s]+/
  if (_recipLines.length && stripTestRe.test(_recipLines[0])) {
    _recipLines[0] = _recipLines[0].replace(stripRe, '').trim()
    if (!_recipLines[0]) _recipLines.shift()
  }
  const recipientHtml =
    `<div style="margin-bottom:2px;">${S.to}</div>` +
    _recipLines.map(l => `<div style="margin-bottom:2px;">${l}</div>`).join('')

  const dateStr = fmtDateL(data.proposal_date || new Date(), lang)

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
    ? `<p style="margin:8px 0;color:#111;"><em>${S.gsrtcInlineNote}</em></p>`
    : renderAutoTable(data, lang)
  const gsrtcStationPageHtml = isGsrtc ? renderGsrtcTable(data, lang) : ''

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
  const signerHtml = renderSignerBlock(signer, company, letterheadOn, lang)

  // Phase 11d (rev15) — bidan moved OFF page 1 to keep cover letter
  // strictly within the letterhead's empty zone. It now lives at the
  // bottom of page 2 (with the district/station list). Owner spec:
  // "covering letter in 1 page A4 size, city or station in 2nd page".
  const page2BidanHtml = renderBidanBlock(mediaType, data.bidan_items, lang)

  const vars = {
    recipient:        recipientHtml,
    date:             dateStr,
    quantity:         numL(formatINREnglish(data.auto_total_quantity || 0), lang),
    districts_count:  numL(String(data.line_items?.length || 0), lang),
    // Phase 34H — for AUTO_HOOD the months placeholder prefers
    // auto_campaign_months; GSRTC stays on gsrtc_campaign_months.
    months:           numL(String(
                        mediaType === 'AUTO_HOOD'
                          ? (data.auto_campaign_months || 1)
                          : (data.gsrtc_campaign_months || 1)
                      ), lang),
    selected_stations: numL(String(data.line_items?.length || 0), lang),
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
    ? renderDistrictListPage(data, lang)
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
        // zone. Header logo bottom at y=82 (7.3% of 1123), printed
        // footer top at y=1023 (91.1%).
        // Phase 28b — owner correction (7 May 2026): paddingTop:170
        // left an obvious empty band below the U logo. Tightened to
        // 110 (28px buffer below the empty-zone start at y=82).
        // paddingBottom tightened to 105 → content area 1123 - 215
        // = 908px, more breathing room for the cover body so the
        // signer block is unlikely to crowd the printed footer.
        paddingTop:    '110px',
        paddingRight:  '70px',
        paddingBottom: '105px',
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
        {/* Phase 11d (rev7) — reference number line. Owner spec docx
            includes "સંદર્ભ ક્રમાંક: UA/GOVT/2026/____  તારીખ: …" at the
            very top. Since the date already lives on the right of the
            recipient block, we put the quote number on the left of that
            same line so both top-of-letter identifiers sit on one row.
            Falls back to ref_number if quote_number is missing (legacy
            proposals). Phase 140 — labels follow the letter language. */}
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
              <strong>{S.refLabel}</strong> {data.quote_number || data.ref_number}
            </span>
            <span>
              <strong>{S.dateLabel}</strong> {dateStr}
            </span>
          </div>
        )}
        {/* Phase 11d (rev9) — date removed from this header. The
            reference-number block above already shows date on the right.
            Owner reported "2 time date" — duplicate render. */}
        <div className="govt-letter__head">
          <div
            className="govt-letter__recipient"
            dangerouslySetInnerHTML={{ __html: recipientHtml }}
          />
        </div>

        <div
          className="govt-letter__subject"
          dangerouslySetInnerHTML={{ __html: S.subjectPrefix + template.subject_line }}
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

function renderSignerBlock(signer, company, letterheadOn = false, lang = 'gu') {
  if (!signer) return ''
  const S = STR[lang]
  const name   = signer.name || ''
  const title  = signer.signature_title || ''
  const mobile = signer.signature_mobile ? `${S.mob} ${signer.signature_mobile}` : ''
  // Phase 140 — English letters use the company's English name; Gujarati
  // letters prefer name_gu (the original behaviour).
  const companyLine = lang === 'en'
    ? (company?.name || company?.short_name || S.companyFallback)
    : (company?.name_gu || company?.short_name || company?.name || S.companyFallback)

  // Phase 11d (rev12) — letterhead-mode signer block originally hid
  // the mobile on the theory that the printed letterhead footer
  // carries phone numbers anyway.
  // Phase 28a — owner correction (7 May 2026): the letterhead phone
  // is the company switchboard; the SIGNER's personal mobile is a
  // different number and should appear under the designation so the
  // recipient can call the signer directly. Company name + address
  // stay suppressed (still duplicated by the letterhead PNG), but
  // the signer's mobile is added back.
  if (letterheadOn) {
    return [
      '<div class="govt-letter__signer" style="text-align:right;margin-top:18px;">',
        `${S.yoursFaithfully}<br/>`,
        `${name}${title ? ` (${title})` : ''}`,
        mobile ? `<br/>${mobile}` : '',
      '</div>',
    ].join('')
  }

  // Plain mode (no letterhead): include the full block since there's
  // no printed footer to provide the company info.
  return [
    '<div class="govt-letter__signer" style="text-align:right;">',
      `${S.yoursFaithfully}<br/>`,
      `${name}${title ? ` (${title})` : ''}<br/>`,
      companyLine,
    mobile ? `<br/>${mobile}` : '',
    '</div>',
  ].join('')
}

function renderAutoTable(data, lang = 'gu') {
  // Renders ONLY the rate summary. The per-district allotment list
  // lives on a separate A4 page — see renderDistrictListPage.
  //
  // Phase 34H — adds a Months column. Rate is per-rickshaw per-month;
  // total = qty × rate × months. Legacy quotes with no months default
  // to 1 (single-month behaviour), so old PDFs render unchanged.
  const S = STR[lang]
  const qty      = Number(data.auto_total_quantity || 0)
  const rate     = Number(data.unit_rate ?? 825)
  const months   = Math.max(1, Number(data.auto_campaign_months || 1))
  const subtotal = qty * rate * months
  const gst      = Math.round(subtotal * GST_PCT / 100)
  const total    = subtotal + gst

  const rowQty    = numL(formatINREnglish(qty), lang)
  const rowRate   = numL(formatINREnglish(rate), lang) + '/-'
  const rowMonths = numL(String(months), lang)
  const rowSub    = numL(formatINREnglish(subtotal), lang) + '/-'
  const rowGst    = numL(formatINREnglish(gst), lang) + '/-'
  const rowTotal  = numL(formatINREnglish(total), lang) + '/-'

  // 6-column table header. The first row spans qty / rate / months /
  // subtotal across the 3 visual rows that describe the rickshaw
  // surfaces (back + left + right) — single ad package.
  return `
  <table class="govt-letter__table">
    <thead>
      <tr>
        <th>${S.autoHead[0]}</th>
        <th>${S.autoHead[1]}</th>
        <th class="num">${S.autoHead[2]}</th>
        <th class="num">${S.autoHead[3]}</th>
        <th class="num">${S.autoHead[4]}</th>
        <th class="num">${S.autoHead[5]}</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>${S.autoRows[0]}</td><td>4' × 3'</td><td class="num" rowspan="3">${rowQty}</td><td class="num" rowspan="3">${rowRate}</td><td class="num" rowspan="3">${rowMonths}</td><td class="num" rowspan="3">${rowSub}</td></tr>
      <tr><td>${S.autoRows[1]}</td><td>2' × 2'</td></tr>
      <tr><td>${S.autoRows[2]}</td><td>2' × 2'</td></tr>
      <tr><td colspan="5">${S.gst}</td><td class="num">${rowGst}</td></tr>
      <tr><td colspan="5"><strong>${S.totalAmount}</strong></td><td class="num"><strong>${rowTotal}</strong></td></tr>
    </tbody>
  </table>`
}

/* Phase 11d — Bidan (enclosure list) block.
   Renders the standard enclosure footer that closes the letter. Items
   are media-type-specific (different attachments are relevant for
   AUTO_HOOD vs GSRTC_LED). Outputs raw HTML inserted via {{bidan_block}}
   placeholder; styling lives in govt.css if needed. Owner spec (4 May
   2026 docx): bidan must appear at the END of every letter when
   generating PDF or printing. Phase 140 — label + fallback items follow
   the letter language. */
function renderBidanBlock(mediaType, dynamicItems, lang = 'gu') {
  // Phase 11d (rev14) — collapsed to single comma-separated line.
  // The previous 6-line numbered list pushed the cover letter past
  // 860px (the available content height when letterhead background
  // is on, which eats top + bottom space). The recipient's own copy
  // shows the actual attachments anyway; this line is a quick
  // index. Single-line format saves ~100px and prevents bidan from
  // colliding with the letterhead's printed footer.
  const S = STR[lang]
  const fallback = mediaType === 'AUTO_HOOD' ? S.bidanAuto : S.bidanGsrtc

  const items = (Array.isArray(dynamicItems) && dynamicItems.length > 0)
    ? dynamicItems
    : fallback

  return [
    '<p style="margin:10px 0 0;font-size:11.5px;line-height:1.5;">',
      `<strong>${S.enclosure}</strong> `,
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
function renderDistrictListPage(data, lang = 'gu') {
  // Phase 11d (rev 3) — compact table sized to fit 33 districts on a
  // single A4 page.
  //   Math: page height 1123px @ 96dpi, with 56px top+bottom padding
  //   on the host .govt-letter, content area = 1011px.
  //   Heading + thead + tfoot ~ 110px, leaves 901px for 33 rows = 27px
  //   each. We use 19px rows (4px vertical padding × 11.5px font ×
  //   1.3 line-height) so the table comfortably fits with margin to
  //   spare. Centered, max-width 540 for printed look.
  const S = STR[lang]
  const items = Array.isArray(data.line_items) ? data.line_items : []
  if (items.length === 0) return ''

  const totalQty = Number(data.auto_total_quantity || 0)
  // Phase 28b — Phase 11d's 27px-per-row math left 80px headroom for
  // heading + total, but the page-2 .govt-letter ALSO carries the
  // bidan block (Phase 11d rev15) plus a ~56px base-CSS padding pair,
  // pushing 33 rows + total + bidan past one A4 page. Owner correction
  // (7 May 2026): "you can reduce font but it should be visible".
  // Tightened: 4px padding / 11px font / 1.35 line-height → row
  // height ≈ 4+4+11*1.35 = 22.85px × 33 = 754px. Plus heading 30 +
  // thead 32 + total 23 + bidan 30 + base padding ~110 = 979px. Fits
  // 1123px with ~140px safety margin. Still readable for printed
  // Gujarati and large enough for the long district names.
  const cellStyle = 'padding:4px 9px;font-size:11px;line-height:1.35;border:1px solid #444;color:#111;background:#fff;'
  const headStyle = cellStyle + 'background:#f5f5f5;font-weight:700;'

  const rowsHtml = items.map((it, i) => {
    // Phase 11d (rev6) — Gujarati FIRST for the gu letter. The wizard
    // saves English names into description/city_name, but the parent
    // loader (govt detail page useEffect) joins auto_districts and
    // surfaces district_name_gu. Owner spec: "AUTO LIST IN GUJRATI NOT
    // ENGLISH". Fall back to English forms only if no Gujarati is
    // available. Phase 140 — for the English letter, prefer the English
    // name (the reverse order).
    const name = lang === 'en'
      ? (it.district_name_en || it.description || it.city_name || it.district_name_gu || it.district_name || '—')
      : (it.district_name_gu || it.district_name || it.description || it.city_name || it.district_name_en || '—')
    const qty = Number(it.allocated_qty ?? it.qty ?? it.quantity ?? 0)
    return `
      <tr>
        <td style="${cellStyle}text-align:center;">${numL(String(i + 1), lang)}</td>
        <td style="${cellStyle}">${name}</td>
        <td style="${cellStyle}text-align:right;">${numL(formatINREnglish(qty), lang)}</td>
      </tr>`
  }).join('')

  return `
  <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;text-align:center;color:#111;">
    ${S.districtTitle}
  </h2>
  <table style="border-collapse:collapse;width:100%;max-width:540px;margin:0 auto;background:#fff;color:#111;">
    <thead>
      <tr>
        <th style="${headStyle}width:50px;text-align:center;">${S.distHead[0]}</th>
        <th style="${headStyle}text-align:left;">${S.distHead[1]}</th>
        <th style="${headStyle}width:140px;text-align:right;">${S.distHead[2]}</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr>
        <td colspan="2" style="${cellStyle}font-weight:700;">${S.total}</td>
        <td style="${cellStyle}font-weight:700;text-align:right;">${numL(formatINREnglish(totalQty), lang)}</td>
      </tr>
    </tbody>
  </table>`
}

// Phase 11d (rev8) — decimal-preserving formatter for the rate
// column. The previous code used formatINREnglish which calls
// .toFixed(0) → 2.75 became "3" for every row, making all stations
// look identical. This formatter keeps up to 2 decimals when the
// number isn't a whole rupee, drops them when it is. Phase 140 — gu
// converts to Gujarati digits; en keeps English digits.
function formatRate(n, lang = 'gu') {
  const num = Number(n)
  if (!Number.isFinite(num)) return lang === 'en' ? '0' : '૦'
  // Whole numbers print without decimals (3 not 3.00).
  // Fractional rates print with 2 decimals (2.75, 2.50).
  const out = (num % 1 === 0) ? String(Math.round(num)) : num.toFixed(2)
  return lang === 'en' ? out : toGujaratiDigits(out)
}

function renderGsrtcTable(data, lang = 'gu') {
  const S = STR[lang]
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
  // Phase 140.1 — English column headers are longer than the short
  // Gujarati labels and were truncating inside the fixed column widths
  // (a global `th` uppercase made it worse). For English: smaller font,
  // wrap to 2 lines, no uppercase. Gujarati keeps the original style.
  const headStyle = lang === 'en'
    ? 'padding:4px 4px;font-size:9px;line-height:1.18;border:1px solid #444;color:#111;background:#f5f5f5;font-weight:700;text-align:center;vertical-align:middle;white-space:normal;word-break:break-word;text-transform:none;'
    : cellStyle + 'background:#f5f5f5;font-weight:700;text-align:center;'
  const numCell   = cellStyle + 'text-align:right;font-variant-numeric:tabular-nums;'

  const rowsHtml = items.map((it, i) => {
    // Use per-row values if set; fall back to defaults
    const daily      = Number(it.daily_spots ?? 100)
    const baseDays   = Number(it.days ?? 30)
    // Phase 18b — owner directive: when campaign is 2 months, the
    // "days" column should show 60 and "monthly spots" should aggregate
    // over the full campaign duration, not 1 month. Fix: multiply
    // base-days by `months` for everything in the row + totals.
    const days       = baseDays * months
    const dur        = Number(it.spot_duration_sec ?? 10)
    const screens    = Number(it.screens || 0)
    const rate       = Number(it.unit_rate || 0)
    const monthly    = screens * daily * days * rate
    const lineTotal  = monthly
    subtotal        += lineTotal
    totalScreens    += screens
    totalDaily      += daily * screens
    totalMonthly    += daily * days * screens
    // Phase 11i — prefer Gujarati station name for the gu letter
    // (joined from gsrtc_stations master in GovtProposalDetailV2.load).
    // Falls back to English description for legacy items / wizard
    // preview. Phase 140 — English letter prefers the English name.
    const stationName = lang === 'en'
      ? (it.station_name_en || it.description || it.station_name_gu || it.description_gu || '')
      : (it.station_name_gu || it.description_gu || it.station_name_en || it.description || '')
    return `
      <tr>
        <td style="${cellStyle}text-align:center;">${numL(String(i + 1), lang)}</td>
        <td style="${cellStyle}">${stationName}</td>
        <td style="${cellStyle}text-align:center;">${it.category || ''}</td>
        <td style="${numCell}">${numL(String(screens), lang)}</td>
        <td style="${numCell}">${numL(String(daily), lang)}</td>
        <td style="${numCell}">${numL(String(dur), lang)} ${S.sec}</td>
        <td style="${numCell}">${numL(String(daily * days), lang)}</td>
        <td style="${numCell}">${numL(String(days), lang)}</td>
        <td style="${numCell}">${formatRate(rate, lang)}</td>
        <td style="${numCell}">${numL(formatINREnglish(monthly), lang)}</td>
        <td style="${numCell}">${numL(formatINREnglish(lineTotal), lang)}</td>
      </tr>`
  }).join('')

  const gst   = Math.round(subtotal * GST_PCT / 100)
  const total = subtotal + gst

  return `
  <p style="margin:8px 0 4px;color:#111;font-size:12px;">
    <em>${S.gsrtcCaption(numL(String(months), lang))}</em>
  </p>
  <table style="border-collapse:collapse;width:100%;background:#fff;color:#111;table-layout:fixed;">
    <thead>
      <tr>
        <th style="${headStyle}width:32px;">${S.gsrtcHead[0]}</th>
        <th style="${headStyle}text-align:left;">${S.gsrtcHead[1]}</th>
        <th style="${headStyle}width:42px;">${S.gsrtcHead[2]}</th>
        <th style="${headStyle}width:46px;">${S.gsrtcHead[3]}</th>
        <th style="${headStyle}width:42px;">${S.gsrtcHead[4]}</th>
        <th style="${headStyle}width:54px;">${S.gsrtcHead[5]}</th>
        <th style="${headStyle}width:60px;">${S.gsrtcHead[6]}</th>
        <th style="${headStyle}width:42px;">${S.gsrtcHead[7]}</th>
        <th style="${headStyle}width:96px;${lang === 'en' ? '' : 'line-height:1.2;font-size:10px;white-space:nowrap;'}">${S.gsrtcSlotHead}</th>
        <th style="${headStyle}width:74px;">${S.gsrtcMonthly}</th>
        <th style="${headStyle}width:80px;">${S.monthsTotal(numL(String(months), lang))}</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr>
        <td colspan="3" style="${cellStyle}font-weight:700;text-align:right;">${S.total}</td>
        <td style="${numCell}font-weight:700;">${numL(String(totalScreens), lang)}</td>
        <td style="${numCell}">${numL(String(totalDaily), lang)}</td>
        <td style="${cellStyle}"></td>
        <td style="${numCell}">${numL(String(totalMonthly), lang)}</td>
        <td colspan="3" style="${cellStyle}"></td>
        <td style="${numCell}font-weight:700;">${numL(formatINREnglish(subtotal), lang)}</td>
      </tr>
      <tr>
        <td colspan="10" style="${cellStyle}text-align:right;">${S.gst}</td>
        <td style="${numCell}">${numL(formatINREnglish(gst), lang)}</td>
      </tr>
      <tr>
        <td colspan="10" style="${cellStyle}font-weight:700;text-align:right;">${S.grandTotal}</td>
        <td style="${numCell}font-weight:700;">${numL(formatINREnglish(total), lang)}</td>
      </tr>
    </tbody>
  </table>`
}
