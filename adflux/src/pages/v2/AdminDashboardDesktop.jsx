// src/pages/v2/AdminDashboardDesktop.jsx
//
// Desktop admin dashboard (≥860px).
// Route: /dashboard (via DashboardV2 switcher) when role = admin.
//
// Data pulls mirror the legacy admin components one-for-one so numbers
// stay consistent during cutover:
//   quotes                (pipeline, revenue, outstanding, active campaigns)
//   payments              (collected, pending approval queue, activity feed)
//   staff_incentive_profiles + monthly_sales_data + incentive_settings
//                         (top performers, incentive liability)
//
// Styles under .v2d scope in src/styles/v2.css.

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FileText, CheckSquare, BarChart3, Users, Building2,
  Repeat, Gift, Settings, LogOut, Search, Bell, Plus, AlertTriangle,
  CheckCircle2, CreditCard, Send, PenLine, ArrowUpRight,
  Contact2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { calculateIncentive } from '../../utils/incentiveCalc'
import {
  todayISO, initials, formatRelative,
} from '../../utils/formatters'
import { thisMonth } from '../../utils/period'
import { PeriodPicker } from '../../components/v2/PeriodPicker'
import '../../styles/v2.css'

/* ─── Money display: full Indian-format number with lakh/crore grouping.
   Previously truncated to ₹3K / ₹29.7K / ₹1.2Cr etc., which hid the
   real figure from admins reviewing numbers. Now always renders full
   (e.g. ₹29,700 or ₹12,50,00,000) — if a cell ever becomes too narrow
   the container CSS handles overflow, not this formatter. ─── */
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

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24
  return Math.max(0, Math.round((new Date(a) - new Date(b)) / MS))
}

