// src/components/quotes/QuotePDF.jsx
// Matches Untitled Adflux brand PDF exactly:
// Yellow header block, UA logo, stats bar, location table with SR#, investment summary, T&C, footer
import {
  Document, Page, Text, View, StyleSheet, Font, pdf,
} from '@react-pdf/renderer'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { supabase } from '../../lib/supabase'

// ─── Font registration ──────────────────────────────────────────────
// Why: @react-pdf/renderer's bundled Helvetica has no glyph for the
// Indian Rupee Sign (₹, U+20B9). Without a Unicode-capable font the
// symbol renders as a tofu box or a spurious "1" next to the number.
//
// Roboto (Apache 2.0) covers the Currency Symbols block including ₹
// and is visually close to Helvetica so the PDF layout doesn't shift.
//
// Loading strategy — LOCAL (bundled in repo):
//   The TTFs live at public/fonts/Roboto-Regular.ttf and
//   public/fonts/Roboto-Bold.ttf. Vite serves public/ at the site
//   root, so these URLs resolve same-origin in every environment
//   (localhost, preview deploys, production) with zero third-party
//   network dependency at PDF-generation time.
//
//   Earlier version tried jsDelivr CDN — failed in production because
//   @react-pdf/renderer's fetch of cross-origin TTFs was blocked /
//   mis-routed. Local paths are the reliable fix.
Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 'normal' },
    { src: '/fonts/Roboto-Bold.ttf',    fontWeight: 'bold' },
  ],
})

// Disable word-break hyphenation for Roboto — the default dictionary
// splits Indian place names awkwardly ("Ahme-dabad"), and our PDF has
// tight column widths where a rogue hyphen looks worse than overflow.
Font.registerHyphenationCallback(word => [word])

