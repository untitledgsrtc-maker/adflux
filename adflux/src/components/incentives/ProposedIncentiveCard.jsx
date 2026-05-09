// src/components/incentives/ProposedIncentiveCard.jsx
//
// Phase 31K (10 May 2026) — owner directive.
//
// What this is:
//   A self-contained version of the Proposed Incentive card that has
//   lived inline inside SalesDashboard.jsx since Phase 1.5. The card
//   now needs to render on /work (the new sales home page per Plan A)
//   AND on /dashboard, so the data fetch + JSX got pulled out of
//   SalesDashboard and into here. Other pages just import + drop it in.
//
// Why a self-fetching component instead of "lift props up":
//   The card needs ~7 small queries (quotes / payments / monthly_sales_data
//   / incentive_settings / staff_incentive_profiles) plus the
//   calculateIncentive math. Lifting that into a hook + threading
//   props down through every consumer = lots of plumbing. Each page
//   that wants the card pays one extra round-trip on first paint —
//   acceptable for a 5-rep team.
//
// Visual:
//   Purple gradient card. Three tabs: Forecast (default) / Pending /
//   Earned. Big number in the middle. One-line subtitle below.
//   Identical to the original — same v2-incentive / v2-tabs CSS.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { thisMonthISO, todayISO } from '../../utils/formatters'

function Money({ value }) {
  const n = Number(value) || 0
  return <>₹{new Intl.NumberFormat('en-IN').format(Math.round(n))}</>
}

function daysBetween(a, b) {
  if (!a || !b) return 0
  return Math.abs(Math.round((new Date(a) - new Date(b)) / (1000 * 60 * 60 * 24)))
}

