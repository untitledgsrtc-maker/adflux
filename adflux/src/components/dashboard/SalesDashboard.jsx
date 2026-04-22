// src/components/dashboard/SalesDashboard.jsx
//
// Arena — Sales Dashboard v2. Mobile-first gamified layout:
//   ┌───────────────────────────────────┐
//   │  Greeting + streak pill + bell    │
//   │  Alerts (rejection / pending)     │
//   │  Gradient PROPOSED INCENTIVE hero │
//   │  2x2 "THIS MONTH AT A GLANCE"     │
//   │  TOP 3 leaderboard (self hilight) │
//   │  TODAY'S MISSIONS (followups+XP)  │
//   │  RECENT ACTIVITY                  │
//   └───────────────────────────────────┘
//
// States handled (per design tokens spec):
//   • Default
//   • Streak Reset  (no streak, gentle nudge in greeting)
//   • New Hire · Day 1 (zero quotes → welcome card + "earn 50 XP" CTA)
//   • Toast / Payment Rejected  (red alert above hero)
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, CheckCircle2, Zap, FileText, AlertCircle, Receipt, Flame, Target, Plus,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  todayISO, thisMonthISO, formatMoneyDisplay, formatMonthYear, initials, formatRelative,
} from '../../utils/formatters'
import { Money } from '../ui/Money'
import { useAuth } from '../../hooks/useAuth'
import { useIncentive } from '../../hooks/useIncentive'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { fetchMyPendingPayments } from '../../hooks/usePayments'
import { RejectionBanner } from './RejectionBanner'
import { PendingApprovalsBanner } from './PendingApprovalsBanner'
import { RenewalReminderBanner } from './RenewalReminderBanner'

