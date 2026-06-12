// src/components/agency/AgencyEarningsView.jsx
//
// Phase 101.A2 (2026-05-29) — agency commission ledger.
// Phase 101.A3 (2026-05-29) — Paid state derivation + Paid/Outstanding totals.
//
// Mounted by MyPerformanceV2 when `profile?.role === 'agency'`.
// Replaces the score / variable / TA / salary widgets with a
// Won-quotes ledger keyed off:
//
//   commission_earned = quote.subtotal × users.agency_commission_percent / 100
//
// Backend doctrine (Phase 101.A1):
//   - users.agency_commission_percent (NUMERIC(5,2), default 5.00, range 0..100)
//   - quote.subtotal is the GST-excluded base (per supabase_all_migrations.sql:71)
//   - payments.approval_status = 'approved' is the "Payable" trigger
//     (Phase 1530+ schema migration; confirmed in 10 JS consumers including
//     src/components/incentives/MyPerformance.jsx:79 and src/utils/settlement.js)
//   - quotes has no `won_at` column today — use quotes.updated_at as the
//     Won-date proxy (same convention as TeamDashboardV2 / IncentiveDashboard,
//     and as documented in CLAUDE.md §33 foot-gun #3)
//   - agency_commission_payouts (Phase 101.A3 SQL) — per-quote payout
//     ledger; aggregate paid total + is_full_payment flag drive Paid state
//
// State derivation:
//   - Pending  : quote.status IN (draft, sent, negotiating)
//   - Paid     : quote.status = 'won' AND (sum(payouts) >= commission OR
//                                          any payout.is_full_payment = true)
//   - Payable  : quote.status = 'won' AND ≥1 approved payment AND NOT Paid
//   - Earned   : quote.status = 'won' AND no approved payment AND NOT Paid
//   - Lost     : quote.status = 'lost'
//
// Brand: reuses .v2d-perf / .v2d-page-head / .v2d-panel / .v2d-stat /
// .v2d-tab-pill / .staff-table classes — all verified present in
// src/styles/v2.css + src/styles/incentives.css. Status chips and the
// rate pill use inline brand-token styles (no new CSS, no new tokens).
//
// Privacy: reads ONLY the current rep's own quotes + payments
// (.eq('created_by', profile.id) and .in('quote_id', myIds)). RLS
// guards still bound the SELECT; the .eq filter is for query shape.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Wallet, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency } from '../../utils/formatters'

const PERIODS = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'fy',         label: 'This FY' },
  { key: 'all',        label: 'All time' },
]

// Phase 101.A2 — inline brand-token chip styles. No new CSS class.
// Mirrors the inline-chip pattern used by LeadsV2 (Phase 34Z.76 no-phone
// chip + Phase 100.B Cross-team chip) so visual language stays uniform.
const STATE_TONE = {
  Pending: { bg: 'var(--v2-bg-2)',          fg: 'var(--v2-ink-2)',     bd: 'var(--v2-line)' },
  // Phase 141 — tinted chip: bright accent TEXT (matches Payable/Paid/Lost
  // pattern). Was --accent-fg (navy) → unreadable on the dark soft tint.
  Earned:  { bg: 'var(--accent-soft)',      fg: 'var(--accent)',       bd: 'var(--accent)' },
  Payable: { bg: 'var(--success-soft)',     fg: 'var(--success)',      bd: 'var(--success)' },
  // Phase 101.A3 — Paid uses the same success tone as Payable; chip
  // text reads "Paid" so the rep can tell the cleared rows apart.
  Paid:    { bg: 'var(--success-soft)',     fg: 'var(--success)',      bd: 'var(--success)' },
  Lost:    { bg: 'var(--danger-soft)',      fg: 'var(--danger)',       bd: 'var(--danger)' },
}

function StateChip({ state }) {
  const tone = STATE_TONE[state] || STATE_TONE.Pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: tone.bg,
      color:      tone.fg,
      border:     `1px solid ${tone.bd}`,
    }}>{state}</span>
  )
}

// IST-anchored YYYY-MM bucket. Same Intl-DateTimeFormat pattern as
// src/utils/istDate.js (Phase 47.9 single source of truth).
function istYearMonth(d) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date(d))
  } catch {
    return ''
  }
}

