// src/components/quotes/QuotePDFHtml.jsx
//
// Phase 34Z.25 — HTML/CSS quote PDF renderer.
//
// Replaces the @react-pdf/renderer pipeline (which kept failing on
// font resolution in production builds — see Phase 34Z.23 / .24) with
// a plain HTML React component rasterised via html2canvas + jsPDF —
// the same pattern that powers GovtProposalRenderer and ships PDFs
// reliably.
//
// No external font fetch. No WASM. No CSP carve-outs.
//
// Owner directive (14 May 2026): "you can take data from pdf
// genratore from govet proposal genrates."
//
// API kept identical to QuotePDF so QuoteDetail.jsx callers don't
// change: downloadQuotePDFHtml / uploadQuotePDFHtml.

import { createRoot } from 'react-dom/client'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { rupeesToWords } from '../../utils/numberToWords'
// Phase 34Z.27 — static imports for html2canvas + jspdf. The previous
// version used `await import('html2canvas')` and `await import('jspdf')`
// which Vite split into separate /assets/*.js chunks. Workbox's
// NavigationRoute then intercepted those chunk URLs and served
// index.html → "Failed to fetch dynamically imported module" → PDF
// generation died. Bundling them into the main chunk via static import
// bypasses the SW fallback entirely.
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

const YELLOW = '#FFE600'
const INK    = '#0f172a'
const MUTED  = '#64748b'
const BORDER = '#e2e8f0'
const SOFT   = '#f8f9fc'

/* ─── Company fetch (mirror QuotePDF) ────────────────────────────── */

async function fetchCompanyForQuote(quote) {
  const seg = quote?.segment === 'GOVERNMENT' ? 'GOVERNMENT' : 'PRIVATE'
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('segment', seg)
    .eq('is_active', true)
    .maybeSingle()
  return data || null
}

/* ─── Phase 81.2.2 — glance helpers (ported from QuotePDF.jsx) ────── */

function totalScreensFn(cities) {
  return cities.reduce((s, c) => s + (Number(c.screens) || 0), 0)
}
function spotsPerMonthFn(city) {
  const screens     = Number(city?.screens) || 0
  const slotsPerDay = Number(city?.slots_per_day) || 100
  return screens * slotsPerDay * 30
}
function totalSpotsPerMonthFn(cities) {
  return cities.reduce((s, c) => s + spotsPerMonthFn(c), 0)
}
function quoteSlotSecondsFn(cities) {
  if (!cities?.length) return 10
  const byScreens = new Map()
  for (const c of cities) {
    const sec    = Number(c.slot_seconds) || 10
    const weight = Number(c.screens) || 1
    byScreens.set(sec, (byScreens.get(sec) || 0) + weight)
  }
  let bestSec = 10, bestWeight = -1
  for (const [sec, weight] of byScreens) {
    if (weight > bestWeight) { bestSec = sec; bestWeight = weight }
  }
  return bestSec
}
function totalImpressionsFn(cities) {
  // ~5200 impressions/screen/month (matches reference PDF ratios).
  return cities.reduce((s, c) => s + (Number(c.screens) || 0) * 5200, 0)
}
function formatLakhFn(n) {
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L'
  if (n >= 1000)   return (n / 1000).toFixed(0) + 'K'
  return String(n)
}

/* ─── Renderer component (off-screen DOM only) ───────────────────── */