export default function AdminDashboardDesktop() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [state, setState] = useState({ loading: true })
  // Period drives every window-bucketed query below. Defaults to the
  // current month; PeriodPicker lets Admin jump to any past month, a
  // preset range (Last 7, This quarter, …), or a fully custom start/end.
  // The picker returns a normalized period object — see utils/period.js.
  const [period, setPeriod] = useState(() => thisMonth())

  useEffect(() => {
    load(period)
    // Realtime — one channel, covers everything that moves numbers.
    // Re-use the current `period` from closure when a realtime event fires.
    const ch = supabase
      .channel('v2d-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load(period))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => load(period))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  /* eslint-disable-next-line */ }, [period])

  async function load(activePeriod) {
    const today = todayISO()
    const p = activePeriod || thisMonth()
    // All three are consumed below: startIso/endIso for row-level time
    // filters (payments, quote timestamps), monthKeys for anything that
    // looks up pre-aggregated monthly tables (monthly_sales_data).
    const monthStartIso = p.startIso
    const monthEndIso   = p.endIso
    const monthKeys     = p.monthKeys

    const [quotesRes, paymentsAllRes, paymentsApprRes, pendingPayRes, profilesRes, msdRes, usersRes, settingsRes] = await Promise.all([
      supabase.from('quotes')
        .select('id, quote_number, client_name, client_company, status, total_amount, subtotal, revenue_type, created_by, sales_person_name, created_at, updated_at, campaign_start_date, campaign_end_date'),
      supabase.from('payments')
        .select('id, quote_id, amount_received, is_final_payment, approval_status, rejection_reason, payment_date, created_at, recorded_by, quotes(quote_number, client_name, sales_person_name)')
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('payments')
        .select('quote_id, amount_received, payment_date, is_final_payment')
        .eq('approval_status', 'approved'),
      supabase.from('payments')
        .select('id, quote_id, amount_received, created_at, recorded_by, quotes(quote_number, client_name, sales_person_name)')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('staff_incentive_profiles').select('*, users(name)').eq('is_active', true),
      supabase.from('monthly_sales_data').select('staff_id, month_year, new_client_revenue, renewal_revenue'),
      // Everyone with role='sales' — used for the leaderboard so reps with
      // zero wins still show up (and to resolve names without relying on
      // the denormalized sales_person_name column).
      supabase.from('users').select('id, name, role').eq('role', 'sales'),
      supabase.from('incentive_settings').select('*').maybeSingle(),
    ])

    const quotes       = quotesRes.data       || []
    const paymentsAll  = paymentsAllRes.data  || []
    const paymentsApr  = paymentsApprRes.data || []
    const pending      = pendingPayRes.data   || []
    const profiles     = profilesRes.data     || []
    const msd          = msdRes.data          || []
    const salesUsers   = usersRes.data        || []
    const settings     = settingsRes.data     || {}

    // Revenue for the selected month = approved payments whose payment_date
    // falls inside [monthStart, monthEnd). The upper bound matters when
    // viewing a past month — without it, later months' payments would leak
    // into the total.
    const revenue = paymentsApr
      .filter(p => (p.payment_date || '') >= monthStartIso
                && (p.payment_date || '') <  monthEndIso)
      .reduce((s, p) => s + (p.amount_received || 0), 0)

    // Active quotes = not lost
    const activeQuotes = quotes.filter(q => q.status !== 'lost').length

    // Pipeline (sent + negotiating value)
    const pipelineValue = quotes
      .filter(q => ['sent', 'negotiating'].includes(q.status))
      .reduce((s, q) => s + (q.total_amount || 0), 0)

    // Lost revenue — quote value we *failed* to close in the selected
    // period. Uses updated_at to bucket by the month the quote moved to
    // 'lost', falling back to created_at. This mirrors the leaderboard's
    // period logic so a quote lost in Mar doesn't bleed into Apr's number.
    const lostRevenue = quotes.reduce((sum, q) => {
      if (q.status !== 'lost') return sum
      const ts = q.updated_at || q.created_at || ''
      if (ts < monthStartIso || ts >= monthEndIso) return sum
      return sum + (q.total_amount || 0)
    }, 0)

    // Outstanding — same per-quote clamp logic as legacy RevenueSummary
    const outstanding = quotes.reduce((sum, q) => {
      if (q.status === 'lost') return sum
      const paid = paymentsApr.filter(p => p.quote_id === q.id)
                              .reduce((s, p) => s + Number(p.amount_received || 0), 0)
      const committed = q.status === 'won' || paid > 0
      if (!committed) return sum
      return sum + Math.max(0, Number(q.total_amount || 0) - paid)
    }, 0)

    // Pipeline funnel
    const stages = ['draft', 'sent', 'negotiating', 'won', 'lost'].map(s => {
      const qs = quotes.filter(q => q.status === s)
      return {
        status: s,
        count: qs.length,
        value: qs.reduce((sum, q) => sum + (q.total_amount || 0), 0),
      }
    })
    const funnelMax = Math.max(1, ...stages.map(r => r.count))

    // Team leaderboard — won-quote total_amount per sales user for the
    // selected period. Pulled directly from quotes (source of truth)
    // instead of monthly_sales_data, so it's never blank just because
    // the incentive aggregate hasn't been populated for a month.
    //
    // "Won this month" = status='won' AND updated_at inside the window.
    // updated_at is set when a quote transitions to won (updateQuoteStatus
    // writes the whole row). created_at would miss renewals closed later.
    const wonByUser = {}
    quotes.forEach(q => {
      if (q.status !== 'won') return
      const ts = q.updated_at || q.created_at || ''
      if (ts < monthStartIso || ts >= monthEndIso) return
      wonByUser[q.created_by] = (wonByUser[q.created_by] || 0) + (q.total_amount || 0)
    })
    const leaderboard = salesUsers
      .map(u => ({ id: u.id, name: u.name, won: wonByUser[u.id] || 0 }))
      .sort((a, b) => b.won - a.won)
    const lbMax = Math.max(1, ...leaderboard.map(p => p.won))

    // Incentive liability — monthly_sales_data is keyed by YYYY-MM, so
    // for a custom range we iterate every month the period touches and
    // sum each rep's incentive across those months. A "above target"
    // rep is counted once if they hit target in ANY month in range
    // (matches how admins think about it: "who's earning bonuses now?").
    let liability = 0
    let aboveTarget = 0
    for (const p of profiles) {
      let repIncentive = 0
      let everAboveTarget = false
      for (const mk of monthKeys) {
        const md = msd.find(s => s.staff_id === p.user_id && s.month_year === mk) || {}
        const r = calculateIncentive({
          monthlySalary:    p.monthly_salary,
          salesMultiplier:  p.sales_multiplier ?? settings.default_multiplier ?? 5,
          newClientRate:    p.new_client_rate  ?? settings.new_client_rate    ?? 0.05,
          renewalRate:      p.renewal_rate     ?? settings.renewal_rate       ?? 0.02,
          flatBonus:        p.flat_bonus       ?? settings.default_flat_bonus ?? settings.flat_bonus ?? 10000,
          newClientRevenue: md.new_client_revenue || 0,
          renewalRevenue:   md.renewal_revenue    || 0,
        })
        repIncentive += r.incentive
        if (r.targetExceeded) everAboveTarget = true
      }
      liability += repIncentive
      if (everAboveTarget) aboveTarget++
    }

    // Outstanding list (top 8)
    const outstandingList = quotes
      .filter(q => q.status === 'won')
      .map(q => {
        const qPayments = paymentsApr.filter(p => p.quote_id === q.id)
        const paid = qPayments.reduce((s, p) => s + (p.amount_received || 0), 0)
        const final = qPayments.some(p => p.is_final_payment)
        const balance = (q.total_amount || 0) - paid
        return { ...q, paid, balance, final }
      })
      .filter(q => !q.final && q.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6)

    // Active campaigns (won, campaign_end_date >= today) — top 6
    const activeCampaigns = quotes
      .filter(q => q.status === 'won' && q.campaign_end_date && q.campaign_end_date >= today)
      .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
      .slice(0, 6)

    // Recent activity (merged quotes + payments, last 12)
    const quoteEvents = quotes
      .slice()
      .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''))
      .slice(0, 10)
      .map(q => ({
        type: 'quote', id: q.id, ts: q.updated_at || q.created_at,
        label: q.client_name, sub: q.quote_number, status: q.status,
        actor: q.sales_person_name,
      }))

    const payEvents = paymentsAll
      .slice(0, 10)
      .map(p => ({
        type: 'payment', id: p.quote_id, ts: p.created_at,
        label: p.quotes?.client_name || '—',
        sub:   p.quotes?.quote_number || '',
        amount: p.amount_received, final: p.is_final_payment,
        status: p.approval_status,
        actor: p.quotes?.sales_person_name,
      }))

    const activity = [...quoteEvents, ...payEvents]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 10)

    // 6-month revenue trend (approved payments grouped by month_year)
    const trendMonths = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
      trendMonths.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-IN', { month: 'short' }),
        value: 0,
      })
    }
    paymentsApr.forEach(p => {
      const k = (p.payment_date || '').slice(0, 7)
      const m = trendMonths.find(x => x.key === k)
      if (m) m.value += p.amount_received || 0
    })
    const trendMax = Math.max(1, ...trendMonths.map(m => m.value))

    setState({
      loading: false,
      kpi: { revenue, activeQuotes, pipelineValue, outstanding, pending: pending.length, liability, lostRevenue },
      funnel: { stages, max: funnelMax },
      leaderboard, lbMax,
      liability: { total: liability, above: aboveTarget, staff: profiles.length },
      outstandingList, activeCampaigns, activity, trendMonths, trendMax,
      pending,
    })
  }

  if (state.loading) {
    return (
      <div className="v2d">
        <div className="v2d-loading"><div className="v2d-spinner" />Loading dashboard…</div>
      </div>
    )
  }

  const firstName = (profile?.name || 'Admin').split(' ')[0]
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
              <div className="v2d-brand-s">Admin</div>
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
            <button onClick={() => navigate('/pending-approvals')}>
              <CheckSquare size={16} /><span>Approvals</span>
              {state.pending.length > 0 && <span className="v2d-nav-badge">{state.pending.length}</span>}
            </button>

            <div className="v2d-nav-group">Manage</div>
            <button onClick={() => navigate('/cities')}>
              <Building2 size={16} /><span>Cities</span>
            </button>
            <button onClick={() => navigate('/team')}>
              <Users size={16} /><span>Team</span>
            </button>
            <button onClick={() => navigate('/hr')}>
              <Gift size={16} /><span>HR</span>
            </button>
            <button onClick={() => navigate('/renewal-tools')}>
              <Repeat size={16} /><span>Renewal Tools</span>
            </button>
            <button onClick={() => navigate('/incentives')}>
              <BarChart3 size={16} /><span>Incentives</span>
            </button>

            <div className="v2d-nav-spacer" />
            <div className="v2d-nav-foot">
              <button onClick={() => navigate('/incentives')}>
                <Settings size={16} /><span>Settings</span>
              </button>
              <button onClick={() => signOut?.()}>
                <LogOut size={16} /><span>Log out</span>
              </button>
            </div>
          </nav>
        </aside>

        {/* ──── Main column ──── */}
        <main className="v2d-main">
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
                PeriodPicker returns a normalized period object
                (see utils/period.js). Every calc in load() reads
                startIso/endIso and monthKeys off that object. */}
            <PeriodPicker period={period} onChange={setPeriod} />
            <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
              <Plus size={14} strokeWidth={2.6} /> Create Quote
            </button>
            <button className="v2d-bell" aria-label="Notifications" onClick={() => navigate('/pending-approvals')}>
              <Bell size={14} />
              {state.pending.length > 0 && <span className="v2d-bell-dot" />}
            </button>
            <div className="v2d-me">
              <div className="v2d-me-av">{initials(profile?.name || 'Admin')}</div>
              <div>
                <div className="v2d-me-name">{profile?.name || 'Admin'}</div>
                <div className="v2d-me-role">Admin</div>
              </div>
            </div>
          </header>

          <div className="v2d-content">
            {/* Action Queue — demoted from hero to an inline notification.
                Only renders when there's actually something pending. When
                the queue is empty the banner disappears entirely; admins
                don't need a "well done, inbox zero" pat on the back on
                every page load. */}
            {state.pending.length > 0 && (
              <section
                className="v2d-banner"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  background: 'rgba(249, 115, 22, 0.08)',
                  border: '1px solid rgba(249, 115, 22, 0.25)',
                  borderRadius: 12,
                  marginBottom: 16,
                }}
              >
                <AlertTriangle size={18} style={{ color: '#f97316', flex: '0 0 auto' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    ⚡ {state.pending.length} payment{state.pending.length > 1 ? 's' : ''} waiting on approval
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.6))' }}>
                    Approve to credit the sales team.
                  </div>
                </div>
                <button
                  className="v2d-banner-cta"
                  onClick={() => navigate('/pending-approvals')}
                  style={{ flex: '0 0 auto' }}
                >
                  Open queue
                </button>
              </section>
            )}

            {/* Revenue hero — this is the number that actually matters
                every morning, so it gets the gradient slot. Incentive
                liability sits alongside because it's the natural
                counter-weight: every rupee of revenue increases what we
                owe the sales team. */}
            <section className="v2d-hero v2d-hero--action">
              <div className="v2d-hero-head">
                <div className="v2d-hero-kicker">₹ Revenue · {period.label}</div>
                <button className="v2d-banner-cta" onClick={() => navigate('/quotes')}>
                  View quotes
                </button>
              </div>
              {/* All four stats use the same number font-size (32px) so the
                  card reads as a uniform stat strip rather than a headline +
                  supporting numbers. The revenue cell keeps its description
                  below to mark it as the primary metric. Inline styles used
                  intentionally — v2d-hero-big / v2d-hero-stat-v are shared
                  across other heroes (Sales dashboard) and shouldn't shift. */}
              <div
                className="v2d-hero-grid"
                style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
              >
                <div>
                  <div className="v2d-hero-stat-l">Revenue</div>
                  <div
                    className="v2d-hero-big"
                    style={{ fontSize: 32, marginBottom: 6 }}
                  >
                    <Money value={state.kpi.revenue} />
                  </div>
                  <div className="v2d-hero-sub" style={{ maxWidth: 'none' }}>
                    Approved payments collected this period.
                  </div>
                </div>
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Pipeline value</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 32 }}>
                    <Money value={state.kpi.pipelineValue} />
                  </div>
                </div>
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Incentive liability</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 32 }}>
                    <Money value={state.kpi.liability} />
                  </div>
                </div>
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Lost revenue</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 32 }}>
                    <Money value={state.kpi.lostRevenue} />
                  </div>
                </div>
              </div>
            </section>

            {/* KPI row — Revenue and Pipeline value are now in the hero
                above, so this row is trimmed to the two metrics that
                *aren't* already covered up there: Active quotes (count)
                and Outstanding (unpaid won-quote balance). The inline
                grid override forces 2-up on desktop since the base
                .v2d-kpi-row rule is repeat(4, 1fr) which would leave
                two empty gutters with only two children. */}
            <section className="v2d-kpi-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <Kpi label="Active quotes"   count={state.kpi.activeQuotes}  tone="blue" />
              <Kpi label="Outstanding"     value={state.kpi.outstanding}   tone="rose" dot={state.kpi.outstanding > 0} />
            </section>

            {/* Row 2: Revenue trend + Funnel */}
            <section className="v2d-grid-2">
              <RevenueTrendPanel months={state.trendMonths} max={state.trendMax} />
              <FunnelPanel stages={state.funnel.stages} max={state.funnel.max} />
            </section>

            {/* Row 3: Approval queue + Outstanding payments */}
            <section className="v2d-grid-2">
              <ApprovalQueuePanel
                pending={state.pending}
                onOpen={(id) => navigate(`/quotes/${id}`)}
                onAll={() => navigate('/pending-approvals')}
              />
              <OutstandingPanel
                rows={state.outstandingList}
                onOpen={(id) => navigate(`/quotes/${id}`)}
              />
            </section>

            {/* Row 4: Team leaderboard + Incentive liability breakdown.
                Leaderboard is quote-based (source of truth); liability is
                incentive-profile-based. Two different questions, two
                different data sources. */}
            <section className="v2d-grid-2">
              <LeaderboardPanel rows={state.leaderboard} max={state.lbMax} period={period} />
              <LiabilityPanel data={state.liability} />
            </section>

            {/* Row 5: Active campaigns */}
            <ActiveCampaignsPanel rows={state.activeCampaigns} onOpen={(id) => navigate(`/quotes/${id}`)} />

            {/* Row 6: Recent activity */}
            <ActivityPanel items={state.activity} onOpen={(id) => navigate(`/quotes/${id}`)} />

            <div className="v2d-foot">
              v2 · admin · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>

          {/* Mobile bottom nav — CSS hides it above 860px */}
          <nav className="v2d-mnav" style={{ '--cols': 4 }}>
            <div className="v2d-mnav-items">
              <button className={`v2d-mnav-item ${isHome ? 'v2d-mnav-item--active' : ''}`} onClick={() => navigate('/dashboard')}>
                <LayoutDashboard size={16} /> Home
              </button>
              <button className="v2d-mnav-item" onClick={() => navigate('/pending-approvals')}>
                <CheckSquare size={16} /> Approve
                {state.pending.length > 0 && <span className="v2d-mnav-badge">{state.pending.length}</span>}
              </button>
              <button className="v2d-mnav-item" onClick={() => navigate('/quotes')}>
                <FileText size={16} /> Quotes
              </button>
              <button className="v2d-mnav-item" onClick={() => signOut?.()}>
                <LogOut size={16} /> Log out
              </button>
            </div>
          </nav>
        </main>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function Kpi({ label, value, count, tone, dot }) {
  const icon = { green: '₹', blue: '◎', amber: '⏱', rose: '!' }[tone] || '•'
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
      {dot && <div className="v2d-kpi-delta"><span className="up">●</span> needs attention</div>}
    </div>
  )
}

