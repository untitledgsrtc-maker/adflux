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

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
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

// Phase 33A — owner directive (11 May 2026): keep card on every sales
// page as daily motivation, but shrink it. The big purple gradient
// hero competed with the new "3 giant action buttons" on /work. Pass
// `compact` to render a 36px strip with a bold ₹ number on the left,
// tabs on the right, no gradient. Default (no prop) renders the
// original full card — kept for /scorecard deep view.
export default function ProposedIncentiveCard({ compact = false }) {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('forecast')
  // Phase 33G.6 — owner directive: full card was eating ~25% of mobile
  // viewport with its 3 inline tabs. Replace tabs with a dropdown chip
  // so the card is the same height regardless of which view is active.
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef(null)

  // Close picker on click-outside.
  useEffect(() => {
    if (!pickerOpen) return
    function onClick(e) {
      if (!pickerRef.current) return
      if (!pickerRef.current.contains(e.target)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [pickerOpen])

  // Phase 33L — bump this to force a re-fetch from the realtime
  // subscription. Saves wiring data through a stale-cache prop.
  const [refreshKey, setRefreshKey] = useState(0)

  // Realtime: subscribe to quotes + payments changes for this user.
  // On any insert/update/delete, bump refreshKey to re-trigger the
  // fetch. Cheap because the channel only fires for THIS user's rows
  // via the inserted filter (RLS still enforced; realtime is just an
  // efficient signal).
  useEffect(() => {
    if (!profile?.id) return
    const ch = supabase
      .channel(`incentive-${profile.id}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'quotes', filter: `created_by=eq.${profile.id}` },
          () => setRefreshKey(k => k + 1))
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'payments', filter: `received_by=eq.${profile.id}` },
          () => setRefreshKey(k => k + 1))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile?.id])

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
          .select('quote_id, amount_received, approval_status, is_final_payment, received_by')
          .eq('received_by', uid),
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
  }, [profile?.id, refreshKey])

  if (!data) {
    // Skeleton — same height as the real card so layout doesn't jump.
    if (compact) {
      return (
        <div className="v2-incentive-strip" style={{ opacity: 0.55 }}>
          <span className="v2-incentive-strip-num">…</span>
          <span className="v2-incentive-strip-sub">Loading</span>
        </div>
      )
    }
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

  const compactTabLabel = tab === 'forecast' ? 'Forecast' : tab === 'pending' ? 'Pending' : 'Earned'

  // Phase 33A — compact strip variant for in-page motivation.
  // Phase 33I (B2 fix) — replaced the F/P/E single-letter mini-tabs
  // with the same dropdown chip pattern the full card uses (33G.6).
  // F/P/E was confusing for new reps who didn't know F=Forecast etc.
  if (compact) {
    return (
      <div className="v2-incentive-strip" ref={pickerRef} style={{ position: 'relative' }}>
        <div className="v2-incentive-strip-left">
          <span className="v2-incentive-strip-num">
            {/* Phase 34Z.89 — dropped leading "+" on forecast value.
                The plus implied "you earned MORE" which is confusing
                for a forecast. Same change applied to the full-card
                variant below. */}
            <Money value={p.value} />
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(v => !v)}
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(255,255,255,.10)',
            border: '1px solid rgba(255,255,255,.14)',
            color: 'inherit', fontSize: 11, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {compactTabLabel}
          <ChevronDown
            size={11}
            style={{
              transform: pickerOpen ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform .15s',
            }}
          />
        </button>
        {pickerOpen && (
          <div
            role="listbox"
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              minWidth: 130, background: 'var(--surface, #1e293b)',
              border: '1px solid var(--border, #334155)',
              borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.45)',
              zIndex: 50, overflow: 'hidden',
            }}
          >
            {[
              { key: 'forecast', label: 'Forecast' },
              { key: 'pending',  label: 'Pending'  },
              { key: 'earned',   label: 'Earned'   },
            ].map(o => (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={tab === o.key}
                onClick={() => { setTab(o.key); setPickerOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 13px',
                  background: tab === o.key ? 'rgba(255,255,255,.06)' : 'transparent',
                  border: 0, color: 'var(--text, #f1f5f9)',
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Phase 33N (owner directive) — reverted to the original full-card
  // design: kicker on top, 3-tab row, big amount, subtitle.
  // The dropdown chip variant from Phase 33G.6 was rolled back per
  // 'forcasted card must be as old one'. Compact strip variant
  // (top of this file) keeps the dropdown for narrow-page contexts.
  return (
    <div className="v2-incentive">
      <div className="v2-incentive-kicker">Proposed Incentive</div>
      <div className="v2-tabs">
        <button className={`v2-tab ${tab === 'forecast' ? 'v2-tab--active' : ''}`} onClick={() => setTab('forecast')}>Forecast</button>
        <button className={`v2-tab ${tab === 'pending'  ? 'v2-tab--active' : ''}`} onClick={() => setTab('pending')}>Pending</button>
        <button className={`v2-tab ${tab === 'earned'   ? 'v2-tab--active' : ''}`} onClick={() => setTab('earned')}>Earned</button>
      </div>
      <div className="v2-incentive-big">
        {/* Phase 34Z.89 — leading "+" removed (see strip variant). */}
        <Money value={p.value} />
      </div>
      <div className="v2-incentive-sub">{p.sub}</div>
    </div>
  )
}
