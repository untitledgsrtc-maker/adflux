// src/components/quotes/OtherMediaQuotePDF.jsx
//
// Phase 15 rev2 — Other Media (private) quotation PDF.
//
// Owner directive (6 May 2026): "use private LED quote PDF format,
// only GST 18% — no HSN/SAC, no CGST/SGST split". So this file mirrors
// the structure of `QuotePDF.jsx` (yellow header band, dark MEDIA
// QUOTATION title, client box, line table, Investment Summary with
// single GST line, Grand Total hero, T&C, signatures, dual footer)
// and only differs in:
//   • Line table columns: Sr / Media + Description / Qty / Rate / Amount
//     (no Grade / Screens / Size / Spots / Duration — LED-specific.)
//   • LED-specific blocks dropped: network stats bar, photo gallery,
//     "Why GSRTC" box, footer's "264 screens" highlight.
//   • Title strip says "Private — Other Media" under MEDIA QUOTATION
//     so the rep / client can see at a glance which kind of quote it is.
//
// Companies row is read by segment='PRIVATE' (Untitled Adflux Pvt Ltd).
// Hard-fails on missing company or zero subtotal — same money-safety
// guards as QuotePDF.

import {
  Document, Page, Text, View, StyleSheet, Font, pdf,
} from '@react-pdf/renderer'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { rupeesToWords } from '../../utils/numberToWords'
import { supabase } from '../../lib/supabase'

// Same Roboto registration as QuotePDF.jsx — Helvetica's missing ₹
// glyph is the reason this exists.
//
// Phase 34P — register numeric weights AND string aliases. Newer
// @react-pdf/renderer fails on the implicit `fontWeight: 400` from
// JSX defaults if only 'normal' is registered. Add both so lookups
// resolve regardless of weight spelling.
Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 'normal' },
    { src: '/fonts/Roboto-Bold.ttf',    fontWeight: 700 },
    { src: '/fonts/Roboto-Bold.ttf',    fontWeight: 'bold' },
  ],
})
Font.registerHyphenationCallback(word => [word])

const YELLOW = '#FFE600'    // brand yellow per tokens.css — NOT #facc15
const DARK   = '#0f172a'
const GRAY   = '#64748b'
const LGRAY  = '#94a3b8'
const BORDER = '#e2e8f0'
const WHITE  = '#ffffff'

