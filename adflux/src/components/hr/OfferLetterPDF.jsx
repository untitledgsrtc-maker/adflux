// src/components/hr/OfferLetterPDF.jsx
//
// Offer-letter PDF generator — "Letter of Appointment" template
// (20 clauses + Annexures A/B/C) approved Apr 2026.
//
// Design notes:
//   • Letterhead PNG (/letterhead.png) is pinned as a full-page
//     background on every page. Content margins clear the
//     UNTITLED logo at the top and the address block at the
//     bottom. The letterhead asset lives at
//     adflux/public/letterhead.png and is fetched over HTTP by
//     @react-pdf at render time.
//   • Full 20-clause T&C reproduced verbatim from the approved
//     template. Merge fields (candidate name, position, territory,
//     joining date, salary, structured incentive values) replace
//     the square-bracket placeholders.
//   • Annexure A is role-selected by matching the `position`
//     string: contains "Head" → L3, contains "Senior"/"Sr" → L2,
//     else → L1.
//   • Annexure B.2 commission row uses the structured incentive
//     fields captured at send-offer time (multiplier, new-client %,
//     renewal %, flat bonus) so the printed letter matches what
//     the admin committed to in the Send Offer modal.
//   • NO ink-signature block. The letter closes with a
//     "DIGITALLY SIGNED" stamp (yellow-on-dark) on the company
//     side and, once the candidate accepts, a "DIGITALLY ACCEPTED"
//     stamp (dark-on-yellow) on the candidate side.
//
// Public API (unchanged from the previous revision):
//   generateOfferLetterBlob(offer, template) → Blob (for upload)
//   downloadOfferLetter(offer, template)     → triggers download

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
const GRAY   = '#475569'
const LGRAY  = '#94a3b8'
const BORDER = '#cbd5e1'

// A4 is 595 × 842 pt. Letterhead art occupies the top ~130pt
// (logo) and bottom ~95pt (address block). Set page padding
// to clear those safe-zones on every page.
const PAGE_PAD_TOP     = 130
const PAGE_PAD_BOTTOM  = 95
const PAGE_PAD_SIDE    = 44