// Indian FY anchor (Apr 1 → Mar 31, per CLAUDE.md §4).
function fyStartDateForToday() {
  const now = new Date()
  const m = now.getMonth() + 1   // 1..12
  const year = m >= 4 ? now.getFullYear() : now.getFullYear() - 1
  return new Date(year, 3, 1)
}

export default function AgencyEarningsView({ refreshKey }) {
  const profile = useAuthStore(s => s.profile)
  const [pct, setPct] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [paymentsByQuote, setPaymentsByQuote] = useState({})
  // Phase 101.A3 — rep's own payout history per quote, used for the
  // Paid state + Paid/Outstanding totals. Aggregated as
  // { quote_id: { paid: number, hasFull: boolean, lastPaid: dateStr } }.
  const [paidByQuote, setPaidByQuote] = useState({})
  const [period, setPeriod] = useState('this_month')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    async function load() {
      setLoading(true); setError('')

      // Two-shot fetch: rep's commission % + their own quotes.
      const [userRes, quotesRes] = await Promise.all([
        supabase
          .from('users')
          .select('agency_commission_percent')
          .eq('id', profile.id)
          .maybeSingle(),
        // Phase 101.A2 hotfix (Phase 101.A2.1) — drop `ref_number`
        // from SELECT. Column does not exist on quotes per Phase 33N
        // (supabase_phase33n_ref_number_fix.sql header), only referenced
        // as defensive `|| q.ref_number` fallback in QuotesV2 list render
        // — JS undefined is harmless there but PostgREST 400s on SELECT.
        supabase
          .from('quotes')
          .select('id, quote_number, client_name, client_company, subtotal, status, updated_at, created_at')
          .eq('created_by', profile.id)
          .order('updated_at', { ascending: false })
          .limit(1000),
      ])
      if (cancelled) return

      if (userRes.error) {
        setError(userRes.error.message || 'Could not load commission rate.')
        setLoading(false)
        return
      }
      if (quotesRes.error) {
        setError(quotesRes.error.message || 'Could not load quotes.')
        setLoading(false)
        return
      }

      setPct(Number(userRes.data?.agency_commission_percent ?? 5.00))
      const list = quotesRes.data || []
      setQuotes(list)

      // Third + fourth shot in parallel: approved client payments
      // (Payable trigger) + own commission payouts (Phase 101.A3
      // Paid state). Skip entirely if no quotes.
      if (list.length === 0) {
        setPaymentsByQuote({})
        setPaidByQuote({})
        setLoading(false)
        return
      }

      const ids = list.map(q => q.id)
      const [paysRes, payoutsRes] = await Promise.all([
        supabase
          .from('payments')
          .select('quote_id, payment_date, approval_status')
          .in('quote_id', ids)
          .eq('approval_status', 'approved')
          .order('payment_date', { ascending: false }),
        // RLS doctrine: acp_self_read scopes by auth.uid(); the
        // explicit user_id eq is for query shape so Postgrest plans
        // a tight index hit on idx_acp_user_quote.
        supabase
          .from('agency_commission_payouts')
          .select('quote_id, amount_paid, is_full_payment, paid_date')
          .eq('user_id', profile.id)
          .in('quote_id', ids)
          .order('paid_date', { ascending: false }),
      ])
      if (cancelled) return

      if (paysRes.error) {
        // Non-fatal — Payable chip just won't fire. Surface as warning.
        console.warn('[AgencyEarningsView] payments load failed:', paysRes.error.message)
        setPaymentsByQuote({})
      } else {
        const byQ = {}
        for (const p of (paysRes.data || [])) {
          if (!(p.quote_id in byQ)) byQ[p.quote_id] = p.payment_date
        }
        setPaymentsByQuote(byQ)
      }

      if (payoutsRes.error) {
        // Non-fatal — Paid chip just won't fire; rows that are fully
        // paid keep showing Payable/Earned. Surface as warning.
        console.warn('[AgencyEarningsView] payouts load failed:', payoutsRes.error.message)
        setPaidByQuote({})
      } else {
        const pbq = {}
        for (const p of (payoutsRes.data || [])) {
          const k = p.quote_id
          if (!pbq[k]) pbq[k] = { paid: 0, hasFull: false, lastPaid: null }
          pbq[k].paid += Number(p.amount_paid || 0)
          if (p.is_full_payment) pbq[k].hasFull = true
          if (!pbq[k].lastPaid || p.paid_date > pbq[k].lastPaid) {
            pbq[k].lastPaid = p.paid_date
          }
        }
        setPaidByQuote(pbq)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [profile?.id, refreshKey])

  // Period filter + per-quote state derivation.
  const rows = useMemo(() => {
    const now = new Date()
    const thisMonth = istYearMonth(now)
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonth = istYearMonth(lastMonthDate)
    const fyStart = fyStartDateForToday()

    return quotes
      .map(q => {
        const baseAmt = Number(q.subtotal || 0)
        const commission = (baseAmt * (pct || 0)) / 100
        const wonAt = q.status === 'won' ? q.updated_at : null
        const lastPay = paymentsByQuote[q.id] || null
        // Phase 101.A3 — payout aggregate for Paid state derivation.
        const payout = paidByQuote[q.id] || { paid: 0, hasFull: false, lastPaid: null }
        // Float-safety: paid >= commission - 0.01 also counts as Paid.
        const isPaid = q.status === 'won' && (payout.hasFull || payout.paid >= commission - 0.01)
        let state
        if (q.status === 'lost')                                       state = 'Lost'
        else if (['draft', 'sent', 'negotiating'].includes(q.status))  state = 'Pending'
        else if (q.status === 'won' && isPaid)                         state = 'Paid'
        else if (q.status === 'won' && lastPay)                        state = 'Payable'
        else if (q.status === 'won')                                   state = 'Earned'
        else                                                           state = 'Pending'
        return {
          id:           q.id,
          quote_number: q.quote_number || '—',
          client:       q.client_company || q.client_name || '—',
          base:         baseAmt,
          pct,
          commission,
          paid_amount:  payout.paid,
          state,
          won_at:       wonAt,
          last_payment: lastPay,
          last_payout:  payout.lastPaid,
        }
      })
      .filter(r => {
        if (period === 'all') return true
        const anchor = r.won_at || r.last_payment
        if (!anchor) return false
        const ym = istYearMonth(anchor)
        if (period === 'this_month') return ym === thisMonth
        if (period === 'last_month') return ym === lastMonth
        if (period === 'fy')         return new Date(anchor) >= fyStart
        return true
      })
  }, [quotes, paymentsByQuote, paidByQuote, pct, period])

  const totals = useMemo(() => {
    let earned = 0, payable = 0, pending = 0
    let earnedCnt = 0, payableCnt = 0, paidCnt = 0
    // Phase 101.A3 — Paid total = sum of payouts actually received.
    // Outstanding = commission earned minus payouts, summed only on
    // Won rows (Earned / Payable / Paid). Pending + Lost rows excluded.
    let totalPaid = 0, outstanding = 0
    for (const r of rows) {
      if (r.state === 'Earned')  { earned  += r.commission; earnedCnt++ }
      if (r.state === 'Payable') { payable += r.commission; payableCnt++ }
      if (r.state === 'Paid')    { paidCnt++ }
      if (r.state === 'Pending') { pending += r.commission }
      if (['Earned', 'Payable', 'Paid'].includes(r.state)) {
        totalPaid   += Number(r.paid_amount || 0)
        outstanding += Math.max(0, r.commission - Number(r.paid_amount || 0))
      }
    }
    return {
      earned, payable, pending,
      earnedCnt, payableCnt, paidCnt,
      totalPaid, outstanding,
    }
  }, [rows])

  if (loading) {
    return (
      <div className="v2d-perf">
        <div className="v2d-loading">
          <div className="v2d-spinner" />
          Loading earnings…
        </div>
      </div>
    )
  }

  return (
    <div className="v2d-perf">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Your numbers</div>
          <h1 className="v2d-page-title">My Earnings</h1>
          <div className="v2d-page-sub">
            Commission on Won quotes — paid as accounting expense.
            Base is quote subtotal (GST-excluded).
          </div>
        </div>
        {/* Commission rate pill — inline brand-token style; no new CSS. */}
        {pct != null && (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: 13, fontWeight: 700,
            background: 'var(--accent-soft)',
            // Phase 141 — bright accent text (was --accent-fg navy →
            // unreadable on the soft tint over the dark page).
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
          }}>
            <Wallet size={14} style={{ marginRight: 6 }} />
            {pct.toFixed(2)}% commission
          </span>
        )}
      </div>

      {error && (
        <div className="v2d-panel" style={{
          marginBottom: 14,
          padding: '12px 16px',
          color: 'var(--danger)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13,
        }}>
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* 6 KPI tiles — Phase 101.A3 adds Paid + Outstanding. Replaces
          .v2d-hr-stats (fixed 4-col) with an inline auto-fit grid so the
          extra tiles don't leave dead slots on the second row. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10, marginBottom: 18,
      }}>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Earned</div>
          <div className="v2d-stat-v v2d-stat-v--accent">{formatCurrency(totals.earned)}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Payable</div>
          <div className="v2d-stat-v v2d-stat-v--ok">{formatCurrency(totals.payable)}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Paid</div>
          <div className="v2d-stat-v v2d-stat-v--ok">{formatCurrency(totals.totalPaid)}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Outstanding</div>
          <div className="v2d-stat-v v2d-stat-v--muted">{formatCurrency(totals.outstanding)}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Pending</div>
          <div className="v2d-stat-v v2d-stat-v--muted">{formatCurrency(totals.pending)}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Won quotes</div>
          <div className="v2d-stat-v">{totals.earnedCnt + totals.payableCnt + totals.paidCnt}</div>
        </div>
      </div>

      {/* Period pills */}
      <div className="v2d-hr-toolbar" style={{ marginTop: 14, marginBottom: 14 }}>
        <div className="v2d-tab-row">
          {PERIODS.map(p => (
            <button
              key={p.key}
              className={`v2d-tab-pill${period === p.key ? ' is-active' : ''}`}
              onClick={() => setPeriod(p.key)}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ledger — reuse .staff-table brand class */}
      {rows.length === 0 ? (
        <div className="v2d-panel" style={{
          padding: 32, textAlign: 'center',
        }}>
          <div style={{
            fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0)',
          }}>
            No quotes in this period
          </div>
          <div style={{
            fontSize: 12, color: 'var(--v2-ink-2)', marginTop: 6,
          }}>
            Commission appears here once you create quotes and they move to Won.
          </div>
        </div>
      ) : (
        <div className="v2d-panel" style={{ overflow: 'auto', padding: 0 }}>
          <table className="staff-table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Client</th>
                <th>Won date</th>
                <th style={{ textAlign: 'right' }}>Base (excl. GST)</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Commission</th>
                {/* Phase 101.A3 — Paid column */}
                <th style={{ textAlign: 'right' }}>Paid</th>
                <th>Status</th>
                <th>Last payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="tabular-nums">{r.quote_number}</td>
                  <td>{r.client}</td>
                  <td className="tabular-nums">
                    {r.won_at
                      ? new Date(r.won_at).toLocaleDateString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          timeZone: 'Asia/Kolkata',
                        })
                      : '—'}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    {formatCurrency(r.base)}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    {(r.pct ?? 0).toFixed(2)}%
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: 700 }}>
                    {formatCurrency(r.commission)}
                  </td>
                  {/* Phase 101.A3 — Paid column. Success tint when any
                      payout is logged so the rep sees the cleared rows. */}
                  <td className="tabular-nums" style={{
                    textAlign: 'right',
                    color: r.paid_amount > 0 ? 'var(--success)' : 'var(--v2-ink-2)',
                    fontWeight: r.paid_amount > 0 ? 600 : 400,
                  }}>
                    {r.paid_amount > 0 ? formatCurrency(r.paid_amount) : '—'}
                  </td>
                  <td><StateChip state={r.state} /></td>
                  <td className="tabular-nums">
                    {r.last_payment
                      ? new Date(r.last_payment).toLocaleDateString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          timeZone: 'Asia/Kolkata',
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
