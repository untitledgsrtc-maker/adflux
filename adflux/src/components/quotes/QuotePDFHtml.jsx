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

  const styles = {
    page: {
      width: '794px',
      minHeight: '1123px',
      background: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      color: INK,
      boxSizing: 'border-box',
      padding: 0,
      margin: 0,
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

    body:   { padding: '20px 32px' },
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

  // Coerce city rows into a normalised line-item shape.
  const lines = cities.map((c, i) => {
    const desc = c.city_name || c.name || `Line ${i + 1}`
    const qty  = Number(c.qty || c.quantity || c.spots_per_month || 1) || 1
    const rate = Number(c.rate || c.unit_rate || c.monthly_rate || 0) || 0
    const amount = Number(c.amount || (qty * rate)) || 0
    const meta = [c.media_type, c.screens && `${c.screens} screens`, c.size]
      .filter(Boolean).join(' · ')
    return { desc, meta, qty, rate, amount }
  })

  return (
    <div style={styles.page}>
      <div style={styles.headBand}>
        <div>
          <div style={styles.headBrand}>{company.name || 'Untitled Advertising'}</div>
          <div style={styles.headSub}>{company.address || ''}</div>
          <div style={styles.headSub}>GSTIN: {company.gstin || '—'}</div>
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

      <div style={styles.body}>
        <div style={styles.sectionTitle}>Bill To</div>
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

        <div style={styles.sectionTitle}>Line Items</div>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: 32 }}>#</th>
              <th style={styles.th}>Description</th>
              <th style={{ ...styles.th, ...styles.tdNum, width: 60 }}>Qty</th>
              <th style={{ ...styles.th, ...styles.tdNum, width: 90 }}>Rate</th>
              <th style={{ ...styles.th, ...styles.tdNum, width: 110 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={styles.td}>{i + 1}</td>
                <td style={styles.td}>
                  <div style={{ fontWeight: 600 }}>{l.desc}</div>
                  {l.meta && <div style={{ color: MUTED, fontSize: 9 }}>{l.meta}</div>}
                </td>
                <td style={{ ...styles.td, ...styles.tdNum }}>{l.qty}</td>
                <td style={{ ...styles.td, ...styles.tdNum }}>{formatCurrency(l.rate)}</td>
                <td style={{ ...styles.td, ...styles.tdNum }}>{formatCurrency(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={styles.summary}>
          <div style={styles.sumRow}>
            <span style={styles.sumLabel}>Subtotal</span>
            <span style={styles.sumValue}>{formatCurrency(subtotal)}</span>
          </div>
          <div style={styles.sumRow}>
            <span style={styles.sumLabel}>GST ({Math.round(gstRate * 100)}%)</span>
            <span style={styles.sumValue}>{formatCurrency(gstAmount)}</span>
          </div>
          <div style={styles.grandRow}>
            <span>Grand Total</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>
          <div style={styles.inWords}>
            <b>Total in Words:</b> {inWords}
          </div>
        </div>
      </div>

      <div style={styles.footer}>
        <div style={styles.footerRow}>
          <div style={styles.footerCell}>
            <div style={styles.footerLabel}>Bank</div>
            <div style={styles.footerValue}>{company.bank_name || ''}</div>
            <div>{company.bank_branch ? `Branch: ${company.bank_branch}` : ''}</div>
            <div>{company.bank_account ? `A/C: ${company.bank_account}` : ''}</div>
            <div>{company.bank_ifsc ? `IFSC: ${company.bank_ifsc}` : ''}</div>
          </div>
          <div style={styles.footerCell}>
            <div style={styles.footerLabel}>Contact</div>
            <div>{company.contact_phone || ''}</div>
            <div>{company.contact_email || ''}</div>
            <div>{company.website || ''}</div>
          </div>
          <div style={{ ...styles.footerCell, textAlign: 'right' }}>
            <div style={styles.footerLabel}>Prepared by</div>
            <div style={styles.footerValue}>{quote?.sales_person_name || 'Sales Executive'}</div>
            <div>{quote?.quote_number} · {quote?.created_at ? formatDate(quote.created_at) : ''}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Snapshot helper (mirrors GovtProposalDetailV2 combined-pdf) ─── */

async function renderToPdfBlob(quote, cities, company) {
  const html2canvas = (await import('html2canvas')).default
  const { jsPDF }    = await import('jspdf')

  const A4_WIDTH_PX = 794
  const wrapper = document.createElement('div')
  wrapper.style.position   = 'fixed'
  wrapper.style.left       = '-100000px'
  wrapper.style.top        = '0'
  wrapper.style.width      = `${A4_WIDTH_PX}px`
  wrapper.style.background = '#ffffff'
  wrapper.style.zIndex     = '-1'
  document.body.appendChild(wrapper)

  const root = createRoot(wrapper)
  await new Promise((resolve) => {
    root.render(<QuotePDFHtmlDocument quote={quote} cities={cities} company={company} />)
    // Two RAFs ensure layout settles before snapshot.
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })

  let canvas
  try {
    canvas = await html2canvas(wrapper, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: A4_WIDTH_PX,
      windowWidth: A4_WIDTH_PX,
    })
  } finally {
    try { root.unmount() } catch { /* ignore */ }
    if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper)
  }

  if (!canvas.width || !canvas.height) {
    throw new Error(
      'PDF render captured an empty canvas — the quote DOM has no layout. ' +
      'Reload the page and try again.'
    )
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidthMm  = 210
  const pageHeightMm = 297
  const pxPerMm      = canvas.width / pageWidthMm
  const pageHpx      = Math.floor(pageHeightMm * pxPerMm)

  let remaining = canvas.height
  let yOffsetPx = 0
  let isFirstPage = true
  while (remaining > 0) {
    const sliceHpx = Math.min(pageHpx, remaining)
    if (!isFirstPage && sliceHpx < pageHpx * 0.05) break
    if (!isFirstPage) pdf.addPage()
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
    isFirstPage = false
    yOffsetPx += sliceHpx
    remaining -= sliceHpx
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