function greetingWord() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function SalesDashboard() {
  const { profile } = useAuth()
  const { fetchProfileForUser, fetchSettings } = useIncentive()
  const navigate = useNavigate()

  const [quotes,       setQuotes]       = useState([])
  const [followups,    setFollowups]    = useState([])
  const [incentive,    setIncentive]    = useState(null)
  const [proposed,     setProposed]     = useState(null)
  const [pendingTotal, setPendingTotal] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [leaders,      setLeaders]      = useState([])
  const [streakMonths, setStreakMonths] = useState(0)
  const [loading,      setLoading]      = useState(true)

  const today = todayISO()
  const thisMonth = thisMonthISO()

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    const uid = profile.id

    const [qRes, fRes, settings, profRes, salesRes, pendRes, boardRes] = await Promise.all([
      supabase
        .from('quotes')
        .select('id, quote_number, client_name, subtotal, total_amount, status, revenue_type, campaign_start_date, campaign_end_date, created_at, updated_at')
        .eq('created_by', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('follow_ups')
        .select('id, follow_up_date, note, is_done, quote_id, quotes(quote_number, client_name)')
        .eq('assigned_to', uid)
        .eq('is_done', false)
        .lte('follow_up_date', today)
        .order('follow_up_date', { ascending: true })
        .limit(6),
      fetchSettings(),
      fetchProfileForUser(uid),
      supabase.from('monthly_sales_data').select('*').eq('staff_id', uid).eq('month_year', thisMonth).single(),
      fetchMyPendingPayments(uid),
      supabase
        .from('monthly_sales_data')
        .select('staff_id, new_client_revenue, renewal_revenue, users(name)')
        .eq('month_year', thisMonth),
    ])

    // Pending payments
    const pendingRows = pendRes?.data || []
    setPendingCount(pendingRows.length)
    setPendingTotal(pendingRows.reduce((s, r) => s + (Number(r.amount_received) || 0), 0))

    const allQuotes = qRes.data || []
    setQuotes(allQuotes)
    setFollowups(fRes.data || [])

    const prof = profRes?.data
    const s    = settings || {}

    if (prof) {
      const multiplier   = prof.sales_multiplier   ?? s.default_multiplier ?? 5
      const newRate      = prof.new_client_rate    ?? s.new_client_rate    ?? 0.05
      const renewalRate  = prof.renewal_rate       ?? s.renewal_rate       ?? 0.02
      const flatBonus    = prof.flat_bonus         ?? s.default_flat_bonus ?? s.flat_bonus ?? 10000

      const actual = calculateIncentive({
        monthlySalary:    prof.monthly_salary || 0,
        salesMultiplier:  multiplier,
        newClientRate:    newRate,
        renewalRate:      renewalRate,
        flatBonus:        flatBonus,
        newClientRevenue: salesRes?.data?.new_client_revenue || 0,
        renewalRevenue:   salesRes?.data?.renewal_revenue    || 0,
      })
      setIncentive({ ...actual, profile: prof })

      const openNew     = allQuotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'new')
                                   .reduce((s, q) => s + (q.subtotal || 0), 0)
      const openRenewal = allQuotes.filter(q => !['lost','won'].includes(q.status) && q.revenue_type === 'renewal')
                                   .reduce((s, q) => s + (q.subtotal || 0), 0)

      const proposedCalc = calculateIncentive({
        monthlySalary:    prof.monthly_salary || 0,
        salesMultiplier:  multiplier,
        newClientRate:    newRate,
        renewalRate:      renewalRate,
        flatBonus:        flatBonus,
        newClientRevenue: (salesRes?.data?.new_client_revenue || 0) + openNew,
        renewalRevenue:   (salesRes?.data?.renewal_revenue    || 0) + openRenewal,
      })
      const deltaIncentive = Math.max(0, (proposedCalc.incentive || 0) - (actual.incentive || 0))
      const deltaRevenue   = openNew + openRenewal
      setProposed({
        ...proposedCalc,
        openNew, openRenewal,
        deltaIncentive, deltaRevenue,
        profile: prof,
        rates: { newRate, renewalRate },
      })
    }

    // Leaderboard — top 3 this month, self-row highlighted
    const board = (boardRes?.data || [])
      .map(r => ({
        id:      r.staff_id,
        name:    r.users?.name || 'Unknown',
        revenue: (r.new_client_revenue || 0) + (r.renewal_revenue || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3)
    setLeaders(board)

    // Streak — count consecutive months the user hit their slab.
    // Cheap approximation: if current month has any won revenue, that's
    // at least 1. We query last 6 months and walk backwards while the
    // month has revenue > 0. Real streak logic lives server-side later.
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const from = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`
    const { data: history } = await supabase
      .from('monthly_sales_data')
      .select('month_year, new_client_revenue, renewal_revenue')
      .eq('staff_id', uid)
      .gte('month_year', from)
      .order('month_year', { ascending: false })

    let streak = 0
    const months = (history || []).map(h => ({
      month: h.month_year,
      total: (h.new_client_revenue || 0) + (h.renewal_revenue || 0),
    }))
    for (const m of months) {
      if (m.total > 0) streak++
      else break
    }
    setStreakMonths(streak)

    setLoading(false)
  }

  async function markDone(id, e) {
    e.stopPropagation()
    await supabase.from('follow_ups').update({ is_done: true, done_at: new Date().toISOString() }).eq('id', id)
    setFollowups(prev => prev.filter(f => f.id !== id))
  }

  const wonThisMonthRevenue = useMemo(() => {
    const monthPrefix = thisMonth // YYYY-MM
    return quotes
      .filter(q => q.status === 'won')
      .filter(q => ((q.updated_at || q.created_at || '')).slice(0, 7) === monthPrefix)
      .reduce((s, q) => s + (q.total_amount || 0), 0)
  }, [quotes, thisMonth])

  const quotesSentThisMonth = useMemo(() => {
    const monthPrefix = thisMonth
    return quotes.filter(q => (q.created_at || '').slice(0, 7) === monthPrefix).length
  }, [quotes, thisMonth])

  const isNewHire = quotes.length === 0 && !loading
  const firstName = profile?.name?.split(' ')[0] || 'there'
  const monthLabel = formatMonthYear(thisMonth).split(' ')[0].toUpperCase() // "APRIL"

  const recentActivity = useMemo(() => {
    return quotes.slice(0, 4).map(q => ({
      id: q.id,
      kind: q.status,
      title: q.status === 'won'  ? `Won ${q.client_name}`
           : q.status === 'lost' ? `Lost ${q.client_name}`
           : `Quote sent to ${q.client_name}`,
      quoteNumber: q.quote_number,
      amount: q.total_amount,
      time: q.updated_at || q.created_at,
    }))
  }, [quotes])

  return (
    <div className="arena">

      {/* ── Greeting ────────────────────────────────────────── */}
      <div className="arena-greet">
        <div className="arena-avatar">{initials(profile?.name)}</div>
        <div className="arena-greet-text">
          <div className="arena-greet-eyebrow">{greetingWord()}</div>
          <div className="arena-greet-name">
            {firstName}{isNewHire ? ' — welcome' : ''}
          </div>
        </div>
        {streakMonths >= 2 && (
          <span className="arena-streak" title={`${streakMonths} month streak`}>
            <Flame size={12} />
            {streakMonths}-MO STREAK
          </span>
        )}
        {streakMonths < 2 && !isNewHire && (
          <span className="arena-streak arena-streak--muted" title="Hit your target to start a streak">
            <Flame size={12} />
            NO STREAK
          </span>
        )}
        <button className="arena-bell" aria-label="Notifications">
          <Bell size={16} />
        </button>
      </div>

      {/* ── Alerts ─────────────────────────────────────────── */}
      <RejectionBanner />
      <PendingApprovalsBanner />
      <RenewalReminderBanner userId={profile?.id} scope="mine" />

      {/* ── PROPOSED INCENTIVE hero (gradient) ───────────────
          • If new hire → "earn 50 XP" onboarding framing
          • If no open pipeline → show earned-this-month instead
          • Else → +₹X incremental on ₹Y pipeline (the Arena design)
      */}
      {isNewHire ? (
        <div className="arena-incentive">
          <div className="arena-incentive-header">
            <span className="arena-incentive-eyebrow">
              <Zap size={11} /> Proposed Incentive
            </span>
            <span className="arena-incentive-subtitle">Day 1</span>
          </div>
          <div className="arena-incentive-hero">Send your first quote to earn 50 XP</div>
          <div className="arena-incentive-footnote">
            Hit ₹1.25L this month to unlock incentive payouts and start a streak.
          </div>
        </div>
      ) : proposed && proposed.deltaRevenue > 0 ? (
        <div className="arena-incentive">
          <div className="arena-incentive-header">
            <span className="arena-incentive-eyebrow">
              <Zap size={11} /> Proposed Incentive
            </span>
            <span className="arena-incentive-subtitle">If pipeline closes</span>
          </div>
          <div className="arena-incentive-hero arena-incentive-hero--plus">
            {formatMoneyDisplay(proposed.deltaIncentive)}
          </div>
          <div className="arena-incentive-footnote">
            Incremental on <Money value={proposed.deltaRevenue} /> open pipeline.
            Assumes every non-lost quote closes this month with final payment.
          </div>
          <div className="arena-incentive-breakdown">
            <div>
              <div className="arena-incentive-stat-label">Open New</div>
              <div className="arena-incentive-stat-value"><Money value={proposed.openNew} /></div>
            </div>
            <div>
              <div className="arena-incentive-stat-label">Open Renewal</div>
              <div className="arena-incentive-stat-value"><Money value={proposed.openRenewal} /></div>
            </div>
            <div>
              <div className="arena-incentive-stat-label">Earned so far</div>
              <div className="arena-incentive-stat-value"><Money value={incentive?.incentive || 0} /></div>
            </div>
          </div>
        </div>
      ) : incentive && (
        <div className="arena-incentive">
          <div className="arena-incentive-header">
            <span className="arena-incentive-eyebrow">
              <Target size={11} /> {monthLabel} Incentive
            </span>
            <span className="arena-incentive-subtitle">Earned</span>
          </div>
          <div className="arena-incentive-hero">
            {formatMoneyDisplay(incentive.incentive || 0)}
          </div>
          <div className="arena-incentive-footnote">
            {incentive.slabReached
              ? 'Target hit. Anything you close now is pure upside.'
              : 'Close the gap to unlock your incentive.'}
          </div>
        </div>
      )}

      {/* ── THIS MONTH AT A GLANCE (2x2 mobile / 4-up desktop) ── */}
      <div>
        <div className="arena-section-title">This month at a glance</div>
        <div className="arena-kpi-grid">
          <div className="arena-kpi arena-kpi--accent">
            <div className="arena-kpi-label">Won Revenue</div>
            <div className="arena-kpi-value"><Money value={wonThisMonthRevenue} /></div>
          </div>
          <div className="arena-kpi">
            <div className="arena-kpi-label">Quotes Sent</div>
            <div className="arena-kpi-value">{quotesSentThisMonth}</div>
          </div>
          <div className="arena-kpi">
            <div className="arena-kpi-label">Pending Approval</div>
            <div className="arena-kpi-value">{pendingCount}</div>
          </div>
          <div className={`arena-kpi ${followups.length > 0 ? 'arena-kpi--danger' : ''}`}>
            <div className="arena-kpi-label">
              Follow-ups Due
              {followups.length > 0 && <span className="arena-kpi-dot" aria-hidden />}
            </div>
            <div className="arena-kpi-value">{followups.length}</div>
          </div>
        </div>
      </div>

      <div className="arena-split">
        {/* ── TOP 3 LEADERBOARD ─────────────────────────────── */}
        {leaders.length > 0 && (
          <div>
            <div className="arena-section-title">
              <span>Top {Math.min(3, leaders.length)} · {monthLabel}</span>
            </div>
            <div className="arena-board">
              {leaders.map((row, i) => {
                const isSelf = row.id === profile?.id
                return (
                  <div key={row.id} className={`arena-board-row ${isSelf ? 'arena-board-row--self' : ''}`}>
                    <div className="arena-board-avatar">{initials(row.name)}</div>
                    <div className="arena-board-name">
                      {row.name}
                      {isSelf && <span className="arena-board-you">You</span>}
                    </div>
                    <div className="arena-board-value"><Money value={row.revenue} /></div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── TODAY'S MISSIONS (follow-ups reframed) ────────── */}
        {followups.length > 0 && (
          <div>
            <div className="arena-section-title">
              <span>Today's Missions · {followups.length * 100} XP</span>
            </div>
            <div className="arena-missions">
              {followups.map(item => {
                const isOverdue = item.follow_up_date < today
                return (
                  <div
                    key={item.id}
                    className={`arena-mission ${isOverdue ? 'arena-mission--overdue' : ''}`}
                    onClick={() => navigate(`/quotes/${item.quote_id}`)}
                  >
                    <div className="arena-mission-icon">
                      <Bell size={15} />
                    </div>
                    <div className="arena-mission-body">
                      <div className="arena-mission-title">
                        {item.quotes?.client_name || 'Follow up'}
                      </div>
                      <div className={`arena-mission-meta ${isOverdue ? 'arena-mission-meta--danger' : ''}`}>
                        {isOverdue ? 'Overdue · ' : ''}{item.follow_up_date}
                        {item.note ? ` · ${item.note}` : ''}
                      </div>
                    </div>
                    <button
                      className="arena-mission-xp"
                      onClick={e => markDone(item.id, e)}
                      title="Mark done"
                    >
                      +100 XP
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── RECENT ACTIVITY ──────────────────────────────── */}
      {recentActivity.length > 0 && (
        <div>
          <div className="arena-section-title">Recent Activity</div>
          <div className="arena-activity">
            {recentActivity.map(a => {
              const iconBg =
                a.kind === 'won'  ? { bg: 'var(--success-soft)', fg: 'var(--success)', I: CheckCircle2 } :
                a.kind === 'lost' ? { bg: 'var(--danger-soft)',  fg: 'var(--danger)',  I: AlertCircle } :
                                     { bg: 'var(--accent-soft)', fg: 'var(--accent)',  I: FileText }
              const Icon = iconBg.I
              return (
                <div key={a.id} className="arena-activity-row" onClick={() => navigate(`/quotes/${a.id}`)}>
                  <div className="arena-activity-icon" style={{ background: iconBg.bg, color: iconBg.fg }}>
                    <Icon size={14} />
                  </div>
                  <div className="arena-activity-body">
                    <div className="arena-activity-title">
                      {a.title} <Money value={a.amount} />
                    </div>
                    <div className="arena-activity-sub">{a.quoteNumber}</div>
                  </div>
                  <div className="arena-activity-time">{a.time ? formatRelative(a.time) : ''}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── NEW-HIRE welcome block (empty state) ─────────── */}
      {isNewHire && (
        <div className="arena-welcome">
          <div className="arena-welcome-title">Let's get your first quote out 🚀</div>
          <div className="arena-welcome-msg">
            Tap the <Plus size={12} style={{ verticalAlign: 'middle', color: 'var(--accent)' }} /> below to draft a quote.
            Each quote you send earns XP and counts toward your monthly target.
          </div>
        </div>
      )}
    </div>
  )
}
