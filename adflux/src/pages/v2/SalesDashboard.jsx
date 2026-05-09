// src/pages/v2/SalesDashboard.jsx
//
// Redesign preview — Batch 1 Sales Core.
// Route: /v2/dashboard
//
// Lives beside the live SalesDashboard.jsx without touching it.
// Once approved, cutover = swap the /dashboard route in App.jsx to
// point here, delete the old file, ship.
//
// Data sources (all existing tables, no schema changes):
//   quotes              → pipeline, won value, sent count
//   payments            → pending approval + rejected toast
//   follow_ups          → to-do count
//   monthly_sales_data  → earned revenue for streak + incentive math
//   staff_incentive_profiles → target, flat bonus, rates
//   incentive_settings  → default rates
//   users               → leaderboard names

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Flame, Home, FileText, Plus, BarChart3, AlertTriangle, RefreshCw, LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { calculateIncentive, calculateStreak } from '../../utils/incentiveCalc'
import { buildSettlementMap } from '../../utils/settlement'
import { thisMonthISO, initials, todayISO } from '../../utils/formatters'
// Phase 31O — V2AppShell mounts ProposedIncentiveCard now; this file
// no longer needs the import.
import '../../styles/v2.css'

/* ─── Money display: full Indian-format number with lakh/crore grouping.
   No more ₹29.7K / ₹1.2Cr truncation — reps want the exact ₹ figure.
   The `big` prop is retained for API compatibility but no longer
   needed for scaling (CSS controls sizing on mobile). ─── */
function Money({ value, big = false }) { /* eslint-disable-line no-unused-vars */
  const n = Number(value) || 0
  return <>₹{new Intl.NumberFormat('en-IN').format(Math.round(n))}</>
}

