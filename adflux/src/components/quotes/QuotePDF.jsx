// src/components/quotes/QuotePDF.jsx
// Matches Untitled Adflux brand PDF exactly:
// Yellow header block, UA logo, stats bar, location table with SR#, investment summary, T&C, footer
import {
  Document, Page, Text, View, StyleSheet, pdf,
} from '@react-pdf/renderer'
import { formatCurrency, formatDate } from '../../utils/formatters'

const YELLOW = '#FFE600'
const DARK   = '#0f172a'
const GRAY   = '#64748b'
const LGRAY  = '#94a3b8'
const BORDER = '#e2e8f0'
const WHITE  = '#ffffff'

const S = StyleSheet.create({
  page: {
    backgroundColor: WHITE,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: DARK,
  },

  // ── TOP HEADER BAND ──────────────────────────────
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
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    color: DARK,
  },
  brandBlock: { gap: 2 },
  brandName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: WHITE },
  brandSub:  { fontSize: 8,  color: LGRAY },
  brandNetwork: { fontSize: 8, color: LGRAY, marginTop: 2 },
  headerRight: { alignItems: 'flex-end', gap: 3 },
  headerWebsite: { fontSize: 9, color: YELLOW },
  headerEmail:   { fontSize: 9, color: LGRAY },

  // ── STATS BAR ──────────────────────────────────
  statsBar: {
    backgroundColor: YELLOW,
    flexDirection: 'row',
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum:  { fontSize: 16, fontFamily: 'Helvetica-Bold', color: DARK },
  statLabel:{ fontSize: 7,  color: DARK, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 },

  // ── MEDIA QUOTATION TITLE BLOCK ────────────────
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
    fontFamily: 'Helvetica-Bold',
    color: YELLOW,
    letterSpacing: 1,
  },
  quoteMetaRight: { alignItems: 'flex-end', gap: 3 },
  quoteNumText: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: WHITE },
  quoteDateSmall: { fontSize: 8, color: LGRAY },
  quoteValid: { fontSize: 8, color: LGRAY },

  // ── BODY PADDING ──────────────────────────────
  body: { paddingHorizontal: 32, paddingTop: 20, paddingBottom: 20 },

  // ── SECTION HEADING ──────────────────────────
  sectionBar: {
    borderLeft: '3pt solid ' + YELLOW,
    paddingLeft: 8,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: DARK, textTransform: 'uppercase', letterSpacing: 0.8 },

  // ── CLIENT BOX ──────────────────────────────
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
  clientFieldValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 8 },

  // ── CAMPAIGN AT A GLANCE ─────────────────────
  glanceRow: {
    flexDirection: 'row',
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    marginBottom: 20,
    overflow: 'hidden',
  },
  glanceItem: {
    flex: 1,
    alignItems: 'center',
    padding: '10 6',
    borderRight: '0.5pt solid ' + BORDER,
  },
  glanceNum:   { fontSize: 14, fontFamily: 'Helvetica-Bold', color: DARK },
  glanceLabel: { fontSize: 7, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  // ── LOCATION TABLE ──────────────────────────
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
  thText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: WHITE, textTransform: 'uppercase', letterSpacing: 0.4 },
  tdText: { fontSize: 8.5, color: DARK },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: DARK },
  tdMuted:{ fontSize: 7.5, color: GRAY },
  colSr:       { width: 22 },
  colCity:     { flex: 2.2 },
  colGrade:    { width: 36, alignItems: 'center' },
  colScreens:  { width: 44, alignItems: 'center' },
  colSize:     { width: 36, alignItems: 'center' },
  colSpots:    { width: 50, alignItems: 'center' },
  colDuration: { width: 44, alignItems: 'center' },
  colRate:     { width: 60, alignItems: 'flex-end' },
  colTotal:    { width: 60, alignItems: 'flex-end' },

  tableFootRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f1f5f9',
    padding: '7 8',
  },
  tableFootLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: DARK },
  tableFootValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: DARK },

  // ── INVESTMENT SUMMARY ──────────────────────
  investSection: { marginBottom: 20 },
  investBox: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    overflow: 'hidden',
    alignSelf: 'flex-end',
    width: 240,
  },
  investRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: '8 14',
    borderBottom: '0.5pt solid ' + BORDER,
  },
  investLabel: { fontSize: 9, color: GRAY },
  investValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: DARK },
  investGrandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: '10 14',
    backgroundColor: YELLOW,
  },
  investGrandLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: DARK },
  investGrandValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: DARK },

  // ── WHY BOX ─────────────────────────────────
  whyBox: {
    backgroundColor: DARK,
    borderRadius: 4,
    padding: '14 16',
    marginBottom: 16,
  },
  whyTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: YELLOW, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  whyItem:  { flexDirection: 'row', gap: 6, marginBottom: 5 },
  whyBullet:{ fontSize: 9, color: YELLOW, marginTop: 0.5 },
  whyItemTitle:{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: WHITE },
  whyItemBody: { fontSize: 7.5, color: LGRAY, lineHeight: 1.4 },

  // ── TERMS ───────────────────────────────────
  termsBox: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    padding: '12 14',
    marginBottom: 16,
  },
  termsTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: DARK, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 7 },
  termItem:   { flexDirection: 'row', gap: 5, marginBottom: 4 },
  termNum:    { fontSize: 7.5, color: GRAY, width: 12 },
  termText:   { fontSize: 7.5, color: GRAY, flex: 1, lineHeight: 1.4 },

  // ── SIGNATURE ROW ───────────────────────────
  sigRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sigBlock: { alignItems: 'center', width: 160 },
  sigLine:  { width: 140, borderBottom: '0.5pt solid #cbd5e1', marginBottom: 4 },
  sigLabel: { fontSize: 7.5, color: GRAY },

  // ── FOOTER BAND ─────────────────────────────
  footerBand: {
    backgroundColor: YELLOW,
    paddingHorizontal: 32,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerPrepared: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: DARK },
  footerQuoteRef: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: DARK },
  footerBottomBand: {
    backgroundColor: DARK,
    paddingHorizontal: 32,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerBottomText: { fontSize: 7, color: LGRAY },
  footerBottomHighlight: { fontSize: 7, color: YELLOW },
})

