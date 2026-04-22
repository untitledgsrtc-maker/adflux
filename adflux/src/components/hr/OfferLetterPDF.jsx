// src/components/hr/OfferLetterPDF.jsx
//
// Offer-letter PDF generator for the HR module.
//
// Mirrors the Jignesh Brahmbhatt reference document: company
// letterhead at the top, body paragraph, consolidated terms table,
// standard boilerplate clauses, and an ACCEPTANCE block at the end.
//
// Fonts are the same Roboto TTFs already bundled for QuotePDF — no
// extra asset load. Font.register() is idempotent on @react-pdf so
// re-registering in this file is safe.
//
// Two exported helpers:
//   generateOfferLetterBlob(offer, template)  → Blob (for upload)
//   downloadOfferLetter(offer, template)      → triggers a browser
//                                                download, used from
//                                                admin preview.
//
// Shape of `offer` mirrors the hr_offers row returned by
// fetch_offer_by_token or selected admin-side. `template` is the row
// from hr_offer_templates (we take the default row in Phase 1).

import {
  Document, Page, Text, View, Image, StyleSheet, Font, pdf,
} from '@react-pdf/renderer'
import { formatCurrency } from '../../utils/formatters'

Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 'normal' },
    { src: '/fonts/Roboto-Bold.ttf',    fontWeight: 'bold' },
  ],
})
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
    fontSize: 10,
    color: DARK,
    lineHeight: 1.45,
  },

  // ─── Letterhead ────────────────────────────────────
  headerBand: {
    backgroundColor: DARK,
    paddingHorizontal: 36,
    paddingVertical: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    fontSize: 14, color: DARK,
  },
  brandBlock: { gap: 2 },
  brandName: { fontSize: 14, fontFamily: 'Roboto', fontWeight: 'bold', color: WHITE },
  brandSub:  { fontSize: 8, color: LGRAY },
  headerRight: { alignItems: 'flex-end', gap: 2 },
  headerText:  { fontSize: 8, color: LGRAY },

  // ─── Title band ─────────────────────────────────────
  titleBand: {
    backgroundColor: YELLOW,
    paddingHorizontal: 36,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleText: { fontSize: 16, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK, letterSpacing: 1 },
  titleDate: { fontSize: 9, color: DARK },

  // ─── Body ───────────────────────────────────────────
  body: { paddingHorizontal: 36, paddingTop: 18, paddingBottom: 24 },
  para: { marginBottom: 9, textAlign: 'justify' },
  addressBlock: { marginBottom: 12 },
  addressLine: { fontSize: 10 },
  greet: { marginBottom: 8, fontFamily: 'Roboto', fontWeight: 'bold' },
  subjectBar: {
    backgroundColor: DARK,
    color: YELLOW,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontFamily: 'Roboto',
    fontWeight: 'bold',
    fontSize: 10,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // ─── Terms table ────────────────────────────────────
  termsTable: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 3,
    marginBottom: 14,
  },
  termRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid ' + BORDER,
  },
  termRowLast: { flexDirection: 'row' },
  termLabel: {
    width: 170,
    backgroundColor: '#f8fafc',
    padding: '6 10',
    fontSize: 9,
    color: GRAY,
    fontFamily: 'Roboto',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    borderRight: '0.5pt solid ' + BORDER,
  },
  termValue: {
    flex: 1,
    padding: '6 10',
    fontSize: 10,
    color: DARK,
  },

  // ─── Section heading ────────────────────────────────
  sectionBar: {
    borderLeft: '3pt solid ' + YELLOW,
    paddingLeft: 8,
    marginTop: 6,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 9, fontFamily: 'Roboto', fontWeight: 'bold',
    color: DARK, textTransform: 'uppercase', letterSpacing: 0.8,
  },

  // ─── Acceptance ────────────────────────────────────
  acceptBox: {
    marginTop: 14,
    padding: 12,
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    backgroundColor: '#fafbfc',
  },
  acceptTitle: {
    fontSize: 10, fontFamily: 'Roboto', fontWeight: 'bold',
    color: DARK, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  acceptLine:  { fontSize: 9, color: GRAY, marginBottom: 3 },
  acceptValue: { fontSize: 10, fontFamily: 'Roboto', fontWeight: 'bold', color: DARK, marginBottom: 6 },
  acceptStamp: {
    marginTop: 10,
    padding: '6 10',
    backgroundColor: YELLOW,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  acceptStampText: {
    fontSize: 9, fontFamily: 'Roboto', fontWeight: 'bold',
    color: DARK, letterSpacing: 0.4,
  },

  // ─── Footer ─────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 20, left: 36, right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: LGRAY,
    borderTop: '0.5pt solid ' + BORDER,
    paddingTop: 8,
  },
})

