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
import { thisMonthISO, initials } from '../../utils/formatters'
import '../../styles/v2.css'

/* ─── Money display: Indian format with L/Cr subscript ─── */
function Money({ value, big = false }) {
  const n = Number(value) || 0
  let num, suffix
  if (n >= 1_00_00_000) { num = (n / 1_00_00_000).toFixed(2).replace(/\.?0+$/, ''); suffix = 'Cr' }
  else if (n >= 1_00_000) { num = (n / 1_00_000).toFixed(2).replace(/\.?0+$/, ''); suffix = 'L' }
  else { num = new Intl.NumberFormat('en-IN').format(n); suffix = null }
  return (
    <>₹{num}{suffix && <sub>{suffix}</sub>}</>
  )
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

    const [qRes, pRes, fRes, msRes, histRes, profRes, settingsRes, usersRes] = await Promise.all([
      supabase.from('quotes')
        .select('id, quote_number, client_name, subtotal, total_amount, status, revenue_type, created_at, updated_at, created_by')
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
      supabase.from('users').select('id, name').eq('role', 'sales'),
    ])

    const quotes = qRes.data || []
    const payments = pRes.data || []
    const followups = fRes.data || []
    const monthRow = msRes.data
    const history = histRes.data || []
    const prof = profRes.data
    const settings = settingsRes.data || {}
    const salesUsers = usersRes.data || []

    // ─── Leaderboard: sum won-quote total_amount per sales user this month ───
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
    const { data: lbQuotes } = await supabase.from('quotes')
      .select('created_by, total_amount, status, updated_at, created_at')
      .eq('status', 'won')
      .gte('updated_at', monthStart.toISOString())
    const wonByUser = {}
    ;(lbQuotes || []).forEach(q => {
      wonByUser[q.created_by] = (wonByUser[q.created_by] || 0) + (q.total_amount || 0)
    })
    const leaderboard = salesUsers
      .map(u => ({ id: u.id, name: u.name, won: wonByUser[u.id] || 0 }))
      .sort((a, b) => b.won - a.won)

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

    const openNew     = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'new')
                              .reduce((s,q) => s + (q.subtotal || 0), 0)
    const openRenewal = quotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'renewal')
                              .reduce((s,q) => s + (q.subtotal || 0), 0)

    const forecast = calculateIncentive({
      monthlySalary: prof?.monthly_salary || 0,
      salesMultiplier: multiplier,
      newClientRate: newRate,
      renewalRate: renewalRate,
      flatBonus,
      newClientRevenue: (monthRow?.new_client_revenue || 0) + openNew,
      renewalRevenue:   (monthRow?.renewal_revenue    || 0) + openRenewal,
    })
    const forecastDelta = Math.max(0, (forecast.incentive || 0) - (earned.incentive || 0))
    const openPipeline  = openNew + openRenewal

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

    setState({
      loading: false,
      isZero,
      streak,
      earned,
      forecast: { incentive: forecastDelta, openNew, openRenewal, openPipeline },
      pendingPending: { count: pendingPayments.length, total: pendingTotal },
      rejected,
      wonValue,
      quotesSent,
      quotesSentValue,
      todoCount,
      leaderboard,
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
        <Header
          name={profile?.name || 'there'}
          streak={state.streak}
          hasAlert={!!state.rejected || state.pendingPending.count > 0}
          onLogout={() => { if (window.confirm('Log out of Adflux?')) signOut?.() }}
        />

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

        <ProposedIncentive
          earned={state.earned}
          forecast={state.forecast}
          pending={state.pendingPending}
        />

        <div className="v2-glance-head">This month at a glance</div>
        <div className="v2-kpi-grid">
          <Kpi label="Won Revenue" value={state.wonValue} tone="green" />
          <Kpi
            label="Quotes Sent"
            value={state.quotesSentValue}
            sub={`${state.quotesSent} quote${state.quotesSent === 1 ? '' : 's'}`}
            tone="blue"
          />
          <Kpi label="Pending Approval" count={state.pendingPending.count} tone="yellow" dot={state.pendingPending.count > 0} />
          <Kpi label="Follow-ups Due" count={state.todoCount} tone="rose" dot={state.todoCount > 0} />
        </div>

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
      {streak > 0 ? (
        <div className="v2-streak">
          <Flame size={13} strokeWidth={2.4} />
          {streak}-mo streak
        </div>
      ) : (
        <div className="v2-streak v2-streak--muted">
          <Flame size={13} strokeWidth={2.4} />
          No streak
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

function ProposedIncentive({ earned, forecast, pending }) {
  // Default to Forecast — the forward-looking "if everything closes"
  // number is the one the sales rep acts on every morning. Earned is
  // backward-looking and less motivating as a landing state.
  const [tab, setTab] = useState('forecast')

  const panes = {
    earned: {
      value: earned.incentive,
      sub: earned.slabReached
        ? `Target hit${earned.targetExceeded ? ' · flat bonus unlocked' : ''}. Payouts credit on admin approval.`
        : `Hit your threshold of ₹${earned.threshold.toLocaleString('en-IN')} to unlock incentive payouts.`,
    },
    pending: {
      value: pending.total,
      sub: pending.count === 0
        ? 'Nothing waiting — admin has cleared every payment you punched.'
        : `${pending.count} payment${pending.count > 1 ? 's' : ''} awaiting admin approval.`,
    },
    forecast: {
      value: forecast.incentive,
      sub: forecast.openPipeline === 0
        ? 'Forecast is flat — send quotes to build your open pipeline.'
        : `Incremental on ₹${new Intl.NumberFormat('en-IN').format(forecast.openPipeline)} open pipeline if every non-lost quote closes this month.`,
    },
  }
  const p = panes[tab]
  const isForecast = tab === 'forecast'

  return (
    <div className="v2-incentive">
      <div className="v2-incentive-kicker">
        <span style={{ fontSize: 13, lineHeight: 1 }}>⚡</span> Proposed Incentive
      </div>
      <div className="v2-tabs">
        <button className={`v2-tab ${tab === 'forecast' ? 'v2-tab--active' : ''}`} onClick={() => setTab('forecast')}>Forecast</button>
        <button className={`v2-tab ${tab === 'pending' ? 'v2-tab--active' : ''}`} onClick={() => setTab('pending')}>Pending</button>
        <button className={`v2-tab ${tab === 'earned' ? 'v2-tab--active' : ''}`} onClick={() => setTab('earned')}>Earned</button>
      </div>
      <div className="v2-incentive-big">
        {isForecast && p.value > 0 && '+'}
        <Money value={p.value} big />
      </div>
      <div className="v2-incentive-sub">{p.sub}</div>
    </div>
  )
}

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

function Leaderboard({ rows, meId }) {
  const top3 = rows.slice(0, 3)
  const meInTop3 = top3.some(r => r.id === meId)
  const me = rows.find(r => r.id === meId)
  const myRank = me ? rows.findIndex(r => r.id === meId) + 1 : null

  return (
    <div className="v2-card" style={{ padding: '14px 15px 12px' }}>
      <div className="v2-card-h">
        <div className="v2-card-t">Team leaderboard · {new Date().toLocaleDateString('en-IN', { month: 'short' })}</div>
        {myRank && <div className="v2-badge v2-badge--neutral">Rank #{myRank}</div>}
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
      </div>
      <div className="v2-lb-val"><Money value={row.won} /></div>
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
