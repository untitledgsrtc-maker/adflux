// src/components/dashboard/RevenueSummary.jsx
//
// Phase 3A additions:
//   - Date range filter (This Month / Last Month / This Year / All / Custom)
//     scopes the "Revenue" and "Lost Revenue" KPIs.
//   - New KPI: Total Lost Revenue (sum of quote totals marked lost in range).
//   - New KPI: Total Possible Incentive (company-wide projected incentive
//     assuming every open quote closes this month with final payment).
//
// The three "snapshot" KPIs — Active Quotes, Pipeline Value, Outstanding —
// intentionally ignore the date filter because they represent current
// state, not historical activity.

import { useEffect, useState, useCallback, useMemo } from 'react'
import { TrendingUp, FileText, IndianRupee, Clock, XCircle, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCompact } from '../../utils/formatters'
import { calculateIncentive } from '../../utils/incentiveCalc'

// ── Date range helpers ─────────────────────────────────────────────
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function startOfLastMonth(d) { return new Date(d.getFullYear(), d.getMonth() - 1, 1) }
function endOfLastMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 0) }
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1) }
function iso(d) { return d.toISOString().slice(0, 10) }

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
    case 'month':      return { from: iso(startOfMonth(now)),     to: iso(now) }
    case 'last_month': return { from: iso(startOfLastMonth(now)), to: iso(endOfLastMonth(now)) }
    case 'year':       return { from: iso(startOfYear(now)),      to: iso(now) }
    case 'all':        return { from: null,                       to: null }
    case 'custom':     return { from: customFrom || null,         to: customTo || null }
    default:           return { from: iso(startOfMonth(now)),     to: iso(now) }
  }
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false
  if (from && dateStr < from) return false
  if (to && dateStr > to) return false
  return true
}