// ── helpers ─────────────────────────────────────────────────────────────────
function totalScreens(cities) {
  return cities.reduce((s, c) => s + (Number(c.screens) || 0), 0)
}
function totalImpressions(cities) {
  // approximate: screens * 3000 spots/month average
  return cities.reduce((s, c) => s + (Number(c.screens) || 0) * 3000, 0)
}
function formatLakh(n) {
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L'
  if (n >= 1000)   return (n / 1000).toFixed(0) + 'K'
  return String(n)
}

// ── Document ─────────────────────────────────────────────────────────────────
function QuoteDocument({ quote, cities }) {
  const subtotal    = Number(quote.subtotal)     || 0
  const gstAmount   = Number(quote.gst_amount)   || 0
  const totalAmount = Number(quote.total_amount) || 0
  const screens     = totalScreens(cities)
  const spots       = totalImpressions(cities)
  const uniqueDay   = Math.round(screens * 150)

  const TERMS = [
    'Quotation valid for 30 days from date of issue. Rates subject to change post-expiry.',
    '50% advance payment required to confirm booking. Balance payable before campaign go-live.',
    'Creative in MP4 format (1920×1080, H.264, max 10MB) to be submitted 5 working days before go-live.',
    'GST @18% is levied on campaign value and is included in the Grand Total above.',
    'Campaign slot confirmation subject to availability at time of booking.',
    'Cancellation post-confirmation: 25% cancellation fee applicable on total invoice.',
    'Content violating law, GSRTC regulations, or community standards may be rejected without refund.',
    'Payments via NEFT/RTGS/Cheque in favour of Untitled Adflux Private Limited.',
  ]

  return (
    <Document>
      <Page size="A4" style={S.page}>

        {/* ── TOP HEADER BAND ── */}
        <View style={S.headerBand}>
          <View style={S.headerLeft}>
            <View style={S.uaBadge}>
              <Text style={S.uaBadgeText}>UA</Text>
            </View>
            <View style={S.brandBlock}>
              <Text style={S.brandName}>UNTITLED ADVERTISING</Text>
              <Text style={S.brandSub}>UNTITLED ADFLUX PRIVATE LIMITED</Text>
              <Text style={S.brandNetwork}>GSRTC LED Screen Network — Gujarat</Text>
            </View>
          </View>
          <View style={S.headerRight}>
            <Text style={S.headerWebsite}>untitlead.in</Text>
            <Text style={S.headerEmail}>hello@untitlead.in</Text>
          </View>
        </View>

        {/* ── STATS BAR ── */}
        <View style={S.statsBar}>
          <View style={S.statItem}>
            <Text style={S.statNum}>{screens || 264}</Text>
            <Text style={S.statLabel}>Total Screens</Text>
          </View>
          <View style={S.statItem}>
            <Text style={S.statNum}>{cities.length || 20}</Text>
            <Text style={S.statLabel}>Cities</Text>
          </View>
          <View style={S.statItem}>
            <Text style={S.statNum}>{formatLakh(spots || 2900000)}+</Text>
            <Text style={S.statLabel}>Monthly Impressions</Text>
          </View>
          <View style={S.statItem}>
            <Text style={S.statNum}>{formatLakh(uniqueDay || 30000)}+</Text>
            <Text style={S.statLabel}>Unique/Day</Text>
          </View>
        </View>

        {/* ── MEDIA QUOTATION TITLE ── */}
        <View style={S.titleBlock}>
          <Text style={S.mediaQuotationText}>MEDIA QUOTATION</Text>
          <View style={S.quoteMetaRight}>
            <Text style={S.quoteNumText}>{quote.quote_number}</Text>
            <Text style={S.quoteDateSmall}>{formatDate(quote.created_at)}</Text>
            <Text style={S.quoteValid}>Valid 30 Days</Text>
          </View>
        </View>

        {/* ── BODY ── */}
        <View style={S.body}>

          {/* Client Info */}
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

          {/* Campaign at a glance */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>This Campaign at a Glance</Text>
          </View>
          <View style={S.glanceRow}>
            <View style={S.glanceItem}>
              <Text style={S.glanceNum}>{screens}</Text>
              <Text style={S.glanceLabel}>Screens Booked</Text>
            </View>
            <View style={S.glanceItem}>
              <Text style={S.glanceNum}>{formatLakh(spots)}+</Text>
              <Text style={S.glanceLabel}>Spots / Month</Text>
            </View>
            <View style={S.glanceItem}>
              <Text style={S.glanceNum}>10 SEC</Text>
              <Text style={S.glanceLabel}>Spot Duration</Text>
            </View>
            <View style={[S.glanceItem, { borderRight: 'none' }]}>
              <Text style={S.glanceNum}>{quote.duration_months}M</Text>
              <Text style={S.glanceLabel}>Campaign Duration</Text>
            </View>
          </View>

          {/* Location Table */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Location Breakdown</Text>
          </View>
          <View style={S.tableSection}>
            {/* Header */}
            <View style={S.tableHead}>
              <View style={S.colSr}><Text style={S.thText}>SR</Text></View>
              <View style={S.colCity}><Text style={S.thText}>Location</Text></View>
              <View style={S.colGrade}><Text style={S.thText}>Grade</Text></View>
              <View style={S.colScreens}><Text style={[S.thText, { textAlign: 'center' }]}>Screens</Text></View>
              <View style={S.colSize}><Text style={[S.thText, { textAlign: 'center' }]}>Size</Text></View>
              <View style={S.colDuration}><Text style={[S.thText, { textAlign: 'center' }]}>Duration</Text></View>
              <View style={S.colRate}><Text style={[S.thText, { textAlign: 'right' }]}>Listed Rate</Text></View>
              <View style={S.colTotal}><Text style={[S.thText, { textAlign: 'right' }]}>Campaign Total</Text></View>
            </View>

            {/* Rows */}
            {cities.map((c, i) => (
              <View key={c.id || i} style={[S.tableRow, i % 2 === 1 && S.tableRowAlt]}>
                <View style={S.colSr}>
                  <Text style={S.tdMuted}>{i + 1}</Text>
                </View>
                <View style={S.colCity}>
                  <Text style={S.tdBold}>{c.city_name}</Text>
                  {c.station_name && <Text style={S.tdMuted}>{c.station_name}</Text>}
                </View>
                <View style={S.colGrade}>
                  <View style={{
                    backgroundColor: c.grade === 'A' ? '#dcfce7' : c.grade === 'B' ? '#fef9c3' : '#f1f5f9',
                    borderRadius: 3, padding: '1 5', alignSelf: 'center',
                  }}>
                    <Text style={[S.tdMuted, {
                      color: c.grade === 'A' ? '#166534' : c.grade === 'B' ? '#854d0e' : '#475569',
                      fontFamily: 'Helvetica-Bold',
                    }]}>{c.grade}</Text>
                  </View>
                </View>
                <View style={S.colScreens}>
                  <Text style={[S.tdText, { textAlign: 'center' }]}>{c.screens}</Text>
                </View>
                <View style={S.colSize}>
                  <Text style={[S.tdMuted, { textAlign: 'center' }]}>
                    {c.screen_size_inch ? `${c.screen_size_inch}"` : '55"'}
                  </Text>
                </View>
                <View style={S.colDuration}>
                  <Text style={[S.tdText, { textAlign: 'center' }]}>
                    {c.duration_months} Month{c.duration_months !== 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={S.colRate}>
                  <Text style={[S.tdText, { textAlign: 'right' }]}>{formatCurrency(c.offered_rate)}</Text>
                  {c.listed_rate && c.listed_rate !== c.offered_rate && (
                    <Text style={[S.tdMuted, { textAlign: 'right', textDecoration: 'line-through' }]}>
                      {formatCurrency(c.listed_rate)}
                    </Text>
                  )}
                </View>
                <View style={S.colTotal}>
                  <Text style={[S.tdBold, { textAlign: 'right' }]}>{formatCurrency(c.campaign_total)}</Text>
                </View>
              </View>
            ))}

            {/* Table footer */}
            <View style={S.tableFootRow}>
              <Text style={S.tableFootLabel}>{cities.length} location{cities.length !== 1 ? 's' : ''} · {quote.duration_months} Month Campaign</Text>
              <Text style={S.tableFootValue}>Campaign Subtotal   {formatCurrency(subtotal)}</Text>
            </View>
          </View>

          {/* Investment Summary */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Investment Summary</Text>
          </View>
          <View style={S.investSection}>
            <View style={S.investBox}>
              <View style={S.investRow}>
                <Text style={S.investLabel}>Campaign Subtotal</Text>
                <Text style={S.investValue}>{formatCurrency(subtotal)}</Text>
              </View>
              <View style={S.investRow}>
                <Text style={S.investLabel}>GST @18%</Text>
                <Text style={S.investValue}>{formatCurrency(gstAmount)}</Text>
              </View>
              <View style={S.investGrandRow}>
                <Text style={S.investGrandLabel}>GRAND TOTAL (INR)</Text>
                <Text style={S.investGrandValue}>{formatCurrency(totalAmount)}</Text>
              </View>
            </View>
          </View>

          {/* Why GSRTC */}
          <View style={S.whyBox}>
            <Text style={S.whyTitle}>Why GSRTC LED Screens?</Text>
            {[
              ["Gujarat's Largest OOH Network:", `${screens || 264} premium LED screens at GSRTC bus depots across ${cities.length || 20} cities — the highest-traffic public transit hubs in the state.`],
              ["Zero Skip. Zero Scroll. Pure Attention:", "Bus terminal audiences dwell for 10–30 minutes. Your brand plays in a 5-minute loop with no ad-blocker, no skip button."],
              ["Hyper-Local + State-Wide Reach:", "Reach hyperlocal audiences in each city simultaneously. Our pricing model gives you more reach per rupee than any other OOH format in Gujarat."],
            ].map(([title, body], i) => (
              <View key={i} style={S.whyItem}>
                <Text style={S.whyBullet}>•</Text>
                <View style={{ flex: 1 }}>
                  <Text style={S.whyItemTitle}>{title} <Text style={S.whyItemBody}>{body}</Text></Text>
                </View>
              </View>
            ))}
          </View>

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
              <Text style={S.sigLabel}>For Untitled Adflux Pvt. Ltd.</Text>
              <Text style={[S.sigLabel, { marginTop: 1 }]}>Authorised Signatory &amp; Stamp</Text>
            </View>
            <View style={S.sigBlock}>
              <View style={S.sigLine} />
              <Text style={S.sigLabel}>Client Acceptance</Text>
              <Text style={[S.sigLabel, { marginTop: 1 }]}>Name, Designation &amp; Company Stamp</Text>
            </View>
          </View>

        </View>{/* end body */}

        {/* ── FOOTER YELLOW BAND ── */}
        <View style={S.footerBand}>
          <Text style={S.footerPrepared}>
            Prepared by: {quote.sales_person_name || 'Sales Executive'}
          </Text>
          <Text style={S.footerQuoteRef}>
            Quote: {quote.quote_number} · {formatDate(quote.created_at)}
          </Text>
        </View>
        <View style={S.footerBottomBand}>
          <Text style={S.footerBottomText}>untitlead.in | hello@untitlead.in</Text>
          <Text style={S.footerBottomText}>GSRTC LED Screen Network — Gujarat</Text>
          <Text style={S.footerBottomHighlight}>
            {screens || 264} Screens · {cities.length || 20} Cities · {formatLakh(spots || 2900000)}+ Monthly Impressions
          </Text>
        </View>

      </Page>
    </Document>
  )
}

// ── Export helpers ────────────────────────────────────────────────────────────
export async function downloadQuotePDF(quote, cities = []) {
  const blob = await pdf(<QuoteDocument quote={quote} cities={cities} />).toBlob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${quote.quote_number}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

export { QuoteDocument }
export default QuoteDocument