function RevenueTrendPanel({ months, max }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Revenue trend · last 6 months</div>
          <div className="v2d-panel-s">Approved payments per month</div>
        </div>
      </div>
      <div className="v2d-bars">
        {months.map((m, i) => {
          const h = Math.max(6, Math.round((m.value / max) * 170))
          const isCurrent = i === months.length - 1
          return (
            <div key={m.key} className="v2d-bar-col">
              <div className={`v2d-bar ${isCurrent ? 'is-current' : ''}`} style={{ height: h }}>
                <div className="v2d-bar-v"><Money value={m.value} /></div>
              </div>
              <div className="v2d-bar-m">{m.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FunnelPanel({ stages, max }) {
  const colors = {
    draft: 'var(--v2-ink-2)',
    sent: 'var(--v2-blue)',
    negotiating: 'var(--v2-amber)',
    won: 'var(--v2-green)',
    lost: 'var(--v2-rose)',
  }
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Pipeline funnel</div>
          <div className="v2d-panel-s">All-time quote distribution</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stages.map(s => (
          <div key={s.status} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colors[s.status], fontWeight: 600, textTransform: 'capitalize' }}>
              {s.status} <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}>{s.count}</span>
            </div>
            <div style={{ height: 8, background: 'var(--v2-bg-2)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(s.count / max) * 100}%`, height: '100%', background: colors[s.status], borderRadius: 'inherit' }} />
            </div>
            <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 12, color: 'var(--v2-ink-0)', textAlign: 'right' }}>
              <Money value={s.value} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ApprovalQueuePanel({ pending, onOpen, onAll }) {
  const top = pending.slice(0, 5)
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Approval queue</div>
          <div className="v2d-panel-s">Payments waiting for your sign-off</div>
        </div>
        {pending.length > 0 && <button className="v2d-link" onClick={onAll}>Open all</button>}
      </div>
      {top.length === 0 ? (
        <div className="v2d-q-empty">Inbox zero — no pending payments.</div>
      ) : top.map(p => (
        <div key={p.id} className="v2d-q-row" onClick={() => onOpen(p.quote_id)}>
          <div className="v2d-q-ic v2d-q-ic--pay"><CreditCard size={14} /></div>
          <div className="v2d-q-body">
            <div className="v2d-q-t">
              {p.quotes?.client_name || '—'}
              <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}> · {p.quotes?.quote_number || ''}</span>
            </div>
            <div className="v2d-q-s">
              {p.quotes?.sales_person_name || 'Sales'} · {formatRelative(p.created_at)}
            </div>
          </div>
          <div className="v2d-q-amt"><Money value={p.amount_received} /></div>
          <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
        </div>
      ))}
    </div>
  )
}

function OutstandingPanel({ rows, onOpen }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Outstanding payments</div>
          <div className="v2d-panel-s">Won quotes with an unpaid balance</div>
        </div>
        {rows.length > 0 && <div className="v2d-badge v2d-badge--rose">{rows.length}</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2d-q-empty">No outstanding balances.</div>
      ) : rows.map(r => {
        const pct = r.total_amount ? Math.round((r.paid / r.total_amount) * 100) : 0
        return (
          <div key={r.id} className="v2d-q-row" onClick={() => onOpen(r.id)}>
            <div className="v2d-q-ic v2d-q-ic--rose"><AlertTriangle size={14} /></div>
            <div className="v2d-q-body">
              <div className="v2d-q-t">
                {r.client_name}
                {r.client_company && <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}> · {r.client_company}</span>}
              </div>
              <div className="v2d-q-s">{r.quote_number} · {pct}% paid</div>
            </div>
            <div className="v2d-q-amt"><Money value={r.balance} /></div>
            <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
          </div>
        )
      })}
    </div>
  )
}

/* Team leaderboard — admin flavour.
   Shows all sales reps ranked by won-quote revenue for the selected
   period. Unlike the sales-side leaderboard there's no "me" highlighting
   because admin isn't a rep. Reps with zero wins still render so admin
   can see who hasn't closed anything this month. Shows top 8 — long
   tail gets collapsed. */
function LeaderboardPanel({ rows, max, period }) {
  const medals = ['🥇', '🥈', '🥉']
  const top = rows.slice(0, 8)
  // period is the normalized object from utils/period.js; label is
  // already formatted for display ("Apr 2026" or "Apr 10 – 20, 2026").
  const label = period?.label
    || new Date().toLocaleDateString('en-IN', { month: 'short' })
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Team leaderboard · {label}</div>
          <div className="v2d-panel-s">Won-quote revenue per rep this period</div>
        </div>
      </div>
      {top.length === 0 ? (
        <div className="v2d-q-empty">No sales reps on the team yet.</div>
      ) : (
        <div className="v2d-lb">
          {top.map((r, i) => {
            const pct = max > 0 ? Math.round((r.won / max) * 100) : 0
            const rankCls = i === 0 ? 'v2d-lb-rank-1' : i === 1 ? 'v2d-lb-rank-2' : i === 2 ? 'v2d-lb-rank-3' : 'v2d-lb-rank-n'
            return (
              <div key={r.id} className="v2d-lb-row">
                <div className={`v2d-lb-rank ${rankCls}`}>{medals[i] || i + 1}</div>
                <div className="v2d-lb-avatar">{initials(r.name)}</div>
                <div className="v2d-lb-name">{r.name}</div>
                <div className="v2d-lb-val"><Money value={r.won} /></div>
                <div className="v2d-lb-pct">{pct}%</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LiabilityPanel({ data }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Incentive liability</div>
          <div className="v2d-panel-s">Projected payout if the month closed today</div>
        </div>
        <div className="v2d-badge v2d-badge--neutral">{data.above}/{data.staff} above target</div>
      </div>
      <div className="v2d-prog-big"><Money value={data.total} /></div>
      <div className="v2d-prog-meta">
        <span>Active sales staff</span>
        <span style={{ color: 'var(--v2-ink-0)', fontWeight: 700 }}>{data.staff}</span>
      </div>
    </div>
  )
}

function ActiveCampaignsPanel({ rows, onOpen }) {
  const today = todayISO()
  return (
    <section className="v2d-panel" style={{ marginBottom: 22 }}>
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Active campaigns</div>
          <div className="v2d-panel-s">Won quotes with a live campaign window</div>
        </div>
        {rows.length > 0 && <div className="v2d-badge v2d-badge--green">{rows.length} running</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2d-q-empty">No active campaigns. Won quotes with future end dates will appear here.</div>
      ) : (
        <div className="v2d-camp-grid">
          {rows.map(r => {
            const daysLeft = daysBetween(r.campaign_end_date, today)
            const pillCls = daysLeft <= 3 ? 'v2d-camp-pill--end'
                          : daysLeft <= 7 ? 'v2d-camp-pill--soon'
                          : 'v2d-camp-pill--live'
            const pillLabel = daysLeft <= 3 ? 'Ending' : daysLeft <= 7 ? 'Soon' : 'Live'
            // Progress = elapsed / total
            const totalDays = r.campaign_start_date ? daysBetween(r.campaign_end_date, r.campaign_start_date) : 30
            const elapsed = r.campaign_start_date ? Math.max(0, daysBetween(today, r.campaign_start_date)) : 0
            const pct = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0
            return (
              <div key={r.id} className="v2d-camp" onClick={() => onOpen(r.id)} style={{ cursor: 'pointer' }}>
                <div className="v2d-camp-h">
                  <div className="v2d-camp-n" title={r.client_name}>{r.client_name}</div>
                  <span className={`v2d-camp-pill ${pillCls}`}>{pillLabel}</span>
                </div>
                <div className="v2d-camp-s">
                  {r.quote_number}
                  {r.sales_person_name && ` · ${r.sales_person_name}`}
                </div>
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

function ActivityPanel({ items, onOpen }) {
  function getIcon(item) {
    if (item.type === 'payment') {
      return item.final
        ? <CheckCircle2 size={14} style={{ color: 'var(--v2-green)' }} />
        : <CreditCard size={14} style={{ color: 'var(--v2-blue)' }} />
    }
    if (item.status === 'sent')        return <Send size={14} style={{ color: 'var(--v2-blue)' }} />
    if (item.status === 'won')         return <CheckCircle2 size={14} style={{ color: 'var(--v2-green)' }} />
    if (item.status === 'draft')       return <PenLine size={14} style={{ color: 'var(--v2-ink-2)' }} />
    return <FileText size={14} style={{ color: 'var(--v2-ink-2)' }} />
  }

  function getDesc(item) {
    if (item.type === 'payment') {
      return item.final
        ? <>Final payment <b><Money value={item.amount} /></b> received</>
        : <>Payment of <b><Money value={item.amount} /></b> recorded</>
    }
    const map = {
      draft:       'Quote drafted',
      sent:        'Quote sent to client',
      negotiating: 'Quote under negotiation',
      won:         'Quote marked Won 🎉',
      lost:        'Quote marked Lost',
    }
    return map[item.status] || `Status: ${item.status}`
  }

  return (
    <section className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Recent activity</div>
          <div className="v2d-panel-s">Latest quote + payment events</div>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="v2d-q-empty">No activity yet.</div>
      ) : items.map((it, i) => (
        <div key={`${it.type}-${it.id}-${i}`} className="v2d-act-row" onClick={() => onOpen(it.id)} style={{ cursor: 'pointer' }}>
          <div className={`v2d-act-dot ${it.type === 'payment' ? (it.final ? 'green' : 'blue') : it.status === 'won' ? 'green' : it.status === 'lost' ? 'rose' : ''}`} />
          <div>
            <div className="v2d-act-t">{getDesc(it)}</div>
            <div className="v2d-act-s">
              {it.label}
              {it.sub && ` · ${it.sub}`}
              {it.actor && ` · ${it.actor}`}
            </div>
          </div>
          <div className="v2d-act-time">{formatRelative(it.ts)}</div>
        </div>
      ))}
    </section>
  )
}
