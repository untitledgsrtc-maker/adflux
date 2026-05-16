// src/components/incentives/TotalPayableCard.jsx
//
// Phase 34Z.38 — single "Total Payable This Month" summary.
//
// Owner directive (15 May 2026):
//   "I also want summary of total salary payable at last
//    BASE SALARY + VARIABLE SALARY + INCENTIVE THIS MONTH + TA/DA"
//
// Renders below the score + revenue cards on /my-performance.
//
// Buckets (each line + grand total):
//   1. Base salary (70% of fixed monthly, from monthly_score RPC)
//   2. Variable salary (30% × score%, from monthly_score RPC)
//   3. Incentive earned (from calculateIncentive on monthly_sales_data,
//      uses Proposed when nothing's been final-paid yet so the rep
//      sees the forecast not just ₹0)
//   4. TA / DA — daily_ta.total_amount summed for current month +
//      approved ta_da_requests.claim_amount/km. Pending claims listed
//      as a hint but not added to total.
//
// All four sourced via Supabase reads — no new RPC.

import { useEffect, useState } from 'react'
import { Loader2, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency } from '../../utils/formatters'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { useIncentive } from '../../hooks/useIncentive'

const monthStart = () => {
  const d = new Date(); d.setDate(1); d.setHours(0,0,0,0)
  return d.toISOString().slice(0, 10)
}
const monthEnd = () => {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 0); d.setHours(23,59,59,999)
  return d.toISOString().slice(0, 10)
}
const monthKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function TotalPayableCard() {
  const profile = useAuthStore(s => s.profile)
  const { settings, fetchSettings, fetchProfileForUser } = useIncentive()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({
    base: 0, variable: 0, variableCap: 0,
    incentive: 0, incentiveProposed: 0,
    taAuto: 0, taDaApproved: 0, taDaPending: 0,
    pendingCount: 0,
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!profile?.id) return
      setLoading(true)
      await fetchSettings()
      const { data: myProfile } = await fetchProfileForUser(profile.id)

      const ms = monthStart()
      const me = monthEnd()
      const mk = monthKey()
      // Phase 36.12 — call compute_monthly_salary RPC. Single source
      // of truth for base + variable + incentive + ta_da + leave
      // deduction + net_payable. Replaces the client-side math that
      // (a) re-implemented base/variable from monthly_score and
      // (b) forgot to subtract unpaid-leave deduction entirely.
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1

      const [salaryRes, tdaRes, msdRes] = await Promise.all([
        supabase.rpc('compute_monthly_salary', {
          p_user_id: profile.id,
          p_year: year,
          p_month: month,
        }),
        // Pending claims still surfaced as a hint (RPC only counts
        // approved). Same query as before, narrowed to pending.
        supabase.from('ta_da_requests')
          .select('claim_amount, claim_km')
          .eq('user_id', profile.id)
          .eq('status', 'pending')
          .gte('claim_date', ms).lte('claim_date', me),
        supabase.from('monthly_sales_data')
          .select('new_client_revenue, renewal_revenue')
          .eq('staff_id', profile.id).eq('month_year', mk).maybeSingle(),
      ])
      if (cancelled) return

      const salary = salaryRes.data || {}
      const base = Number(salary.base || 0)
      const variable = Number(salary.variable || 0)
      // variable_cap not in RPC payload — compute from monthly_salary
      // (30% cap) for the muted-helper line.
      const variableCap = Number(myProfile?.monthly_salary || 0) * 0.30
      const taDaTotal = Number(salary.ta_da || 0)
      const leaveUnpaid = Number(salary.leave_days_unpaid || 0)
      const unpaidDeduction = Number(salary.unpaid_deduction || 0)
      const netPayable = Number(salary.net_payable || 0)

      // Incentive — RPC returns paid-out portion (incentive_payouts).
      // For forecast display, also run client-side calculateIncentive
      // so rep sees what they'd earn if the month closed today.
      let incentive = Number(salary.incentive || 0)
      let incentiveProposed = 0
      if (myProfile) {
        const cfg = {
          monthlySalary:    Number(myProfile.monthly_salary || 0),
          salesMultiplier:  Number(myProfile.sales_multiplier || settings?.sales_multiplier || 5),
          newClientRate:    myProfile.new_client_rate ?? settings?.new_client_rate ?? 0.04,
          renewalRate:      myProfile.renewal_rate    ?? settings?.renewal_rate    ?? 0.02,
          flatBonus:        myProfile.flat_bonus      ?? settings?.default_flat_bonus ?? settings?.flat_bonus ?? 10000,
        }
        const earned = calculateIncentive({
          ...cfg,
          newClientRevenue: msdRes.data?.new_client_revenue || 0,
          renewalRevenue:   msdRes.data?.renewal_revenue    || 0,
        })
        incentiveProposed = Number(earned.incentive || 0)
        // If RPC paid-out is 0 but forecast non-zero, show forecast
        // so the rep isn't surprised at month-end.
        if (incentive === 0) incentive = incentiveProposed
      }

      const pendingRows = tdaRes.data || []
      const taDaPending = pendingRows
        .reduce((s, r) => s + Number(r.claim_amount || 0) + Number(r.claim_km || 0) * 3, 0)

      setData({
        base, variable, variableCap,
        incentive, incentiveProposed,
        taDaTotal,
        leaveUnpaid, unpaidDeduction,
        netPayable,
        taDaPending, pendingCount: pendingRows.length,
      })
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [profile?.id, settings?.id])

  if (loading) {
    return (
      <div style={cardStyle}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>Computing total payable…</span>
      </div>
    )
  }

  // Phase 36.12 — grand total = NET from RPC (already deducts
  // unpaid leave). No client-side recompute.
  const grand = data.netPayable

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Wallet size={16} style={{ color: 'var(--accent)' }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.14em', textTransform: 'uppercase' }}>
          Total Payable This Month
        </div>
      </div>

      <Row label="Base salary (70%)"            value={data.base} />
      <Row label={`Variable salary (30%)`}      value={data.variable} sub={data.variableCap > 0 ? `cap ${formatCurrency(data.variableCap)}` : null} />
      <Row label="Incentive earned"             value={data.incentive} muted={data.incentive === 0 ? 'No final payment yet' : null} />
      <Row label="TA / DA — approved + GPS"     value={data.taDaTotal} muted={data.pendingCount > 0 ? `${data.pendingCount} pending · ${formatCurrency(data.taDaPending)} not added` : null} />
      {/* Phase 36.12 — unpaid leave deduction line. Negative number
          shown in danger red so the rep sees what's being cut. */}
      {data.unpaidDeduction > 0 && (
        <Row
          label="Unpaid-leave deduction"
          value={-data.unpaidDeduction}
          sub={`${data.leaveUnpaid} day${data.leaveUnpaid === 1 ? '' : 's'} · base ÷ 26`}
          negative
        />
      )}

      <div style={{
        marginTop: 14, padding: '14px 16px', borderRadius: 12,
        background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontWeight: 700,
      }}>
        <span style={{ fontSize: 13 }}>Grand total payable</span>
        <span style={{ fontSize: 22, fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)', fontWeight: 700 }}>
          {formatCurrency(grand)}
        </span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
        Approx — base + variable use the live score, incentive is what the system
        has recorded so far this month, TA is the GPS distance × city rate plus
        any admin-approved manual claims. Pending claims appear in the line above
        but don't add until admin approves.
      </div>
    </div>
  )
}

const cardStyle = {
  background: 'var(--v2-bg-1, var(--surface))',
  border: '1px solid var(--v2-line, var(--border))',
  borderRadius: 14,
  padding: 16,
  marginTop: 14,
}

function Row({ label, value, sub, muted, negative }) {
  // Phase 36.12 — `negative` prop renders the amount in danger red
  // for deduction lines (unpaid-leave deduction). Value is passed in
  // as a negative number (e.g. -404) so the sign shows.
  const displayValue = value < 0
    ? `- ${formatCurrency(Math.abs(value))}`
    : value > 0
      ? formatCurrency(value)
      : '—'
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '8px 0', borderBottom: '1px dashed var(--border)',
    }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
        {muted && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>{muted}</div>}
      </div>
      <div style={{
        fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)',
        fontWeight: 700,
        color: negative || value < 0
          ? 'var(--danger, #EF4444)'
          : value > 0
            ? 'var(--v2-ink-0, var(--text))'
            : 'var(--v2-ink-2, var(--text-subtle))',
      }}>
        {displayValue}
      </div>
    </div>
  )
}