// Small helper: print ₹X,XX,XXX per month / ₹XX,XX,XXX per annum
function salaryLine(monthly) {
  const m = Number(monthly) || 0
  return `${formatCurrency(m)} per month  (${formatCurrency(m * 12)} per annum)`
}

function formatLongDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

// Template falls back to sane defaults if the migration row is missing
// (defensive — the seed should always create one, but we never want
// the PDF to fail because the templates table is empty).
const DEFAULT_TPL = {
  probation_months:      6,
  notice_probation_days: 15,
  notice_confirmed_days: 30,
  min_monthly_target:    100000,
  paid_leave_days:       6,
  sick_leave_days:       6,
  non_compete_months:    12,
  working_days:          'Monday to Saturday',
  travel_percent:        '50-60%',
  place_default:         'Vadodara',
  confidentiality_text: 'You shall, during the period of your employment or at any time thereafter, not disclose or use any confidential information relating to the business of the Company for your own benefit or for the benefit of any third party.',
  termination_text:     'Either party may terminate this agreement by serving the notice period specified above. The Company reserves the right to terminate immediately in case of misconduct, breach of confidentiality, or material non-performance.',
  company_assets_text:  'All company assets (laptop, SIM, marketing collateral, client contacts, etc.) issued to you must be returned in good condition on your last working day. Failure to return assets may result in deduction from final settlement.',
  remuneration_text:    'The remuneration details in this letter are strictly confidential and shall not be disclosed to any third party, including colleagues, under any circumstances.',
}