export function QuotePDFHtmlDocument({ quote, cities = [], company }) {
  if (!company) {
    throw new Error(
      'QuotePDFHtml: companies row is required. ' +
      'Seed Master → Companies for segment=' + String(quote?.segment) + '.'
    )
  }
  const subtotal    = Number(quote?.subtotal) || 0
  const gstRate     = quote?.gst_rate !== null && quote?.gst_rate !== undefined ? Number(quote.gst_rate) : 0.18
  const gstAmount   = Number(quote?.gst_amount) || (subtotal * gstRate)
  const totalAmount = Number(quote?.total_amount) || (subtotal + gstAmount)
  const inWords     = rupeesToWords(Math.round(totalAmount))

  // Phase 81.2 — letterhead-aware page.
  //   When companies.letterhead_url is present, render the page on
  //   top of the rasterised letterhead PNG (top logo + bottom address
  //   strip). Content padded into the safe middle zone the way
  //   GovtProposalRenderer does (Phase 10b / 28b).
  //   When no letterhead is set, fall back to the legacy yellow
  //   headBand + dark titleBand chrome.
  const letterheadOn = !!company.letterhead_url
  const styles = {
    page: letterheadOn ? {
      width:             '794px',
      minHeight:         '1123px',
      background:        '#ffffff',
      backgroundImage:   `url("${company.letterhead_url}")`,
      backgroundRepeat:  'no-repeat',
      backgroundSize:    '100% 100%',
      backgroundPosition:'top center',
      fontFamily:        '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      color:             INK,
      boxSizing:         'border-box',
      padding:           '110px 70px 105px 70px',  // letterhead safe zone
      margin:            0,
    } : {
      width:     '794px',
      minHeight: '1123px',
      background: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      color:      INK,
      boxSizing:  'border-box',
      padding:    0,
      margin:     0,
    },
    headBand: {
      background: YELLOW,
      padding: '20px 32px',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    headBrand: { fontWeight: 700, fontSize: 20, color: INK, lineHeight: 1.1 },
    headSub:   { fontSize: 11, color: INK, marginTop: 2, opacity: 0.7 },
    headQuote: { textAlign: 'right' },
    headQuoteLabel: { fontSize: 9, letterSpacing: '0.12em', color: INK, opacity: 0.6, textTransform: 'uppercase' },
    headQuoteNum:   { fontWeight: 700, fontSize: 14, color: INK },
    headQuoteDate:  { fontSize: 10, color: INK, marginTop: 1, opacity: 0.7 },

    titleBand: {
      background: INK,
      color: '#fff',
      padding: '12px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    titleText: { fontSize: 16, fontWeight: 700, letterSpacing: '0.04em' },
    titleSub:  { fontSize: 10, color: '#e2e8f0' },

    // Phase 81.2 — body padding is letterhead-aware. When letterhead
    // is on, the outer page already has the 70px / 110px / 105px safe
    // zone applied, so body padding collapses to 0. Without letterhead
    // the legacy headBand/titleBand sit above and body keeps its own
    // 20/32 padding.
    body:   { padding: letterheadOn ? 0 : '20px 32px' },
    // Phase 81.2 — clean text title used WITH letterhead (replaces
    // the dark titleBand bar that would clash with letterhead chrome).
    // Phase 81.2.1 — entire block left-aligned to leave room for the
    // letterhead's top-right logo + wordmark. Earlier flex-row layout
    // placed ref/date on the right which overlapped UNTITLED ADFLUX
    // PVT.LTD. on owner's UA-2026-0055 sample.
    quoteTitleRow: {
      marginBottom:   18,
      paddingBottom:  10,
      borderBottom:   `2px solid ${INK}`,
    },
    quoteTitleText:  { fontSize: 22, fontWeight: 700, color: INK, letterSpacing: '0.05em' },
    quoteTitleMeta:  { marginTop: 4 },
    quoteTitleRef:   { fontSize: 13, fontWeight: 700, color: INK },
    quoteTitleDate:  { fontSize: 10, color: MUTED, marginTop: 2 },
    quoteTitleSub:   { fontSize: 10, color: MUTED, marginTop: 1 },

    // Phase 81.2.2 — "This Campaign at a Glance" 4-card strip.
    // Quote-level headline numbers (screens / spots-month / spot-
    // duration / total-impressions). Ported from the dead QuotePDF.jsx
    // — owner caught the omission on UA-2026-0055.
    glanceRow: {
      display:        'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      border:         `1px solid ${BORDER}`,
      borderRadius:   8,
      marginBottom:   16,
      overflow:       'hidden',
      background:     '#ffffff',
    },
    glanceItem: {
      padding:       '14px 10px',
      textAlign:     'center',
      borderRight:   `1px solid ${BORDER}`,
    },
    glanceItemLast: { borderRight: 'none' },
    glanceNum: {
      fontSize:    20,
      fontWeight:  700,
      color:       INK,
      letterSpacing: '0.01em',
    },
    glanceLabel: {
      fontSize:        9,
      color:           MUTED,
      marginTop:       4,
      textTransform:   'uppercase',
      letterSpacing:   '0.10em',
    },
    sectionTitle: { fontSize: 9, letterSpacing: '0.14em', fontWeight: 700, color: MUTED, textTransform: 'uppercase', margin: '0 0 6px' },

    clientGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px 28px',
      padding: '10px 14px',
      background: SOFT,
      border: `1px solid ${BORDER}`,
      borderRadius: 8,
      marginBottom: 16,
    },
    clientCell: { fontSize: 11 },
    clientLabel: { color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 },
    clientValue: { color: INK, fontSize: 11, fontWeight: 600 },

    table: {
      width: '100%',
      borderCollapse: 'collapse',
      marginBottom: 14,
      fontSize: 10.5,
    },
    th: {
      background: INK,
      color: '#fff',
      padding: '8px 10px',
      textAlign: 'left',
      fontWeight: 600,
      fontSize: 10,
      letterSpacing: '0.04em',
    },
    td:  { padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, fontSize: 10.5, color: INK, verticalAlign: 'top' },
    tdNum: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },

    summary: {
      marginLeft: 'auto',
      width: '60%',
      borderTop: `1px solid ${BORDER}`,
      paddingTop: 10,
    },
    sumRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 },
    sumLabel: { color: MUTED },
    sumValue: { color: INK, fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
    grandRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 12px',
      marginTop: 6,
      background: YELLOW,
      borderRadius: 6,
      fontSize: 14,
      fontWeight: 700,
      color: INK,
    },

    inWords: {
      marginTop: 8,
      padding: '8px 12px',
      background: SOFT,
      border: `1px dashed ${BORDER}`,
      borderRadius: 6,
      fontSize: 10.5,
      color: INK,
    },

    footer: {
      marginTop: 20,
      padding: '14px 32px',
      borderTop: `2px solid ${INK}`,
      background: SOFT,
      fontSize: 9.5,
      color: MUTED,
    },
    footerRow: { display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 6 },
    footerCell: { flex: 1 },
    footerLabel: { fontSize: 8, letterSpacing: '0.12em', color: MUTED, textTransform: 'uppercase', marginBottom: 2 },
    footerValue: { color: INK, fontSize: 10, fontWeight: 600 },
  }

  // Phase 34Z.26 — full LED row shape, mirrors the on-screen quote
  // detail table: CITY · GRADE · SCREENS · DURATION · SLOT · SLOTS/DAY
  // · LISTED · OFFERED · TOTAL. Listed rendered struck-through when it
  // differs from offered. Grade chip colored A=green / B=orange / C=gray
  // (matches QuotePDF.jsx convention).
  const lines = cities.map((c, i) => ({
    sr:           i + 1,
    cityName:     c.city_name || c.name || `Line ${i + 1}`,
    station:      c.station || c.media_type || '',
    grade:        c.grade || '',
    screens:      Number(c.screens || 0),
    sizeInch:     c.screen_size_inch ? `${c.screen_size_inch}"` : '',
    slotSec:      Number(c.slot_seconds) || 10,
    slotsPerDay:  Number(c.slots_per_day) || 100,
    durationMo:   Number(c.duration_months) || Number(quote?.duration_months) || 1,
    listedRate:   Number(c.listed_rate)  || 0,
    offeredRate:  Number(c.offered_rate) || 0,
    campaignTotal: Number(c.campaign_total) || (Number(c.offered_rate || 0) * Number(c.screens || 0) * (Number(c.duration_months) || 1)),
  }))
  const totalScreens = lines.reduce((s, l) => s + l.screens, 0)
  const repName = quote?.sales_person_name || 'Sales Executive'
  const campaignDurationLabel = `${quote?.duration_months || 1} Month${(quote?.duration_months || 1) !== 1 ? 's' : ''}`

  return (
    <div style={styles.page}>
      {/* Phase 81.2 — when letterhead is uploaded, the page already
          shows top logo + bottom address from the letterhead PNG, so
          we drop the yellow headBand + dark titleBand entirely
          (otherwise they cover the letterhead's own brand chrome).
          A clean text title takes their place. When no letterhead,
          fall back to the legacy yellow + dark bands. */}
      {letterheadOn ? (
        <div style={styles.quoteTitleRow}>
          <div style={styles.quoteTitleText}>MEDIA QUOTATION</div>
          <div style={styles.quoteTitleMeta}>
            <span style={styles.quoteTitleRef}>{quote?.quote_number || '—'}</span>
            <span style={{ ...styles.quoteTitleDate, marginLeft: 12 }}>{quote?.created_at ? formatDate(quote.created_at) : ''}</span>
            <span style={{ ...styles.quoteTitleSub, marginLeft: 12 }}>
              {quote?.media_type === 'OTHER_MEDIA' ? '· Private — Other Media' : '· Private — LED Cities'}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div style={{
            ...styles.headBand,
            position: 'relative',
          }}>
            <div>
              <div style={styles.headBrand}>{company.name || company.short_name || 'Untitled Advertising'}</div>
              <div style={styles.headSub}>
                {[company.address_line, company.city, company.state, company.pincode].filter(Boolean).join(', ')}
              </div>
              <div style={styles.headSub}>GSTIN: {company.gstin || '—'} · PAN: {company.pan || '—'}</div>
            </div>
            <div style={styles.headQuote}>
              <div style={styles.headQuoteLabel}>Quote #</div>
              <div style={styles.headQuoteNum}>{quote?.quote_number || '—'}</div>
              <div style={styles.headQuoteDate}>{quote?.created_at ? formatDate(quote.created_at) : ''}</div>
            </div>
          </div>

          <div style={styles.titleBand}>
            <div style={styles.titleText}>MEDIA QUOTATION</div>
            <div style={styles.titleSub}>
              {quote?.media_type === 'OTHER_MEDIA' ? 'Private — Other Media' : 'Private — LED Cities'}
            </div>
          </div>
        </>
      )}

      <div style={styles.body}>
        <div style={styles.sectionTitle}>Client Details</div>
        <div style={styles.clientGrid}>
          <div style={styles.clientCell}>
            <div style={styles.clientLabel}>Client</div>
            <div style={styles.clientValue}>{quote?.client_name || '—'}</div>
          </div>
          <div style={styles.clientCell}>
            <div style={styles.clientLabel}>Company</div>
            <div style={styles.clientValue}>{quote?.client_company || '—'}</div>
          </div>
          <div style={styles.clientCell}>
            <div style={styles.clientLabel}>Phone</div>
            <div style={styles.clientValue}>{quote?.client_phone || '—'}</div>
          </div>
          <div style={styles.clientCell}>
            <div style={styles.clientLabel}>Email</div>
            <div style={styles.clientValue}>{quote?.client_email || '—'}</div>
          </div>
        </div>

        {/* Campaign meta strip — mirrors on-screen detail (Duration /
            Type / Prepared by / Locations / Total Screens). */}
        <div style={styles.sectionTitle}>Campaign Details</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 14,
          padding: '10px 14px',
          background: SOFT,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          marginBottom: 16,
        }}>
          <div>
            <div style={styles.clientLabel}>Duration</div>
            <div style={styles.clientValue}>{campaignDurationLabel}</div>
          </div>
          <div>
            <div style={styles.clientLabel}>Type</div>
            <div style={styles.clientValue}>{quote?.client_type || 'New Client'}</div>
          </div>
          <div>
            <div style={styles.clientLabel}>Prepared by</div>
            <div style={styles.clientValue}>{repName}</div>
          </div>
          <div>
            <div style={styles.clientLabel}>Locations</div>
            <div style={styles.clientValue}>{lines.length} City{lines.length !== 1 ? 's' : ''}</div>
          </div>
          <div>
            <div style={styles.clientLabel}>Screens</div>
            <div style={styles.clientValue}>{totalScreens}</div>
          </div>
        </div>

        {/* Phase 81.2.2 — "This Campaign at a Glance" — quote-level
            headline numbers. Mirrors the on-screen quote detail glance
            card so the PDF tells the same story. Skipped if cities is
            empty (defensive — would render zeroes otherwise). */}
        {lines.length > 0 && (
          <>
            <div style={styles.sectionTitle}>This Campaign at a Glance</div>
            <div style={styles.glanceRow}>
              <div style={styles.glanceItem}>
                <div style={styles.glanceNum}>{totalScreensFn(cities)}</div>
                <div style={styles.glanceLabel}>Screens Booked</div>
              </div>
              <div style={styles.glanceItem}>
                <div style={styles.glanceNum}>{formatLakhFn(totalSpotsPerMonthFn(cities))}</div>
                <div style={styles.glanceLabel}>Spots / Month</div>
              </div>
              <div style={styles.glanceItem}>
                <div style={styles.glanceNum}>{quoteSlotSecondsFn(cities)} SEC</div>
                <div style={styles.glanceLabel}>Spot Duration</div>
              </div>
              <div style={{ ...styles.glanceItem, ...styles.glanceItemLast }}>
                <div style={styles.glanceNum}>{formatLakhFn(totalImpressionsFn(cities))}</div>
                <div style={styles.glanceLabel}>Total Impressions</div>
              </div>
            </div>
          </>
        )}

        <div style={styles.sectionTitle}>Location Breakdown</div>
        <table style={{ ...styles.table, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 28 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 42 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 38 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={styles.th}>SR</th>
              <th style={styles.th}>CITY</th>
              <th style={{ ...styles.th, textAlign: 'center' }}>GRADE</th>
              <th style={{ ...styles.th, ...styles.tdNum }}>SCRNS</th>
              <th style={{ ...styles.th, ...styles.tdNum }}>MONTHS</th>
              <th style={{ ...styles.th, ...styles.tdNum }}>SLOT</th>
              <th style={{ ...styles.th, ...styles.tdNum }}>SLOTS<br/>/DAY</th>
              <th style={{ ...styles.th, ...styles.tdNum }}>LISTED</th>
              <th style={{ ...styles.th, ...styles.tdNum }}>OFFER<br/>/SCRN</th>
              <th style={{ ...styles.th, ...styles.tdNum }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const gradeBg = l.grade === 'A' ? '#DCFCE7' : l.grade === 'B' ? '#FFEDD5' : '#F1F5F9'
              const gradeFg = l.grade === 'A' ? '#166534' : l.grade === 'B' ? '#B45309' : '#475569'
              const showListedStruck = l.listedRate && l.listedRate !== l.offeredRate
              return (
                <tr key={l.sr}>
                  <td style={{ ...styles.td, color: MUTED }}>{l.sr}</td>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 600 }}>{l.cityName}</div>
                    {l.station && <div style={{ color: MUTED, fontSize: 9 }}>{l.station}</div>}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 7px',
                      background: gradeBg,
                      color: gradeFg,
                      borderRadius: 8,
                      fontWeight: 700,
                      fontSize: 9,
                    }}>{l.grade || '—'}</span>
                  </td>
                  <td style={{ ...styles.td, ...styles.tdNum }}>{l.screens}</td>
                  <td style={{ ...styles.td, ...styles.tdNum }}>{l.durationMo}mo</td>
                  <td style={{ ...styles.td, ...styles.tdNum }}>{l.slotSec}s</td>
                  <td style={{ ...styles.td, ...styles.tdNum }}>{l.slotsPerDay}</td>
                  <td style={{ ...styles.td, ...styles.tdNum, color: MUTED }}>
                    {showListedStruck ? formatCurrency(l.listedRate) : '—'}
                  </td>
                  <td style={{ ...styles.td, ...styles.tdNum, color: '#16a34a', fontWeight: 700 }}>
                    {formatCurrency(l.offeredRate)}
                  </td>
                  <td style={{ ...styles.td, ...styles.tdNum, fontWeight: 700 }}>{formatCurrency(l.campaignTotal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div style={styles.summary}>
          <div style={styles.sumRow}>
            <span style={styles.sumLabel}>Subtotal</span>
            <span style={styles.sumValue}>{formatCurrency(subtotal)}</span>
          </div>
          {gstRate > 0 ? (
            <div style={styles.sumRow}>
              <span style={styles.sumLabel}>GST ({Math.round(gstRate * 100)}%)</span>
              <span style={styles.sumValue}>{formatCurrency(gstAmount)}</span>
            </div>
          ) : (
            <div style={styles.sumRow}>
              <span style={styles.sumLabel}>No GST</span>
              <span style={styles.sumValue}>—</span>
            </div>
          )}
          <div style={styles.grandRow}>
            <span>Grand Total</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>
          <div style={styles.inWords}>
            <b>Total in Words:</b> {inWords}
          </div>
        </div>
      </div>

      {/* Phase 81.2 — when letterhead is on, suppress the legacy
          footer block. Bank details are kept inside the body via
          Terms (or could move into a Payment Details block); the
          letterhead's own bottom address strip carries contact info.
          When letterhead is OFF, the full legacy footer renders. */}
      {!letterheadOn && (
        <div style={styles.footer}>
          <div style={styles.footerRow}>
            <div style={styles.footerCell}>
              <div style={styles.footerLabel}>Bank</div>
              <div style={styles.footerValue}>{company.bank_name || ''}</div>
              {company.bank_branch && <div>Branch: {company.bank_branch}</div>}
              {company.bank_acc_name && <div>A/C Name: {company.bank_acc_name}</div>}
              {company.bank_acc_number && <div>A/C: {company.bank_acc_number}</div>}
              {company.bank_ifsc && <div>IFSC: {company.bank_ifsc}</div>}
              {company.bank_micr && <div>MICR: {company.bank_micr}</div>}
              {company.upi_id && <div>UPI: {company.upi_id}</div>}
            </div>
            <div style={styles.footerCell}>
              <div style={styles.footerLabel}>Contact</div>
              {company.phone && <div>Phone: {company.phone}</div>}
              {company.email && <div>Email: {company.email}</div>}
              {company.website && <div>Web: {company.website}</div>}
            </div>
            <div style={{ ...styles.footerCell, textAlign: 'right' }}>
              <div style={styles.footerLabel}>Prepared by</div>
              <div style={styles.footerValue}>{repName}</div>
              <div>{quote?.quote_number} · {quote?.created_at ? formatDate(quote.created_at) : ''}</div>
            </div>
          </div>
        </div>
      )}

      {/* Phase 81.2 — when letterhead is on, drop a compact Bank /
          Prepared-by block INSIDE the safe-zone body so the rep info
          + payment details still print. Sits above the letterhead's
          bottom address strip. */}
      {letterheadOn && (
        <div style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${BORDER}`, fontSize: 10, color: MUTED }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
            <div>
              <div style={styles.footerLabel}>Bank</div>
              {company.bank_name && <div><b style={{ color: INK }}>{company.bank_name}</b></div>}
              {company.bank_acc_name && <div>{company.bank_acc_name}</div>}
              {company.bank_acc_number && <div>A/C: {company.bank_acc_number}</div>}
              {company.bank_ifsc && <div>IFSC: {company.bank_ifsc}</div>}
              {company.upi_id && <div>UPI: {company.upi_id}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={styles.footerLabel}>Prepared by</div>
              <div style={{ color: INK, fontWeight: 600 }}>{repName}</div>
              <div>{quote?.quote_number} · {quote?.created_at ? formatDate(quote.created_at) : ''}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Phase 81.3 — paginated quote page (letterhead path) ────────── */
//
// Owner directive 22 May 2026:
//   "use same letter head as it is but you render data on that white
//    margin only. if data is more the page 2 same header n footer it
//    will be look more professional"
//
// Implementation: each quote page is a FIXED 794×1123 div with the
// letterhead PNG as background + 110/70/105/70 safe-zone padding +
// overflow hidden. Cities are paginated client-side; each page is
// captured to its own canvas, addPage'd into jsPDF. Letterhead
// repeats automatically because every page renders with the same
// CSS background.
//
// Why fixed dimensions matter: html2canvas with a fixed-height
// wrapper captures exactly that height; the jsPDF slicer paints
// the whole canvas onto one A4 page (no overflow stretching, no
// missing chrome).

const ROW_HEIGHT_PX        = 40    // empirical: typical city row height
const PAGE_BUDGET_PX       = 908   // 1123 − 110 top − 105 bottom
const FIRST_PAGE_OVERHEAD  = 460   // title + client + campaign + glance + section title + table head
const CONT_PAGE_OVERHEAD   = 120   // title + section title + table head
const LAST_PAGE_FOOTER     = 280   // totals + bank + prepared-by

/**
 * Split cities into paginated chunks that fit the letterhead safe
 * zone. Returns: [{cities, isFirst, isLast}, …].
 *
 * Sizing heuristic (over-conservative on purpose so rows never spill
 * into the bottom address strip):
 *   • Single page if all cities + totals fit.
 *   • Page 1 = first 10 cities (leaves room for totals on the same
 *     page when there are few cities; otherwise totals push to last).
 *   • Continuation pages = 18 cities.
 *   • Last page = remaining cities + totals + bank.
 */
function paginateCities(cities) {
  const SAFE_FIRST_AND_LAST_ROWS = Math.floor(
    (PAGE_BUDGET_PX - FIRST_PAGE_OVERHEAD - LAST_PAGE_FOOTER) / ROW_HEIGHT_PX
  ) // ≈ 4
  if (cities.length <= 14) {
    return [{ cities, isFirst: true, isLast: true }]
  }
  const pages = [{ cities: cities.slice(0, 10), isFirst: true, isLast: false }]
  let i = 10
  while (i < cities.length) {
    const remaining = cities.length - i
    if (remaining <= 14) {
      pages.push({ cities: cities.slice(i), isFirst: false, isLast: true })
      break
    }
    pages.push({ cities: cities.slice(i, i + 18), isFirst: false, isLast: false })
    i += 18
  }
  return pages
}

/**
 * Single A4 page of the quote.
 *
 * @param {object} p
 * @param {object} p.quote
 * @param {object} p.company
 * @param {Array}  p.cityChunk   cities for THIS page
 * @param {Array}  p.allCities   full city list (for totals computation)
 * @param {boolean} p.isFirst    show full header (client / campaign / glance)
 * @param {boolean} p.isLast     show totals + bank + prepared-by
 * @param {number} p.pageIndex   1-based
 * @param {number} p.totalPages
 */
function QuotePage({ quote, company, cityChunk, allCities, isFirst, isLast, pageIndex, totalPages }) {
  const letterheadOn = !!company.letterhead_url
  const subtotal     = Number(quote?.subtotal) || 0
  const gstRate      = quote?.gst_rate !== null && quote?.gst_rate !== undefined ? Number(quote.gst_rate) : 0.18
  const gstAmount    = Number(quote?.gst_amount) || (subtotal * gstRate)
  const totalAmount  = Number(quote?.total_amount) || (subtotal + gstAmount)
  const inWords      = rupeesToWords(Math.round(totalAmount))
  const repName      = quote?.sales_person_name || 'Sales Executive'
  const campaignDurationLabel = `${quote?.duration_months || 1} Month${(quote?.duration_months || 1) !== 1 ? 's' : ''}`

  // Phase 81.3.5: position:relative so the title can sit absolutely
  // in the letterhead's top-left empty zone (owner directive on
  // UA-2026-0053 — uses the otherwise-wasted whitespace beside the
  // top-right logo).
  const wrapperStyle = {
    width:              '794px',
    height:             '1123px',
    boxSizing:          'border-box',
    overflow:           'hidden',
    position:           'relative',
    background:         '#ffffff',
    backgroundImage:    letterheadOn ? `url("${company.letterhead_url}")` : 'none',
    backgroundRepeat:   'no-repeat',
    backgroundSize:     '794px 1123px',  // FIXED — no stretch
    backgroundPosition: 'top center',
    // Phase 81.3.7: bottom padding bumped 105 → 140 so the last
    // page's bank + prepared-by block clears the letterhead's bottom
    // address strip. Owner caught the IFSC line overlapping
    // "203, Sidcup Tower..." on UA-2026-0053.
    padding:            letterheadOn ? '110px 70px 140px 70px' : '0',
    fontFamily:         '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    color:              INK,
    fontSize:           10.5,
  }

  // Lines for this page only.
  const lines = cityChunk.map((c, idx) => {
    // sr is absolute (global numbering across pages)
    const globalSr = allCities.findIndex(x => (x.id || x.city_id || x.city?.id) === (c.id || c.city_id || c.city?.id)) + 1 || (idx + 1)
    return {
      sr:           globalSr,
      cityName:     c.city_name || c.name || `Line ${idx + 1}`,
      station:      c.station || c.media_type || '',
      grade:        c.grade || '',
      screens:      Number(c.screens || 0),
      slotSec:      Number(c.slot_seconds) || 10,
      slotsPerDay:  Number(c.slots_per_day) || 100,
      durationMo:   Number(c.duration_months) || (Number(quote?.duration_months) || 1),
      listedRate:   Number(c.listed_rate) || 0,
      offeredRate:  Number(c.offered_rate) || 0,
      campaignTotal: Number(c.campaign_total) || (Number(c.offered_rate || 0) * Number(c.screens || 0) * (Number(c.duration_months) || 1)),
    }
  })

  // Phase 81.3.3: only break headers at explicit <br/> points.
  // wordBreak break-word was chopping "GRADE" → "GRAD E", "SCREENS"
  // → "SCREEN S" etc. on owner's UA-2026-0055.
  const tableTh = {
    background:    INK,
    color:         '#fff',
    padding:       '6px 6px',
    textAlign:     'left',
    fontWeight:    600,
    fontSize:      9,
    letterSpacing: '0.02em',
    lineHeight:    1.2,
    whiteSpace:    'normal',
    wordBreak:     'normal',
    verticalAlign: 'middle',
  }
  const tableTd  = { padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, fontSize: 10.5, color: INK, verticalAlign: 'top' }
  const tdNum    = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
  const sectionTitle = { fontSize: 9, letterSpacing: '0.14em', fontWeight: 700, color: MUTED, textTransform: 'uppercase', margin: '0 0 6px' }

  return (
    <div style={wrapperStyle}>
      {/* Phase 81.3.5 — title block placed absolutely in the
          letterhead's top-LEFT zone (between page edge and the
          letterhead PNG's right-side logo). Owner: "we can use
          blank space left side of logo". Width 350px keeps it
          clear of the right-side logo wordmark. */}
      {letterheadOn ? (
        <div style={{
          position: 'absolute',
          top:      30,
          left:     70,
          width:    350,
          color:    INK,
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.05em' }}>
            MEDIA QUOTATION{!isFirst ? ' (cont.)' : ''}
          </div>
          <div style={{ marginTop: 4, fontSize: 11 }}>
            <span style={{ fontWeight: 700, color: INK }}>{quote?.quote_number || '—'}</span>
            <span style={{ marginLeft: 8, color: MUTED, fontSize: 10 }}>
              {quote?.created_at ? formatDate(quote.created_at) : ''}
            </span>
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: MUTED }}>
            {quote?.media_type === 'OTHER_MEDIA' ? 'Private — Other Media' : 'Private — LED Cities'}
            {totalPages > 1 && ` · Page ${pageIndex} of ${totalPages}`}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14, paddingBottom: 8, borderBottom: `2px solid ${INK}` }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: INK, letterSpacing: '0.05em' }}>
            MEDIA QUOTATION{!isFirst ? ' (cont.)' : ''}
          </div>
          <div style={{ marginTop: 4, fontSize: 11 }}>
            <span style={{ fontWeight: 700, color: INK }}>{quote?.quote_number || '—'}</span>
            <span style={{ marginLeft: 10, color: MUTED, fontSize: 10 }}>
              {quote?.created_at ? formatDate(quote.created_at) : ''}
            </span>
            <span style={{ marginLeft: 10, color: MUTED, fontSize: 10 }}>
              · {quote?.media_type === 'OTHER_MEDIA' ? 'Private — Other Media' : 'Private — LED Cities'}
            </span>
            {totalPages > 1 && (
              <span style={{ float: 'right', color: MUTED, fontSize: 10 }}>
                Page {pageIndex} of {totalPages}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Full header — first page only */}
      {isFirst && (
        <>
          <div style={sectionTitle}>Client Details</div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: '14px 28px', padding: '14px 16px',
            background: SOFT, border: `1px solid ${BORDER}`,
            borderRadius: 8, marginBottom: 14,
          }}>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Client</div>
              <div style={{ color: INK, fontSize: 14, fontWeight: 700 }}>{quote?.client_name || '—'}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Company</div>
              <div style={{ color: INK, fontSize: 14, fontWeight: 700 }}>{quote?.client_company || '—'}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Phone</div>
              <div style={{ color: INK, fontSize: 14, fontWeight: 700 }}>{quote?.client_phone || '—'}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Email</div>
              <div style={{ color: INK, fontSize: 14, fontWeight: 700 }}>{quote?.client_email || '—'}</div>
            </div>
          </div>

          <div style={sectionTitle}>Campaign Details</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 14, padding: '10px 14px', background: SOFT,
            border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 14,
          }}>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Duration</div>
              <div style={{ color: INK, fontSize: 11, fontWeight: 600 }}>{campaignDurationLabel}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Type</div>
              <div style={{ color: INK, fontSize: 11, fontWeight: 600 }}>{quote?.client_type || 'New Client'}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Prepared by</div>
              <div style={{ color: INK, fontSize: 11, fontWeight: 600 }}>{repName}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Locations</div>
              <div style={{ color: INK, fontSize: 11, fontWeight: 600 }}>{allCities.length} City{allCities.length !== 1 ? 's' : ''}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>Screens</div>
              <div style={{ color: INK, fontSize: 11, fontWeight: 600 }}>{totalScreensFn(allCities)}</div>
            </div>
          </div>

          <div style={sectionTitle}>This Campaign at a Glance</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            border: `1px solid ${BORDER}`, borderRadius: 8,
            marginBottom: 12, overflow: 'hidden', background: '#fff',
          }}>
            <div style={{ padding: '12px 8px', textAlign: 'center', borderRight: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{totalScreensFn(allCities)}</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.10em' }}>Screens Booked</div>
            </div>
            <div style={{ padding: '12px 8px', textAlign: 'center', borderRight: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{formatLakhFn(totalSpotsPerMonthFn(allCities))}</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.10em' }}>Spots / Month</div>
            </div>
            <div style={{ padding: '12px 8px', textAlign: 'center', borderRight: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{quoteSlotSecondsFn(allCities)} SEC</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.10em' }}>Spot Duration</div>
            </div>
            <div style={{ padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{formatLakhFn(totalImpressionsFn(allCities))}</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.10em' }}>Total Impressions</div>
            </div>
          </div>
        </>
      )}

      {/* Location table — every page. Phase 81.3.1: lock layout to
          fixed widths via colgroup + table-layout:fixed so the grade
          chips + numeric cols align identically across pages
          (auto-layout was flexing the City col per-page chunk and
          throwing downstream columns out of vertical alignment). */}
      <div style={sectionTitle}>Location Breakdown{!isFirst ? ' (cont.)' : ''}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 10.5, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 22 }} />
          <col style={{ width: 116 }} />
          <col style={{ width: 42 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 36 }} />
          <col style={{ width: 50 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 76 }} />
          <col style={{ width: 76 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={tableTh}>SR</th>
            <th style={tableTh}>CITY</th>
            <th style={{ ...tableTh, textAlign: 'center' }}>GRADE</th>
            <th style={{ ...tableTh, ...tdNum }}>SCRNS</th>
            <th style={{ ...tableTh, ...tdNum }}>MONTHS</th>
            <th style={{ ...tableTh, ...tdNum }}>SLOT</th>
            <th style={{ ...tableTh, ...tdNum }}>SLOTS<br/>/DAY</th>
            <th style={{ ...tableTh, ...tdNum }}>LISTED</th>
            <th style={{ ...tableTh, ...tdNum }}>OFFER<br/>/SCRN</th>
            <th style={{ ...tableTh, ...tdNum }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, idx) => {
            const gradeBg = l.grade === 'A' ? '#DCFCE7' : l.grade === 'B' ? '#FFEDD5' : '#F1F5F9'
            const gradeFg = l.grade === 'A' ? '#166534' : l.grade === 'B' ? '#B45309' : '#475569'
            // Phase 81.3.4: drop strikethrough on listed rate.
            // html2canvas was rendering line-through at scale=2 as
            // two parallel lines sandwiching the number, looked like
            // a glitch on owner's UA-2026-0055.
            const hasListed = l.listedRate && l.listedRate !== l.offeredRate
            return (
              <tr key={`${l.sr}-${idx}`}>
                <td style={{ ...tableTd, color: MUTED }}>{l.sr}</td>
                <td style={tableTd}>
                  <div style={{ fontWeight: 600 }}>{l.cityName}</div>
                  {l.station && <div style={{ color: MUTED, fontSize: 9 }}>{l.station}</div>}
                </td>
                <td style={{ ...tableTd, textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 7px',
                    background: gradeBg, color: gradeFg,
                    borderRadius: 8, fontWeight: 700, fontSize: 9,
                  }}>{l.grade || '—'}</span>
                </td>
                <td style={{ ...tableTd, ...tdNum }}>{l.screens}</td>
                <td style={{ ...tableTd, ...tdNum }}>{l.durationMo}mo</td>
                <td style={{ ...tableTd, ...tdNum }}>{l.slotSec}s</td>
                <td style={{ ...tableTd, ...tdNum }}>{l.slotsPerDay}</td>
                <td style={{ ...tableTd, ...tdNum, color: MUTED }}>
                  {hasListed ? formatCurrency(l.listedRate) : '—'}
                </td>
                <td style={{ ...tableTd, ...tdNum, color: '#16a34a', fontWeight: 700 }}>
                  {formatCurrency(l.offeredRate)}
                </td>
                <td style={{ ...tableTd, ...tdNum, fontWeight: 700 }}>{formatCurrency(l.campaignTotal)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Totals + bank — last page only */}
      {isLast && (
        <>
          {/* Phase 81.3.2 — totals block. Was 60% width left-floated
              which produced ragged alignment with the table's
              rightmost column. Now: full-width, two columns where the
              right column matches the table's "Total" column width
              for clean right-alignment. */}
          <div style={{
            marginTop:    4,
            marginBottom: 10,
            display:      'flex',
            justifyContent: 'flex-end',
          }}>
            <div style={{ width: 320 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12, borderBottom: `1px solid ${BORDER}` }}>
                <span style={{ color: MUTED }}>Subtotal</span>
                <span style={{ color: INK, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12, borderBottom: `1px solid ${BORDER}` }}>
                <span style={{ color: MUTED }}>{gstRate > 0 ? `GST (${Math.round(gstRate * 100)}%)` : 'No GST'}</span>
                <span style={{ color: INK, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{gstRate > 0 ? formatCurrency(gstAmount) : '—'}</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '10px 14px', marginTop: 6, background: YELLOW,
                borderRadius: 6, fontSize: 15, fontWeight: 800, color: INK,
              }}>
                <span>Grand Total</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalAmount)}</span>
              </div>
            </div>
          </div>
          {/* Phase 81.3.5 — CPM (Cost Per Mille / 1000 impressions).
              Owner asked for this metric on UA-2026-0053. Industry
              standard OOH benchmark; tells the client the unit cost
              of reach. Formula: (subtotal / total_impressions) × 1000.
              Hidden when impressions = 0 (defensive). */}
          {(() => {
            const totalImps = totalImpressionsFn(allCities)
            if (!totalImps || subtotal <= 0) return null
            const cpm = (subtotal / totalImps) * 1000
            return (
              <div style={{
                marginTop:      4,
                padding:        '10px 14px',
                background:     '#0f172a',
                color:          '#ffffff',
                borderRadius:   6,
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'center',
                fontSize:       11,
              }}>
                {/* Phase 81.3.6 — owner directive: write full form +
                    explicit "per 1000 impressions" so clients reading
                    the PDF without OOH-jargon background still
                    understand the metric. */}
                <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 9, color: '#cbd5e1', lineHeight: 1.3 }}>
                  CPM · Cost Per Mille
                  <br />
                  (Cost per 1,000 Impressions)
                </span>
                <span style={{ fontWeight: 700, fontSize: 14, color: YELLOW, fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(Math.round(cpm))}
                </span>
              </div>
            )
          })()}

          <div style={{
            marginTop: 4, padding: '6px 10px',
            background: SOFT, border: `1px dashed ${BORDER}`,
            borderRadius: 6, fontSize: 10, color: INK,
          }}>
            <b>Total in Words:</b> {inWords}
          </div>

          {/* Phase 81.3.7: compact bank + prepared-by block. Tighter
              line-height + smaller padding so the entire footer
              clears the letterhead's bottom address strip. */}
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${BORDER}`, fontSize: 9.5, color: MUTED, lineHeight: 1.35 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                <div style={{ fontSize: 8, letterSpacing: '0.12em', color: MUTED, textTransform: 'uppercase', marginBottom: 1 }}>Bank</div>
                {company.bank_name && <div><b style={{ color: INK }}>{company.bank_name}</b></div>}
                {company.bank_acc_name && <div>{company.bank_acc_name}</div>}
                {company.bank_acc_number && <div>A/C: {company.bank_acc_number}</div>}
                {company.bank_ifsc && <div>IFSC: {company.bank_ifsc}</div>}
                {company.upi_id && <div>UPI: {company.upi_id}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 8, letterSpacing: '0.12em', color: MUTED, textTransform: 'uppercase', marginBottom: 1 }}>Prepared by</div>
                <div style={{ color: INK, fontWeight: 600 }}>{repName}</div>
                <div>{quote?.quote_number} · {quote?.created_at ? formatDate(quote.created_at) : ''}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Phase 81.2 — per-city photo page + thank-you page ─────────── */
//
// Each page is a fixed-A4 div (794×1123 px) rendered as its own canvas
// via html2canvas, then added as a discrete jsPDF page. Keeping the
// canvas-per-page exactly A4-sized avoids the slicer chopping a photo
// across page boundaries.

function CityPhotoPage({ city /*, quote */ }) {
  // Phase 81.2.1 — owner directive 22 May 2026: "you dont need to
  // write anything in photo just attach photo". City photo PNGs
  // already have city name + screens + impressions burned in. The
  // dark caption strip was duplicating that info and clashing with
  // the image content. Photo now renders full-bleed with zero
  // overlay.
  const cityName = city.city_name || city.name || ''
  return (
    <div style={{
      width:      '794px',
      height:     '1123px',
      position:   'relative',
      background: '#0f172a',
      overflow:   'hidden',
    }}>
      <img
        src={city.photo_url}
        alt={cityName}
        crossOrigin="anonymous"
        style={{
          width:     '100%',
          height:    '100%',
          objectFit: 'cover',
          display:   'block',
        }}
      />
    </div>
  )
}

function ThankYouPage({ url }) {
  return (
    <div style={{
      width:    '794px',
      height:   '1123px',
      position: 'relative',
      background: '#ffffff',
      overflow: 'hidden',
    }}>
      <img
        src={url}
        alt="Thank you"
        crossOrigin="anonymous"
        style={{
          width:     '100%',
          height:    '100%',
          objectFit: 'cover',
          display:   'block',
        }}
      />
    </div>
  )
}

/* ─── Phase 81.2 — enrichment helpers ───────────────────────────── */

/**
 * Resolve master cities photo_url + companies.thank_you_url from the
 * DB. Both are needed for the multi-page PDF.
 */
async function enrichCitiesWithPhotos(cities) {
  if (!cities?.length) return cities
  const ids = [...new Set(
    cities.map(c => c.city_id || c.city?.id).filter(Boolean)
  )]
  if (!ids.length) return cities
  const { data, error } = await supabase
    .from('cities')
    .select('id, photo_url')
    .in('id', ids)
  if (error || !data) return cities
  const photoMap = Object.fromEntries(data.map(m => [m.id, m.photo_url]))
  return cities.map(c => ({
    ...c,
    photo_url: c.photo_url || photoMap[c.city_id || c.city?.id] || null,
  }))
}

/* ─── Snapshot helper (mirrors GovtProposalDetailV2 combined-pdf) ─── */

const A4_WIDTH_PX  = 794
const A4_HEIGHT_PX = 1123

/**
 * Render a React tree into an off-screen wrapper, capture with
 * html2canvas, return the canvas. Caller adds it to the jsPDF.
 */
async function captureToCanvas(jsx, { fixedHeight = null } = {}) {
  const wrapper = document.createElement('div')
  wrapper.style.position   = 'fixed'
  wrapper.style.left       = '-100000px'
  wrapper.style.top        = '0'
  wrapper.style.width      = `${A4_WIDTH_PX}px`
  if (fixedHeight) wrapper.style.height = `${fixedHeight}px`
  wrapper.style.background = '#ffffff'
  wrapper.style.zIndex     = '-1'
  document.body.appendChild(wrapper)

  const root = createRoot(wrapper)
  await new Promise((resolve) => {
    root.render(jsx)
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })

  let canvas
  try {
    canvas = await html2canvas(wrapper, {
      scale:           2,
      backgroundColor: '#ffffff',
      useCORS:         true,
      logging:         false,
      width:           A4_WIDTH_PX,
      windowWidth:     A4_WIDTH_PX,
      height:          fixedHeight || undefined,
      windowHeight:    fixedHeight || undefined,
    })
  } finally {
    try { root.unmount() } catch { /* ignore */ }
    if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper)
  }
  return canvas
}

async function renderToPdfBlob(quote, cities, company) {
  // Phase 81.2 — enrich cities with master photo_url so each city's
  // photo page can render. Best-effort: failure just skips that
  // city's page silently (no broken-image placeholder).
  const enrichedCities = await enrichCitiesWithPhotos(cities)
  const thankYouUrl    = company?.thank_you_url || null

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidthMm  = 210
  const pageHeightMm = 297
  let isFirstSlice = true

  /**
   * Slice a tall canvas into A4-height jsPDF pages. For exactly-A4
   * canvases (photo / thank-you) the loop runs once.
   */
  function addCanvasAsPages(canvas) {
    if (!canvas.width || !canvas.height) return
    const pxPerMm = canvas.width / pageWidthMm
    const pageHpx = Math.floor(pageHeightMm * pxPerMm)
    let remaining = canvas.height
    let yOffsetPx = 0
    while (remaining > 0) {
      const sliceHpx = Math.min(pageHpx, remaining)
      // Drop tiny tail slices (<5%) that would render as a blank
      // page. Only applies after we've already added at least one
      // slice for this canvas.
      if (yOffsetPx > 0 && sliceHpx < pageHpx * 0.05) break
      if (!isFirstSlice) pdf.addPage()
      isFirstSlice = false
      const slice = document.createElement('canvas')
      slice.width  = canvas.width
      slice.height = sliceHpx
      slice.getContext('2d').drawImage(
        canvas,
        0, yOffsetPx, canvas.width, sliceHpx,
        0, 0,         canvas.width, sliceHpx,
      )
      const sliceData = slice.toDataURL('image/jpeg', 0.92)
      const sliceMm = Math.min(sliceHpx / pxPerMm, pageHeightMm)
      pdf.addImage(sliceData, 'JPEG', 0, 0, pageWidthMm, sliceMm, undefined, 'FAST')
      yOffsetPx += sliceHpx
      remaining -= sliceHpx
    }
  }

  // Phase 81.3 — letterhead path uses paginated QuotePage. Each
  // chunk is rendered at exactly 794×1123 with the letterhead PNG
  // as background + safe-zone padding + overflow hidden. Slicer
  // therefore never stretches the letterhead, and every page has
  // the letterhead chrome.
  const letterheadOn = !!company?.letterhead_url
  if (letterheadOn) {
    const pages = paginateCities(enrichedCities)
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]
      const pageCanvas = await captureToCanvas(
        <QuotePage
          quote={quote}
          company={company}
          cityChunk={p.cities}
          allCities={enrichedCities}
          isFirst={p.isFirst}
          isLast={p.isLast}
          pageIndex={i + 1}
          totalPages={pages.length}
        />,
        { fixedHeight: A4_HEIGHT_PX },
      )
      addCanvasAsPages(pageCanvas)
    }
  } else {
    // No-letterhead fallback: single render with legacy chrome
    // (yellow headBand + dark titleBand). Slicer handles overflow.
    const page1 = await captureToCanvas(
      <QuotePDFHtmlDocument quote={quote} cities={enrichedCities} company={company} />
    )
    if (!page1.width || !page1.height) {
      throw new Error(
        'PDF render captured an empty canvas — the quote DOM has no layout. ' +
        'Reload the page and try again.'
      )
    }
    addCanvasAsPages(page1)
  }

  // PHOTO PAGES — one A4 per city with photo_url. Cities without a
  // photo are skipped (no blank pages).
  for (const c of enrichedCities) {
    if (!c.photo_url) continue
    const photoCanvas = await captureToCanvas(
      <CityPhotoPage city={c} quote={quote} />,
      { fixedHeight: A4_HEIGHT_PX },
    )
    addCanvasAsPages(photoCanvas)
  }

  // THANK-YOU PAGE — last A4 if admin uploaded one in Master.
  if (thankYouUrl) {
    const tyCanvas = await captureToCanvas(
      <ThankYouPage url={thankYouUrl} />,
      { fixedHeight: A4_HEIGHT_PX },
    )
    addCanvasAsPages(tyCanvas)
  }

  return pdf.output('blob')
}

/* ─── Public API ─────────────────────────────────────────────────── */

export async function downloadQuotePDFHtml(quote, cities = []) {
  const company = await fetchCompanyForQuote(quote)
  const blob    = await renderToPdfBlob(quote, cities, company)
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href     = url
  a.download = `${(quote?.quote_number || 'quote').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

export async function uploadQuotePDFHtml(quote, cities = []) {
  const company = await fetchCompanyForQuote(quote)
  const blob    = await renderToPdfBlob(quote, cities, company)
  const ts      = Date.now()
  const safeNumber = (quote?.quote_number || 'quote').replace(/[^A-Za-z0-9_-]/g, '_')
  const path    = `${safeNumber}/${ts}.pdf`

  const { error: uploadErr } = await supabase
    .storage
    .from('quote-pdfs')
    .upload(path, blob, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadErr) throw new Error(`PDF upload failed: ${uploadErr.message}`)

  const { data } = supabase.storage.from('quote-pdfs').getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('PDF uploaded but no public URL was returned — check bucket is public.')
  return data.publicUrl
}
