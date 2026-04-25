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
  Contact2,
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

    const [qRes, pRes, fRes, msRes, histRes, profRes, settingsRes, usersRes] = await Promise.all([
      supabase.from('quotes')
        .select('id, quote_number, client_name, subtotal, total_amount, status, revenue_type, created_at, updated_at, created_by, campaign_start_date, campaign_end_date')
        .eq('created_by', uid)
        .order('created_at', { ascending: false }),
      supabase.from('payments')
        .select('id, amount_received, approval_status, rejection_reason, created_at, recorded_by, quote_id')
        .eq('recorded_by', uid),
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
      supabase.from('users').select('id, name').eq('role', 'sales'),
    ])

    const quotes = qRes.data || []
    const payments = pRes.data || []
    const followups = fRes.data || []
    const monthRows = msRes.data || []
    const history = histRes.data || []
    const prof = profRes.data
    const settings = settingsRes.data || {}
    const salesUsers = usersRes.data || []

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
    const [{ data: lbQuotes }, { data: lbPayments }] = await Promise.all([
      supabase.from('quotes').select('id, created_by, total_amount, status, updated_at, created_at'),
      supabase.from('payments')
        .select('quote_id, amount_received, payment_date, created_at, is_final_payment')
        .eq('approval_status', 'approved'),
    ])
    const lbSettleMap = buildSettlementMap(lbQuotes || [], lbPayments || [])
    const wonByUser = {}
    ;(lbQuotes || []).forEach(q => {
      const s = lbSettleMap.get(q.id)
      if (!s) return
      if (s.settledAt < monthStartIso || s.settledAt >= monthEndIso) return
      wonByUser[q.created_by] = (wonByUser[q.created_by] || 0) + (q.total_amount || 0)
    })
    const leaderboard = salesUsers
      .map(u => ({ id: u.id, name: u.name, won: wonByUser[u.id] || 0 }))
      .sort((a, b) => b.won - a.won)

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

    const openNew     = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'new')
                              .reduce((s, q) => s + (q.subtotal || 0), 0)
    const openRenewal = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'renewal')
                              .reduce((s, q) => s + (q.subtotal || 0), 0)

    const forecast = calculateIncentive({
      monthlySalary: prof?.monthly_salary || 0,
      salesMultiplier: multiplier,
      newClientRate: newRate,
      renewalRate: renewalRate,
      flatBonus,
      newClientRevenue: monthNewClient + openNew,
      renewalRevenue:   monthRenewal   + openRenewal,
    })
    const forecastDelta = Math.max(0, (forecast.incentive || 0) - (earned.incentive || 0))
    const openPipeline  = openNew + openRenewal

    const pendingPayments = payments.filter(p => p.approval_status === 'pending')
    const pendingTotal    = pendingPayments.reduce((s, p) => s + (Number(p.amount_received) || 0), 0)

    // Outstanding — mirror the admin dashboard + QuotesV2 computeBalance
    // exactly so the rep's KPI matches what they see in the Quotes list.
    //
    // Rule: a quote is "committed" (and therefore counts toward outstanding)
    // if status === 'won' OR it has any approved payment recorded. Sent or
    // negotiating quotes with a part-payment taken count. Lost quotes never
    // count. Balance is clamped at 0 so over-payments don't go negative.
    //
    // IMPORTANT: we query payments BY QUOTE_ID here, not by recorded_by —
    // admin can record payments against a rep's quote too, and those still
    // reduce the balance. Using the `payments` slice from load() above
    // would undercount (it's .eq('recorded_by', uid)) and inflate outstanding.
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
    const today = todayISO()
    const activeCampaigns = quotes
      .filter(q => q.status === 'won' && q.campaign_end_date && q.campaign_end_date >= today)
      .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
      .slice(0, 6)

    setState({
      loading: false,
      streak,
      earned,
      forecast: { incentive: forecastDelta, openPipeline },
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
    <div className="v2d">
      <div className="v2d-app">
        {/* ──── Sidebar ──── */}
        <aside className="v2d-side">
          <div className="v2d-brand">
            <span className="v2d-brand-mark">A</span>
            <div>
              <div className="v2d-brand-t">Adflux</div>
              <div className="v2d-brand-s">Sales</div>
            </div>
          </div>

          <nav className="v2d-nav">
            <button className={isHome ? 'is-active' : ''} onClick={() => navigate('/dashboard')}>
              <LayoutDashboard size={16} /><span>Dashboard</span>
            </button>
            <button onClick={() => navigate('/quotes')}>
              <FileText size={16} /><span>Quotes</span>
            </button>
            <button onClick={() => navigate('/clients')}>
              <Contact2 size={16} /><span>Clients</span>
            </button>
            <button onClick={() => navigate('/my-performance')}>
              <BarChart3 size={16} /><span>My Performance</span>
            </button>
            <button onClick={() => navigate('/my-offer')}>
              <Gift size={16} /><span>My Offer</span>
            </button>
            <button onClick={() => navigate('/renewal-tools')}>
              <Repeat size={16} /><span>Renewal Tools</span>
            </button>

            <div className="v2d-nav-spacer" />

            <div className="v2d-nav-foot">
              {state.streak > 0 && (
                <div className="v2d-side-streak">
                  <div className="v2d-side-streak-k">
                    <Flame size={12} strokeWidth={2.6} /> Streak
                  </div>
                  <div className="v2d-side-streak-v">{state.streak} months</div>
                  <div className="v2d-side-streak-s">Keep the fire going</div>
                </div>
              )}
              <button onClick={() => signOut?.()}>
                <LogOut size={16} /><span>Log out</span>
              </button>
            </div>
          </nav>
        </aside>

        {/* ──── Main column ──── */}
        <main className="v2d-main">
          {/* Top bar */}
          <header className="v2d-topbar">
            <div>
              <div className="v2d-crumb-kicker">{greeting()}</div>
              <div className="v2d-crumb-t">{firstName} 👋</div>
            </div>
            <div className="v2d-topbar-spacer" />
            <div className="v2d-search">
              <Search size={14} />
              <input placeholder="Search quotes, clients…" onFocus={() => navigate('/quotes')} readOnly />
            </div>
            {/* Period picker — month nav + presets + custom range.
                Same component as admin dashboard. */}
            <PeriodPicker period={period} onChange={setPeriod} />
            <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
              <Plus size={14} strokeWidth={2.6} /> Create Quote
            </button>
            <button className="v2d-bell" aria-label="Notifications">
              <Bell size={14} />
              {(state.rejected || state.pendingPending.count > 0) && <span className="v2d-bell-dot" />}
            </button>
            <div className="v2d-me">
              <div className="v2d-me-av">{initials(profile?.name || 'You')}</div>
              <div>
                <div className="v2d-me-name">{profile?.name || 'You'}</div>
                <div className="v2d-me-role">Sales</div>
              </div>
            </div>
          </header>

          <div className="v2d-content">
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
                <div className="v2d-hero-kicker">⚡ Proposed Incentive</div>
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
                    {tab === 'forecast' && (
                      state.forecast.openPipeline === 0
                        ? 'Forecast is flat — send quotes to build your open pipeline.'
                        : `Incremental on ₹${new Intl.NumberFormat('en-IN').format(state.forecast.openPipeline)} open pipeline if every non-lost quote closes this month.`
                    )}
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

            {/* Row 4: Leaderboard + Today's actions */}
            <section className="v2d-grid-2">
              <LeaderboardPanel rows={state.leaderboard} meId={profile?.id} />
              <TodayActionsPanel followups={state.followups} onOpen={(id) => navigate(`/quotes/${id}`)} onAll={() => navigate('/quotes')} />
            </section>

            <div className="v2d-foot">
              v2 · sales · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </main>
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
          {hit ? '🏆 Target hit' : `${threshPct}% to threshold`}
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
            <tr><th>Quote</th><th>Client</th><th>Status</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {quotes.map(q => (
              <tr key={q.id} onClick={() => onOpen(q.id)}>
                <td>{q.quote_number || '—'}</td>
                <td>{q.client_name || '—'}</td>
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
  const myPct = me && leader?.won ? Math.min(100, Math.round((me.won / leader.won) * 100)) : 0

  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Team leaderboard · {new Date().toLocaleDateString('en-IN', { month: 'short' })}</div>
          <div className="v2d-panel-s">Won-revenue race this month</div>
        </div>
        {myRank && <div className="v2d-badge v2d-badge--neutral">Rank #{myRank} · {myPct}% of leader</div>}
      </div>

      {rows.length === 0 ? (
        <div className="v2d-q-empty">No sales reps yet.</div>
      ) : (
        <div className="v2d-lb">
          {top.map((r, i) => (
            <LbRow key={r.id} rank={i + 1} row={r} isYou={r.id === meId} leader={leader?.won || 0} />
          ))}
          {!meIn && me && <LbRow rank={myRank} row={me} isYou leader={leader?.won || 0} />}
        </div>
      )}
    </div>
  )
}

function LbRow({ rank, row, isYou, leader }) {
  const pct = leader ? Math.min(100, Math.round((row.won / leader) * 100)) : 0
  const rankCls = rank === 1 ? 'v2d-lb-rank-1' : rank === 2 ? 'v2d-lb-rank-2' : rank === 3 ? 'v2d-lb-rank-3' : 'v2d-lb-rank-n'
  return (
    <div className={`v2d-lb-row ${isYou ? 'v2d-lb-row--you' : ''}`}>
      <div className={`v2d-lb-rank ${rankCls}`}>{rank}</div>
      <div className="v2d-lb-avatar">{initials(row.name)}</div>
      <div className="v2d-lb-name">
        {row.name}{isYou && <span className="v2d-lb-you">· you</span>}
      </div>
      <div className="v2d-lb-val"><Money value={row.won} /></div>
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
            return (
              <div key={r.id} className="v2d-camp" onClick={() => onOpen(r.id)} style={{ cursor: 'pointer' }}>
                <div className="v2d-camp-h">
                  <div className="v2d-camp-n" title={r.client_name}>{r.client_name}</div>
                  <span className={`v2d-camp-pill ${pillCls}`}>{pillLabel}</span>
                </div>
                <div className="v2d-camp-s">{r.quote_number}</div>
                <div className="v2d-camp-s" style={{ marginTop: 4, color: 'var(--v2-ink-0)', fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 13 }}>
                  {daysLeft} day{daysLeft === 1 ? '' : 's'} left · <Money value={r.total_amount || 0} />
                </div>
                <div className="v2d-camp-prog"><div className="v2d-camp-prog-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function TodayActionsPanel({ followups, onOpen, onAll }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Today's actions</div>
          <div className="v2d-panel-s">Follow-ups due on or before today</div>
        </div>
        {followups.length > 0 && <div className="v2d-badge v2d-badge--amber">{followups.length} open</div>}
      </div>
      {followups.length === 0 ? (
        <div className="v2d-q-empty">Inbox zero. Nothing due today.</div>
      ) : followups.map(f => (
        <div key={f.id} className="v2d-q-row" onClick={() => f.quote_id && onOpen(f.quote_id)}>
          <div className="v2d-q-ic v2d-q-ic--rose"><Phone size={14} /></div>
          <div className="v2d-q-body">
            <div className="v2d-q-t">{f.notes || 'Follow up'}</div>
            <div className="v2d-q-s">Due {new Date(f.follow_up_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
          </div>
          <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
        </div>
      ))}
    </div>
  )
}
