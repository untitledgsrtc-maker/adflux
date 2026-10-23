// src/components/incentives/SalarySlipPDF.jsx
//
// Phase 185 — rep-downloadable salary slip (PDF).
//
// A plain one-page A4 salary slip built from the SAME numbers the payroll
// function returns (compute_monthly_salary): base 70% + variable 30% +
// incentive + TA/DA − leave deduction = net payable. Owner decisions:
// plain "Untitled" logo header (no legal entity), show the score %. The PAID
// row shows the recorded payout when one exists, else "PAYMENT · Pending"
// (owner 2026-08-31 REVERSED the 2026-07-02 "download only after full payment"
// gate — a slip is now downloadable for any recent month, paid or not).
//
// Money is display-only here — the figures come straight from the RPC the
// rep is already allowed to read for themselves (self-gated). No new math.
//
// `buildSalarySlipBlob(data)` renders the PDF client-side via
// @react-pdf/renderer (same dep as OfferLetterPDF), so nothing hits a server.
// Handing it to the person (share sheet / download) is utils/savePdf.js.

import {
  Document, Page, Text, View, Image, StyleSheet, pdf,
} from '@react-pdf/renderer'
import { safePdfName } from '../../utils/savePdf'

// Rs. + Indian grouping — avoids the ₹ glyph (blank in react-pdf's default
// Helvetica) while staying unambiguous on a payslip.
function inr(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN')
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${MON[Number(m) - 1] || ''} ${y}`
}

const YELLOW = '#FFE600'
const INK = '#0c1224'
const INK2 = '#4a5474'
const LINE = '#e3e6ee'

const S = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 44, paddingHorizontal: 44, fontSize: 10, color: INK, fontFamily: 'Helvetica' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 38, height: 38, borderRadius: 8 },
  brandWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { fontSize: 15, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  slipTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: INK2, letterSpacing: 2 },
  slipMonth: { fontSize: 10, color: INK2, marginTop: 2, textAlign: 'right' },
  rule: { height: 3, backgroundColor: YELLOW, marginTop: 12, marginBottom: 16, borderRadius: 2 },

  empGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 18 },
  empCell: { width: '50%', marginBottom: 6 },
  empLabel: { fontSize: 8, color: INK2, textTransform: 'uppercase', letterSpacing: 0.5 },
  empValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  sectionHead: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: INK2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: LINE },
  rowLabel: { fontSize: 10, color: INK },
  rowNote: { fontSize: 8, color: INK2, marginTop: 1 },
  rowAmt: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  subtotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 2 },
  subLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: INK2 },
  subAmt: { fontSize: 10, fontFamily: 'Helvetica-Bold' },

  netBox: { marginTop: 18, backgroundColor: '#f8f9fc', borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  netLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: INK2, textTransform: 'uppercase', letterSpacing: 1 },
  netAmt: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: INK },

  paidRow: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, backgroundColor: 'rgba(16,185,129,0.10)', borderRadius: 8 },
  paidLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#0f7a54' },
  paidVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#0f7a54' },

  footer: { position: 'absolute', bottom: 26, left: 44, right: 44, fontSize: 8, color: INK2, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
})

// data = { rep:{name,designation}, monthLabel, salary:<jsonb>, payout:{amount_paid,paid_date} }
// logoSrc = optional data: URL for the header logo. When absent the slip simply
// has no logo (Phase 359: a logo that fails to load must never block the slip).
export function SalarySlipDocument({ rep, monthLabel, salary, payout, logoSrc }) {
  const base       = Number(salary?.base || 0)
  const variable   = Number(salary?.variable || 0)
  const incentive  = Number(salary?.incentive || 0)
  const taDa       = Number(salary?.ta_da || 0)
  const leaveCut   = Number(salary?.unpaid_deduction || 0)
  const net        = Number(salary?.net_payable || 0)
  const gross      = base + variable + incentive + taDa
  const scorePct   = Number(salary?.score_pct || 0)
  const workDays   = Number(salary?.working_days || 0)
  const leaveDays  = Number(salary?.leave_days_total || 0)
  const monthlySal = Number(salary?.monthly_salary || 0)

  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* Header — plain Untitled logo, no legal entity */}
        <View style={S.headRow}>
          <View style={S.brandWrap}>
            {logoSrc ? <Image src={logoSrc} style={S.logo} /> : null}
            <Text style={S.brand}>UNTITLED</Text>
          </View>
          <View>
            <Text style={S.slipTitle}>SALARY SLIP</Text>
            <Text style={S.slipMonth}>{monthLabel}</Text>
          </View>
        </View>
        <View style={S.rule} />

        {/* Employee */}
        <View style={S.empGrid}>
          <View style={S.empCell}>
            <Text style={S.empLabel}>Employee</Text>
            <Text style={S.empValue}>{rep?.name || '—'}</Text>
          </View>
          <View style={S.empCell}>
            <Text style={S.empLabel}>Designation</Text>
            <Text style={S.empValue}>{rep?.designation || '—'}</Text>
          </View>
          <View style={S.empCell}>
            <Text style={S.empLabel}>Pay period</Text>
            <Text style={S.empValue}>{monthLabel}</Text>
          </View>
          <View style={S.empCell}>
            <Text style={S.empLabel}>Fixed salary</Text>
            <Text style={S.empValue}>{inr(monthlySal)}</Text>
          </View>
        </View>

        {/* Earnings */}
        <Text style={S.sectionHead}>Earnings</Text>
        <View style={S.row}>
          <View>
            <Text style={S.rowLabel}>Base salary</Text>
            <Text style={S.rowNote}>70% of fixed</Text>
          </View>
          <Text style={S.rowAmt}>{inr(base)}</Text>
        </View>
        <View style={S.row}>
          <View>
            <Text style={S.rowLabel}>Performance pay (variable)</Text>
            <Text style={S.rowNote}>30% cap · score {scorePct}%</Text>
          </View>
          <Text style={S.rowAmt}>{inr(variable)}</Text>
        </View>
        <View style={S.row}>
          <Text style={S.rowLabel}>Incentive</Text>
          <Text style={S.rowAmt}>{inr(incentive)}</Text>
        </View>
        <View style={S.row}>
          <Text style={S.rowLabel}>TA / DA (travel)</Text>
          <Text style={S.rowAmt}>{inr(taDa)}</Text>
        </View>
        <View style={S.subtotal}>
          <Text style={S.subLabel}>Gross earnings</Text>
          <Text style={S.subAmt}>{inr(gross)}</Text>
        </View>

        {/* Deductions */}
        <Text style={[S.sectionHead, { marginTop: 12 }]}>Deductions</Text>
        <View style={S.row}>
          <View>
            <Text style={S.rowLabel}>Leave deduction</Text>
            <Text style={S.rowNote}>{leaveDays} day(s) · salary ÷ {Number(salary?.unpaid_divisor || 26)} per day{Number(salary?.late_half_days || 0) > 0 ? ` · incl. ${Number(salary.late_half_days)} day(s) for check-in after 11:30` : ''}</Text>
          </View>
          <Text style={S.rowAmt}>{leaveCut > 0 ? '- ' + inr(leaveCut) : inr(0)}</Text>
        </View>
        <View style={S.subtotal}>
          <Text style={S.subLabel}>Total deductions</Text>
          <Text style={S.subAmt}>{inr(leaveCut)}</Text>
        </View>

        {/* Net */}
        <View style={S.netBox}>
          <Text style={S.netLabel}>Net payable</Text>
          <Text style={S.netAmt}>{inr(net)}</Text>
        </View>

        {/* Paid — blank/Pending until the accountant records a payout (owner 2026-08-31,
            reverses the Phase 185 download-only-when-paid gate). */}
        <View style={[S.paidRow, payout ? {} : { backgroundColor: LINE }]}>
          <Text style={[S.paidLabel, payout ? {} : { color: INK2 }]}>{payout ? 'PAID' : 'PAYMENT'}</Text>
          <Text style={[S.paidVal, payout ? {} : { color: INK2 }]}>
            {payout ? `${inr(payout.amount_paid ?? net)} on ${fmtDate(payout.paid_date)}` : 'Pending'}
          </Text>
        </View>

        {/* Footer */}
        <View style={S.footer} fixed>
          <Text>System-generated · Score {scorePct}% · {workDays} working days · {leaveDays} leave day(s)</Text>
          <Text>Untitled</Text>
        </View>
      </Page>
    </Document>
  )
}

// Logo as a data: URL so the PDF renderer never does its own network fetch.
// Best-effort: any failure returns null and the slip renders without a logo.
async function loadLogoDataUrl() {
  try {
    const res = await fetch('/icon-192.png')
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const r = new FileReader()
      r.onerror = () => resolve(null)
      r.onload = () => resolve(String(r.result || '') || null)
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// Render the slip to a PDF Blob. No server round-trip, nothing uploaded.
export async function buildSalarySlipBlob(data) {
  const logoSrc = await loadLogoDataUrl()
  const blob = await pdf(<SalarySlipDocument {...data} logoSrc={logoSrc} />).toBlob()
  const fileName = safePdfName(
    `Salary-Slip-${String(data?.rep?.name || 'rep')}-${String(data?.monthLabel || '')}`,
    'Salary-Slip',
  )
  return { blob, fileName }
}