/* ─── Greeting by time-of-day ─── */
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function SalesDashboardV2() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const [state, setState] = useState({ loading: true })

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    const uid = profile.id
    const monthKey = thisMonthISO()

    const [qRes, pRes, fRes, msRes, histRes, profRes, settingsRes] = await Promise.all([
      supabase.from('quotes')
        .select('id, quote_number, client_name, client_company, subtotal, total_amount, status, revenue_type, created_at, updated_at, created_by, campaign_start_date, campaign_end_date')
        .eq('created_by', uid)
        .order('created_at', { ascending: false }),
      supabase.from('payments')
        .select('id, amount_received, approval_status, rejection_reason, created_at, recorded_by, quote_id')
        .eq('recorded_by', uid),
      supabase.from('follow_ups')
        .select('id')
        .eq('assigned_to', uid)
        .eq('is_done', false)
        .lte('follow_up_date', new Date().toISOString().slice(0, 10)),
      supabase.from('monthly_sales_data')
        .select('*').eq('staff_id', uid).eq('month_year', monthKey).maybeSingle(),
      supabase.from('monthly_sales_data')
        .select('*').eq('staff_id', uid).order('month_year', { ascending: false }).limit(12),
      supabase.from('staff_incentive_profiles')
        .select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('incentive_settings').select('*').maybeSingle(),
    ])

    const quotes = qRes.data || []
    const payments = pRes.data || []
    const followups = fRes.data || []
    const monthRow = msRes.data
    const history = histRes.data || []
    const prof = profRes.data
    const settings = settingsRes.data || {}

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
    const monthEnd   = new Date(monthStart); monthEnd.setMonth(monthEnd.getMonth() + 1)
    const monthStartIso = monthStart.toISOString()
    const monthEndIso   = monthEnd.toISOString()

    // Leaderboard now races on PROPOSED INCENTIVE (forecast) per rep
    // and shows EARNED alongside. Per-rep math has to run against ALL
    // reps' data, which means bypassing the user-scoped RLS on
    // staff_incentive_profiles + monthly_sales_data. The
    // get_team_leaderboard SECURITY DEFINER RPC returns aggregated
    // inputs only — no raw row leakage. See supabase_phase3d.sql.
    //
    // We still fetch lbQuotes + lbPayments separately because the
    // rep's own settled-this-month KPI needs the settle map (built
    // from payment_date).
    const [{ data: lbQuotes }, { data: lbPayments }, lbRpcRes, lbUsersRes] = await Promise.all([
      supabase.from('quotes').select('id, created_by, total_amount, status, updated_at, created_at'),
      supabase.from('payments')
        .select('quote_id, amount_received, payment_date, created_at, is_final_payment')
        .eq('approval_status', 'approved'),
      supabase.rpc('get_team_leaderboard', { p_month_keys: [monthKey] }),
      // Names-only fallback when the RPC isn't deployed yet
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
      // RPC unavailable — render names with zeros so the leaderboard
      // doesn't read "No sales reps yet". Apply supabase_phase3d.sql
      // to populate real numbers.
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

    // My settled-this-month total (drives the "Settled" KPI)
    const mySettledValue = (lbQuotes || [])
      .filter(q => q.created_by === uid)
      .reduce((s, q) => {
        const settle = lbSettleMap.get(q.id)
        if (!settle) return s
        if (settle.settledAt < monthStartIso || settle.settledAt >= monthEndIso) return s
        return s + (Number(q.total_amount) || 0)
      }, 0)

    // ─── Incentive math ───
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

    // Pull approved payments BY QUOTE_ID up front — both the forecast
    // calc (won-unsettled inclusion) and the outstanding KPI need to
    // know which quotes have a final payment cleared. We query by
    // quote_id (not recorded_by) because admin can record payments
    // against a rep's quote too — using the payments slice from above
    // (.eq('recorded_by', uid)) would miss those and double-count
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

    const openNew     = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'new')
                              .reduce((s,q) => s + (q.subtotal || 0), 0)
    const openRenewal = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'renewal')
                              .reduce((s,q) => s + (q.subtotal || 0), 0)

    // Won-but-not-yet-settled — quote is closed (status='won') but the
    // final approved payment hasn't cleared, so monthly_sales_data
    // hasn't credited it yet. These belong in forecast: the rep has
    // earned the deal, the money is just stuck in collections. Carries
    // forward month-over-month until the final payment lands (settles
    // the quote, moves it into earned) OR the rep flips it to lost.
    const today = todayISO()
    const wonUnsettled = quotes.filter(q => q.status === 'won' && !(paidMap[q.id]?.final))
    const wonUnsettledNew     = wonUnsettled.filter(q => q.revenue_type === 'new')
                                            .reduce((s, q) => s + (q.subtotal || 0), 0)
    const wonUnsettledRenewal = wonUnsettled.filter(q => q.revenue_type === 'renewal')
                                            .reduce((s, q) => s + (q.subtotal || 0), 0)

    // Age buckets for won-unsettled — Fresh <30d, Aging 30-60d,
    // Stale 60+d, computed off updated_at (the won timestamp).
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
      newClientRevenue: (monthRow?.new_client_revenue || 0) + openNew + wonUnsettledNew,
      renewalRevenue:   (monthRow?.renewal_revenue    || 0) + openRenewal + wonUnsettledRenewal,
    })
    const forecastDelta = Math.max(0, (forecast.incentive || 0) - (earned.incentive || 0))
    const openPipeline  = openNew + openRenewal
    const wonUnsettledTotal = wonUnsettledNew + wonUnsettledRenewal

    // Pending: payments this user submitted that admin hasn't decided yet
    const pendingPayments = payments.filter(p => p.approval_status === 'pending')
    const pendingTotal    = pendingPayments.reduce((s,p) => s + (Number(p.amount_received) || 0), 0)

    // Rejection toast: most recent rejected payment (if any)
    const rejected = payments.filter(p => p.approval_status === 'rejected')
                             .sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]

    // Streak
    const streak = calculateStreak(history, earned.target)

    // Zero state
    const isZero = quotes.length === 0 && payments.length === 0

    // KPIs
    const wonValue = quotes.filter(q => q.status === 'won')
                           .filter(q => (q.updated_at || q.created_at || '').slice(0,7) === monthKey)
                           .reduce((s,q) => s + (q.total_amount || 0), 0)
    // Quotes Sent: count + total ₹ value so the dashboard surfaces the
    // headline "how much have I sent" figure alongside the raw count.
    const sentQuotes = quotes.filter(q => q.status === 'sent')
    const quotesSent = sentQuotes.length
    const quotesSentValue = sentQuotes.reduce((s, q) => s + (Number(q.total_amount) || 0), 0)
    const todoCount  = followups.length

    // Outstanding — mirror admin dashboard + QuotesV2 computeBalance so
    // the rep KPI matches the Outstanding column on the Quotes list.
    // Reuses the paidMap built above (one fetch, two consumers).
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

    // Active campaigns — rep's own won quotes still on air. Same rule
    // the admin dashboard uses, just scoped to the rep's quotes (which
    // the query above already filters via .eq('created_by', uid)).
    // Tag each row with its age bucket and an is_settled flag so the
    // panel can show which ones still owe money.
    const activeCampaigns = quotes
      .filter(q => q.status === 'won' && q.campaign_end_date && q.campaign_end_date >= today)
      .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
      .slice(0, 6)
      .map(q => {
        const days = daysBetween(today, q.updated_at || q.created_at)
        const ageKey = days < 30 ? 'fresh' : days < 60 ? 'aging' : 'stale'
        return { ...q, _ageDays: days, _ageKey: ageKey, _isSettled: !!paidMap[q.id]?.final }
      })

    setState({
      loading: false,
      isZero,
      streak,
      earned,
      forecast: {
        incentive: forecastDelta,
        openNew,
        openRenewal,
        openPipeline,
        wonUnsettledTotal,
        wonAge,
      },
      pendingPending: { count: pendingPayments.length, total: pendingTotal },
      rejected,
      wonValue,                  // Closed (status→won) this month — informational
      settledValue: mySettledValue, // Fully paid this month — drives incentive
      quotesSent,
      quotesSentValue,
      todoCount,
      outstanding: { total: outstandingTotal, count: outstandingCount },
      leaderboard,
      activeCampaigns,
    })
  }

  if (state.loading) {
    return (
      <div className="v2">
        <div className="v2-canvas"><div style={{ padding: 60, textAlign: 'center', color: 'var(--v2-ink-2)' }}>Loading…</div></div>
      </div>
    )
  }

  return (
    <div className="v2">
      <div className="v2-canvas">
        {/* Phase 19d — V2AppShell topbar already shows greeting + bell +
            profile + logout. Header used to render those again, causing
            a stacked duplicate header on mobile. Just keep the streak
            pill as a small inline element since the topbar doesn't
            carry that signal. */}
        {/* Phase 31D — owner reported (9 May 2026) the muted "No streak"
            pill was confusing: looks like a clickable badge but does
            nothing, and reading "No streak" first thing on dashboard
            kills morale. Render the streak pill only when the rep
            actually has one. The Day-1 reset banner below already
            handles the "you have nothing yet" case. */}
        {state.streak > 0 && (
          <div className="v2-streak" style={{ alignSelf: 'flex-start', marginBottom: 12 }}>
            <Flame size={13} strokeWidth={2.4} />
            {state.streak}-mo streak
          </div>
        )}

        {state.rejected && (
          <div className="v2-banner v2-banner--toast">
            <AlertTriangle size={16} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="v2-banner-title">Payment rejected</div>
              <div>{state.rejected.rejection_reason || 'Admin sent this back — check the payment record.'}</div>
            </div>
            <button className="v2-banner-toast-cta" onClick={() => navigate(`/quotes/${state.rejected.quote_id}`)}>
              Re-record
            </button>
          </div>
        )}

        {state.isZero && (
          <div className="v2-banner v2-banner--reset">
            <RefreshCw size={16} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1, color: 'var(--v2-yellow)' }} />
            <div>
              <span className="v2-banner-title">Day 1.</span>{' '}
              Tap the <b style={{ color: 'var(--v2-yellow)' }}>+</b> below to draft your first quote and start the streak.
            </div>
          </div>
        )}

        {/* Phase 31O — V2AppShell now mounts ProposedIncentiveCard at
            the top of every sales page. /dashboard no longer renders
            it inline (it would be a duplicate of the shell's render).
            The inline ProposedIncentive function further down stays as
            dead code in case of rollback; ESLint will flag it. */}

        <div className="v2-glance-head">This month at a glance</div>
        {/* Tiles in a 2-col grid. Settled = fully paid this month
            (drives incentive). Closed = quotes won this month
            (informational — gap = revenue still to collect).
            Outstanding gets the full-width bottom slot — cash owed
            is the number reps act on most urgently. */}
        <div className="v2-kpi-grid">
          <Kpi label="Settled" value={state.settledValue} sub="Fully paid · this month" tone="green" />
          <Kpi label="Closed" value={state.wonValue} sub="Won · this month" tone="blue" />
          <Kpi
            label="Quotes Sent"
            value={state.quotesSentValue}
            sub={`${state.quotesSent} quote${state.quotesSent === 1 ? '' : 's'}`}
            tone="blue"
          />
          <Kpi label="Pending Approval" count={state.pendingPending.count} tone="yellow" dot={state.pendingPending.count > 0} />
          <Kpi label="Follow-ups Due" count={state.todoCount} tone="rose" dot={state.todoCount > 0} />
          <Kpi
            label="Outstanding"
            value={state.outstanding?.total || 0}
            sub={`${state.outstanding?.count || 0} quote${(state.outstanding?.count || 0) === 1 ? '' : 's'}`}
            tone="yellow"
            dot={(state.outstanding?.count || 0) > 0}
          />
        </div>

        <ActiveCampaignsCard rows={state.activeCampaigns || []} onOpen={(id) => navigate(`/quotes/${id}`)} />

        <EarnedCard earned={state.earned} />

        <Leaderboard rows={state.leaderboard} meId={profile?.id} />

        <div className="v2-empty-hint" style={{ opacity: 0.6 }}>
          v2 preview · sales core · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      <BottomNav active="home" onNew={() => navigate('/quotes/new')} onNav={(k) => {
        if (k === 'quotes') navigate('/quotes')
        if (k === 'perf')   navigate('/my-performance')
        if (k === 'offer')  navigate('/my-offer')
      }} />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   Sub-components (kept in-file for Batch 1 — extract once
   they're shared by more pages)
   ══════════════════════════════════════════════════════════ */

function Header({ name, streak, hasAlert, onLogout }) {
  const firstName = name.split(' ')[0]
  return (
    <div className="v2-head">
      <div className="v2-avatar">{initials(name)}</div>
      <div className="v2-hello">
        <div className="v2-hello-kicker">{greeting()}</div>
        <div className="v2-hello-name">{firstName} 👋</div>
      </div>
      {streak > 0 && (
        <div className="v2-streak">
          <Flame size={13} strokeWidth={2.4} />
          {streak}-mo streak
        </div>
      )}
      <div className="v2-bell" title="Notifications — coming soon">
        <Bell size={16} strokeWidth={2.2} />
        {hasAlert && <span className="v2-bell-dot" />}
      </div>
      {onLogout && (
        <button
          className="v2-bell"
          style={{ marginLeft: 6, background: 'transparent', border: '1px solid var(--v2-line, rgba(255,255,255,.12))', cursor: 'pointer' }}
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut size={16} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}

// Phase 31W — the inline ProposedIncentive function that lived here
// pre-31O has been deleted. Phase 31O moved to a self-fetching shared
// component in src/components/incentives/ProposedIncentiveCard.jsx
// mounted by V2AppShell. Rollback window has closed.

function Kpi({ label, value, count, sub, tone, dot }) {
  const toneClass = tone === 'green' ? 'v2-kpi--green'
                  : tone === 'blue'  ? 'v2-kpi--blue'
                  : tone === 'rose'  ? 'v2-kpi--rose' : ''
  return (
    <div className={`v2-kpi ${toneClass}`}>
      {dot && <span className="v2-kpi-dot" />}
      <div className="v2-kpi-label">{label}</div>
      <div className="v2-kpi-value">
        {value !== undefined ? <Money value={value} /> : <>{count ?? 0}</>}
      </div>
      {sub && (
        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--v2-ink-2)', fontWeight: 500 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function EarnedCard({ earned }) {
  const pct = Math.round((earned.progressToTarget || 0) * 100)
  const threshPct = Math.round((earned.progressToThreshold || 0) * 100)
  const hit = earned.slabReached
  const over = earned.targetExceeded
  return (
    <div className="v2-card">
      <div className="v2-card-h">
        <div className="v2-card-t">{new Date().toLocaleDateString('en-IN', { month: 'long' })} incentive · Earned</div>
        <div className={`v2-badge ${hit ? 'v2-badge--green' : 'v2-badge--neutral'}`}>
          {hit ? '🏆 Target hit' : `${threshPct}% to threshold`}
        </div>
      </div>
      <div className="v2-metric-big"><Money value={earned.incentive} /></div>
      <div className="v2-progress">
        <div
          className={`v2-progress-fill ${!hit ? 'v2-progress-fill--partial' : ''}`}
          style={{ width: `${Math.min(100, hit ? pct : threshPct)}%` }}
        />
      </div>
      <div className="v2-progress-meta">
        <span>{hit ? `${pct}% of target` : `₹${new Intl.NumberFormat('en-IN').format(earned.total)} / ₹${new Intl.NumberFormat('en-IN').format(earned.threshold)} threshold`}</span>
        <span>Target <Money value={earned.target} /></span>
      </div>
      {over && earned.flatBonus > 0 && (
        <>
          <div className="v2-divider" />
          <div className="v2-bonus">
            <span>Flat bonus unlocked</span>
            <span className="v2-bonus-amt">+<Money value={earned.flatBonus} /></span>
          </div>
        </>
      )}
    </div>
  )
}

// Mobile-friendly active-campaign card. Uses the v2d-camp-* CSS the
// desktop dashboard already ships, but lays out as a vertical stack
// so phone widths don't squeeze the labels. Kept in this file because
// the mobile dashboard owns its own card primitives (v2-card-*).
function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24
  return Math.max(0, Math.round((new Date(a) - new Date(b)) / MS))
}

function ActiveCampaignsCard({ rows, onOpen }) {
  const today = todayISO()
  return (
    <div className="v2-card" style={{ padding: '14px 15px 12px' }}>
      <div className="v2-card-h">
        <div className="v2-card-t">My active campaigns</div>
        {rows.length > 0 && <div className="v2-badge v2-badge--green">{rows.length} running</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2-empty-hint" style={{ padding: '12px 0' }}>
          No active campaigns. Won quotes with a live window will appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {rows.map(r => {
            const daysLeft = daysBetween(r.campaign_end_date, today)
            const pillCls = daysLeft <= 3 ? 'v2d-camp-pill--end'
                          : daysLeft <= 7 ? 'v2d-camp-pill--soon'
                          : 'v2d-camp-pill--live'
            const pillLabel = daysLeft <= 3 ? 'Ending' : daysLeft <= 7 ? 'Soon' : 'Live'
            const totalDays = r.campaign_start_date ? daysBetween(r.campaign_end_date, r.campaign_start_date) : 30
            const elapsed   = r.campaign_start_date ? Math.max(0, daysBetween(today, r.campaign_start_date)) : 0
            const pct = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0
            // Age tag — Fresh/Aging/Stale based on days since the
            // won flip (updated_at). Settled tag wins if a final
            // payment has cleared.
            const ageKey = r._ageKey || 'fresh'
            const isSettled = !!r._isSettled
            const ageBadge = isSettled
              ? { cls: 'v2d-camp-age--paid', label: 'Settled' }
              : ageKey === 'stale' ? { cls: 'v2d-camp-age--stale', label: `Stale ${r._ageDays}d` }
              : ageKey === 'aging' ? { cls: 'v2d-camp-age--aging', label: `Aging ${r._ageDays}d` }
              :                      { cls: 'v2d-camp-age--fresh', label: `Fresh ${r._ageDays}d` }
            return (
              <div
                key={r.id}
                className="v2d-camp"
                onClick={() => onOpen(r.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="v2d-camp-h">
                  <div className="v2d-camp-n" title={r.client_company || r.client_name}>{r.client_company || r.client_name}</div>
                  <span className={`v2d-camp-pill ${pillCls}`}>{pillLabel}</span>
                </div>
                <div className="v2d-camp-s">{r.quote_number}</div>
                <div className="v2d-camp-s" style={{ marginTop: 4, color: 'var(--v2-ink-0)', fontWeight: 700, fontSize: 13 }}>
                  {daysLeft} day{daysLeft === 1 ? '' : 's'} left · <Money value={r.total_amount || 0} />
                </div>
                <div className="v2d-camp-prog"><div className="v2d-camp-prog-fill" style={{ width: `${pct}%` }} /></div>
                <div className={`v2d-camp-age ${ageBadge.cls}`}>{ageBadge.label}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Leaderboard({ rows, meId }) {
  const top3 = rows.slice(0, 3)
  const meInTop3 = top3.some(r => r.id === meId)
  const me = rows.find(r => r.id === meId)
  const myRank = me ? rows.findIndex(r => r.id === meId) + 1 : null

  return (
    <div className="v2-card" style={{ padding: '14px 15px 12px' }}>
      <div className="v2-card-h">
        <div>
          <div className="v2-card-t">Team leaderboard · {new Date().toLocaleDateString('en-IN', { month: 'short' })}</div>
          <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
            {rows.length > 0 && rows.every(r => r._fallback)
              ? 'Names only — apply supabase_phase3d.sql for numbers'
              : 'Proposed incentive + total won quotes'}
          </div>
        </div>
        {myRank && !rows.every(r => r._fallback) && <div className="v2-badge v2-badge--neutral">Rank #{myRank}</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2-empty-hint" style={{ padding: '8px 0' }}>No sales reps yet.</div>
      ) : (
        <>
          {top3.map((r, i) => (
            <Row key={r.id} rank={i + 1} row={r} isYou={r.id === meId} />
          ))}
          {!meInTop3 && me && (
            <Row rank={myRank} row={me} isYou />
          )}
        </>
      )}
    </div>
  )
}

function Row({ rank, row, isYou }) {
  const rankCls = rank === 1 ? 'v2-lb-rank-1' : rank === 2 ? 'v2-lb-rank-2' : rank === 3 ? 'v2-lb-rank-3' : 'v2-lb-rank-n'
  return (
    <div className={`v2-lb-row ${isYou ? 'v2-lb-row--you' : ''}`}>
      <div className={`v2-lb-rank ${rankCls}`}>{rank}</div>
      <div className="v2-lb-avatar">{initials(row.name)}</div>
      <div className="v2-lb-name">
        {row.name}{isYou && <span className="v2-lb-you">· you</span>}
        <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontWeight: 500, marginTop: 1 }}>
          {row.wonCount} won quote{row.wonCount === 1 ? '' : 's'}
        </div>
      </div>
      {/* Earned ↑ Proposed stacked — phone widths can't fit two
          horizontal columns of money so we double them up. */}
      <div className="v2-lb-val" style={{ textAlign: 'right', lineHeight: 1.3 }}>
        <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 13, color: 'var(--v2-green)' }}>
          <Money value={row.earned} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', fontWeight: 600, letterSpacing: '.04em' }}>earned</div>
        <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 13, color: 'var(--v2-ink-0)', marginTop: 2 }}>
          <Money value={row.proposed} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', fontWeight: 600, letterSpacing: '.04em' }}>proposed</div>
      </div>
    </div>
  )
}

function BottomNav({ active, onNew, onNav }) {
  return (
    <nav className="v2-nav" aria-label="Primary">
      <div className="v2-nav-items">
        <button className={`v2-nav-item ${active === 'home' ? 'v2-nav-item--active' : ''}`}>
          <Home size={18} /> Home
        </button>
        <button className="v2-nav-item" onClick={() => onNav('quotes')}>
          <FileText size={18} /> Quotes
        </button>
        <div className="v2-nav-center">
          <button className="v2-fab" onClick={onNew} aria-label="New quote">
            <Plus size={24} strokeWidth={2.4} />
          </button>
          <span className="v2-fab-caption">CREATE QUOTE</span>
        </div>
        <button className="v2-nav-item" onClick={() => onNav('perf')}>
          <BarChart3 size={18} /> Perf
        </button>
        <button className="v2-nav-item" onClick={() => onNav('offer')}>
          <FileText size={18} /> Offer
        </button>
      </div>
    </nav>
  )
}
