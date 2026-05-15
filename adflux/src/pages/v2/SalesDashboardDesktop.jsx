// src/pages/v2/SalesDashboardDesktop.jsx
//
// Desktop variant of the sales dashboard (≥860px).
// Route: /dashboard (via DashboardV2 switcher)
//
// Shell = .v2d sidebar + main. Reuses the exact same Supabase queries as
// the mobile SalesDashboard.jsx so there's a single source of truth for
// the numbers; only the layout differs.
//
// All styles live in src/styles/v2.css under the .v2d scope.

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FileText, BarChart3, Gift, Repeat, LogOut,
  Search, Bell, Plus, Flame, ArrowUpRight, Phone, AlertTriangle,
  Contact2, Trophy, Zap,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { calculateIncentive, calculateStreak } from '../../utils/incentiveCalc'
import { buildSettlementMap } from '../../utils/settlement'
import { initials, formatCompact, todayISO } from '../../utils/formatters'
import { thisMonth } from '../../utils/period'
import { PeriodPicker } from '../../components/v2/PeriodPicker'
import '../../styles/v2.css'

/* ─── Money display: full Indian-format number with lakh/crore grouping.
   Full ₹ amount every time — ₹29,700 instead of ₹29.7K. Reps want to see
   exactly what a quote is worth without doing the mental math. ─── */