const S = StyleSheet.create({
  page: {
    backgroundColor: WHITE,
    fontFamily: 'Roboto',
    fontSize: 9,
    color: DARK,
  },

  // ── Top header band ──
  headerBand: {
    backgroundColor: DARK,
    paddingHorizontal: 32,
    paddingVertical: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  uaBadge: {
    backgroundColor: YELLOW,
    width: 36, height: 36,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uaBadgeText: {
    fontFamily: 'Roboto', fontWeight: 'bold',
    fontSize: 14,
    color: DARK,
  },
  brandBlock: { gap: 2 },
  brandName: { fontSize: 14, fontFamily: 'Roboto', fontWeight: 'bold', color: WHITE },
  brandSub:  { fontSize: 8,  color: LGRAY },
  brandNetwork: { fontSize: 8, color: LGRAY, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', gap: 3 },
  headerWebsite: { fontSize: 9, color: YELLOW },
  headerEmail:   { fontSize: 9, color: LGRAY },

  // ── Media quotation title block ──
  titleBlock: {
    backgroundColor: DARK,
    paddingHorizontal: 32,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mediaQuotationText: {
    fontSize: 22,
    fontFamily: 'Roboto', fontWeight: 'bold',
    color: YELLOW,
    letterSpacing: 1,
  },
  quoteMetaRight: { alignItems: 'flex-end', gap: 3 },
  quoteNumText: { fontSize: 11, fontFamily: 'Roboto', fontWeight: 'bold', color: WHITE },
  quoteDateSmall: { fontSize: 8, color: LGRAY },
  quoteValid: { fontSize: 8, color: LGRAY },

  // ── Body ──
  body: { paddingHorizontal: 32, paddingTop: 20, paddingBottom: 20 },

  // ── Section heading ──
  sectionBar: {
    borderLeft: '3pt solid ' + YELLOW,
    paddingLeft: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 9, fontFamily: 'Roboto', fontWeight: 'bold',
    color: DARK, textTransform: 'uppercase', letterSpacing: 0.8,
  },

  // ── Client box ──
  clientBox: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    padding: '12 16',
    marginBottom: 20,
    flexDirection: 'row',
    gap: 30,
  },
  clientCol: { flex: 1 },
  clientFieldLabel: { fontSize: 7, color: LGRAY, marginBottom: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  clientFieldValue: { fontSize: 10, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK, marginBottom: 8 },

  // ── Line items table ──
  // Column budget at A4 with 32pt margins → 531pt usable.
  // Sr 22 + Qty 50 + Rate 80 + Amount 90 = 242. Media flex absorbs ~289pt,
  // which fits "Newspaper" + a 2-line description without wrapping awkwardly.
  tableSection: { marginBottom: 20 },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: DARK,
    padding: '6 8',
  },
  tableRow: {
    flexDirection: 'row',
    padding: '7 8',
    borderBottom: '0.5pt solid ' + BORDER,
  },
  tableRowAlt: { backgroundColor: '#f8fafc' },
  thText: { fontSize: 7, fontFamily: 'Roboto', fontWeight: 'bold', color: WHITE, textTransform: 'uppercase', letterSpacing: 0.4 },
  tdText: { fontSize: 8.5, color: DARK },
  tdBold: { fontSize: 8.5, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  tdMuted:{ fontSize: 7.5, color: GRAY, marginTop: 1 },

  colSr:     { width: 22 },
  colMedia:  { flex: 1, paddingRight: 8 },
  colQty:    { width: 50, alignItems: 'center' },
  colRate:   { width: 80, alignItems: 'flex-end' },
  colTotal:  { width: 90, alignItems: 'flex-end' },

  tableFootRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f1f5f9',
    padding: '7 8',
  },
  tableFootLabel: { fontSize: 8, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  tableFootValue: { fontSize: 8, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },

  // ── Investment Summary ──
  investSection: { marginBottom: 20 },
  investBox: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    overflow: 'hidden',
  },
  investRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: '8 14',
    borderBottom: '0.5pt solid ' + BORDER,
  },
  investLabel: { fontSize: 9, color: GRAY },
  investValue: { fontSize: 9, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },

  grandHero: {
    backgroundColor: DARK,
    borderRadius: 6,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  grandHeroLabel: {
    fontSize: 13, fontFamily: 'Roboto', fontWeight: 'bold',
    color: YELLOW, letterSpacing: 1,
  },
  grandHeroValue: {
    fontSize: 18, fontFamily: 'Roboto', fontWeight: 'bold',
    color: YELLOW,
  },
  // Phase 34.8 — "Total in Words" line under Grand Total. CLAUDE.md
  // §18 mandates it on every invoice / quotation PDF.
  grandHeroWords: {
    fontSize: 9,
    fontFamily: 'Roboto',
    color: DARK,
    paddingHorizontal: 20,
    paddingVertical: 6,
    marginBottom: 12,
    fontStyle: 'italic',
  },

  // ── Terms ──
  termsBox: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    padding: '12 14',
    marginBottom: 16,
  },
  termsTitle: {
    fontSize: 8, fontFamily: 'Roboto', fontWeight: 'bold',
    color: DARK, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 7,
  },
  termItem: { flexDirection: 'row', gap: 5, marginBottom: 4 },
  termNum:  { fontSize: 7.5, color: GRAY, width: 12 },
  termText: { fontSize: 7.5, color: GRAY, flex: 1, lineHeight: 1.4 },

  // ── Signature row ──
  sigRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sigBlock: { alignItems: 'center', width: 160 },
  sigLine:  { width: 140, borderBottom: '0.5pt solid #cbd5e1', marginBottom: 4 },
  sigLabel: { fontSize: 7.5, color: GRAY },

  // ── Footer ──
  footerBand: {
    backgroundColor: YELLOW,
    paddingHorizontal: 32,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerPrepared: { fontSize: 7.5, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  footerQuoteRef: { fontSize: 7.5, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  footerBottomBand: {
    backgroundColor: DARK,
    paddingHorizontal: 32,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerBottomText: { fontSize: 7, color: LGRAY },
})

// ── Document ─────────────────────────────────────────────────────────
function OtherMediaQuoteDocument({ quote, lines, company }) {
  // Same hard-fails as QuotePDF — refuse to render the wrong legal
  // entity or a ₹0 invoice.
  if (!company) {
    throw new Error(
      'OtherMediaQuotePDF: companies row is required. ' +
      'fetchCompanyForQuote() must run before render. ' +
      `Quote segment=${String(quote?.segment)}, no row found.`
    )
  }
  if (company.segment && quote?.segment && company.segment !== quote.segment) {
    throw new Error(
      `OtherMediaQuotePDF: segment mismatch — quote.segment=${quote.segment} but ` +
      `company.segment=${company.segment}. Refusing to render the wrong legal entity.`
    )
  }
  const co = company

  const subtotal    = Number(quote.subtotal)
  const gstAmount   = Number(quote.gst_amount) || 0
  const totalAmount = Number(quote.total_amount)
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    throw new Error(
      'OtherMediaQuotePDF: subtotal must be > 0. ' +
      `Got subtotal=${quote?.subtotal}.`
    )
  }
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error(
      'OtherMediaQuotePDF: total_amount must be > 0. ' +
      `Got total_amount=${quote?.total_amount}.`
    )
  }

  const rate   = quote.gst_rate !== null && quote.gst_rate !== undefined ? Number(quote.gst_rate) : 0.18
  const gstPct = Math.round(rate * 100)
  const gstApplies = rate > 0
  const gstLabel = gstApplies ? `GST @${gstPct}%` : 'No GST'

  const TERMS = [
    'Quotation valid for 30 days from date of issue. Rates subject to change post-expiry.',
    '50% advance payment required to confirm booking. Balance payable before campaign go-live.',
    'Final creative / artwork to be submitted at least 3 working days before campaign go-live, in the format and dimensions specified by the media partner.',
    gstApplies
      ? `GST @${gstPct}% is levied on campaign value and is included in the Grand Total above.`
      : 'No GST is applied to this quotation. The Grand Total is the final payable amount.',
    'Booking confirmation subject to slot / inventory availability with the underlying media at time of payment.',
    'Cancellation post-confirmation: 25% cancellation fee applicable on total invoice.',
    'Content violating law, statutory codes, or community standards may be rejected by the media partner without refund.',
    `Payments via NEFT/RTGS/Cheque in favour of ${co.bank_acc_name || co.name}.${co.bank_name ? ` ${co.bank_name}` : ''}${co.bank_branch ? ` (${co.bank_branch} branch)` : ''}${co.bank_acc_number ? `. A/c No. ${co.bank_acc_number}` : ''}${co.bank_ifsc ? ` · IFSC ${co.bank_ifsc}` : ''}${co.gstin ? `. GSTIN: ${co.gstin}` : ''}.`,
  ]

  return (
    <Document>
      <Page size="A4" style={S.page}>

        {/* ── Top header band ── */}
        <View style={S.headerBand}>
          <View style={S.headerLeft}>
            <View style={S.uaBadge}>
              <Text style={S.uaBadgeText}>UA</Text>
            </View>
            <View style={S.brandBlock}>
              <Text style={S.brandName}>UNTITLED ADVERTISING</Text>
              <Text style={S.brandSub}>{(co.name || 'UNTITLED ADFLUX PRIVATE LIMITED').toUpperCase()}</Text>
              <Text style={S.brandNetwork}>Newspaper · Hoarding · Cinema · Mall · Digital · Radio</Text>
            </View>
          </View>
          <View style={S.headerRight}>
            <Text style={S.headerWebsite}>{co.website || 'untitledad.in'}</Text>
            <Text style={S.headerEmail}>{co.email || 'hello@untitledad.in'}</Text>
          </View>
        </View>

        {/* ── Title block ── */}
        <View style={S.titleBlock}>
          <Text style={S.mediaQuotationText}>MEDIA QUOTATION</Text>
          <View style={S.quoteMetaRight}>
            <Text style={S.quoteNumText}>{quote.quote_number}</Text>
            <Text style={S.quoteDateSmall}>{formatDate(quote.proposal_date || quote.created_at)}</Text>
            <Text style={S.quoteValid}>Valid 30 Days</Text>
          </View>
        </View>

        {/* ── Body ── */}
        <View style={S.body}>

          {/* Client */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Prepared Exclusively For</Text>
          </View>
          <View style={S.clientBox}>
            <View style={S.clientCol}>
              <Text style={S.clientFieldLabel}>Client Name</Text>
              <Text style={S.clientFieldValue}>{quote.client_name || '—'}</Text>
              <Text style={S.clientFieldLabel}>Company</Text>
              <Text style={S.clientFieldValue}>{quote.client_company || '—'}</Text>
            </View>
            <View style={S.clientCol}>
              <Text style={S.clientFieldLabel}>Phone</Text>
              <Text style={S.clientFieldValue}>{quote.client_phone || '—'}</Text>
              <Text style={S.clientFieldLabel}>Email</Text>
              <Text style={S.clientFieldValue}>{quote.client_email || '—'}</Text>
            </View>
          </View>

          {/* Campaign period if set */}
          {quote.campaign_start_date && quote.campaign_end_date && (
            <View style={{ marginBottom: 16, paddingLeft: 8 }}>
              <Text style={{ fontSize: 9, color: GRAY }}>
                Campaign Period: {formatDate(quote.campaign_start_date)} — {formatDate(quote.campaign_end_date)}
              </Text>
            </View>
          )}

          {/* Line items table */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Quotation Items</Text>
          </View>
          <View style={S.tableSection}>
            <View style={S.tableHead}>
              <View style={S.colSr}><Text style={S.thText}>SR</Text></View>
              <View style={S.colMedia}><Text style={S.thText}>Media · Description</Text></View>
              <View style={S.colQty}><Text style={[S.thText, { textAlign: 'center' }]}>Qty</Text></View>
              <View style={S.colRate}><Text style={[S.thText, { textAlign: 'right' }]}>Rate</Text></View>
              <View style={S.colTotal}><Text style={[S.thText, { textAlign: 'right' }]}>Amount</Text></View>
            </View>

            {(lines || []).map((l, i) => {
              // The wizard saves the media name in city_name and the
              // pure description in description. Older rows may have a
              // "<media>: <desc>" prefix in description; strip it on
              // display so the gallery doesn't read "Newspaper: Newspaper:".
              const mediaName = l.city_name || ''
              const rawDesc   = l.description || ''
              const cleanDesc = (mediaName && rawDesc.startsWith(`${mediaName}: `))
                ? rawDesc.slice(mediaName.length + 2)
                : rawDesc
              const amount = Number(l.amount || (Number(l.qty || 0) * Number(l.unit_rate || 0)))
              return (
                <View key={l.id || i} style={[S.tableRow, i % 2 === 1 && S.tableRowAlt]} wrap={false}>
                  <View style={S.colSr}><Text style={S.tdMuted}>{i + 1}</Text></View>
                  <View style={S.colMedia}>
                    <Text style={S.tdBold}>{mediaName}</Text>
                    {cleanDesc ? <Text style={S.tdMuted}>{cleanDesc}</Text> : null}
                  </View>
                  <View style={S.colQty}>
                    <Text style={[S.tdText, { textAlign: 'center' }]}>
                      {Number(l.qty || 0)}{l.unit ? ` ${l.unit}` : ''}
                    </Text>
                  </View>
                  <View style={S.colRate}>
                    <Text style={[S.tdText, { textAlign: 'right' }]}>
                      {formatCurrency(l.unit_rate)}
                    </Text>
                  </View>
                  <View style={S.colTotal}>
                    <Text style={[S.tdBold, { textAlign: 'right' }]}>
                      {formatCurrency(amount)}
                    </Text>
                  </View>
                </View>
              )
            })}

            <View style={S.tableFootRow}>
              <Text style={S.tableFootLabel}>
                {(lines || []).length} item{(lines || []).length !== 1 ? 's' : ''}
              </Text>
              <Text style={S.tableFootValue}>Subtotal   {formatCurrency(subtotal)}</Text>
            </View>
          </View>

          {/* Investment Summary */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Investment Summary</Text>
          </View>
          <View style={S.investSection}>
            <View style={S.investBox}>
              <View style={S.investRow}>
                <Text style={S.investLabel}>Subtotal</Text>
                <Text style={S.investValue}>{formatCurrency(subtotal)}</Text>
              </View>
              <View style={[S.investRow, { borderBottom: 'none' }]}>
                <Text style={S.investLabel}>{gstLabel}</Text>
                <Text style={S.investValue}>
                  {gstApplies ? formatCurrency(gstAmount) : '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* Grand Total hero */}
          <View style={S.grandHero}>
            <Text style={S.grandHeroLabel}>GRAND TOTAL (INR)</Text>
            <Text style={S.grandHeroValue}>{formatCurrency(totalAmount)}</Text>
          </View>

          {/* Phase 34.8 — Total in Words. CLAUDE.md §18 mandates this
              on every invoice / quotation PDF; Indian lakh/crore
              numbering via rupeesToWords(). */}
          <Text style={S.grandHeroWords}>
            Amount in Words: {rupeesToWords(totalAmount)}
          </Text>

          {/* Terms */}
          <View style={S.termsBox}>
            <Text style={S.termsTitle}>Terms &amp; Conditions</Text>
            {TERMS.map((t, i) => (
              <View key={i} style={S.termItem}>
                <Text style={S.termNum}>{i + 1}.</Text>
                <Text style={S.termText}>{t}</Text>
              </View>
            ))}
          </View>

          {/* Signatures */}
          <View style={S.sigRow}>
            <View style={S.sigBlock}>
              <View style={S.sigLine} />
              <Text style={S.sigLabel}>For {co.short_name || co.name}</Text>
              <Text style={[S.sigLabel, { marginTop: 1 }]}>Authorised Signatory &amp; Stamp</Text>
            </View>
            <View style={S.sigBlock}>
              <View style={S.sigLine} />
              <Text style={S.sigLabel}>Client Acceptance</Text>
              <Text style={[S.sigLabel, { marginTop: 1 }]}>Name, Designation &amp; Company Stamp</Text>
            </View>
          </View>

        </View>

        {/* ── Footer ── */}
        <View style={S.footerBand}>
          <Text style={S.footerPrepared}>
            Prepared by: {quote.sales_person_name || 'Sales Executive'}
          </Text>
          <Text style={S.footerQuoteRef}>
            Quote: {quote.quote_number} · {formatDate(quote.created_at)}
          </Text>
        </View>
        <View style={S.footerBottomBand}>
          <Text style={S.footerBottomText}>{co.website || 'untitledad.in'} | {co.email || 'hello@untitledad.in'}</Text>
          <Text style={S.footerBottomText}>{co.gstin ? `GSTIN: ${co.gstin}` : ''}</Text>
        </View>

      </Page>
    </Document>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────
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

/**
 * Download the Other Media quotation PDF for a given quote + line items.
 * Mirrors `downloadQuotePDF` from QuotePDF.jsx: fetch the company row,
 * render the @react-pdf document, save as `${quote_number}.pdf`.
 *
 * Param shape kept as `{ quote, lines }` so existing callers
 * (`QuoteDetail.handleDownloadPDF`) don't change.
 */
export async function downloadOtherMediaPdf({ quote, lines }) {
  const company = await fetchCompanyForQuote(quote)
  const blob = await pdf(
    <OtherMediaQuoteDocument quote={quote} lines={lines || []} company={company} />
  ).toBlob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${(quote.quote_number || 'quotation').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Optional: upload the PDF to the public quote-pdfs bucket and return
 * the public URL. Mirrors `uploadQuotePDF` from QuotePDF.jsx so a future
 * "Send via WhatsApp" flow on Other Media quotes can reuse it.
 */
export async function uploadOtherMediaPdf({ quote, lines }) {
  const company = await fetchCompanyForQuote(quote)
  const blob = await pdf(
    <OtherMediaQuoteDocument quote={quote} lines={lines || []} company={company} />
  ).toBlob()
  const ts   = Date.now()
  const safeNumber = (quote.quote_number || 'quote').replace(/[^A-Za-z0-9_-]/g, '_')
  const path = `${safeNumber}/${ts}.pdf`
  const { error: uploadErr } = await supabase.storage
    .from('quote-pdfs')
    .upload(path, blob, { contentType: 'application/pdf', upsert: false })
  if (uploadErr) {
    throw new Error(`Other Media PDF upload failed: ${uploadErr.message}`)
  }
  const { data } = supabase.storage.from('quote-pdfs').getPublicUrl(path)
  return data?.publicUrl || null
}