export default function ProposedIncentiveCard() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('forecast')

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      const uid      = profile.id
      const monthKey = thisMonthISO()

      const [qRes, pRes, msRes, profRes, settingsRes] = await Promise.all([
        supabase.from('quotes')
          .select('id, total_amount, subtotal, status, revenue_type, updated_at, created_at')
          .eq('created_by', uid),
        supabase.from('payments')
          .select('quote_id, amount_received, approval_status, is_final_payment, recorded_by')
          .eq('recorded_by', uid),
        supabase.from('monthly_sales_data')
          .select('*').eq('staff_id', uid).eq('month_year', monthKey).maybeSingle(),
        supabase.from('staff_incentive_profiles')
          .select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('incentive_settings').select('*').maybeSingle(),
      ])

      if (cancelled) return

      const quotes   = qRes.data   || []
      const payments = pRes.data   || []
      const monthRow = msRes.data
      const prof     = profRes.data
      const settings = settingsRes.data || {}

      const multiplier  = prof?.sales_multiplier ?? settings.default_multiplier ?? 5
      const newRate     = prof?.new_client_rate  ?? settings.new_client_rate    ?? 0.05
      const renewalRate = prof?.renewal_rate     ?? settings.renewal_rate       ?? 0.02
      const flatBonus   = prof?.flat_bonus       ?? settings.default_flat_bonus ?? settings.flat_bonus ?? 10000

      const earned = calculateIncentive({
        monthlySalary: prof?.monthly_salary || 0,
        salesMultiplier: multiplier,
        newClientRate: newRate,
        renewalRate: renewalRate,
        flatBonus,
        newClientRevenue: monthRow?.new_client_revenue || 0,
        renewalRevenue:   monthRow?.renewal_revenue    || 0,
      })

      // For forecast we need to know which quotes have a final payment
      // already — those are "won-but-not-yet-settled" and belong in
      // forecast, not earned (until the final payment lands).
      const approvedFinal = new Set(
        payments
          .filter(p => p.approval_status === 'approved' && p.is_final_payment)
          .map(p => p.quote_id)
      )

      const openNew     = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'new')
                                .reduce((s, q) => s + (q.subtotal || 0), 0)
      const openRenewal = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'renewal')
                                .reduce((s, q) => s + (q.subtotal || 0), 0)

      const today = todayISO()
      const wonUnsettled = quotes.filter(q => q.status === 'won' && !approvedFinal.has(q.id))
      const wonUnsettledNew     = wonUnsettled.filter(q => q.revenue_type === 'new')
                                              .reduce((s, q) => s + (q.subtotal || 0), 0)
      const wonUnsettledRenewal = wonUnsettled.filter(q => q.revenue_type === 'renewal')
                                              .reduce((s, q) => s + (q.subtotal || 0), 0)

      const wonAge = { stale: 0, staleValue: 0 }
      wonUnsettled.forEach(q => {
        const days = daysBetween(today, q.updated_at || q.created_at)
        if (days >= 60) {
          wonAge.stale++
          wonAge.staleValue += Number(q.subtotal) || 0
        }
      })

      const forecast = calculateIncentive({
        monthlySalary: prof?.monthly_salary || 0,
        salesMultiplier: multiplier,
        newClientRate: newRate,
        renewalRate: renewalRate,
        flatBonus,
        newClientRevenue: (monthRow?.new_client_revenue || 0) + openNew + wonUnsettledNew,
        renewalRevenue:   (monthRow?.renewal_revenue    || 0) + openRenewal + wonUnsettledRenewal,
      })
      const forecastDelta = Math.max(0, (forecast.incentive || 0) - (earned.incentive || 0))

      const pendingPayments = payments.filter(p => p.approval_status === 'pending')
      const pendingTotal    = pendingPayments.reduce((s, p) => s + (Number(p.amount_received) || 0), 0)

      setData({
        earned,
        pending: { total: pendingTotal, count: pendingPayments.length },
        forecast: {
          incentive: forecastDelta,
          openPipeline: openNew + openRenewal,
          wonUnsettledTotal: wonUnsettledNew + wonUnsettledRenewal,
          wonAge,
        },
      })
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  if (!data) {
    // Skeleton — same height as the real card so layout doesn't jump.
    return (
      <div className="v2-incentive" style={{ opacity: 0.55 }}>
        <div className="v2-incentive-kicker">Proposed Incentive</div>
        <div className="v2-incentive-big">…</div>
        <div className="v2-incentive-sub">Loading your numbers</div>
      </div>
    )
  }

  const { earned, pending, forecast } = data

  const fmt = (n) => new Intl.NumberFormat('en-IN').format(n)
  const panes = {
    earned: {
      value: earned.incentive,
      sub: earned.slabReached
        ? `Target hit${earned.targetExceeded ? ' · flat bonus unlocked' : ''}. Payouts credit on admin approval.`
        : `Hit your threshold of ₹${fmt(earned.threshold)} to unlock incentive payouts.`,
    },
    pending: {
      value: pending.total,
      sub: pending.count === 0
        ? 'Nothing waiting — admin has cleared every payment you punched.'
        : `${pending.count} payment${pending.count > 1 ? 's' : ''} awaiting admin approval.`,
    },
    forecast: {
      value: forecast.incentive,
      sub: (() => {
        const open = forecast.openPipeline || 0
        const won  = forecast.wonUnsettledTotal || 0
        const stalePart = forecast.wonAge.stale > 0 ? ` · ₹${fmt(forecast.wonAge.staleValue)} stale` : ''
        if (open === 0 && won === 0) return 'Forecast is flat — send quotes to build your open pipeline.'
        if (won === 0)  return `Incremental on ₹${fmt(open)} open pipeline if every non-lost quote closes this month.`
        if (open === 0) return `₹${fmt(won)} from won quotes still collecting${stalePart}.`
        return `₹${fmt(open)} open + ₹${fmt(won)} won-not-settled${stalePart}.`
      })(),
    },
  }
  const p = panes[tab]
  const isForecast = tab === 'forecast'

  return (
    <div className="v2-incentive">
      <div className="v2-incentive-kicker">Proposed Incentive</div>
      <div className="v2-tabs">
        <button className={`v2-tab ${tab === 'forecast' ? 'v2-tab--active' : ''}`} onClick={() => setTab('forecast')}>Forecast</button>
        <button className={`v2-tab ${tab === 'pending'  ? 'v2-tab--active' : ''}`} onClick={() => setTab('pending')}>Pending</button>
        <button className={`v2-tab ${tab === 'earned'   ? 'v2-tab--active' : ''}`} onClick={() => setTab('earned')}>Earned</button>
      </div>
      <div className="v2-incentive-big">
        {isForecast && p.value > 0 && '+'}
        <Money value={p.value} />
      </div>
      <div className="v2-incentive-sub">{p.sub}</div>
    </div>
  )
}