const S = StyleSheet.create({
  page: {
    fontFamily: 'Roboto',
    fontSize: 9.5,
    color: DARK,
    lineHeight: 1.45,
    paddingTop:    PAGE_PAD_TOP,
    paddingBottom: PAGE_PAD_BOTTOM,
    paddingLeft:   PAGE_PAD_SIDE,
    paddingRight:  PAGE_PAD_SIDE,
  },

  // A4 is 595 × 842 pt. Pin the letterhead to the absolute page
  // edges (not the padded content box) so the logo hits the top
  // and the address block hits the bottom of every physical page.
  bgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 595,
    height: 842,
  },

  refBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: GRAY,
    marginBottom: 10,
  },

  addressee:   { marginBottom: 10 },
  addresseeName: { fontFamily: 'Roboto', fontWeight: 'bold', fontSize: 10.5, color: DARK },
  addresseeLine: { fontSize: 9.5, color: DARK },

  subject: {
    fontFamily: 'Roboto', fontWeight: 'bold',
    fontSize: 10.5,
    color: DARK,
    textDecoration: 'underline',
    marginBottom: 10,
  },

  greet:   { marginBottom: 6, fontFamily: 'Roboto', fontWeight: 'bold' },
  para:    { marginBottom: 7, textAlign: 'justify' },

  clauseNum: {
    fontFamily: 'Roboto', fontWeight: 'bold',
    fontSize: 10.5,
    marginTop: 9, marginBottom: 4,
    color: DARK,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  bullet: {
    flexDirection: 'row',
    marginBottom: 3,
    paddingLeft: 10,
  },
  bulletDot:  { width: 10, fontSize: 9.5 },
  bulletText: { flex: 1, fontSize: 9.5, textAlign: 'justify' },

  // Terms table (Position / Reporting / Department / etc.)
  termsTable: {
    border: '0.5pt solid ' + BORDER,
    borderRadius: 3,
    marginBottom: 10,
    marginTop: 4,
  },
  termRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid ' + BORDER,
  },
  termRowLast: { flexDirection: 'row' },
  termLabel: {
    width: 150,
    backgroundColor: '#f8fafc',
    padding: '5 9',
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
    padding: '5 9',
    fontSize: 9.5,
    color: DARK,
  },

  // Annexure heading pill
  annexBand: {
    marginTop: 12,
    marginBottom: 8,
    padding: '6 10',
    backgroundColor: DARK,
    color: YELLOW,
    fontFamily: 'Roboto',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  annexSub: {
    fontFamily: 'Roboto', fontWeight: 'bold',
    fontSize: 10,
    color: DARK,
    marginTop: 4,
    marginBottom: 4,
  },

  // Digital-sign stamps
  signRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    gap: 18,
  },
  signBlock: {
    flex: 1,
    border: '0.5pt solid ' + BORDER,
    borderRadius: 4,
    padding: 10,
    backgroundColor: '#fafbfc',
  },
  signHeader: {
    fontFamily: 'Roboto', fontWeight: 'bold',
    fontSize: 9,
    color: GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  signName: {
    fontFamily: 'Roboto', fontWeight: 'bold',
    fontSize: 10.5,
    color: DARK,
  },
  signMeta: {
    fontSize: 9,
    color: GRAY,
    marginTop: 2,
  },
  signStamp: {
    marginTop: 8,
    padding: '4 8',
    backgroundColor: YELLOW,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  signStampDark: {
    marginTop: 8,
    padding: '4 8',
    backgroundColor: DARK,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  signStampText: {
    fontSize: 8.5, fontFamily: 'Roboto', fontWeight: 'bold',
    color: DARK, letterSpacing: 0.6,
  },
  signStampTextInv: {
    fontSize: 8.5, fontFamily: 'Roboto', fontWeight: 'bold',
    color: YELLOW, letterSpacing: 0.6,
  },

  pageNum: {
    position: 'absolute',
    bottom: 30, right: PAGE_PAD_SIDE,
    fontSize: 8,
    color: LGRAY,
  },
})

// ─── helpers ──────────────────────────────────────────────

function formatLongDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

function formatShortDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function salaryLine(monthly) {
  const m = Number(monthly) || 0
  return `${formatCurrency(m)} per month (${formatCurrency(m * 12)} per annum)`
}

// Map free-text position → Annexure A level
function resolveLevel(position) {
  const p = (position || '').toLowerCase()
  if (p.includes('head'))      return 'L3'
  if (p.includes('senior') || p.includes('sr'))  return 'L2'
  return 'L1'
}

// Human label for the level
function levelTitle(level) {
  return level === 'L3' ? 'Sales Head'
       : level === 'L2' ? 'Senior Sales Executive'
       : 'Sales Person'
}

// ─── document ─────────────────────────────────────────────

function OfferDocument({ offer, template }) {
  const issueDate = offer.created_at ? new Date(offer.created_at) : new Date()
  const issuedOn  = issueDate.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const candidateName = offer.full_legal_name || offer.candidate_name || '—'
  const firstName = (candidateName.split(' ')[0]) || candidateName
  const address = [
    offer.address_line1,
    offer.address_line2,
    [offer.city, offer.district].filter(Boolean).join(', '),
    [offer.state, offer.pincode].filter(Boolean).join(' - '),
  ].filter(Boolean)

  const level = resolveLevel(offer.position)
  const position = offer.position || levelTitle(level)
  const territory = offer.territory || '—'
  const joiningDate = formatLongDate(offer.joining_date)
  const joiningShort = formatShortDate(offer.joining_date)

  const monthlySalary = Number(offer.fixed_salary_monthly) || 0
  const multiplier    = Number(offer.incentive_sales_multiplier) || 0
  const newClientPct  = (Number(offer.incentive_new_client_rate) * 100) || 0
  const renewalPct    = (Number(offer.incentive_renewal_rate)   * 100) || 0
  const flatBonus     = Number(offer.incentive_flat_bonus) || 0

  const threshold = monthlySalary * 2
  const target    = monthlySalary * multiplier

  const refNo = offer.reference_no
    || `UA/HR/APPT/${issueDate.getFullYear()}/${String(offer.id || '').slice(0, 4).toUpperCase() || 'NNNN'}`

  // For Annexure B.1 we print only the candidate's own row (not
  // all three levels — that would be a privacy/confidentiality
  // breach under Clause 19).
  const ctcAnnum = monthlySalary * 12

  return (
    <Document>

      {/* ──────────── Page 1 ──────────── */}
      <Page size="A4" style={S.page} wrap>
        <Image src="/letterhead.png" style={S.bgImage} fixed />

        <View style={S.refBar}>
          <Text>Ref. No.: {refNo}</Text>
          <Text>Date: {issuedOn}</Text>
        </View>

        <View style={S.addressee}>
          <Text style={{ fontSize: 9.5, marginBottom: 2 }}>To,</Text>
          <Text style={S.addresseeName}>{candidateName}</Text>
          {offer.fathers_name && (
            <Text style={S.addresseeLine}>S/o / D/o {offer.fathers_name}</Text>
          )}
          {address.map((l, i) => (
            <Text key={i} style={S.addresseeLine}>{l}</Text>
          ))}
          {(offer.mobile || offer.personal_email || offer.candidate_email) && (
            <Text style={S.addresseeLine}>
              {offer.mobile ? `Mobile: ${offer.mobile}` : ''}
              {offer.mobile && (offer.personal_email || offer.candidate_email) ? '  |  ' : ''}
              {(offer.personal_email || offer.candidate_email)
                ? `Email: ${offer.personal_email || offer.candidate_email}` : ''}
            </Text>
          )}
        </View>

        <Text style={S.subject}>
          Subject: Letter of Appointment – Position of {position}
        </Text>

        <Text style={S.greet}>Dear {firstName},</Text>

        <Text style={S.para}>
          With reference to your application and the subsequent selection
          process, we are pleased to offer you employment with Untitled
          Advertising (hereinafter referred to as "the Company"), a
          proprietorship concern having its registered office at 203,
          Sidcup Tower, Beside Marble Arch, Racecourse, Vadodara – 390 007,
          Gujarat, India.
        </Text>

        <Text style={S.para}>
          Your appointment is governed by the following terms and conditions,
          together with the policies, rules, and codes of conduct of the
          Company as issued and amended from time to time.
        </Text>

        {/* 1. POSITION */}
        <Text style={S.clauseNum}>1. Position, Designation & Reporting</Text>
        <View style={S.termsTable}>
          <Row label="Designation" value={position} />
          <Row label="Grade / Level" value={`${level} – ${levelTitle(level)}`} />
          <Row label="Department" value="Sales & Business Development" />
          <Row label="Reporting To" value="Mr. Brijesh Solanki, Proprietor – Sales & Operations" />
          <Row label="Work Location" value={offer.place || 'Vadodara'} />
          <Row label="Assigned Territory" value={territory} />
          <Row label="Date of Joining" value={joiningDate} last />
        </View>
        <Text style={S.para}>
          The Company reserves the right to transfer, depute, or reassign
          you to any other department, function, location, branch, or
          associate entity within India, based on business requirements,
          without any change in the essential terms of employment other
          than those strictly necessitated by such transfer.
        </Text>

        {/* 2. NATURE */}
        <Text style={S.clauseNum}>2. Nature of Employment</Text>
        <Text style={S.para}>
          Your employment with the Company is on a full-time basis and is
          subject to the successful completion of the probation period as
          set out in Clause 4 below. Your employment is exclusive; you
          shall not engage, directly or indirectly, in any other trade,
          business, profession, employment, or remunerative activity
          during the tenure of your employment with the Company, whether
          during or outside working hours, without prior written permission
          from the Proprietor.
        </Text>

        {/* 3. JOINING */}
        <Text style={S.clauseNum}>3. Date of Joining & Documentation</Text>
        <Text style={S.para}>
          You are required to join the Company on or before {joiningDate}.
          Failure to join on or before this date, without prior written
          intimation and approval, shall render this offer automatically
          null and void, and the Company shall be under no obligation to
          extend the joining date or re-issue this letter.
        </Text>
        <Text style={S.para}>
          At the time of joining, you shall submit self-attested copies
          of the following (originals shall be produced for verification):
        </Text>
        <Bullet text="PAN Card and Aadhaar Card" />
        <Bullet text="Educational qualification certificates (10th, 12th, Graduation, Post-Graduation, as applicable)" />
        <Bullet text="Experience / Relieving letters from all previous employers" />
        <Bullet text="Latest salary slips (last 3 months) and Form 16 (last 2 financial years), where applicable" />
        <Bullet text="Passport-size photographs (4 nos.)" />
        <Bullet text="Proof of current residential address" />
        <Bullet text="Bank account details (cancelled cheque or passbook copy) for salary transfer" />
        <Bullet text="Two (2) professional / character references with contact details" />
        <Text style={S.para}>
          Your appointment is contingent upon (a) satisfactory verification
          of the above documents, (b) satisfactory background and reference
          checks, and (c) medical fitness certification where required. The
          Company reserves the right to withdraw this offer or terminate
          your services with immediate effect, without notice or
          compensation in lieu thereof, if any information furnished by
          you is found to be false, misleading, or materially incomplete,
          at any time during your employment.
        </Text>

        {/* 4. PROBATION */}
        <Text style={S.clauseNum}>4. Probation & Confirmation</Text>
        <Text style={S.para}>
          You shall be on probation for an initial period of six (6)
          months from the date of joining. During probation, your
          performance shall be evaluated on the basis of defined key
          performance indicators (KPIs), including but not limited to
          revenue generation, client acquisition, territory coverage,
          adherence to reporting discipline, and overall conduct.
        </Text>
        <Text style={S.para}>
          The probation period may, at the sole discretion of the Company,
          be extended for a further period of up to three (3) months if
          your performance is assessed as requiring improvement. On
          successful completion of probation, your confirmation in the
          services of the Company shall be intimated to you in writing.
          Until such written confirmation is issued, you shall continue
          to be deemed to be on probation.
        </Text>
        <Text style={S.para}>
          Confirmation is subject to the Company's written assessment of
          your performance. In the event your performance is found
          unsatisfactory, the Company reserves the right, at its
          discretion, to (a) extend probation, (b) reassign you to a
          different role or territory, or (c) terminate your services in
          accordance with Clause 14.
        </Text>

        {/* 5. COMPENSATION */}
        <Text style={S.clauseNum}>5. Compensation & Remuneration</Text>
        <Text style={S.para}>
          Your Cost to Company (CTC) shall be {salaryLine(monthlySalary)}.
          The remuneration is paid on a monthly basis and is inclusive of
          all statutory and non-statutory components, save as expressly
          provided in Annexure B (Compensation Structure).
        </Text>
        <Text style={S.para}>
          Currently, the Company does not operate a Provident Fund (EPF),
          Employees' State Insurance (ESIC), or similar statutory
          deduction scheme, and your remuneration shall be disbursed on a
          gross basis, subject only to applicable Tax Deducted at Source
          (TDS) under the Income Tax Act, 1961 and Professional Tax under
          the Gujarat State Tax on Professions, Trades, Callings and
          Employments Act, 1976, where applicable.
        </Text>
        <Text style={S.para}>
          <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>
            Future Statutory Compliance:
          </Text>
          {' '}As and when the Company becomes liable to register under
          the Employees' Provident Funds and Miscellaneous Provisions Act,
          1952, the Employees' State Insurance Act, 1948, the Payment of
          Gratuity Act, 1972, or any other applicable labour legislation,
          the Company shall restructure the CTC to accommodate such
          statutory contributions. Any such restructuring shall be
          effected so as not to reduce your net take-home pay, and the
          resultant revised structure shall form an integral part of
          these terms.
        </Text>
        <Text style={S.para}>
          <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>
            Performance Incentives & Commission:
          </Text>
          {' '}Variable pay, sales incentives, and commission structures
          applicable to your role are detailed in Annexure B. Incentives
          are discretionary in nature, are contingent upon achievement of
          pre-defined monthly and quarterly targets, and are payable only
          upon realisation of billings from clients. No incentive shall
          be payable on disputed, bad-debt, or written-off invoices.
        </Text>
        <Text style={S.para}>
          <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>
            Travel Allowance (TA) & Daily Allowance (DA):
          </Text>
          {' '}TA/DA shall be paid in accordance with the "Final Gujarat
          Sales Team – Bike Travel TA-DA Chart (2025-26)", as amended
          from time to time, which forms part of Annexure C to this letter.
        </Text>
        <Text style={S.para}>
          <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>
            Annual Review:
          </Text>
          {' '}Your compensation shall be reviewed annually, ordinarily
          in the month of April, subject to your continued employment,
          achievement of performance standards, and overall Company
          performance. Any revision shall be at the sole discretion of
          the Proprietor and is not an entitlement.
        </Text>

        {/* 6. WORKING */}
        <Text style={S.clauseNum}>6. Working Days, Hours & Travel</Text>
        <Text style={S.para}>
          Your normal working days shall be Monday to Saturday. Standard
          working hours shall be 10:00 AM to 7:00 PM, with a lunch break
          of thirty (30) minutes, totalling not less than eight and a
          half (8.5) working hours per day, in compliance with the
          Gujarat Shops and Establishments (Regulation of Employment and
          Conditions of Service) Act, 2019.
        </Text>
        <Text style={S.para}>
          By the very nature of your role, you will be required to travel
          extensively (approximately 50%–60% of working days) within your
          assigned territory, and occasionally outside the territory, to
          meet clients, conduct site inspections, attend events, and
          execute the Company's business. You agree to undertake such
          travel as a core requirement of your position.
        </Text>
        <Text style={S.para}>
          Sundays and public holidays notified by the Government of
          Gujarat shall be observed as weekly off / paid holidays, in
          accordance with the Company's published holiday calendar for
          each calendar year.
        </Text>

        {/* 7. LEAVE */}
        <Text style={S.clauseNum}>7. Leave Entitlement</Text>
        <Text style={S.para}>
          You shall be entitled to leave in accordance with the Gujarat
          Shops and Establishments (Regulation of Employment and
          Conditions of Service) Act, 2019, and the Company's leave
          policy, as amended from time to time. The current entitlement,
          on a pro-rated basis in the year of joining, is:
        </Text>
        <Bullet text="Earned / Privilege Leave (EL/PL): 21 working days per calendar year, accruing at the rate of 1.75 days per completed month of service, available after completion of 240 working days." />
        <Bullet text="Casual Leave (CL): 7 days per calendar year (non-carry-forward, non-encashable)." />
        <Bullet text="Sick Leave (SL): 7 days per calendar year (non-carry-forward, non-encashable). Sick leave exceeding two (2) consecutive days must be supported by a registered medical practitioner's certificate." />
        <Bullet text="Public / Festival Holidays: As per the Company's annual holiday calendar (typically 10 days per calendar year)." />
        <Bullet text="Maternity Leave: As per the Maternity Benefit Act, 1961, as amended." />
        <Text style={S.para}>
          All leave, except sick leave in unforeseen circumstances,
          requires prior written approval of the Reporting Manager.
          Unauthorised absence shall be treated as loss of pay (LOP) and,
          if continuous, may amount to misconduct as described in
          Clause 14.
        </Text>

        {/* 8. CONDUCT */}
        <Text style={S.clauseNum}>8. Code of Conduct & Company Policies</Text>
        <Text style={S.para}>
          You shall, at all times, conduct yourself with the highest
          standards of integrity, honesty, diligence, and professionalism.
          You shall comply with all policies, rules, circulars, standard
          operating procedures, and directions of the Company, as issued
          from time to time, including (without limitation):
        </Text>
        <Bullet text="The Company's Code of Conduct and Ethics Policy" />
        <Bullet text="Anti-Bribery, Anti-Corruption and Gifts/Hospitality Policy" />
        <Bullet text='Policy on the Prevention of Sexual Harassment at the Workplace, framed pursuant to the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 ("POSH Act")' />
        <Bullet text="Information Security, IT Usage and Data Protection Policy" />
        <Bullet text="Social Media and External Communication Policy" />
        <Bullet text="Conflict of Interest and Outside Engagement Policy" />
        <Bullet text="Expense Reimbursement and Travel Policy" />
        <Text style={S.para}>
          You shall devote the whole of your time, attention, skill, and
          abilities during working hours exclusively to the business of
          the Company, and shall not engage in any activity that is, or
          is likely to be, in conflict with the interests of the Company.
        </Text>

        {/* 9. CONFIDENTIALITY */}
        <Text style={S.clauseNum}>9. Confidentiality & Proprietary Information</Text>
        <Text style={S.para}>
          You acknowledge that, in the course of your employment, you
          will have access to and become acquainted with Confidential
          Information of the Company, including but not limited to:
          client lists and contact details, rate cards and commercial
          terms, site inventories, media plans, supplier and vendor
          agreements, pricing strategies, business plans, financial
          data, trade secrets, technical know-how, software, databases,
          marketing plans, and any other information of a confidential
          or proprietary nature (collectively, "Confidential Information").
        </Text>
        <Text style={S.para}>
          You agree that, during the term of your employment and at all
          times thereafter, you shall:
        </Text>
        <Bullet text="Hold all Confidential Information in strict confidence and shall not, directly or indirectly, disclose, publish, communicate, or make available any Confidential Information to any person, firm, corporation, or entity, except in the proper performance of your duties and with the prior written authorisation of the Proprietor." />
        <Bullet text="Not use any Confidential Information for any purpose other than the legitimate business purposes of the Company." />
        <Bullet text="Take all reasonable steps to prevent the unauthorised disclosure, copying, or use of Confidential Information." />
        <Bullet text="On cessation of employment, return to the Company all Confidential Information (in physical or electronic form), together with all copies, extracts, notes, and derivatives thereof, and permanently delete any such information from personal devices, email accounts, or cloud storage." />
        <Text style={S.para}>
          The obligations under this Clause shall survive the termination
          of your employment indefinitely, in respect of trade secrets,
          and for a period of three (3) years following cessation of
          employment, in respect of other Confidential Information.
        </Text>

        {/* 10. IP */}
        <Text style={S.clauseNum}>10. Intellectual Property</Text>
        <Text style={S.para}>
          All Intellectual Property, including creative concepts, designs,
          artwork, copy, pitch decks, client proposals, site layouts,
          photographs, software, databases, processes, methods, and any
          other works created, conceived, developed, or reduced to
          practice by you, whether alone or jointly with others, during
          the course of your employment or using any resources of the
          Company, shall be the sole and exclusive property of the
          Company ("Company IP").
        </Text>
        <Text style={S.para}>
          You hereby assign, and to the extent not already vested, agree
          to assign on first creation, all right, title, and interest
          (including all copyrights, design rights, patent rights, and
          rights in confidential information) in the Company IP to the
          Company, absolutely and throughout the world, free from all
          encumbrances. You waive all moral rights in the Company IP to
          the maximum extent permitted by law. You shall, at the
          Company's cost, execute such documents and do such acts as may
          be reasonably required by the Company to vest, perfect, or
          enforce its rights in the Company IP.
        </Text>

        {/* 11. NON-SOLICITATION */}
        <Text style={S.clauseNum}>11. Non-Solicitation</Text>
        <Text style={S.para}>
          You agree that, during the term of your employment and for a
          period of twelve (12) months following the cessation of your
          employment (howsoever arising), you shall not, directly or
          indirectly, whether on your own account or on behalf of any
          other person, firm, or entity:
        </Text>
        <Bullet text="Solicit, canvass, approach, entice, or induce any client or customer of the Company (with whom you had dealings, or about whom you had access to Confidential Information, during the last twenty-four (24) months of your employment) to cease, reduce, or transfer any business from the Company, or to place any business with any competing entity;" />
        <Bullet text="Solicit, induce, or attempt to induce any employee, consultant, vendor, or supplier of the Company to terminate his/her/its engagement or contract with the Company, or to enter into any employment or engagement with you or any third party;" />
        <Bullet text="Interfere with, or attempt to interfere with, the relationship between the Company and any of its clients, vendors, employees, or business associates." />
        <Text style={S.para}>
          <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>
            Note on Enforceability:
          </Text>
          {' '}The parties acknowledge that the above restrictions relate
          solely to non-solicitation and protection of legitimate business
          interests (including Confidential Information and goodwill), and
          do not, in any manner, restrain you from exercising your lawful
          profession, trade, or business post-employment, consistent with
          Section 27 of the Indian Contract Act, 1872.
        </Text>

        {/* 12. NOTICE */}
        <Text style={S.clauseNum}>12. Notice Period & Resignation</Text>
        <View style={S.termsTable}>
          <Row label="During Probation" value="Fifteen (15) days' written notice from either side, or salary/pay in lieu thereof" />
          <Row label="Post Confirmation" value={level === 'L3'
            ? "Sixty (60) days' written notice (Sales Head), or salary/pay in lieu thereof"
            : "Thirty (30) days' written notice, or salary/pay in lieu thereof"
          } last />
        </View>
        <Text style={S.para}>
          You shall be required to serve the full notice period unless the
          Company, in its sole discretion, accepts a shorter notice period
          or waives the notice requirement. The Company reserves the right
          to require you, during the notice period, to be placed on garden
          leave, to hand over pending assignments, to refrain from
          contacting clients, and/or to return Company property.
        </Text>
        <Text style={S.para}>
          Acceptance of your resignation shall be communicated in writing.
          Your employment shall not be deemed to have ceased until you
          have (a) served the notice period (or made payment in lieu),
          (b) satisfactorily completed handover and knowledge transfer,
          (c) returned all Company property, and (d) received a written
          relieving letter and full-and-final settlement from the Company.
        </Text>

        {/* 13. FnF */}
        <Text style={S.clauseNum}>13. Full and Final Settlement</Text>
        <Text style={S.para}>
          On cessation of employment for any reason, you shall be
          entitled to a full-and-final settlement comprising: (a) salary
          for the days worked up to the last working day, (b) encashment
          of unavailed Earned Leave (capped at 30 days' accrual),
          (c) any pending reimbursements duly supported by bills, and
          (d) any earned-but-unpaid incentives on realised billings, less
          (i) notice period shortfall, (ii) recovery of any advance,
          loan, or Company dues, (iii) recovery for non-returned Company
          property at replacement value, and (iv) TDS and other applicable
          statutory deductions.
        </Text>
        <Text style={S.para}>
          The full-and-final settlement shall ordinarily be paid within
          forty-five (45) working days from the last working day, subject
          to completion of exit formalities and clearance from all
          departments.
        </Text>

        {/* 14. TERMINATION */}
        <Text style={S.clauseNum}>14. Termination</Text>
        <Text style={S.para}>
          Your employment may be terminated in accordance with Clause 12
          (Notice Period). In addition, the Company reserves the right to
          terminate your employment forthwith, without notice or
          compensation in lieu thereof, and without prejudice to any
          other remedy available in law or equity, in the event of any
          of the following, which shall constitute gross misconduct:
        </Text>
        <Bullet text="Fraud, theft, embezzlement, misappropriation, or dishonesty" />
        <Bullet text="Wilful disobedience of lawful and reasonable instructions of the Company" />
        <Bullet text="Breach of confidentiality, intellectual property, or non-solicitation obligations" />
        <Bullet text="Acceptance of bribes, kickbacks, or gifts of significant value from clients or vendors, without written approval" />
        <Bullet text="Conviction for any criminal offence involving moral turpitude" />
        <Bullet text="Falsification of records, expense claims, attendance, or reimbursement bills" />
        <Bullet text="Consumption of alcohol or illegal substances during working hours, or reporting to work under their influence" />
        <Bullet text="Sexual harassment or any conduct in violation of the POSH Act, 2013" />
        <Bullet text="Repeated non-performance or failure to meet minimum performance standards, after due warning" />
        <Bullet text="Unauthorised absence of eight (8) or more consecutive working days without prior approval or acceptable justification, provided that a show-cause notice has been issued and you have failed to respond within the time stipulated therein" />
        <Text style={S.para}>
          In respect of allegations of misconduct, the Company shall,
          save in cases requiring urgent action to protect its interests,
          observe the principles of natural justice, including the
          issuance of a show-cause notice and an opportunity to respond,
          before taking action.
        </Text>

        {/* 15. POST-EMPLOYMENT */}
        <Text style={S.clauseNum}>15. Post-Employment Obligations</Text>
        <Text style={S.para}>On cessation of employment, you shall:</Text>
        <Bullet text="Return forthwith all Company property in your possession or control, including (without limitation) laptops, mobile phones, SIM cards, identity cards, access cards, visiting cards, letterheads, keys, sample materials, client files, rate cards, presentation decks, marketing collateral, expense advances, and any other physical or electronic records belonging to the Company." />
        <Bullet text="Permanently delete all Confidential Information from personal devices, email accounts, cloud storage, and social media, and provide a written declaration to that effect if required." />
        <Bullet text="Cooperate in the orderly handover of your responsibilities, clients, pipelines, and pending matters to a successor designated by the Company." />
        <Bullet text="Continue to observe the confidentiality and non-solicitation obligations under Clauses 9 and 11, as applicable." />

        {/* 16. DPDP */}
        <Text style={S.clauseNum}>16. Data Protection & Privacy</Text>
        <Text style={S.para}>
          The Company shall collect, store, and process your personal
          data (including demographic, financial, and identification
          details) for the lawful purposes of employment administration,
          payroll, statutory compliance, performance management, and
          such other purposes as are reasonably connected to your
          employment, in accordance with the Digital Personal Data
          Protection Act, 2023, and applicable rules. By accepting this
          letter, you consent to such processing and to the sharing of
          your data with authorised third-party service providers (such
          as payroll processors, banks, statutory authorities, and
          auditors) on a need-to-know basis.
        </Text>

        {/* 17. POSH */}
        <Text style={S.clauseNum}>17. Prevention of Sexual Harassment (POSH)</Text>
        <Text style={S.para}>
          The Company is committed to providing a safe and respectful
          workplace, free from sexual harassment of any kind. The Company
          has an Internal Complaints Committee (ICC) / designated
          redressal mechanism, as required under the Sexual Harassment
          of Women at Workplace (Prevention, Prohibition and Redressal)
          Act, 2013, and you are required to familiarise yourself with,
          and comply with, the Company's POSH Policy. Any act of sexual
          harassment shall be treated as gross misconduct under Clause 14.
        </Text>

        {/* 18. LAW */}
        <Text style={S.clauseNum}>18. Governing Law & Jurisdiction</Text>
        <Text style={S.para}>
          This Letter of Appointment and your employment shall be governed
          by, and construed in accordance with, the laws of India. Any
          dispute, controversy, or claim arising out of or in connection
          with your employment, or the termination thereof, shall be
          subject to the exclusive jurisdiction of the competent courts
          at Vadodara, Gujarat, without prejudice to any statutory forum
          of mandatory jurisdiction (including labour courts and
          industrial tribunals, where applicable).
        </Text>

        {/* 19. GENERAL */}
        <Text style={S.clauseNum}>19. General Provisions</Text>
        <Bullet text="Entire Agreement: This letter, together with the Annexures (A–C), constitutes the entire agreement between you and the Company in respect of your employment, and supersedes all prior offers, representations, or understandings, whether written or oral." />
        <Bullet text="Amendment: No amendment or modification to these terms shall be valid unless in writing and signed by the Proprietor." />
        <Bullet text="Severability: If any provision of this letter is held invalid or unenforceable, the remaining provisions shall continue in full force and effect, and the invalid provision shall be deemed modified to the minimum extent necessary to render it enforceable." />
        <Bullet text="Waiver: No failure or delay by the Company in exercising any right under this letter shall operate as a waiver thereof." />
        <Bullet text="Confidentiality of Remuneration: The remuneration details contained herein are strictly confidential, personal to you, and shall not be disclosed to any colleague, third party, or external person, save as required by law or with the prior written permission of the Proprietor." />
        <Bullet text="Notices: Any notice under this letter shall be served in writing, by hand delivery, registered post, courier, or email, at the address/email set out at the top of this letter (or such other address as may be notified in writing)." />

        {/* 20. ACCEPTANCE */}
        <Text style={S.clauseNum}>20. Acceptance</Text>
        <Text style={S.para}>
          Kindly signify your acceptance of the above terms and conditions
          by digitally accepting this letter through the Company's HR
          portal on or before {joiningDate}. Failure to do so within the
          stipulated period shall render this offer null and void, at the
          discretion of the Company.
        </Text>
        <Text style={S.para}>
          We welcome you to the Untitled Advertising family, and we look
          forward to a long, mutually rewarding, and professionally
          fulfilling association.
        </Text>

        {/* Digital-sign stamps (company + candidate) */}
        <View style={S.signRow}>
          <View style={S.signBlock}>
            <Text style={S.signHeader}>For Untitled Advertising</Text>
            <Text style={S.signName}>Brijesh Solanki</Text>
            <Text style={S.signMeta}>Proprietor – Sales & Operations</Text>
            <Text style={S.signMeta}>Issued on: {issuedOn}</Text>
            <View style={S.signStampDark}>
              <Text style={S.signStampTextInv}>DIGITALLY SIGNED</Text>
            </View>
          </View>

          <View style={S.signBlock}>
            <Text style={S.signHeader}>Accepted by Candidate</Text>
            <Text style={S.signName}>{candidateName}</Text>
            <Text style={S.signMeta}>
              PAN: {offer.pan_number || '—'}
            </Text>
            <Text style={S.signMeta}>
              Place: {offer.place || 'Vadodara'}
            </Text>
            {offer.accepted_terms_at ? (
              <>
                <Text style={S.signMeta}>
                  Accepted on: {formatLongDate(offer.accepted_terms_at)}
                </Text>
                <View style={S.signStamp}>
                  <Text style={S.signStampText}>DIGITALLY ACCEPTED</Text>
                </View>
              </>
            ) : (
              <Text style={[S.signMeta, { marginTop: 6 }]}>
                Pending candidate acceptance
              </Text>
            )}
          </View>
        </View>

        <Text style={S.pageNum} render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>

      {/* ──────────── Annexure A – role-specific ──────────── */}
      <Page size="A4" style={S.page} wrap>
        <Image src="/letterhead.png" style={S.bgImage} fixed />

        <Text style={S.annexBand}>Annexure A — Role-Specific Terms, Responsibilities & KPIs</Text>

        {level === 'L1' && <AnnexA_L1 territory={territory} />}
        {level === 'L2' && <AnnexA_L2 territory={territory} />}
        {level === 'L3' && <AnnexA_L3 territory={territory} />}

        <Text style={S.pageNum} render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>

      {/* ──────────── Annexure B – compensation ──────────── */}
      <Page size="A4" style={S.page} wrap>
        <Image src="/letterhead.png" style={S.bgImage} fixed />

        <Text style={S.annexBand}>Annexure B — Compensation, Incentive & Commission Structure</Text>

        <Text style={S.annexSub}>B.1  Fixed Monthly Remuneration (Gross)</Text>
        <View style={S.termsTable}>
          <Row label="Level" value={`${level} – ${levelTitle(level)}`} />
          <Row label="Position" value={position} />
          <Row label="Fixed Gross / Month" value={formatCurrency(monthlySalary)} />
          <Row label="Fixed Gross / Annum" value={formatCurrency(ctcAnnum)} last />
        </View>
        <Text style={S.para}>
          Salary is disbursed by bank transfer on or before the 7th
          (seventh) of the succeeding month, subject to deduction of TDS
          under Section 192 of the Income Tax Act, 1961, and Professional
          Tax, where applicable.
        </Text>

        <Text style={S.annexSub}>B.2  Performance Incentive & Commission</Text>
        <Text style={S.para}>
          Variable pay is payable only on realised billings (i.e., invoices
          for which payment has been received in full from the client) and
          is computed as below:
        </Text>
        <View style={S.termsTable}>
          <Row label="Incentive Threshold"
               value={`${formatCurrency(threshold)} per month (2× fixed salary)`} />
          <Row label="Monthly Target"
               value={`${formatCurrency(target)} per month (${multiplier}× fixed salary)`} />
          <Row label="New-Client Commission"
               value={`${newClientPct.toFixed(2)}% on realised billings from new clients`} />
          <Row label="Renewal Commission"
               value={`${renewalPct.toFixed(2)}% on realised billings from renewals`} />
          <Row label="Flat Stretch Bonus"
               value={flatBonus > 0
                 ? `${formatCurrency(flatBonus)} per month when realised billings exceed the monthly target`
                 : 'Not applicable'
               } last />
        </View>
        <Text style={S.para}>
          Commission is payable once monthly realised billing crosses the
          incentive threshold above, on the entire realised billing (not
          merely the excess over threshold).
        </Text>

        <Text style={S.annexSub}>B.3  Terms Applicable to All Variable Pay</Text>
        <Bullet text="Variable pay shall be computed monthly and paid quarterly, within 30 days of the close of the quarter, subject to continued employment and no notice having been served by either party." />
        <Bullet text="Disputed, written-off, bad-debt, or reversed invoices shall not qualify for commission; any commission paid on such invoices shall be recoverable / adjustable against future payments." />
        <Bullet text="Discounts beyond the delegated authority matrix, or credit extended in breach of the Company's credit policy, shall not qualify for commission." />
        <Bullet text="In case of resignation, termination, or cessation of employment for any reason, no variable pay shall accrue or be payable for the quarter in which separation occurs, save for commissions already crystallised and approved in writing prior to the date of separation." />
        <Bullet text="The Company reserves the right to revise the commission / incentive structure from time to time by giving thirty (30) days' written notice. Changes shall apply prospectively." />

        <Text style={S.annexSub}>B.4  Travelling Allowance (TA) & Daily Allowance (DA)</Text>
        <Text style={S.para}>
          TA/DA is reimbursed in accordance with the "Final Gujarat Sales
          Team – Bike Travel TA-DA Chart (2025-26)", reproduced at
          Annexure C, and the following rules:
        </Text>
        <Bullet text="Daily Allowance: ₹200 per tour day (food and miscellaneous), fixed, no bills required." />
        <Bullet text="Bike / Two-Wheeler: ₹3 per km on round-trip distance (shortest route per Google Maps). No minimum limit." />
        <Bullet text="Toll & Parking: Reimbursed 100% on production of receipts (photograph of receipt to be shared on WhatsApp with the immediate supervisor on the same day)." />
        <Bullet text="Hotel / Overnight Stay: Only where pre-approved in writing by the Reporting Manager, subject to city ceilings set out in Annexure C, inclusive of GST, and against a hotel invoice issued in the name and GSTIN of Untitled Advertising." />
        <Bullet text="Advance: A weekly advance may be drawn every Monday based on 100% of the planned tour programme for the week." />
        <Bullet text="Claim: Claims must be submitted every Saturday evening, supported by the Daily Visit Report. Balance/excess shall be settled by the following Tuesday." />
        <Text style={S.para}>
          Non-compliance, inflated claims, or falsified bills shall
          constitute gross misconduct under Clause 14 of the main letter.
        </Text>

        <Text style={S.pageNum} render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>

      {/* ──────────── Annexure C – TA/DA chart ──────────── */}
      <Page size="A4" style={S.page} wrap>
        <Image src="/letterhead.png" style={S.bgImage} fixed />

        <Text style={S.annexBand}>Annexure C — Gujarat Sales Team Bike Travel TA/DA Chart (2025–26)</Text>

        <Text style={S.annexSub}>Rules</Text>
        <Bullet text="Daily DA → ₹200 fixed per tour day (no bills required)." />
        <Bullet text="Bike → ₹3 per km round trip (Google Maps shortest route) — no minimum." />
        <Bullet text="Toll + Parking → 100% actual, on production of receipt (photo on WhatsApp)." />
        <Bullet text="Hotel → Only when pre-approved by Manager in writing → Surat (A) max ₹1,100 | B-cities ₹900 | C-cities ₹700 (all inclusive of GST) → Hotel invoice MUST be in the Company name and carry the Company's GSTIN." />
        <Bullet text="Weekly Advance → Every Monday morning (100% of planned week amount)." />
        <Bullet text="Submit Claim → Every Saturday evening → Balance/excess settled by Tuesday." />

        <Text style={[S.annexSub, { marginTop: 12 }]}>City Ceilings</Text>
        <TADATable />

        <Text style={[S.para, { marginTop: 14, fontSize: 9, color: GRAY, textAlign: 'center' }]}>
          — End of Document —
        </Text>

        <Text style={S.pageNum} render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>

    </Document>
  )
}

// ─── small components ─────────────────────────────────────

function Row({ label, value, last }) {
  return (
    <View style={last ? S.termRowLast : S.termRow}>
      <Text style={S.termLabel}>{label}</Text>
      <Text style={S.termValue}>{value}</Text>
    </View>
  )
}

function Bullet({ text }) {
  return (
    <View style={S.bullet} wrap={false}>
      <Text style={S.bulletDot}>•</Text>
      <Text style={S.bulletText}>{text}</Text>
    </View>
  )
}

// ─── Annexure A variants ──────────────────────────────────

function AnnexA_L1({ territory }) {
  return (
    <>
      <Text style={S.annexSub}>Level 1 — Sales Person (Field Sales Executive)</Text>
      <View style={S.termsTable}>
        <Row label="Reporting To" value="Sr. Sales Executive / Sales Head" />
        <Row label="Territory" value={territory || 'Single district / zone as assigned'} last />
      </View>
      <Text style={S.annexSub}>Key Responsibilities</Text>
      <Bullet text="New client acquisition through field visits, cold calling, and territory mapping" />
      <Bullet text="Minimum 30 client meetings per week and daily updation of the CRM / daily visit report" />
      <Bullet text="Preparation and presentation of rate cards, site layouts, and advertising proposals" />
      <Bullet text="Coordination with operations for site installations and campaign execution" />
      <Bullet text="Collection of outstanding payments from assigned clients" />
      <Text style={S.para}>
        <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>Monthly Target (Indicative):</Text>
        {' '}₹1,00,000 – ₹1,50,000 billings per month (subject to Annexure B).
      </Text>
      <Text style={S.para}>
        <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>Confirmation Criteria:</Text>
        {' '}Average monthly billing of not less than ₹1,00,000 over the
        final three (3) months of probation, and overall conduct rating
        of "Meets Expectations" or above.
      </Text>
    </>
  )
}

function AnnexA_L2({ territory }) {
  return (
    <>
      <Text style={S.annexSub}>Level 2 — Senior Sales Executive</Text>
      <View style={S.termsTable}>
        <Row label="Reporting To" value="Sales Head" />
        <Row label="Territory" value={territory || 'Cluster of 2–3 districts as assigned'} last />
      </View>
      <Text style={S.annexSub}>Key Responsibilities</Text>
      <Bullet text="Key account management and growth of existing client relationships" />
      <Bullet text="Mentoring and on-field coaching of Sales Persons in the assigned cluster" />
      <Bullet text="Ownership of cluster-level revenue, renewals, and collections" />
      <Bullet text="Weekly pipeline review with the Sales Head and monthly business reviews" />
      <Bullet text="Competition tracking, rate benchmarking, and market intelligence reporting" />
      <Text style={S.para}>
        <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>Monthly Target (Indicative):</Text>
        {' '}₹3,00,000 – ₹5,00,000 billings per month (subject to Annexure B).
      </Text>
      <Text style={S.para}>
        <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>Confirmation Criteria:</Text>
        {' '}Average monthly billing of not less than ₹3,00,000 over the
        final three (3) months of probation, achievement of renewal rate
        ≥ 70%, and conduct rating of "Meets Expectations" or above.
      </Text>
    </>
  )
}

function AnnexA_L3({ territory }) {
  return (
    <>
      <Text style={S.annexSub}>Level 3 — Sales Head</Text>
      <View style={S.termsTable}>
        <Row label="Reporting To" value="Proprietor" />
        <Row label="Territory" value={territory || 'State / multi-state, as assigned'} last />
      </View>
      <Text style={S.annexSub}>Key Responsibilities</Text>
      <Bullet text="End-to-end ownership of sales, revenue, collections, and team performance for the assigned territory" />
      <Bullet text="Recruitment, training, performance management, and retention of the sales team" />
      <Bullet text="Annual sales budgeting, forecasting, and monthly/quarterly review with the Proprietor" />
      <Bullet text="Large account acquisition, government tenders, and strategic agency partnerships" />
      <Bullet text="Pricing strategy, discount approvals (within delegated authority), and credit policy adherence" />
      <Bullet text="Coordination with operations, finance, and creative teams to ensure client satisfaction" />
      <Text style={S.para}>
        <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>Monthly Target (Indicative):</Text>
        {' '}₹12,00,000 – ₹15,00,000 team billings per month (subject to Annexure B).
      </Text>
      <Text style={S.para}>
        <Text style={{ fontFamily: 'Roboto', fontWeight: 'bold' }}>Confirmation Criteria:</Text>
        {' '}Average monthly team billing of not less than ₹12,00,000 over
        the final three (3) months of probation, team DSO (Days Sales
        Outstanding) within policy, and conduct rating of "Meets
        Expectations" or above. Where performance is below threshold but
        trending positive, the Company may offer a documented Performance
        Improvement Plan (PIP) of up to 90 days in lieu of immediate
        termination.
      </Text>
    </>
  )
}

// Annexure C city ceilings table
const TADA_ROWS = [
  ['Anand', 'C', 700], ['Kheda / Nadiad', 'C', 700], ['Gandhinagar', 'B', 900],
  ['Himmatnagar', 'C', 700], ['Dahod', 'C', 700], ['Godhra', 'C', 700],
  ['Ankleshwar GIDC', 'B', 900], ['Surat (City)', 'A', 1100], ['Valsad / Vapi', 'B', 900],
  ['Chikhli', 'C', 700], ['Botad', 'C', 700], ['Bhavnagar', 'B', 900],
  ['Veraval', 'C', 700], ['Junagadh', 'B', 900], ['Porbandar', 'C', 700],
  ['Dwarka', 'C', 700], ['Jamnagar', 'B', 900], ['Morbi', 'C', 700],
  ['Bhachau (Kutch)', 'C', 700], ['Surendranagar', 'C', 700],
]

function TADATable() {
  return (
    <View style={{ border: '0.5pt solid ' + BORDER, borderRadius: 3 }}>
      <View style={{
        flexDirection: 'row',
        backgroundColor: '#0f172a',
        padding: '6 8',
      }}>
        <Text style={{ width: 30, fontSize: 9, color: YELLOW, fontFamily: 'Roboto', fontWeight: 'bold' }}>Sr.</Text>
        <Text style={{ flex: 1.6, fontSize: 9, color: YELLOW, fontFamily: 'Roboto', fontWeight: 'bold' }}>City / Area</Text>
        <Text style={{ width: 60, fontSize: 9, color: YELLOW, fontFamily: 'Roboto', fontWeight: 'bold' }}>Category</Text>
        <Text style={{ width: 60, fontSize: 9, color: YELLOW, fontFamily: 'Roboto', fontWeight: 'bold' }}>Daily DA</Text>
        <Text style={{ width: 80, fontSize: 9, color: YELLOW, fontFamily: 'Roboto', fontWeight: 'bold' }}>Bike</Text>
        <Text style={{ width: 80, fontSize: 9, color: YELLOW, fontFamily: 'Roboto', fontWeight: 'bold' }}>Hotel (₹, incl. GST)</Text>
      </View>
      {TADA_ROWS.map(([city, cat, hotel], i) => (
        <View key={i} style={{
          flexDirection: 'row',
          padding: '5 8',
          borderTop: '0.5pt solid ' + BORDER,
          backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc',
        }}>
          <Text style={{ width: 30, fontSize: 8.5 }}>{i + 1}</Text>
          <Text style={{ flex: 1.6, fontSize: 8.5 }}>{city}</Text>
          <Text style={{ width: 60, fontSize: 8.5 }}>{cat}</Text>
          <Text style={{ width: 60, fontSize: 8.5 }}>₹200</Text>
          <Text style={{ width: 80, fontSize: 8.5 }}>₹3 per km</Text>
          <Text style={{ width: 80, fontSize: 8.5 }}>₹{hotel.toLocaleString('en-IN')}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── Public API ───────────────────────────────────────────

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
