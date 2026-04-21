// src/components/dashboard/SalesDashboard.jsx
// Phase 2 expanded sales dashboard:
// - 5 KPI cards (adds "Total Possible Incentive")
// - Proposed Incentive card: what could I earn if all open quotes closed?
// - Active Campaigns card with countdown
// - Per-quote potential badges in Recent Quotes list
// - Follow-ups Due panel
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCircle2, Plus, CalendarDays, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, todayISO, thisMonthISO } from '../../utils/formatters'
import { useAuth } from '../../hooks/useAuth'
import { useIncentive } from '../../hooks/useIncentive'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { fetchMyPendingPayments } from '../../hooks/usePayments'
import { RenewalReminderBanner } from './RenewalReminderBanner'
import { RejectionBanner } from './RejectionBanner'
import { PendingApprovalsBanner } from './PendingApprovalsBanner'

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24
  return Math.round((new Date(a) - new Date(b)) / MS)
}

// ── Date range helpers ────────────────────────────────────────────
// Same presets as admin dashboard (RevenueSummary.jsx). We use local-time
// date arithmetic rather than UTC ISO slicing because IST-morning users
// were getting yesterday's date and "This Month" was excluding today.
function pad(n) { return String(n).padStart(2, '0') }
function localISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function startOfMonth(d)     { return new Date(d.getFullYear(), d.getMonth(), 1) }
function startOfLastMonth(d) { return new Date(d.getFullYear(), d.getMonth() - 1, 1) }
function endOfLastMonth(d)   { return new Date(d.getFullYear(), d.getMonth(), 0) }
function startOfYear(d)      { return new Date(d.getFullYear(), 0, 1) }

const PRESETS = [
  { key: 'month',      label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'year',       label: 'This Year'  },
  { key: 'all',        label: 'All Time'   },
  { key: 'custom',     label: 'Custom'     },
]

function resolveRange(preset, customFrom, customTo) {
  const now = new Date()
  switch (preset) {
    case 'month':      return { from: localISO(startOfMonth(now)),     to: localISO(now) }
    case 'last_month': return { from: localISO(startOfLastMonth(now)), to: localISO(endOfLastMonth(now)) }
    case 'year':       return { from: localISO(startOfYear(now)),      to: localISO(now) }
    case 'all':        return { from: null,                            to: null }
    case 'custom':     return { from: customFrom || null,              to: customTo || null }
    default:           return { from: localISO(startOfMonth(now)),     to: localISO(now) }
  }
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false
  if (from && dateStr < from) return false
  if (to && dateStr > to)     return false
  return true
}