function Money({ value }) {
  const n = Number(value) || 0
  return <>₹{new Intl.NumberFormat('en-IN').format(Math.round(n))}</>
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function SalesDashboardDesktop() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [state, setState] = useState({ loading: true })
  // Default to Forecast — the forward-looking "if everything closes" number
  // is the one reps act on every morning. Mirrors the mobile dashboard.
  const [tab, setTab] = useState('forecast')
  // Period drives every window-bucketed query. PeriodPicker returns a
  // normalized object (startIso/endIso/monthKeys/label) — see
  // utils/period.js. Defaults to the current month.
  const [period, setPeriod] = useState(() => thisMonth())

  useEffect(() => { if (profile?.id) load(period) /* eslint-disable-next-line */ }, [profile?.id, period])

  async function load(activePeriod) {
    const uid = profile.id
    const p = activePeriod || thisMonth()
    const monthStartIso = p.startIso
    const monthEndIso   = p.endIso
    const monthKeys     = p.monthKeys

    // M1 — pull the rep's active daily target so the counter widget
    // has a denominator. Single row per active user (one_active_per_user
    // unique index in supabase_phase9 SQL); maybeSingle() so a missing
    // row falls back to defaults instead of erroring the whole load.
    const todayDate = new Date().toISOString().slice(0, 10)

    const [qRes, pRes, fRes, msRes, histRes, profRes, settingsRes, dtRes, fDoneRes] = await Promise.all([
      supabase.from('quotes')
        .select('id, quote_number, client_name, client_company, subtotal, total_amount, status, revenue_type, created_at, updated_at, created_by, campaign_start_date, campaign_end_date')
        .eq('created_by', uid)
        .order('created_at', { ascending: false }),
      supabase.from('payments')
        .select('id, amount_received, approval_status, rejection_reason, created_at, received_by, quote_id')
        .eq('received_by', uid),
      supabase.from('follow_ups')
        .select('id, notes, follow_up_date, quote_id')
        .eq('assigned_to', uid)
        .eq('is_done', false)
        .lte('follow_up_date', new Date().toISOString().slice(0, 10))
        .order('follow_up_date', { ascending: true })
        .limit(6),
      // Fetch ALL monthly_sales_data rows the period touches (not just
      // one). A custom range spanning March+April returns both rows;
      // earned/forecast math sums new_client_revenue and renewal_revenue
      // across them so the incentive calc reflects the whole window.
      supabase.from('monthly_sales_data')
        .select('*').eq('staff_id', uid).in('month_year', monthKeys),
      supabase.from('monthly_sales_data')
        .select('*').eq('staff_id', uid).order('month_year', { ascending: false }).limit(12),
      supabase.from('staff_incentive_profiles')
        .select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('incentive_settings').select('*').maybeSingle(),
      // M1 — active daily target for this rep
      supabase.from('daily_targets')
        .select('min_quotes, min_followups, min_calls')
        .eq('user_id', uid)
        .is('effective_to', null)
        .maybeSingle(),
      // M1 — follow-ups COMPLETED today (for the daily counter). The
      // open-followups query above pulls is_done=false; this one pulls
      // done=true to count today's completions.
      supabase.from('follow_ups')
        .select('id, completed_at')
        .eq('assigned_to', uid)
        .eq('is_done', true)
        .gte('completed_at', `${todayDate}T00:00:00`)
        .lte('completed_at', `${todayDate}T23:59:59`),
    ])

    const quotes = qRes.data || []
    const payments = pRes.data || []
    const followups = fRes.data || []
    const monthRows = msRes.data || []
    const history = histRes.data || []
    const prof = profRes.data
    const settings = settingsRes.data || {}
    const dailyTarget = dtRes.data || { min_quotes: 2, min_followups: 5, min_calls: 0 }
    const followupsDoneToday = (fDoneRes.data || []).length

    // Sum pre-aggregated monthly revenue across every month the period
    // covers. If it's a single month this is just one row; for a range
    // like "Mar 20 → Apr 10" it's two.
    const monthNewClient = monthRows.reduce((s, r) => s + (r.new_client_revenue || 0), 0)
    const monthRenewal   = monthRows.reduce((s, r) => s + (r.renewal_revenue    || 0), 0)

    // Leaderboard — bucketed by SETTLED month (rep is paid only when
    // a quote is fully cleared — see utils/settlement.js). Pulls every
    // quote + every approved payment, computes settle date locally,
    // sums total_amount for quotes whose settle date falls in window.
    // Same rule the admin dashboard uses, so numbers reconcile.
    // Leaderboard now races on PROPOSED INCENTIVE (forecast) per rep,
    // and shows EARNED alongside. Per-rep math runs against ALL reps'
    // data, which means we have to bypass per-user RLS — the
    // get_team_leaderboard SECURITY DEFINER RPC returns aggregated
    // inputs (no individual quote/payment rows leak). See
    // supabase_phase3d.sql for the function definition.
    //
    // We still fetch lbQuotes + lbPayments separately because the
    // settlement map (used for the rep's own settled-this-period KPI)
    // needs payment_date data the RPC doesn't expose.
    const [{ data: lbQuotes }, { data: lbPayments }, lbRpcRes, lbUsersRes] = await Promise.all([
      supabase.from('quotes').select('id, created_by, total_amount, status, updated_at, created_at'),
      supabase.from('payments')
        .select('quote_id, amount_received, payment_date, created_at, is_final_payment')
        .eq('approval_status', 'approved'),
      supabase.rpc('get_team_leaderboard', { p_month_keys: monthKeys }),
      // Names-only fallback for when the RPC isn't deployed yet —
      // RLS on users normally lets sales read the team list, so we
      // can at least populate the leaderboard with names + ₹0 until
      // supabase_phase3d.sql is applied.
      supabase.from('users').select('id, name').eq('role', 'sales'),
    ])
    const lbSettleMap = buildSettlementMap(lbQuotes || [], lbPayments || [])

    let leaderboard
    if (lbRpcRes?.data && lbRpcRes.data.length > 0) {
      leaderboard = lbRpcRes.data
        .map(r => {
          const cfg = {
            monthlySalary:   Number(r.monthly_salary)   || 0,
            salesMultiplier: Number(r.sales_multiplier) || 5,
            newClientRate:   Number(r.new_client_rate)  || 0.05,
            renewalRate:     Number(r.renewal_rate)     || 0.02,
            flatBonus:       Number(r.flat_bonus)       || 10000,
          }
          const repEarned = calculateIncentive({
            ...cfg,
            newClientRevenue: Number(r.msd_new)     || 0,
            renewalRevenue:   Number(r.msd_renewal) || 0,
          })
          const repForecast = calculateIncentive({
            ...cfg,
            newClientRevenue: (Number(r.msd_new)     || 0) + (Number(r.open_new)     || 0) + (Number(r.wu_new)     || 0),
            renewalRevenue:   (Number(r.msd_renewal) || 0) + (Number(r.open_renewal) || 0) + (Number(r.wu_renewal) || 0),
          })
          return {
            id: r.user_id,
            name: r.name,
            earned:   repEarned.incentive   || 0,
            proposed: repForecast.incentive || 0,
            wonCount: Number(r.won_count) || 0,
          }
        })
        .sort((a, b) => b.proposed - a.proposed)
    } else {
      // RPC failed (function not deployed) or returned empty — fall
      // back to the user list so names still render with zeros. The
      // current rep is patched with their own forecast incentive
      // computed from already-fetched data so they see SOMETHING.
      if (lbRpcRes?.error) {
        console.warn('[leaderboard] RPC unavailable, using fallback. Apply supabase_phase3d.sql.', lbRpcRes.error)
      }
      leaderboard = (lbUsersRes?.data || []).map(u => ({
        id: u.id,
        name: u.name,
        earned: 0,
        proposed: 0,
        wonCount: 0,
        _fallback: true,
      }))
    }

    // My settled-this-period revenue — the actually-paid number.
    // Read from the same settle map the leaderboard uses so the rep's
    // own KPI exactly matches their leaderboard row. Bucketed by settle
    // date (date the final-clearing payment was received).
    const mySettledValue = (lbQuotes || [])
      .filter(q => q.created_by === uid)
      .reduce((s, q) => {
        const settle = lbSettleMap.get(q.id)
        if (!settle) return s
        if (settle.settledAt < monthStartIso || settle.settledAt >= monthEndIso) return s
        return s + (Number(q.total_amount) || 0)
      }, 0)

    // Incentive math
    const multiplier  = prof?.sales_multiplier ?? settings.default_multiplier ?? 5
    const newRate     = prof?.new_client_rate  ?? settings.new_client_rate    ?? 0.05
    const renewalRate = prof?.renewal_rate     ?? settings.renewal_rate       ?? 0.02
    const flatBonus   = prof?.flat_bonus       ?? settings.default_flat_bonus ?? settings.flat_bonus ?? 10000

    // Earned: pure "what have I booked in the selected window" — driven
    // by the summed monthly_sales_data rows (monthNewClient/monthRenewal
    // above, one-row-per-month aggregate the incentive subsystem owns).
    const earned = calculateIncentive({
      monthlySalary: prof?.monthly_salary || 0,
      salesMultiplier: multiplier,
      newClientRate: newRate,
      renewalRate: renewalRate,
      flatBonus,
      newClientRevenue: monthNewClient,
      renewalRevenue:   monthRenewal,
    })

    // Pull approved payments BY QUOTE_ID up front — both the forecast
    // calc (won-unsettled inclusion) and the outstanding KPI need to
    // know which quotes have a final payment cleared. We query by
    // quote_id (not received_by) because admin can record payments
    // against a rep's quote too — using the payments slice from above
    // (.eq('received_by', uid)) would miss those and double-count
    // forecast / inflate outstanding.
    const myQuoteIds = quotes.filter(q => q.status !== 'lost').map(q => q.id)
    let approvedPayments = []
    if (myQuoteIds.length) {
      const { data: ap } = await supabase
        .from('payments')
        .select('quote_id, amount_received, is_final_payment')
        .eq('approval_status', 'approved')
        .in('quote_id', myQuoteIds)
      approvedPayments = ap || []
    }
    const paidMap = {}
    for (const p of approvedPayments) {
      if (!paidMap[p.quote_id]) paidMap[p.quote_id] = { paid: 0, final: false }
      paidMap[p.quote_id].paid += Number(p.amount_received) || 0
      if (p.is_final_payment) paidMap[p.quote_id].final = true
    }

    // Open pipeline: still-live quotes (sent / negotiating / draft)
    const openNew     = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'new')
                              .reduce((s, q) => s + (q.subtotal || 0), 0)
    const openRenewal = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'renewal')
                              .reduce((s, q) => s + (q.subtotal || 0), 0)

    // Won-but-not-yet-settled — quote is closed (status='won') but the
    // final approved payment hasn't cleared, so monthly_sales_data
    // hasn't credited it yet. These belong in forecast: the rep has
    // earned the deal, the money is just stuck in collections. Carries
    // forward month-over-month until the final payment lands (settles
    // the quote, moves it into earned) OR the rep flips it to lost.
    const today = todayISO()
    const wonUnsettled = quotes.filter(q => {
      if (q.status !== 'won') return false
      // already-settled means a final approved payment is on file
      return !(paidMap[q.id]?.final)
    })
    const wonUnsettledNew     = wonUnsettled.filter(q => q.revenue_type === 'new')
                                            .reduce((s, q) => s + (q.subtotal || 0), 0)
    const wonUnsettledRenewal = wonUnsettled.filter(q => q.revenue_type === 'renewal')
                                            .reduce((s, q) => s + (q.subtotal || 0), 0)

    // Age buckets for won-unsettled — driven by updated_at (the won
    // timestamp). Fresh <30d, Aging 30-60d, Stale 60+d. Surfaces the
    // ones that need chasing without being noise.
    const wonAge = { fresh: 0, aging: 0, stale: 0, freshValue: 0, agingValue: 0, staleValue: 0 }
    wonUnsettled.forEach(q => {
      const days = daysBetween(today, q.updated_at || q.created_at)
      const v = Number(q.subtotal) || 0
      if (days < 30)        { wonAge.fresh++; wonAge.freshValue += v }
      else if (days < 60)   { wonAge.aging++; wonAge.agingValue += v }
      else                  { wonAge.stale++; wonAge.staleValue += v }
    })

    const forecast = calculateIncentive({
      monthlySalary: prof?.monthly_salary || 0,
      salesMultiplier: multiplier,
      newClientRate: newRate,
      renewalRate: renewalRate,
      flatBonus,
      newClientRevenue: monthNewClient + openNew + wonUnsettledNew,
      renewalRevenue:   monthRenewal   + openRenewal + wonUnsettledRenewal,
    })
    const forecastDelta = Math.max(0, (forecast.incentive || 0) - (earned.incentive || 0))
    const openPipeline  = openNew + openRenewal
    const wonUnsettledTotal = wonUnsettledNew + wonUnsettledRenewal

    const pendingPayments = payments.filter(p => p.approval_status === 'pending')
    const pendingTotal    = pendingPayments.reduce((s, p) => s + (Number(p.amount_received) || 0), 0)

    // Outstanding — mirror the admin dashboard + QuotesV2 computeBalance
    // exactly so the rep's KPI matches what they see in the Quotes list.
    //
    // Rule: a quote is "committed" (and therefore counts toward outstanding)
    // if status === 'won' OR it has any approved payment recorded. Sent or
    // negotiating quotes with a part-payment taken count. Lost quotes never
    // count. Balance is clamped at 0 so over-payments don't go negative.
    const outstandingRows = quotes
      .filter(q => q.status !== 'lost')
      .map(q => {
        const paid    = paidMap[q.id]?.paid  || 0
        const isFinal = paidMap[q.id]?.final || false
        const committed = q.status === 'won' || paid > 0
        const balance = Math.max(0, (Number(q.total_amount) || 0) - paid)
        return { balance, isFinal, committed }
      })
      .filter(r => r.committed && !r.isFinal && r.balance > 0)
    const outstandingTotal = outstandingRows.reduce((s, r) => s + r.balance, 0)
    const outstandingCount = outstandingRows.length

    const rejected = payments.filter(p => p.approval_status === 'rejected')
                             .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]

    const streak = calculateStreak(history, earned.target)

    const wonValue = quotes.filter(q => q.status === 'won')
                           .filter(q => {
                             const ts = q.updated_at || q.created_at || ''
                             return ts >= monthStartIso && ts < monthEndIso
                           })
                           .reduce((s, q) => s + (q.total_amount || 0), 0)
    // Quotes Sent: surface the total ₹ value as the headline with the raw
    // count as a sub-line. Mirrors the mobile dashboard so reps see the
    // revenue figure first, not just "how many did I send".
    const sentQuotes       = quotes.filter(q => q.status === 'sent')
    const quotesSent       = sentQuotes.length
    const quotesSentValue  = sentQuotes.reduce((s, q) => s + (Number(q.total_amount) || 0), 0)
    const todoCount        = followups.length

    const recent = [...quotes]
      .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''))
      .slice(0, 6)

    // Active campaigns — rep's own won quotes whose campaign window is
    // still live (campaign_end_date today or later). Same shape the
    // admin dashboard uses, scoped to created_by = uid via the quotes
    // query above. Sorted by soonest-to-end so the urgent ones surface.
    // Tag each row with its age bucket (Fresh/Aging/Stale) and an
    // is_settled flag so the panel can show which ones still owe money.
    const activeCampaigns = quotes
      .filter(q => q.status === 'won' && q.campaign_end_date && q.campaign_end_date >= today)
      .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
      .slice(0, 6)
      .map(q => {
        const days = daysBetween(today, q.updated_at || q.created_at)
        const ageKey = days < 30 ? 'fresh' : days < 60 ? 'aging' : 'stale'
        return { ...q, _ageDays: days, _ageKey: ageKey, _isSettled: !!paidMap[q.id]?.final }
      })

    // M1 — TODAY counts + urgency-sorted action list ───────────────
    // 1) Quotes SENT today by this rep (created_at = today).
    const quotesSentToday = quotes.filter(q => {
      const ts = (q.created_at || '').slice(0, 10)
      return ts === todayDate
    }).length

    // 2) Payments LOGGED today by this rep (already filtered to received_by=uid).
    const paymentsToday = payments.filter(p => {
      const ts = (p.created_at || '').slice(0, 10)
      return ts === todayDate
    }).length

    // 3) Stale sent quotes — sent >7 days ago, no follow-up logged.
    //    "No follow-up logged" = no row in followups (open) for that quote.
    //    These are the deals quietly slipping. Show top 6.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const followupQuoteIds = new Set((followups || []).map(f => f.quote_id))
    const staleSent = quotes
      .filter(q => q.status === 'sent')
      .filter(q => {
        const updated = new Date(q.updated_at || q.created_at)
        return Date.now() - updated.getTime() > SEVEN_DAYS_MS
      })
      .filter(q => !followupQuoteIds.has(q.id))
      .slice(0, 6)
      .map(q => ({
        kind:    'stale',
        id:      q.id,
        title:   q.client_name || q.client_company || 'Quote',
        sub:     `${q.quote_number || ''} · sent ${daysBetween(today, q.updated_at || q.created_at)}d ago`,
        urgency: 2,
      }))

    // 4) Won quotes with no payment recorded — money still uncollected.
    const wonNoPayment = quotes
      .filter(q => q.status === 'won')
      .filter(q => !(paidMap[q.id]?.paid > 0))
      .slice(0, 6)
      .map(q => ({
        kind:    'won_no_payment',
        id:      q.id,
        title:   q.client_name || q.client_company || 'Quote',
        sub:     `${q.quote_number || ''} · ₹${new Intl.NumberFormat('en-IN').format(Math.round(q.total_amount || 0))} unpaid`,
        urgency: 1,
      }))

    // 5) Follow-ups due — convert existing followups array to the same shape.
    const followupActions = (followups || []).map(f => ({
      kind:    'followup',
      id:      f.quote_id,
      title:   f.notes || 'Follow up',
      sub:     `Due ${new Date(f.follow_up_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
      urgency: 0, // most urgent — overdue follow-ups
    }))

    // Merge + sort by urgency (lower = more urgent), cap at 10.
    const todayActions = [...followupActions, ...wonNoPayment, ...staleSent]
      .sort((a, b) => a.urgency - b.urgency)
      .slice(0, 10)

    setState({
      loading: false,
      streak,
      earned,
      // M1 daily counter inputs
      dailyTarget,
      todayActivity: {
        quotes:    quotesSentToday,
        followups: followupsDoneToday,
        payments:  paymentsToday,
      },
      todayActions,
      forecast: {
        incentive: forecastDelta,
        openPipeline,
        wonUnsettledTotal,
        wonAge,
      },
      pendingPending: { count: pendingPayments.length, total: pendingTotal },
      rejected,
      wonValue,                  // closed (status→won) this period — informational
      settledValue: mySettledValue, // fully-paid this period — drives incentive
      quotesSent,
      quotesSentValue,
      todoCount,
      outstanding: { total: outstandingTotal, count: outstandingCount },
      leaderboard,
      recent,
      followups,
      activeCampaigns,
    })
  }

  if (state.loading) {
    return (
      <div className="v2d">
        <div className="v2d-loading"><div className="v2d-spinner" />Loading…</div>
      </div>
    )
  }

  const firstName = (profile?.name || 'there').split(' ')[0]
  const isHome = location.pathname === '/dashboard'

  return (
    // Phase 18c — sales dashboard now lives INSIDE V2AppShell, sharing
    // the same sidebar as every other page (this is the same fix
    // applied to AdminDashboardDesktop in Phase 18). Owner saw two
    // sidebars side-by-side: the V2AppShell one + this component's
    // own .v2d-side. Strip the .v2d-app + .v2d-side + .v2d-topbar
    // wrappers; keep .v2d-content as the only child. Greeting +
    // period picker + Create Quote CTA fold into a page-head row.
    <div className="v2d">
      <div className="v2d-content">
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            flexWrap: 'wrap', marginBottom: 16,
          }}
        >
          {/* Phase 21b — V2AppShell topbar already shows the greeting
              ("SALES CONSOLE / Good evening, KAMINA"). Drop the inline
              hero — same fix applied to AdminDashboardDesktop. */}
          <div style={{ flex: 1 }} />
          <PeriodPicker period={period} onChange={setPeriod} />
          <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
            <Plus size={14} strokeWidth={2.6} /> Create Quote
          </button>
        </header>

        <div>
            {/* Rejected payment banner */}
            {state.rejected && (
              <div className="v2d-banner v2d-banner--warn">
                <AlertTriangle size={14} />
                <div style={{ flex: 1 }}>
                  <b>Payment rejected.</b>{' '}
                  {state.rejected.rejection_reason || 'Admin sent a payment back — check the record.'}
                </div>
                <button className="v2d-banner-cta" onClick={() => navigate(`/quotes/${state.rejected.quote_id}`)}>
                  Re-record
                </button>
              </div>
            )}

            {/* Incentive Hero */}
            <section className="v2d-hero v2d-hero--incentive">
              <div className="v2d-hero-head">
                <div className="v2d-hero-kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={13} strokeWidth={1.6} /> Proposed Incentive
                </div>
                <div className="v2d-hero-tabs">
                  <button className={`v2d-hero-tab ${tab === 'forecast' ? 'is-active' : ''}`} onClick={() => setTab('forecast')}>Forecast</button>
                  <button className={`v2d-hero-tab ${tab === 'pending' ? 'is-active' : ''}`} onClick={() => setTab('pending')}>Pending</button>
                  <button className={`v2d-hero-tab ${tab === 'earned' ? 'is-active' : ''}`} onClick={() => setTab('earned')}>Earned</button>
                </div>
              </div>

              <div className="v2d-hero-grid">
                <div>
                  <div className="v2d-hero-big">
                    {tab === 'forecast' && (state.forecast.incentive > 0) && '+'}
                    <Money value={
                      tab === 'earned' ? state.earned.incentive :
                      tab === 'pending' ? state.pendingPending.total :
                      state.forecast.incentive
                    } />
                  </div>
                  <div className="v2d-hero-sub">
                    {tab === 'earned' && (
                      state.earned.slabReached
                        ? `Target hit${state.earned.targetExceeded ? ' · flat bonus unlocked' : ''}. Payouts credit on admin approval.`
                        : `Hit your threshold of ₹${state.earned.threshold.toLocaleString('en-IN')} to unlock incentive payouts.`
                    )}
                    {tab === 'pending' && (
                      state.pendingPending.count === 0
                        ? 'Nothing waiting — admin has cleared every payment you punched.'
                        : `${state.pendingPending.count} payment${state.pendingPending.count > 1 ? 's' : ''} awaiting admin approval.`
                    )}
                    {tab === 'forecast' && (() => {
                      const fmt = (n) => new Intl.NumberFormat('en-IN').format(n)
                      const open = state.forecast.openPipeline || 0
                      const won  = state.forecast.wonUnsettledTotal || 0
                      const age  = state.forecast.wonAge || {}
                      const stalePart = age.stale > 0 ? ` · ₹${fmt(age.staleValue)} stale (60+d, chase or close)` : ''
                      if (open === 0 && won === 0) {
                        return 'Forecast is flat — send quotes to build your open pipeline.'
                      }
                      if (won === 0) {
                        return `Incremental on ₹${fmt(open)} open pipeline if every non-lost quote closes this month.`
                      }
                      if (open === 0) {
                        return `₹${fmt(won)} from won quotes still collecting${stalePart}.`
                      }
                      return `₹${fmt(open)} open pipeline + ₹${fmt(won)} won-not-settled${stalePart}.`
                    })()}
                  </div>
                </div>

                <HeroStat label="Earned" value={state.earned.incentive} />

                {state.earned.flatBonus > 0
                  ? <HeroStat label="Flat bonus" value={state.earned.flatBonus} plus />
                  : <HeroStat label="Settled" value={state.settledValue} />}
              </div>
            </section>

            {/* KPI row. 5 tiles. "Closed" = total_amount of quotes
                moved to won this period (informational). "Settled" is
                in the hero — that's the number the rep gets paid on.
                Closed - Settled = the gap they're waiting to collect. */}
            <section className="v2d-kpi-row">
              <Kpi
                label="Closed"
                sub="Won this period"
                value={state.wonValue}
                tone="green"
              />
              <Kpi
                label="Quotes sent"
                value={state.quotesSentValue}
                sub={`${state.quotesSent ?? 0} quote${(state.quotesSent ?? 0) === 1 ? '' : 's'}`}
                tone="blue"
              />
              <Kpi
                label="Outstanding"
                value={state.outstanding?.total || 0}
                sub={`${state.outstanding?.count || 0} quote${(state.outstanding?.count || 0) === 1 ? '' : 's'}`}
                tone="amber"
                dot={(state.outstanding?.count || 0) > 0}
              />
              <Kpi label="Pending approval" count={state.pendingPending.count} tone="amber" dot={state.pendingPending.count > 0} />
              <Kpi label="Follow-ups due" count={state.todoCount} tone="rose" dot={state.todoCount > 0} />
            </section>

            {/* Row 2: Earned progress + Recent quotes */}
            <section className="v2d-grid-2">
              <EarnedPanel earned={state.earned} />
              <RecentQuotesPanel quotes={state.recent} onOpen={(id) => navigate(`/quotes/${id}`)} onAll={() => navigate('/quotes')} />
            </section>

            {/* Row 3: Active campaigns — rep's own won quotes still on air.
                Same panel as admin dashboard, scoped to this rep's clients. */}
            <ActiveCampaignsPanel rows={state.activeCampaigns || []} onOpen={(id) => navigate(`/quotes/${id}`)} />

            {/* M1 Row: Daily counter + What I owe today.
                Daily counter = today's quote/follow-up/payment counts
                vs daily_targets. Today panel = urgency-sorted list of
                what needs the rep's attention right now (follow-ups due
                + won-no-payment + stale sent quotes). */}
            <section className="v2d-grid-2">
              <DailyCounterPanel activity={state.todayActivity} target={state.dailyTarget} />
              <TodayActionsPanel actions={state.todayActions || []} onOpen={(id) => navigate(`/quotes/${id}`)} onAll={() => navigate('/quotes')} />
            </section>

            {/* Row 4: Leaderboard (full width, replaces the side-by-side
                with TodayActions which moved up to the M1 row above) */}
            <section>
              <LeaderboardPanel rows={state.leaderboard} meId={profile?.id} />
            </section>

            <div className="v2d-foot">
              v2 · sales · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>
      </div>
    )
  }

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function HeroStat({ label, value, plus }) {
  return (
    <div className="v2d-hero-stat">
      <div className="v2d-hero-stat-l">{label}</div>
      <div className="v2d-hero-stat-v">
        {plus && value > 0 && '+'}<Money value={value} />
      </div>
    </div>
  )
}

function Kpi({ label, value, count, sub, tone, dot }) {
  const icon = {
    green: '₹', blue: '◎', amber: '⏱', rose: '📞',
  }[tone] || '•'
  const iconClass = tone === 'green' ? 'v2d-kpi-ic--green'
                  : tone === 'blue'  ? 'v2d-kpi-ic--blue'
                  : tone === 'amber' ? 'v2d-kpi-ic--amber' : 'v2d-kpi-ic--rose'
  return (
    <div className="v2d-kpi">
      <div className="v2d-kpi-head">
        <div className={`v2d-kpi-ic ${iconClass}`}>{icon}</div>
        <div className="v2d-kpi-l">{label}</div>
      </div>
      <div className="v2d-kpi-v">
        {value !== undefined ? <Money value={value} /> : (count ?? 0)}
      </div>
      {sub && <div className="v2d-kpi-sub" style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.55))', marginTop: 2 }}>{sub}</div>}
      {dot && <div className="v2d-kpi-delta"><span className="up">●</span> needs attention</div>}
    </div>
  )
}

function EarnedPanel({ earned }) {
  const pct = Math.round((earned.progressToTarget || 0) * 100)
  const threshPct = Math.round((earned.progressToThreshold || 0) * 100)
  const hit = earned.slabReached
  return (
    <div className="v2d-prog-card">
      <div className="v2d-prog-head">
        <div>
          <div className="v2d-panel-t">{new Date().toLocaleDateString('en-IN', { month: 'long' })} incentive · Earned</div>
          <div className="v2d-panel-s">Updates the moment payments clear admin approval</div>
        </div>
        <div className={`v2d-badge ${hit ? 'v2d-badge--green' : 'v2d-badge--neutral'}`}>
          {hit ? <><Trophy size={13} strokeWidth={1.6} /> Target hit</> : `${threshPct}% to threshold`}
        </div>
      </div>

      <div className="v2d-prog-big"><Money value={earned.incentive} /></div>

      <div className="v2d-prog-bar">
        <div
          className={`v2d-prog-fill ${!hit ? 'v2d-prog-fill--partial' : ''}`}
          style={{ width: `${Math.min(100, hit ? pct : threshPct)}%` }}
        />
      </div>
      <div className="v2d-prog-meta">
        <span>{hit
          ? `${pct}% of target`
          : `${formatCompact(earned.total)} / ${formatCompact(earned.threshold)} threshold`}</span>
        <span>Target <Money value={earned.target} /></span>
      </div>

      {earned.targetExceeded && earned.flatBonus > 0 && (
        <div className="v2d-prog-bonus">
          <span>Flat bonus unlocked</span>
          <span className="v2d-prog-bonus-v">+<Money value={earned.flatBonus} /></span>
        </div>
      )}
    </div>
  )
}

function RecentQuotesPanel({ quotes, onOpen, onAll }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Recent quotes</div>
          <div className="v2d-panel-s">Latest activity across your pipeline</div>
        </div>
        <button className="v2d-link" onClick={onAll}>View all</button>
      </div>
      {quotes.length === 0 ? (
        <div className="v2d-q-empty">No quotes yet — create your first to get started.</div>
      ) : (
        <table className="v2d-qt">
          <thead>
            <tr><th>Quote</th><th>Company</th><th>Status</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {quotes.map(q => (
              <tr key={q.id} onClick={() => onOpen(q.id)}>
                <td>{q.quote_number || '—'}</td>
                <td>{q.client_company || q.client_name || '—'}</td>
                <td><span className={`st st--${q.status}`}>{q.status}</span></td>
                <td className="num"><Money value={q.total_amount || q.subtotal || 0} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function LeaderboardPanel({ rows, meId }) {
  const top = rows.slice(0, 5)
  const meIn = top.some(r => r.id === meId)
  const me = rows.find(r => r.id === meId)
  const myRank = me ? rows.findIndex(r => r.id === meId) + 1 : null
  const leader = rows[0]
  const myPct = me && leader?.proposed ? Math.min(100, Math.round((me.proposed / leader.proposed) * 100)) : 0
  const usingFallback = rows.length > 0 && rows.every(r => r._fallback)

  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Team leaderboard · {new Date().toLocaleDateString('en-IN', { month: 'short' })}</div>
          <div className="v2d-panel-s">
            {usingFallback
              ? 'Names only — apply supabase_phase3d.sql to populate numbers'
              : 'Proposed incentive + total won quotes'}
          </div>
        </div>
        {myRank && !usingFallback && <div className="v2d-badge v2d-badge--neutral">Rank #{myRank} · {myPct}% of leader</div>}
      </div>

      {rows.length === 0 ? (
        <div className="v2d-q-empty">No sales reps yet.</div>
      ) : (
        <div className="v2d-lb">
          {top.map((r, i) => (
            <LbRow key={r.id} rank={i + 1} row={r} isYou={r.id === meId} leader={leader?.proposed || 0} />
          ))}
          {!meIn && me && <LbRow rank={myRank} row={me} isYou leader={leader?.proposed || 0} />}
        </div>
      )}
    </div>
  )
}

function LbRow({ rank, row, isYou, leader }) {
  const pct = leader ? Math.min(100, Math.round((row.proposed / leader) * 100)) : 0
  const rankCls = rank === 1 ? 'v2d-lb-rank-1' : rank === 2 ? 'v2d-lb-rank-2' : rank === 3 ? 'v2d-lb-rank-3' : 'v2d-lb-rank-n'
  return (
    <div className={`v2d-lb-row ${isYou ? 'v2d-lb-row--you' : ''}`} style={{ alignItems: 'center' }}>
      <div className={`v2d-lb-rank ${rankCls}`}>{rank}</div>
      <div className="v2d-lb-avatar">{initials(row.name)}</div>
      <div className="v2d-lb-name">
        {row.name}{isYou && <span className="v2d-lb-you">· you</span>}
        <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontWeight: 500, marginTop: 2 }}>
          {row.wonCount} won quote{row.wonCount === 1 ? '' : 's'}
        </div>
      </div>
      {/* Earned column — what's already cleared and credited */}
      <div style={{ textAlign: 'right', minWidth: 90 }}>
        <div style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--v2-ink-2)', fontWeight: 700, textTransform: 'uppercase' }}>Earned</div>
        <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 13, color: 'var(--v2-green)' }}>
          <Money value={row.earned} />
        </div>
      </div>
      {/* Proposed (forecast) column — what they're projected to earn */}
      <div className="v2d-lb-val" style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--v2-ink-2)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 1 }}>Proposed</div>
        <Money value={row.proposed} />
      </div>
      <div className="v2d-lb-pct">{pct}%</div>
    </div>
  )
}

// Inline so the sales dashboard doesn't need to import from admin.
// Mirrors AdminDashboardDesktop's ActiveCampaignsPanel but drops the
// sales_person_name column — on the rep's own dashboard every row is
// theirs by definition, so showing the name is redundant noise.
function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24
  return Math.max(0, Math.round((new Date(a) - new Date(b)) / MS))
}

function ActiveCampaignsPanel({ rows, onOpen }) {
  const today = todayISO()
  return (
    <section className="v2d-panel" style={{ marginBottom: 22 }}>
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">My active campaigns</div>
          <div className="v2d-panel-s">Your won quotes with a live campaign window</div>
        </div>
        {rows.length > 0 && <div className="v2d-badge v2d-badge--green">{rows.length} running</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2d-q-empty">No active campaigns. Once a won quote's campaign window opens, it'll appear here.</div>
      ) : (
        <div className="v2d-camp-grid">
          {rows.map(r => {
            const daysLeft = daysBetween(r.campaign_end_date, today)
            const pillCls = daysLeft <= 3 ? 'v2d-camp-pill--end'
                          : daysLeft <= 7 ? 'v2d-camp-pill--soon'
                          : 'v2d-camp-pill--live'
            const pillLabel = daysLeft <= 3 ? 'Ending' : daysLeft <= 7 ? 'Soon' : 'Live'
            const totalDays = r.campaign_start_date ? daysBetween(r.campaign_end_date, r.campaign_start_date) : 30
            const elapsed = r.campaign_start_date ? Math.max(0, daysBetween(today, r.campaign_start_date)) : 0
            const pct = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0
            // Age tag — Fresh/Aging/Stale based on days since the won
            // flip (updated_at). Only shown for unsettled rows; once
            // the final payment clears the campaign is just running
            // out its window, age is irrelevant.
            const ageKey = r._ageKey || 'fresh'
            const isSettled = !!r._isSettled
            const ageBadge = isSettled
              ? { cls: 'v2d-camp-age--paid', label: 'Settled' }
              : ageKey === 'stale' ? { cls: 'v2d-camp-age--stale', label: `Stale ${r._ageDays}d` }
              : ageKey === 'aging' ? { cls: 'v2d-camp-age--aging', label: `Aging ${r._ageDays}d` }
              :                      { cls: 'v2d-camp-age--fresh', label: `Fresh ${r._ageDays}d` }
            return (
              <div key={r.id} className="v2d-camp" onClick={() => onOpen(r.id)} style={{ cursor: 'pointer' }}>
                <div className="v2d-camp-h">
                  <div className="v2d-camp-n" title={r.client_company || r.client_name}>{r.client_company || r.client_name}</div>
                  <span className={`v2d-camp-pill ${pillCls}`}>{pillLabel}</span>
                </div>
                <div className="v2d-camp-s">{r.quote_number}</div>
                <div className="v2d-camp-s" style={{ marginTop: 4, color: 'var(--v2-ink-0)', fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 13 }}>
                  {daysLeft} day{daysLeft === 1 ? '' : 's'} left · <Money value={r.total_amount || 0} />
                </div>
                <div className="v2d-camp-prog"><div className="v2d-camp-prog-fill" style={{ width: `${pct}%` }} /></div>
                <div className={`v2d-camp-age ${ageBadge.cls}`}>{ageBadge.label}</div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// M1 — Today panel. Was follow-ups only; now merges THREE urgency
// streams the rep needs to act on right now:
//   • follow-ups due on/before today (urgency 0 — most urgent)
//   • won quotes with no payment recorded yet (urgency 1)
//   • sent quotes idle >7d with no follow-up logged (urgency 2)
// Caller passes pre-sorted `actions` array — see load() todayActions
// computation. Each row carries a `kind` so the icon/colour routes.
function TodayActionsPanel({ actions, onOpen, onAll }) {
  const KIND_META = {
    followup:        { icon: <Phone size={14} />,         iconCls: 'v2d-q-ic--rose',  label: 'Follow-up' },
    won_no_payment:  { icon: <AlertTriangle size={14} />, iconCls: 'v2d-q-ic--amber', label: 'Collect' },
    stale:           { icon: <ArrowUpRight size={14} />,  iconCls: 'v2d-q-ic--blue',  label: 'Chase' },
  }
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">What I owe today</div>
          <div className="v2d-panel-s">Follow-ups due, won quotes unpaid, sent quotes idle &gt;7d</div>
        </div>
        {actions.length > 0 && <div className="v2d-badge v2d-badge--amber">{actions.length} item{actions.length === 1 ? '' : 's'}</div>}
      </div>
      {actions.length === 0 ? (
        <div className="v2d-q-empty">Inbox zero. Nothing needs your attention today.</div>
      ) : actions.map((a, i) => {
        const meta = KIND_META[a.kind] || KIND_META.followup
        return (
          <div key={`${a.kind}-${a.id}-${i}`} className="v2d-q-row" onClick={() => a.id && onOpen(a.id)}>
            <div className={`v2d-q-ic ${meta.iconCls}`}>{meta.icon}</div>
            <div className="v2d-q-body">
              <div className="v2d-q-t">
                {a.title}
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--v2-ink-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {meta.label}
                </span>
              </div>
              <div className="v2d-q-s">{a.sub}</div>
            </div>
            <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
          </div>
        )
      })}
    </div>
  )
}

// M1 — Daily Counter widget. Three progress bars: quotes sent, follow-
// ups completed, payments logged today. Each bar fills against the
// daily_targets row for this rep. Counters > target render at 100%
// with a "✓" so the rep sees green when they've hit it. Calls section
// hidden when target = 0 (no calls module yet).
function DailyCounterPanel({ activity, target }) {
  const rows = [
    { key: 'quotes',    label: 'Quotes sent',        value: activity?.quotes    || 0, target: target?.min_quotes    || 0 },
    { key: 'followups', label: 'Follow-ups done',    value: activity?.followups || 0, target: target?.min_followups || 0 },
    { key: 'payments',  label: 'Payments logged',    value: activity?.payments  || 0, target: 0 },
  ]
  if ((target?.min_calls || 0) > 0) {
    rows.push({ key: 'calls', label: 'Calls logged', value: 0, target: target.min_calls, soon: true })
  }
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Today's targets</div>
          <div className="v2d-panel-s">Reset at midnight. Hit them every day.</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map(r => {
          const pct = r.target > 0 ? Math.min(100, Math.round((r.value / r.target) * 100)) : (r.value > 0 ? 100 : 0)
          const hit = r.target > 0 && r.value >= r.target
          const noTarget = r.target === 0
          return (
            <div key={r.key}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                fontSize: 12, marginBottom: 6,
              }}>
                <span style={{ color: 'var(--v2-ink-0)', fontWeight: 600 }}>
                  {r.label}{r.soon && <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}> · soon</span>}
                </span>
                <span style={{
                  fontFamily: 'var(--v2-display)', fontWeight: 700,
                  color: hit ? 'var(--v2-green)' : noTarget ? 'var(--v2-ink-2)' : 'var(--v2-ink-0)',
                }}>
                  {r.value}{r.target > 0 ? ` / ${r.target}` : ''}
                  {hit && ' ✓'}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--v2-bg-2)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`, height: '100%',
                  background: hit ? 'var(--v2-green)' : 'var(--v2-blue)',
                  borderRadius: 'inherit',
                  transition: 'width .25s ease',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