function OfferDocument({ offer, template }) {
  const tpl = { ...DEFAULT_TPL, ...(template || {}) }
  const issueDate = offer.created_at ? new Date(offer.created_at) : new Date()
  const issuedOn  = issueDate.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const candidateName    = offer.full_legal_name || offer.candidate_name || '—'
  const address = [
    offer.address_line1,
    offer.address_line2,
    [offer.city, offer.district].filter(Boolean).join(', '),
    [offer.state, offer.pincode].filter(Boolean).join(' - '),
  ].filter(Boolean)

  return (
    <Document>
      <Page size="A4" style={S.page}>

        {/* Letterhead */}
        <View style={S.headerBand}>
          <View style={S.headerLeft}>
            <View style={S.uaBadge}><Text style={S.uaBadgeText}>UA</Text></View>
            <View style={S.brandBlock}>
              <Text style={S.brandName}>UNTITLED ADVERTISING</Text>
              <Text style={S.brandSub}>Outdoor LED Advertising Network</Text>
            </View>
          </View>
          <View style={S.headerRight}>
            <Text style={S.headerText}>203 Sidcup Tower, Beside Marble Arch</Text>
            <Text style={S.headerText}>Racecourse, Vadodara - 390 007</Text>
            <Text style={S.headerText}>9409152255 / 9428273686</Text>
            <Text style={S.headerText}>untitledadvertising@gmail.com</Text>
          </View>
        </View>

        <View style={S.titleBand}>
          <Text style={S.titleText}>OFFER LETTER</Text>
          <Text style={S.titleDate}>{issuedOn}</Text>
        </View>

        <View style={S.body}>

          {/* Addressee block */}
          <View style={S.addressBlock}>
            <Text style={[S.addressLine, { fontFamily: 'Roboto', fontWeight: 'bold' }]}>
              {candidateName}
            </Text>
            {address.map((l, i) => (
              <Text key={i} style={S.addressLine}>{l}</Text>
            ))}
            {offer.mobile && <Text style={S.addressLine}>Mobile: {offer.mobile}</Text>}
            {(offer.personal_email || offer.candidate_email) && (
              <Text style={S.addressLine}>
                Email: {offer.personal_email || offer.candidate_email}
              </Text>
            )}
          </View>

          <Text style={S.greet}>Dear {candidateName},</Text>

          <Text style={S.para}>
            We are pleased to offer you the position of <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>{offer.position || 'Sales Person'}</Text> at
            Untitled Advertising. This letter confirms the terms and conditions
            of your employment with the Company, subject to your acceptance of
            the clauses herein.
          </Text>

          {/* Consolidated terms table */}
          <View style={S.subjectBar}><Text>Terms of Employment</Text></View>

          <View style={S.termsTable}>
            <Row label="Position"            value={offer.position || 'Sales Person'} />
            {offer.territory && <Row label="Territory" value={offer.territory} />}
            <Row label="Date of Joining"     value={formatLongDate(offer.joining_date)} />
            <Row label="Fixed Remuneration"  value={salaryLine(offer.fixed_salary_monthly)} />
            {offer.incentive_text && <Row label="Performance Incentive" value={offer.incentive_text} />}
            <Row label="Probation Period"    value={`${tpl.probation_months} month${tpl.probation_months !== 1 ? 's' : ''}`} />
            <Row label="Working Days"        value={`${tpl.working_days} · Travel ${tpl.travel_percent}`} />
            <Row label="Leave Entitlement"   value={`${tpl.paid_leave_days} paid leave + ${tpl.sick_leave_days} sick leave per annum`} />
            <Row label="Monthly Target"      value={`Minimum ${formatCurrency(tpl.min_monthly_target)} per month`} />
            <Row label="Notice Period"       value={`${tpl.notice_probation_days} days during probation · ${tpl.notice_confirmed_days} days post confirmation`} />
            <Row label="Non-Compete"         value={`${tpl.non_compete_months} months from date of separation`} last />
          </View>

          {/* Clauses */}
          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Confidentiality</Text>
          </View>
          <Text style={S.para}>{tpl.confidentiality_text}</Text>

          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Termination</Text>
          </View>
          <Text style={S.para}>{tpl.termination_text}</Text>

          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Return of Company Assets</Text>
          </View>
          <Text style={S.para}>{tpl.company_assets_text}</Text>

          <View style={S.sectionBar}>
            <Text style={S.sectionTitle}>Confidentiality of Remuneration</Text>
          </View>
          <Text style={S.para}>{tpl.remuneration_text}</Text>

          {/* Acceptance block */}
          <View style={S.acceptBox}>
            <Text style={S.acceptTitle}>Acceptance</Text>
            <Text style={S.acceptLine}>
              I have read and understood the terms of this offer letter and
              accept the same without reservation.
            </Text>
            <View style={{ flexDirection: 'row', gap: 30, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={S.acceptLine}>Name</Text>
                <Text style={S.acceptValue}>{candidateName}</Text>
                <Text style={S.acceptLine}>Place</Text>
                <Text style={S.acceptValue}>{offer.place || tpl.place_default}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.acceptLine}>Accepted On</Text>
                <Text style={S.acceptValue}>
                  {offer.accepted_terms_at ? formatLongDate(offer.accepted_terms_at) : '—'}
                </Text>
                <Text style={S.acceptLine}>PAN</Text>
                <Text style={S.acceptValue}>{offer.pan_number || '—'}</Text>
              </View>
            </View>
            {offer.accepted_terms_at && (
              <View style={S.acceptStamp}>
                <Text style={S.acceptStampText}>DIGITALLY ACCEPTED</Text>
              </View>
            )}
          </View>

          <Text style={[S.para, { marginTop: 14 }]}>
            For Untitled Advertising,
          </Text>
          <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>
            Authorised Signatory
          </Text>
        </View>

        <View style={S.footer} fixed>
          <Text>Untitled Advertising · Vadodara · untitledad.in</Text>
          <Text render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`} />
        </View>

      </Page>
    </Document>
  )
}

function Row({ label, value, last }) {
  return (
    <View style={last ? S.termRowLast : S.termRow}>
      <Text style={S.termLabel}>{label}</Text>
      <Text style={S.termValue}>{value}</Text>
    </View>
  )
}

// ─── Public API ─────────────────────────────────────

export async function generateOfferLetterBlob(offer, template) {
  return await pdf(<OfferDocument offer={offer} template={template} />).toBlob()
}

export async function downloadOfferLetter(offer, template) {
  const blob = await generateOfferLetterBlob(offer, template)
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  const safeName = (offer.full_legal_name || offer.candidate_name || 'offer')
    .replace(/[^A-Za-z0-9_-]/g, '_')
  a.download = `Offer_Letter_${safeName}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

export { OfferDocument }