export function RevenueSummary() {
  const [preset, setPreset]         = useState('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')

  const [raw, setRaw]       = useState(null) // all loaded data, range-agnostic
  const [loading, setLoading] = useState(true)

  const range = useMemo(
    () => resolveRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  )

  const load = useCallback(async () => {
    const [quotesRes, paymentsRes, profilesRes, msdRes, settingsRes] = await Promise.all([
      supabase.from('quotes').select('id, status, total_amount, subtotal, revenue_type, created_by, updated_at, created_at, campaign_end_date'),
      supabase.from('payments').select('amount_received, payment_date, is_final_payment'),
      supabase.from('staff_incentive_profiles').select('*').eq('is_active', true),
      supabase.from('monthly_sales_data').select('staff_id, month_year, new_client_revenue, renewal_revenue'),
      supabase.from('incentive_settings').select('*').limit(1).maybeSingle(),
    ])

    setRaw({
      quotes:   quotesRes.data   || [],
      payments: paymentsRes.data || [],
      profiles: profilesRes.data || [],
      msd:      msdRes.data      || [],
      settings: settingsRes.data || {},
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    load()

    // Realtime subscriptions
    const channel = supabase
      .channel('dashboard-revenue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => load())
      .subscribe()

    const onFocus = () => load()
    window.addEventListener('focus', onFocus)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  // ── Derived KPIs ─────────────────────────────────────────────────
  const data = useMemo(() => {
    if (!raw) return null
    const { quotes, payments, profiles, msd, settings } = raw
    const { from, to } = range

    // Revenue: payments whose payment_date is in range
    const revenue = payments
      .filter(p => inRange(p.payment_date, from, to))
      .reduce((s, p) => s + (p.amount_received || 0), 0)

    // Lost revenue: quotes with status='lost' whose updated_at falls in range
    // (updated_at is when the status flipped). Falls back to created_at if
    // updated_at is missing.
    const lostRevenue = quotes
      .filter(q => q.status === 'lost')
      .filter(q => inRange((q.updated_at || q.created_at || '').slice(0, 10), from, to))
      .reduce((s, q) => s + (q.total_amount || 0), 0)

    // Snapshot KPIs (range-agnostic)
    const activeQuotes = quotes.filter(q => !['lost'].includes(q.status)).length
    const pipelineValue = quotes
      .filter(q => ['sent', 'negotiating'].includes(q.status))
      .reduce((s, q) => s + (q.total_amount || 0), 0)

    const totalCollected = payments.reduce((s, p) => s + (p.amount_received || 0), 0)
    const wonTotal = quotes
      .filter(q => q.status === 'won')
      .reduce((s, q) => s + (q.total_amount || 0), 0)
    const outstanding = Math.max(0, wonTotal - totalCollected)

    // Total Possible Incentive (company-wide projection).
    // For each active sales profile, compute incentive assuming current
    // month's actuals + all their open (non-lost, non-won) quotes close.
    const thisMonth = new Date().toISOString().slice(0, 7)
    const possibleTotal = profiles.reduce((sum, prof) => {
      const openNew = quotes
        .filter(q => q.created_by === prof.user_id && !['lost', 'won'].includes(q.status) && q.revenue_type === 'new')
        .reduce((s, q) => s + (q.subtotal || 0), 0)
      const openRenewal = quotes
        .filter(q => q.created_by === prof.user_id && !['lost', 'won'].includes(q.status) && q.revenue_type === 'renewal')
        .reduce((s, q) => s + (q.subtotal || 0), 0)
      const salesRow = msd.find(r => r.staff_id === prof.user_id && r.month_year === thisMonth) || {}

      const multiplier  = prof.sales_multiplier ?? settings.default_multiplier ?? 5
      const newRate     = prof.new_client_rate  ?? settings.new_client_rate    ?? 0.05
      const renewalRate = prof.renewal_rate     ?? settings.renewal_rate       ?? 0.02
      const flatBonus   = prof.flat_bonus       ?? settings.default_flat_bonus ?? 10000

      const { incentive } = calculateIncentive({
        monthlySalary:    prof.monthly_salary || 0,
        salesMultiplier:  multiplier,
        newClientRate:    newRate,
        renewalRate:      renewalRate,
        flatBonus:        flatBonus,
        newClientRevenue: (salesRow.new_client_revenue || 0) + openNew,
        renewalRevenue:   (salesRow.renewal_revenue    || 0) + openRenewal,
      })
      return sum + (incentive || 0)
    }, 0)

    return { revenue, lostRevenue, activeQuotes, pipelineValue, outstanding, possibleTotal }
  }, [raw, range])

  const cards = data ? [
    { label: 'Revenue',               value: formatCompact(data.revenue),        icon: IndianRupee, color: 'var(--success)',  bg: 'var(--success-soft)',  scoped: true  },
    { label: 'Lost Revenue',          value: formatCompact(data.lostRevenue),    icon: XCircle,     color: 'var(--danger)',   bg: 'var(--danger-soft)',   scoped: true  },
    { label: 'Active Quotes',         value: data.activeQuotes,                  icon: FileText,    color: 'var(--blue)',     bg: 'var(--blue-soft)',     scoped: false },
    { label: 'Pipeline Value',        value: formatCompact(data.pipelineValue),  icon: TrendingUp,  color: 'var(--accent-fg)', bg: 'var(--accent-soft)',  scoped: false },
    { label: 'Outstanding',           value: formatCompact(data.outstanding),    icon: Clock,       color: 'var(--warning)',  bg: 'var(--warning-soft)',  scoped: false },
    { label: 'Total Possible Incentive', value: formatCompact(data.possibleTotal), icon: Zap,       color: '#b39ddb',         bg: 'rgba(179,157,219,.12)', scoped: false },
  ] : []

  return (
    <div className="db-revenue-block">
      {/* Date filter bar */}
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

      {/* KPI grid */}
      <div className="db-kpi-grid">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="db-kpi-card db-kpi-card--loading" />
          ))
        ) : (
          cards.map(card => {
            const Icon = card.icon
            return (
              <div key={card.label} className="db-kpi-card">
                <div
                  className="db-kpi-icon"
                  style={{ background: card.bg, color: card.color }}
                >
                  <Icon size={18} />
                </div>
                <div className="db-kpi-body">
                  <p className="db-kpi-label">
                    {card.label}
                    {!card.scoped && <span className="db-kpi-scope-note"> · live</span>}
                  </p>
                  <p className="db-kpi-value">{card.value}</p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