export function SalesDashboard() {
  const { profile } = useAuth()
  const { fetchProfileForUser, fetchSettings } = useIncentive()
  const navigate = useNavigate()

  const [quotes,       setQuotes]       = useState([])
  const [followups,    setFollowups]    = useState([])
  const [incentive,    setIncentive]    = useState(null)
  const [proposed,     setProposed]     = useState(null)
  const [campaigns,    setCampaigns]    = useState([])
  const [pendingTotal, setPendingTotal] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading,      setLoading]      = useState(true)

  // Period filter — mirrors admin dashboard. Only "Won Revenue" is
  // scoped to the range; the other KPIs represent current pipeline
  // state ("live") and intentionally ignore the filter.
  const [preset, setPreset]         = useState('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const range = useMemo(
    () => resolveRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  )

  // Use local-time helpers — UTC slicing dropped today's rows for
  // morning users (00:00-05:30 IST window).
  const today = todayISO()
  const thisMonth = thisMonthISO()

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    const uid = profile.id

    const [qRes, fRes, settings, profRes, salesRes, pendRes] = await Promise.all([
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
    ])

    // Pending payments — sum of amount_received this user submitted that
    // admin hasn't approved or rejected yet. Kept separate from pipeline
    // (which is quote-level) because this is a cash-flow / approval KPI.
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

      // Current-month actuals
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

      // Proposed: if every non-lost quote closed today + final payment.
      // We show the INCREMENTAL upside (delta vs. current actual) — showing
      // total was misleading because when a user had won everything and
      // nothing was open, the "projected" number equalled the already-earned
      // number, which looked like the won quote was counted twice.
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

    // Active campaigns = won quotes whose campaign window is today or future
    const active = allQuotes
      .filter(q => q.status === 'won' && q.campaign_end_date && q.campaign_end_date >= today)
      .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
    setCampaigns(active)

    setLoading(false)
  }

  async function markDone(id, e) {
    e.stopPropagation()
    await supabase.from('follow_ups').update({ is_done: true, done_at: new Date().toISOString() }).eq('id', id)
    setFollowups(prev => prev.filter(f => f.id !== id))
  }

  const won      = quotes.filter(q => q.status === 'won')
  const active   = quotes.filter(q => !['lost'].includes(q.status))
  const pipeline = active.reduce((s, q) => s + (q.total_amount || 0), 0)
  // Won Revenue is scoped to the filter range — uses updated_at (when the
  // status flipped to won) and falls back to created_at. The other KPIs
  // stay "live" because they represent current pipeline state, which
  // wouldn't make sense scoped to a past period.
  const wonValue = won
    .filter(q => range.from === null && range.to === null
      ? true
      : inRange(((q.updated_at || q.created_at || '')).slice(0, 10), range.from, range.to))
    .reduce((s, q) => s + (q.total_amount || 0), 0)

  const STATUS_COLOR = { won: '#81c784', lost: '#ef9a9a', sent: '#64b5f6', negotiating: '#ffb74d', draft: '#888' }

  // Per-quote potential incentive — only meaningful once slab is reached,
  // so we show marginal rate × subtotal as a rough-guide badge.
  function potentialFor(q) {
    if (!proposed?.profile) return null
    if (['won', 'lost'].includes(q.status)) return null
    const rate = q.revenue_type === 'renewal' ? proposed.rates.renewalRate : proposed.rates.newRate
    return (q.subtotal || 0) * rate
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Payment rejection alerts — shown only when admin has
          rejected a payment the sales user hasn't dismissed yet */}
      <RejectionBanner />

      {/* Pending approval alerts — payments this user punched that are
          still waiting for an admin approve/reject decision */}
      <PendingApprovalsBanner />

      {/* Renewal reminders */}
      <RenewalReminderBanner userId={profile?.id} scope="mine" />

      {/* ── Proposed Incentive HERO ───────────────────────────────
          Lifted ABOVE the KPI row per user request (2026-04): this is
          the most motivational number on the page — "what could I
          earn if everything in my pipeline closes" — and the user
          wants it read first, before the snapshot numbers. The
          trade-off is that the glance-value KPIs now come second,
          but that's an intentional choice to lead with upside.

          Hidden when deltaRevenue === 0 (no open pipeline). Without
          this guard, the hero shows the already-earned incentive as
          if it's "projected", which reads as double-counting the
          won quote. */}
      {proposed && proposed.deltaRevenue > 0 && (
        <div
          className="card"
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderColor: 'rgba(179,157,219,.35)',
            background: 'linear-gradient(135deg, rgba(179,157,219,.10) 0%, rgba(179,157,219,.02) 60%, transparent 100%)',
            borderLeft: '4px solid #b39ddb',
          }}
        >
          <div className="card-h">
            <div className="card-t" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '1rem' }}>
              <Zap size={18} color="#b39ddb" /> Proposed Incentive
              <span style={{ fontSize: '.72rem', fontWeight: 400, color: 'var(--gray)', letterSpacing: 0, textTransform: 'none' }}>
                if pipeline closes
              </span>
            </div>
          </div>

          <div className="sd-hero-grid">
            {/* Hero number */}
            <div className="sd-hero-main">
              <div style={{ fontSize: '.7rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                Projected Incentive
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(1.8rem, 7vw, 2.4rem)',
                lineHeight: 1.05,
                color: '#b39ddb',
                textShadow: '0 0 24px rgba(179,157,219,.25)',
                wordBreak: 'break-word',
              }}>
                +{formatCurrency(proposed.deltaIncentive)}
              </div>
              <div style={{ fontSize: '.7rem', color: 'var(--gray)', marginTop: 4 }}>
                incremental on {formatCurrency(proposed.deltaRevenue)} open pipeline
              </div>
            </div>

            {/* Supporting breakdown */}
            {[
              { label: 'Open New-Client', val: formatCurrency(proposed.openNew) },
              { label: 'Open Renewal',    val: formatCurrency(proposed.openRenewal) },
              { label: 'Open Pipeline', val: formatCurrency(proposed.deltaRevenue), color: 'var(--y)' },
            ].map((f, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                <div style={{ fontSize: '.68rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: f.color || 'var(--wh)', wordBreak: 'break-word' }}>{f.val}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: '.7rem', color: 'var(--gray)', lineHeight: 1.5 }}>
            Projection assumes every non-lost quote closes this month with final payment.
            Actuals depend on payment receipts, not quote status.
          </div>
        </div>
      )}

      {/* Date filter bar — same presets as admin dashboard. Only
          Won Revenue is scoped; snapshot KPIs stay live. */}
      <div className="db-filter-bar">
        <div className="db-filter-presets">
          {PRESETS.map(p => (
            <button
              key={p.key}
              className={`db-filter-chip ${preset === p.key ? 'db-filter-chip--active' : ''}`}
              onClick={() => setPreset(p.key)}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="db-filter-custom">
            <input
              type="date"
              className="db-filter-date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              max={customTo || undefined}
            />
            <span className="db-filter-dash">→</span>
            <input
              type="date"
              className="db-filter-date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              min={customFrom || undefined}
            />
          </div>
        )}
      </div>

      {/* KPI Cards — 6 tiles (moved below hero per user request).
          `scoped: true` means the KPI respects the filter range;
          everything else is rendered with a " · live" suffix so
          the user knows it ignores the date filter. */}
      <div className="sg">
        {[
          { label: 'My Quotes',              val: quotes.length,              color: '#64b5f6' },
          { label: 'Pipeline Value',         val: formatCurrency(pipeline),   color: 'var(--y)' },
          { label: 'Won Revenue',            val: formatCurrency(wonValue),   color: '#81c784', scoped: true },
          {
            label: 'Pending Approval',
            val:   formatCurrency(pendingTotal),
            color: '#ffb74d',
            sub:   pendingCount > 0 ? `${pendingCount} payment${pendingCount === 1 ? '' : 's'}` : null,
          },
          { label: 'Follow-ups Due',         val: followups.length,           color: '#ffb74d' },
          {
            label: 'Total Possible Incentive',
            val: proposed ? formatCurrency(proposed.incentive) : '—',
            color: '#b39ddb',
          },
        ].map((k, i) => (
          <div key={i} className="sc">
            <div className="sc-lbl">
              {k.label}
              {!k.scoped && <span className="db-kpi-scope-note"> · live</span>}
            </div>
            <div className="sc-val" style={{ color: k.color }}>{k.val}</div>
            {k.sub && (
              <div style={{ fontSize: '.68rem', color: 'var(--gray)', marginTop: 2 }}>{k.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* Earned incentive — this-month actuals */}
      {incentive && (
        <div className="card">
          <div className="card-h">
            <div className="card-t">My Incentive — {thisMonth}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 14, marginBottom: 14 }}>
            {[
              { label: 'Total Sales',                                        val: formatCurrency(incentive.total),     color: 'var(--wh)' },
              { label: `Target (${incentive.profile?.sales_multiplier || 5}×)`, val: formatCurrency(incentive.target),   color: 'var(--y)' },
              { label: 'Incentive Earned',                                   val: formatCurrency(incentive.incentive), color: '#81c784' },
              { label: 'Flat Bonus',                                         val: incentive.flatBonus > 0 ? formatCurrency(incentive.flatBonus) : '—', color: 'var(--y)' },
            ].map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: '.68rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: f.color }}>{f.val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '.72rem', color: 'var(--gray)', marginBottom: 5 }}>
            {Math.min(100, Math.round((incentive.progressToTarget || 0) * 100))}% of target reached
          </div>
          <div style={{ height: 6, background: 'var(--brd)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, transition: '.6s',
              width: `${Math.min(100, (incentive.progressToTarget || 0) * 100)}%`,
              background: incentive.targetExceeded ? '#81c784' : incentive.slabReached ? '#ffb74d' : '#ef9a9a',
            }} />
          </div>
        </div>
      )}

      {/* Active Campaigns */}
      <div className="card">
        <div className="card-h">
          <div className="card-t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarDays size={14} color="var(--y)" /> My Active Campaigns
            {campaigns.length > 0 && (
              <span style={{ background: 'rgba(255,152,0,.15)', color: '#ffb74d', borderRadius: 20, padding: '2px 8px', fontSize: '.68rem', fontWeight: 700 }}>
                {campaigns.length}
              </span>
            )}
          </div>
        </div>
        {campaigns.length === 0 ? (
          <div style={{ padding: '14px 0', color: 'var(--gray)', fontSize: '.82rem' }}>
            No active campaigns. Won quotes with campaign dates will appear here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {campaigns.slice(0, 6).map(c => {
              const daysLeft = daysBetween(c.campaign_end_date, today)
              const tone =
                daysLeft <= 3  ? { bg: 'rgba(239,83,80,.1)',  bd: 'rgba(239,83,80,.3)',  fg: '#ef9a9a' } :
                daysLeft <= 7  ? { bg: 'rgba(255,152,0,.08)', bd: 'rgba(255,152,0,.25)', fg: '#ffb74d' } :
                daysLeft <= 30 ? { bg: 'rgba(100,181,246,.07)', bd: 'rgba(100,181,246,.2)', fg: '#64b5f6' } :
                                 { bg: 'rgba(129,199,132,.07)', bd: 'rgba(129,199,132,.2)', fg: '#81c784' }
              return (
                <div
                  key={c.id}
                  onClick={() => navigate(`/quotes/${c.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    background: tone.bg, border: `1px solid ${tone.bd}`,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{c.client_name}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--gray)' }}>
                      {c.quote_number} · {c.campaign_start_date} → {c.campaign_end_date}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '.9rem', color: tone.fg }}>
                      {daysLeft} day{daysLeft === 1 ? '' : 's'} left
                    </div>
                    <div style={{ fontSize: '.7rem', color: 'var(--y)' }}>{formatCurrency(c.total_amount)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {/* Recent Quotes with per-quote potential badges */}
        <div className="card">
          <div className="card-h">
            <div className="card-t">Recent Quotes</div>
            <button className="btn btn-y btn-sm" onClick={() => navigate('/quotes/new')}>
              <Plus size={13} /> New
            </button>
          </div>
          {loading ? <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--gray)' }}>Loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {quotes.slice(0, 6).map(q => {
                const pot = potentialFor(q)
                return (
                  <div
                    key={q.id}
                    onClick={() => navigate(`/quotes/${q.id}`)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer' }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{q.client_name}</div>
                      <div style={{ fontSize: '.72rem', color: STATUS_COLOR[q.status] || 'var(--gray)', marginTop: 2, fontWeight: 600, textTransform: 'capitalize' }}>
                        {q.quote_number} · {q.status}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--y)' }}>{formatCurrency(q.total_amount)}</div>
                      {pot > 0 && (
                        <div style={{ fontSize: '.68rem', color: '#b39ddb', marginTop: 2 }}>
                          +{formatCurrency(pot)} potential
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {quotes.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--gray)', fontSize: '.82rem' }}>No quotes yet</div>}
            </div>
          )}
        </div>

        {/* Follow-ups */}
        <div className="card">
          <div className="card-h">
            <div className="card-t">
              Follow-ups Due
              {followups.length > 0 && (
                <span style={{ background: 'rgba(255,152,0,.2)', color: '#ffb74d', borderRadius: 20, padding: '2px 8px', fontSize: '.68rem', fontWeight: 700, marginLeft: 8 }}>
                  {followups.length}
                </span>
              )}
            </div>
          </div>
          {loading ? <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--gray)' }}>Loading…</div> :
           followups.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--gray)' }}>
              <CheckCircle2 size={28} style={{ opacity: .3, margin: '0 auto 8px' }} />
              <div style={{ fontSize: '.82rem' }}>All caught up!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {followups.map(item => {
                const isOverdue = item.follow_up_date < today
                return (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/quotes/${item.quote_id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                      background: isOverdue ? 'rgba(229,57,53,.08)' : 'rgba(255,255,255,.03)',
                      border: `1px solid ${isOverdue ? 'rgba(229,57,53,.25)' : 'transparent'}`,
                    }}
                  >
                    <Bell size={14} style={{ color: isOverdue ? '#ef9a9a' : '#ffb74d', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.quotes?.client_name}
                      </div>
                      {item.note && <div style={{ fontSize: '.72rem', color: 'var(--gray)', marginTop: 2 }}>{item.note}</div>}
                    </div>
                    <div style={{ fontSize: '.72rem', color: isOverdue ? '#ef9a9a' : 'var(--gray)', flexShrink: 0 }}>{item.follow_up_date}</div>
                    <button
                      onClick={e => markDone(item.id, e)}
                      style={{ background: 'none', border: 'none', color: '#81c784', cursor: 'pointer', padding: 4 }}
                      title="Mark done"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