const YELLOW = '#FFE600'
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

  // ── STATS BAR ──────────────────────────────────
  statsBar: {
    backgroundColor: YELLOW,
    flexDirection: 'row',
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum:  { fontSize: 16, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
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
    fontFamily: 'Roboto', fontWeight: 'bold',
    color: YELLOW,
    letterSpacing: 1,
  },
  quoteMetaRight: { alignItems: 'flex-end', gap: 3 },
  quoteNumText: { fontSize: 11, fontFamily: 'Roboto', fontWeight: 'bold', color: WHITE },
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
  sectionTitle: { fontSize: 9, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK, textTransform: 'uppercase', letterSpacing: 0.8 },

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
  clientFieldValue: { fontSize: 10, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK, marginBottom: 8 },

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
  glanceNum:   { fontSize: 14, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
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
  thText: { fontSize: 7, fontFamily: 'Roboto', fontWeight: 'bold', color: WHITE, textTransform: 'uppercase', letterSpacing: 0.4 },
  tdText: { fontSize: 8.5, color: DARK },
  tdBold: { fontSize: 8.5, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  tdMuted:{ fontSize: 7.5, color: GRAY },
  // 9-column layout at A4 with 32pt side margins → 531pt usable.
  // Fixed widths total ~335pt; City flex absorbs the rest (~196pt).
  // Increments must stay within budget or SPOTS/MO gets clipped.
  colSr:       { width: 20 },
  colCity:     { flex: 1 },
  colGrade:    { width: 34, alignItems: 'center' },
  colScreens:  { width: 40, alignItems: 'center' },
  colSize:     { width: 30, alignItems: 'center' },
  colSpots:    { width: 50, alignItems: 'center' },
  colDuration: { width: 48, alignItems: 'center' },
  colRate:     { width: 55, alignItems: 'flex-end' },
  colTotal:    { width: 60, alignItems: 'flex-end' },

  tableFootRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f1f5f9',
    padding: '7 8',
  },
  tableFootLabel: { fontSize: 8, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  tableFootValue: { fontSize: 8, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },

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
  investValue: { fontSize: 9, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  investGrandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: '10 14',
    backgroundColor: YELLOW,
  },
  investGrandLabel: { fontSize: 10, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },
  investGrandValue: { fontSize: 10, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK },

  // ── GRAND TOTAL HERO (standalone dark bar, reference page 3 top) ─
  grandHero: {
    backgroundColor: DARK,
    borderRadius: 6,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  grandHeroLabel: {
    fontSize: 13,
    fontFamily: 'Roboto', fontWeight: 'bold',
    color: YELLOW,
    letterSpacing: 1,
  },
  grandHeroValue: {
    fontSize: 18,
    fontFamily: 'Roboto', fontWeight: 'bold',
    color: YELLOW,
  },

  // ── WHY BOX ─────────────────────────────────
  whyBox: {
    backgroundColor: DARK,
    borderRadius: 4,
    padding: '14 16',
    marginBottom: 16,
  },
  whyTitle: { fontSize: 9, fontFamily: 'Roboto', fontWeight: 'bold', color: YELLOW, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  whyItem:  { flexDirection: 'row', gap: 6, marginBottom: 5 },
  whyBullet:{ fontSize: 9, color: YELLOW, marginTop: 0.5 },
  whyItemTitle:{ fontSize: 8, fontFamily: 'Roboto', fontWeight: 'bold', color: WHITE },
  whyItemBody: { fontSize: 7.5, color: LGRAY, lineHeight: 1.4 },

  // ── TERMS ───────────────────────────────────
  termsBox: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    padding: '12 14',
    marginBottom: 16,
  },
  termsTitle: { fontSize: 8, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 7 },
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
  footerBottomHighlight: { fontSize: 7, color: YELLOW },
})

// ── Network marketing constants ─────────────────────────────────────
// Shown in the top yellow stats banner AND the dark footer strip.
// Network-wide pitch, not per-quote. Update here if the fleet changes.
const NETWORK = {
  totalScreens: '264',
  cities:       '20',
  monthlyImpressions: '29L+',
  uniquePerDay: '30K+',
}

// ── Per-row and glance helpers ──────────────────────────────────────
function totalScreens(cities) {
  return cities.reduce((s, c) => s + (Number(c.screens) || 0), 0)
}
// Spots per month for a city = screens × 3000 (100 spots/day × 30 days).
function spotsPerMonth(screens) {
  return (Number(screens) || 0) * 3000
}
function totalSpotsPerMonth(cities) {
  return cities.reduce((s, c) => s + spotsPerMonth(c.screens), 0)
}
// Quote-wide total monthly impressions. Reference data implies ~5200
// impressions/screen/month (13.7L / 264 ≈ 5200). Keeps the "glance"
// Total Impressions card in the same ballpark as the reference PDF.
function totalImpressions(cities) {
  return cities.reduce((s, c) => s + (Number(c.screens) || 0) * 5200, 0)
}
function formatLakh(n) {
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L'
  if (n >= 1000)   return (n / 1000).toFixed(0) + 'K'
  return String(n)
}
// Station subtitle under each city name ("Anand ST Bus Depot").
// Prefer the stored station_name when present (not currently saved by
// the wizard, see task #30); fall back to computing it from city_name.
function stationLabel(c) {
  if (c.station_name) return c.station_name
  if (!c.city_name)   return ''
  // Title-case city name so "ANAND" → "Anand" for the subtitle only.
  const nice = c.city_name
    .toLowerCase()
    .replace(/\b\w/g, ch => ch.toUpperCase())
  return `${nice} ST Bus Depot`
}

// ── Document ─────────────────────────────────────────────────────────────────
function QuoteDocument({ quote, cities }) {
  const subtotal    = Number(quote.subtotal)     || 0
  const gstAmount   = Number(quote.gst_amount)   || 0
  const totalAmount = Number(quote.total_amount) || 0
  const screens     = totalScreens(cities)
  const spotsMonth  = totalSpotsPerMonth(cities)
  const impressions = totalImpressions(cities)

  // Dynamic GST text — pull from the quote so "No GST" (rate=0) quotes
  // don't ship a PDF claiming GST was charged. Null/missing rate falls
  // back to 18% for legacy rows created before the gst_rate migration.
  const rate   = quote.gst_rate !== null && quote.gst_rate !== undefined ? Number(quote.gst_rate) : 0.18
  const gstPct = Math.round(rate * 100)
  const gstApplies = rate > 0
  const gstLabel = gstApplies ? `GST @${gstPct}%` : 'No GST'

  const TERMS = [
    'Quotation valid for 30 days from date of issue. Rates subject to change post-expiry.',
    '50% advance payment required to confirm booking. Balance payable before campaign go-live.',
    'Creative in MP4 format (1920×1080, H.264, max 10MB) to be submitted 5 working days before go-live.',
    gstApplies
      ? `GST @${gstPct}% is levied on campaign value and is included in the Grand Total above.`
      : 'No GST is applied to this quotation. The Grand Total is the final payable amount.',
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

        {/* ── STATS BAR ── Network-wide marketing stats, not quote-specific.
            These are the pitch for the whole GSRTC fleet; the quote's own
            totals live in the "At a Glance" block further down. */}
        <View style={S.statsBar}>
          <View style={S.statItem}>
            <Text style={S.statNum}>{NETWORK.totalScreens}</Text>
            <Text style={S.statLabel}>Total Screens</Text>
          </View>
          <View style={S.statItem}>
            <Text style={S.statNum}>{NETWORK.cities}</Text>
            <Text style={S.statLabel}>Cities</Text>
          </View>
          <View style={S.statItem}>
            <Text style={S.statNum}>{NETWORK.monthlyImpressions}</Text>
            <Text style={S.statLabel}>Monthly Impressions</Text>
          </View>
          <View style={S.statItem}>
            <Text style={S.statNum}>{NETWORK.uniquePerDay}</Text>
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
          {/* Quote-specific headline numbers. Mirrors the reference's
              4-card strip. Total Impressions ≈ screens × 5200/mo. */}
          <View style={S.glanceRow}>
            <View style={S.glanceItem}>
              <Text style={S.glanceNum}>{screens}</Text>
              <Text style={S.glanceLabel}>Screens Booked</Text>
            </View>
            <View style={S.glanceItem}>
              <Text style={S.glanceNum}>{formatLakh(spotsMonth)}</Text>
              <Text style={S.glanceLabel}>Spots / Month</Text>
            </View>
            <View style={S.glanceItem}>
              <Text style={S.glanceNum}>10 SEC</Text>
              <Text style={S.glanceLabel}>Spot Duration</Text>
            </View>
            <View style={[S.glanceItem, { borderRight: 'none' }]}>
              <Text style={S.glanceNum}>{formatLakh(impressions)}</Text>
              <Text style={S.glanceLabel}>Total Impressions</Text>
            </View>
          </View>

          {/* Campaign Period if set */}
          {quote.campaign_start_date && quote.campaign_end_date && (
            <View style={{ marginBottom: 16, paddingLeft: 8 }}>
              <Text style={{ fontSize: 9, color: GRAY }}>
                Campaign Period: {formatDate(quote.campaign_start_date)} — {formatDate(quote.campaign_end_date)}
              </Text>
            </View>
          )}

          {/* Location Table */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Location Breakdown</Text>
          </View>
          <View style={S.tableSection}>
            {/* Header — mirrors reference: SR | LOCATION | GRADE | SCREENS
                | SIZE | SPOTS/MO | DURATION | LISTED RATE | CAMPAIGN TOTAL */}
            <View style={S.tableHead}>
              <View style={S.colSr}><Text style={S.thText}>SR</Text></View>
              <View style={S.colCity}><Text style={S.thText}>Location</Text></View>
              <View style={S.colGrade}><Text style={S.thText}>Grade</Text></View>
              <View style={S.colScreens}><Text style={[S.thText, { textAlign: 'center' }]}>Screens</Text></View>
              <View style={S.colSize}><Text style={[S.thText, { textAlign: 'center' }]}>Size</Text></View>
              <View style={S.colSpots}><Text style={[S.thText, { textAlign: 'center' }]}>Spots/Mo</Text></View>
              <View style={S.colDuration}><Text style={[S.thText, { textAlign: 'center' }]}>Duration</Text></View>
              <View style={S.colRate}><Text style={[S.thText, { textAlign: 'right' }]}>Listed Rate</Text></View>
              <View style={S.colTotal}><Text style={[S.thText, { textAlign: 'right' }]}>Campaign Total</Text></View>
            </View>

            {/* Rows. Grade chip colors match reference: A=green, B=orange,
                C=gray. Size falls back to em dash when no per-city data
                (screen_size_inch isn't captured by the wizard yet). */}
            {cities.map((c, i) => {
              const gradeBg = c.grade === 'A' ? '#DCFCE7' : c.grade === 'B' ? '#FFEDD5' : '#F1F5F9'
              const gradeFg = c.grade === 'A' ? '#166534' : c.grade === 'B' ? '#B45309' : '#475569'
              const sizeText = c.screen_size_inch ? `${c.screen_size_inch}"` : '—'
              const spots = spotsPerMonth(c.screens)
              return (
                <View key={c.id || i} style={[S.tableRow, i % 2 === 1 && S.tableRowAlt]} wrap={false}>
                  <View style={S.colSr}>
                    <Text style={S.tdMuted}>{i + 1}</Text>
                  </View>
                  <View style={S.colCity}>
                    <Text style={S.tdBold}>{c.city_name}</Text>
                    <Text style={S.tdMuted}>{stationLabel(c)}</Text>
                  </View>
                  <View style={S.colGrade}>
                    <View style={{
                      backgroundColor: gradeBg,
                      borderRadius: 8,
                      paddingVertical: 2,
                      paddingHorizontal: 6,
                      alignSelf: 'center',
                    }}>
                      <Text style={{
                        fontSize: 8,
                        fontFamily: 'Roboto', fontWeight: 'bold',
                        color: gradeFg,
                      }}>{c.grade}</Text>
                    </View>
                  </View>
                  <View style={S.colScreens}>
                    <Text style={[S.tdText, { textAlign: 'center' }]}>{c.screens}</Text>
                  </View>
                  <View style={S.colSize}>
                    <Text style={[S.tdMuted, { textAlign: 'center' }]}>{sizeText}</Text>
                  </View>
                  <View style={S.colSpots}>
                    <Text style={[S.tdText, { textAlign: 'center' }]}>
                      {spots.toLocaleString('en-IN')}
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
              )
            })}

            {/* Table footer */}
            <View style={S.tableFootRow}>
              <Text style={S.tableFootLabel}>{cities.length} location{cities.length !== 1 ? 's' : ''} · {quote.duration_months} Month Campaign</Text>
              <Text style={S.tableFootValue}>Campaign Subtotal   {formatCurrency(subtotal)}</Text>
            </View>
          </View>

          {/* Investment Summary — full-width in the reference (not
              right-aligned). Shows Subtotal + GST line only; Grand Total
              promotes to its own dark hero bar below. */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Investment Summary</Text>
          </View>
          <View style={S.investSection}>
            <View style={[S.investBox, { alignSelf: 'stretch', width: '100%' }]}>
              <View style={S.investRow}>
                <Text style={S.investLabel}>Campaign Subtotal</Text>
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

          {/* Grand Total hero — standalone dark bar, reference p3 top */}
          <View style={S.grandHero}>
            <Text style={S.grandHeroLabel}>GRAND TOTAL (INR)</Text>
            <Text style={S.grandHeroValue}>{formatCurrency(totalAmount)}</Text>
          </View>

          {/* Why GSRTC */}
          <View style={S.whyBox}>
            <Text style={S.whyTitle}>Why GSRTC LED Screens?</Text>
            {[
              ["Gujarat's Largest OOH Network:", `${NETWORK.totalScreens} premium LED screens at GSRTC bus depots across ${NETWORK.cities} cities — the highest-traffic public transit hubs in the state, delivering ${NETWORK.monthlyImpressions} verified monthly impressions.`],
              ["Zero Skip. Zero Scroll. Pure Attention:", "Bus terminal audiences dwell for 10–30 minutes. Your brand plays in a 5-minute loop with no ad-blocker, no skip button, and no competing screen."],
              ["Hyper-Local + State-Wide Reach:", "Reach hyperlocal audiences in each city simultaneously. Grade A locations deliver premium footfall; our pricing model gives you more reach per rupee than any other OOH format in Gujarat."],
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
            {NETWORK.totalScreens} Screens · {NETWORK.cities} Cities · {NETWORK.monthlyImpressions} Monthly · {NETWORK.uniquePerDay} Unique/Day
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

/**
 * Generate + upload the PDF to Supabase Storage and return a public URL.
 *
 * Bucket: 'quote-pdfs' (must exist and be public — see
 * supabase_storage_quotes.sql in the repo root).
 *
 * Path convention:  {quote_number}/{timestamp}.pdf
 *   - Folder per quote keeps revisions grouped and makes manual cleanup
 *     easy (drop the folder to forget a quote).
 *   - Timestamp suffix means every regeneration produces a new file
 *     so WhatsApp recipients always download the latest version
 *     (no CDN cache confusion from overwriting the same key).
 *
 * Why this exists:
 *   WhatsApp click-to-chat URLs (wa.me?text=…) only support plaintext
 *   — they cannot attach files. So we upload the PDF to a public
 *   bucket and paste the URL into the message body.
 *
 * @returns {Promise<string>} public URL to the uploaded PDF
 */
export async function uploadQuotePDF(quote, cities = []) {
  const blob = await pdf(<QuoteDocument quote={quote} cities={cities} />).toBlob()
  const ts   = Date.now()
  const safeNumber = (quote.quote_number || 'quote').replace(/[^A-Za-z0-9_-]/g, '_')
  const path = `${safeNumber}/${ts}.pdf`

  const { error: uploadErr } = await supabase
    .storage
    .from('quote-pdfs')
    .upload(path, blob, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadErr) {
    // Surface a readable error — the caller decides whether to fall
    // back to the manual-attach flow or bubble it up to the user.
    throw new Error(`PDF upload failed: ${uploadErr.message}`)
  }

  const { data } = supabase
    .storage
    .from('quote-pdfs')
    .getPublicUrl(path)

  if (!data?.publicUrl) {
    throw new Error('PDF uploaded but no public URL was returned — check bucket is public.')
  }

  return data.publicUrl
}

export { QuoteDocument }
export default QuoteDocument
