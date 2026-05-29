// src/pages/v2/AgencyCommissionAdminV2.jsx
//
// Phase 101.A3 JSX (2026-05-29) — admin commission payout ledger.
//
// Mounted at /admin/agency-commission via RequirePrivileged (admin /
// co_owner). Reads every role='agency' user + their Won quotes +
// approved client payments + agency_commission_payouts; renders a
// SalaryAdminV2-shaped ledger with a Mark-paid CTA that opens
// AgencyCommissionPayoutModal per (agency, quote).
//
// Reads:
//   users                       — agencies (role='agency', is_active=true)
//                                 with agency_commission_percent
//   quotes                      — Won quotes by these agencies
//                                 (created_by IN agencyIds, status='won')
//   payments                    — approved client payments per quote
//                                 (used for Earned vs Payable split)
//   agency_commission_payouts   — Untitled→agency payout history per
//                                 (user_id, quote_id) — Phase 101.A3 SQL
//
// State derivation (per quote):
//   Earned    : won quote, no approved client payment yet, no payout
//               and not fully paid
//   Payable   : won quote, ≥1 approved client payment, payouts < commission
//   Paid      : sum(payouts.amount_paid) >= commission OR any payout
//               row marked is_full_payment=true
//
// CSV export reflects the current filtered rows (Agency / Status /
// Date range). Empty states distinguish "no agency users" from
// "no Won quotes yet" so admin can see exactly which step to take.
//
// Brand: reuses .v2d-* + .staff-table classes + brand tokens. No new
// CSS. Inline grids mirror SalaryAdminV2 Phase 41.4 pattern.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download, Loader2, AlertTriangle, Wallet, IndianRupee,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import AgencyCommissionPayoutModal from '../../components/agency/AgencyCommissionPayoutModal'

const STATUSES = [
  { key: 'all',     label: 'All status' },
  { key: 'Earned',  label: 'Earned' },
  { key: 'Payable', label: 'Payable' },
  { key: 'Paid',    label: 'Paid' },
]

// Inline brand-token chip — same pattern as AgencyEarningsView §28-clean.
const STATE_TONE = {
  Earned:  { bg: 'var(--accent-soft)',  fg: 'var(--accent-fg)', bd: 'var(--accent)' },
  Payable: { bg: 'var(--success-soft)', fg: 'var(--success)',   bd: 'var(--success)' },
  Paid:    { bg: 'var(--success-soft)', fg: 'var(--success)',   bd: 'var(--success)' },
}

function StateChip({ state }) {
  const tone = STATE_TONE[state] || STATE_TONE.Earned
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: tone.bg, color: tone.fg,
      border: `1px solid ${tone.bd}`,
    }}>{state}</span>
  )
}

function fmtINR(n) {
  if (n == null || isNaN(n)) return '—'
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(n)))
}

function istDate(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })
  } catch { return '—' }
}

export default function AgencyCommissionAdminV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = ['admin', 'co_owner'].includes(profile?.role)

  // Defense-in-depth: RequirePrivileged in App.jsx already gates this
  // route; the in-page guard keeps the page safe if the route guard
  // ever drifts (mirrors SalaryAdminV2 line 48-50 pattern).
  useEffect(() => {
    if (profile && !isAdmin) navigate('/dashboard')
  }, [profile, isAdmin, navigate])

  const [agencies,       setAgencies]       = useState([])
  const [quotes,         setQuotes]         = useState([])
  const [paysByQuote,    setPaysByQuote]    = useState({})  // quote_id → last approved payment_date
  const [payoutsByQuote, setPayoutsByQuote] = useState({})  // quote_id → { paid, hasFull, lastPaid }
  const [agencyFilter,   setAgencyFilter]   = useState('all')
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')
  const [payoutTarget,   setPayoutTarget]   = useState(null)  // { agency, quote }

  async function load() {
    if (!isAdmin) return
    setLoading(true); setError('')

    // 1) Agencies
    const { data: agRows, error: agErr } = await supabase
      .from('users')
      .select('id, name, agency_commission_percent')
      .eq('role', 'agency')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (agErr) {
      setError(agErr.message || 'Could not load agency users.')
      setLoading(false)
      return
    }
    setAgencies(agRows || [])

    const agencyIds = (agRows || []).map(a => a.id)
    if (agencyIds.length === 0) {
      setQuotes([])
      setPaysByQuote({})
      setPayoutsByQuote({})
      setLoading(false)
      return
    }

    // 2) Won quotes by these agencies. Same SELECT shape as
    //    AgencyEarningsView Phase 101.A2 to keep Postgrest cache hot.
    const { data: qRows, error: qErr } = await supabase
      .from('quotes')
      .select('id, quote_number, client_name, client_company, subtotal, status, updated_at, created_by')
      .in('created_by', agencyIds)
      .eq('status', 'won')
      .order('updated_at', { ascending: false })
      .limit(2000)
    if (qErr) {
      setError(qErr.message || 'Could not load quotes.')
      setLoading(false)
      return
    }
    setQuotes(qRows || [])

    const quoteIds = (qRows || []).map(q => q.id)
    if (quoteIds.length === 0) {
      setPaysByQuote({})
      setPayoutsByQuote({})
      setLoading(false)
      return
    }

    // 3) Approved client payments + agency payout history. Parallel.
    const [paysRes, payoutsRes] = await Promise.all([
      supabase
        .from('payments')
        .select('quote_id, payment_date, approval_status')
        .in('quote_id', quoteIds)
        .eq('approval_status', 'approved')
        .order('payment_date', { ascending: false }),
      supabase
        .from('agency_commission_payouts')
        .select('user_id, quote_id, amount_paid, is_full_payment, paid_date')
        .in('user_id', agencyIds)
        .order('paid_date', { ascending: false }),
    ])

    // Non-fatal — the page degrades but won't blank.
    if (paysRes.error) {
      console.warn('[AgencyCommissionAdminV2] payments load failed:', paysRes.error.message)
    }
    if (payoutsRes.error) {
      console.warn('[AgencyCommissionAdminV2] payouts load failed:', payoutsRes.error.message)
    }

    const pbq = {}
    for (const p of (paysRes.data || [])) {
      if (!(p.quote_id in pbq)) pbq[p.quote_id] = p.payment_date
    }
    setPaysByQuote(pbq)

    const obq = {}
    for (const p of (payoutsRes.data || [])) {
      const k = p.quote_id
      if (!obq[k]) obq[k] = { paid: 0, hasFull: false, lastPaid: null }
      obq[k].paid += Number(p.amount_paid || 0)
      if (p.is_full_payment) obq[k].hasFull = true
      if (!obq[k].lastPaid || p.paid_date > obq[k].lastPaid) {
        obq[k].lastPaid = p.paid_date
      }
    }
    setPayoutsByQuote(obq)

    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [isAdmin])
  useAutoRefresh(load, { enabled: isAdmin })

  // Per-quote computed rows. Commission = base × user rate.
  const rows = useMemo(() => {
    const byId = {}
    for (const a of agencies) byId[a.id] = a
    return quotes.map(q => {
      const ag = byId[q.created_by] || null
      const pct = Number(ag?.agency_commission_percent ?? 5.00)
      const base = Number(q.subtotal || 0)
      const earned = (base * pct) / 100
      const pay = payoutsByQuote[q.id] || { paid: 0, hasFull: false, lastPaid: null }
      const lastApprovedPay = paysByQuote[q.id] || null
      const balance = Math.max(0, earned - pay.paid)
      // Floating-point safety: paid >= earned - 0.01 also counts as Paid.
      let state
      if (pay.hasFull || pay.paid >= earned - 0.01) state = 'Paid'
      else if (lastApprovedPay)                     state = 'Payable'
      else                                          state = 'Earned'
      return {
        id:           q.id,
        agency_id:    ag?.id || null,
        agency_name:  ag?.name || '—',
        quote_number: q.quote_number || '—',
        client:       q.client_company || q.client_name || '—',
        won_at:       q.updated_at,
        base,
        pct,
        earned,
        paid:         pay.paid,
        balance,
        hasFull:      pay.hasFull,
        last_payout:  pay.lastPaid,
        last_payment: lastApprovedPay,
        state,
      }
    })
  }, [agencies, quotes, paysByQuote, payoutsByQuote])

  // Filter rows on Agency + Status + Date range. CSV export reads
  // filteredRows so the spreadsheet always matches what's on screen.
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (agencyFilter !== 'all' && r.agency_id !== agencyFilter) return false
      if (statusFilter !== 'all' && r.state    !== statusFilter) return false
      if (dateFrom && r.won_at && r.won_at.slice(0, 10) < dateFrom) return false
      if (dateTo   && r.won_at && r.won_at.slice(0, 10) > dateTo)   return false
      return true
    })
  }, [rows, agencyFilter, statusFilter, dateFrom, dateTo])

  const totals = useMemo(() => {
    let earned = 0, paid = 0, outstanding = 0
    for (const r of filteredRows) {
      earned += r.earned
      paid   += r.paid
      outstanding += r.balance
    }
    return { earned, paid, outstanding, count: filteredRows.length }
  }, [filteredRows])

  function exportCSV() {
    const header = [
      'Agency', 'Quote #', 'Client', 'Won date',
      'Base (excl. GST)', 'Rate %', 'Earned',
      'Paid', 'Balance', 'Status', 'Last payout',
    ]
    const lines = filteredRows.map(r => [
      r.agency_name,
      r.quote_number,
      r.client,
      r.won_at ? r.won_at.slice(0, 10) : '',
      r.base,
      r.pct,
      Math.round(r.earned),
      Math.round(r.paid),
      Math.round(r.balance),
      r.state,
      r.last_payout || '',
    ].map(v => String(v).replace(/,/g, ' ')).join(','))
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agency-commission-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (!isAdmin) return null

  return (
    <div className="v2d-salary" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Finance · Agency</div>
          <h1 className="v2d-page-title">Agency Commission Payouts</h1>
          <div className="v2d-page-sub">
            Mark commission payments to agency users per Won quote.
            Multi-installment supported. Base = quote subtotal (GST-excluded)
            × user-level commission rate.
          </div>
        </div>
      </div>

      {/* 4 summary cards — filtered totals so admin sees what's on screen */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <SummaryCard
            label="Total earned"
            value={fmtINR(totals.earned)}
            sub={`${totals.count} quote${totals.count === 1 ? '' : 's'}`}
          />
          <SummaryCard
            label="Already paid"
            value={fmtINR(totals.paid)}
            valueColor="var(--v2-green, #10B981)"
            sub={totals.earned > 0
              ? `${Math.round((totals.paid / totals.earned) * 100)}% of earned`
              : '—'}
          />
          <SummaryCard
            label="Outstanding"
            value={fmtINR(totals.outstanding)}
            valueColor={totals.outstanding > 0 ? 'var(--v2-amber, #F59E0B)' : 'var(--v2-ink-2)'}
            sub={totals.outstanding > 0 ? 'Pending payout' : 'All cleared'}
          />
          <SummaryCard
            label="Agencies on file"
            value={String(agencies.length)}
            sub={agencies.length === 0 ? 'Add via HR' : `${rows.length} Won quote${rows.length === 1 ? '' : 's'} total`}
          />
        </div>
      )}

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 'var(--v2-r-sm, 10px)',
          background: 'rgba(239,68,68,.08)', color: 'var(--v2-rose, #EF4444)',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Filter row — Agency · Status · Date range · Export CSV */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <div style={filtColStyle}>
          <label style={labelStyle}>Agency</label>
          <select
            value={agencyFilter}
            onChange={e => setAgencyFilter(e.target.value)}
            style={{ ...inputStyle, minWidth: 180 }}
          >
            <option value="all">All agencies</option>
            {agencies.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div style={filtColStyle}>
          <label style={labelStyle}>Status</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ ...inputStyle, minWidth: 140 }}
          >
            {STATUSES.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
        <div style={filtColStyle}>
          <label style={labelStyle}>Won from</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={filtColStyle}>
          <label style={labelStyle}>Won to</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={exportCSV}
          disabled={loading || filteredRows.length === 0}
          style={ghostBtnStyle}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {payoutTarget && (
        <AgencyCommissionPayoutModal
          agency={payoutTarget.agency}
          quote={payoutTarget.quote}
          onClose={() => setPayoutTarget(null)}
          onSaved={() => load()}
        />
      )}

      <div className="v2d-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ marginTop: 8 }}>Loading commission ledger…</div>
          </div>
        ) : agencies.length === 0 ? (
          <EmptyCard
            title="No agency users yet"
            sub="Add an agency user via HR → Add Member → role: Agency. Commission rows will appear here when their quotes hit Won."
          />
        ) : rows.length === 0 ? (
          <EmptyCard
            title="No Won quotes yet"
            sub="When an agency user's quote moves to Won, the commission row appears here automatically. Use the Payout button to record installments."
          />
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            No rows match the current Agency / Status / Date filter. Clear filters to see all {rows.length} rows.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="staff-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1400 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
                  <th style={thStyle}>Agency</th>
                  <th style={thStyle}>Quote #</th>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Won</th>
                  <th style={thNum}>Base (excl. GST)</th>
                  <th style={thNum}>Rate</th>
                  <th style={thNum}>Earned</th>
                  <th style={thNum}>Paid</th>
                  <th style={thNum}>Balance</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Last payout</th>
                  <th style={thNum}>Payout</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>
                        {r.agency_name}
                      </div>
                    </td>
                    <td style={tdStyle} className="tabular-nums">{r.quote_number}</td>
                    <td style={tdStyle}>{r.client}</td>
                    <td style={tdStyle} className="tabular-nums">{istDate(r.won_at)}</td>
                    <td style={tdNum}>{fmtINR(r.base)}</td>
                    <td style={tdNum}>{r.pct.toFixed(2)}%</td>
                    <td style={{ ...tdNum, fontWeight: 700, color: 'var(--v2-ink-0)' }}>
                      {fmtINR(r.earned)}
                    </td>
                    <td style={{ ...tdNum, color: r.paid > 0 ? 'var(--success, #10B981)' : 'var(--v2-ink-2)' }}>
                      {r.paid > 0 ? fmtINR(r.paid) : '—'}
                    </td>
                    <td style={{ ...tdNum, color: r.balance > 0 ? 'var(--warning, #F59E0B)' : 'var(--v2-ink-2)' }}>
                      {r.balance > 0 ? fmtINR(r.balance) : '—'}
                    </td>
                    <td style={tdStyle}><StateChip state={r.state} /></td>
                    <td style={tdStyle} className="tabular-nums">{istDate(r.last_payout)}</td>
                    <td style={tdNum}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={() => setPayoutTarget({
                          agency: { id: r.agency_id, name: r.agency_name },
                          quote: {
                            id: r.id,
                            quote_number: r.quote_number,
                            client: r.client,
                            commission_earned: r.earned,
                          },
                        })}
                      >
                        <IndianRupee size={13} style={{ marginRight: 4 }} />
                        {r.state === 'Paid' ? 'View' : 'Payout'}
                      </button>
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--v2-line)', background: 'rgba(255,255,255,.02)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--v2-ink-0)' }}>
                    TOTAL{filteredRows.length !== rows.length ? ` · ${filteredRows.length} of ${rows.length}` : ''}
                  </td>
                  <td style={tdStyle}>—</td>
                  <td style={tdStyle}>—</td>
                  <td style={tdStyle}>—</td>
                  <td style={tdNum}>—</td>
                  <td style={tdNum}>—</td>
                  <td style={{ ...tdNum, fontWeight: 800, color: 'var(--accent, #FFE600)' }}>
                    {fmtINR(totals.earned)}
                  </td>
                  <td style={{ ...tdNum, fontWeight: 700, color: 'var(--success, #10B981)' }}>
                    {totals.paid > 0 ? fmtINR(totals.paid) : '—'}
                  </td>
                  <td style={{ ...tdNum, fontWeight: 700, color: totals.outstanding > 0 ? 'var(--warning, #F59E0B)' : 'var(--v2-ink-2)' }}>
                    {totals.outstanding > 0 ? fmtINR(totals.outstanding) : '—'}
                  </td>
                  <td style={tdStyle}>—</td>
                  <td style={tdStyle}>—</td>
                  <td style={tdNum}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// SummaryCard — same shape as SalaryAdminV2 Phase 41.4 (.inc-summary-card
// spec). Token-only fill + border, no new CSS class.
function SummaryCard({ label, value, sub, valueColor }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '18px 20px',
    }}>
      <div style={{
        fontSize: 12, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        margin: '0 0 8px',
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 700,
        color: valueColor || 'var(--text)',
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function EmptyCard({ title, sub }) {
  return (
    <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
      <div className="v2d-empty-ic" style={{ marginBottom: 12 }}>
        <Wallet size={28} strokeWidth={1.6} />
      </div>
      <div className="v2d-empty-t">{title}</div>
      <div className="v2d-empty-s" style={{
        marginTop: 6, color: 'var(--v2-ink-2)', fontSize: 13,
        maxWidth: 460, margin: '6px auto 0',
      }}>{sub}</div>
    </div>
  )
}

// Inline tokens — same as SalaryAdminV2 Phase 41.4 toolbar.
const labelStyle = {
  display: 'block',
  fontSize: 11, fontWeight: 600,
  color: 'var(--v2-ink-2)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
}
const inputStyle = {
  padding: '9px 12px',
  background: 'var(--v2-bg-2)',
  border: '1px solid var(--v2-line)',
  borderRadius: 'var(--v2-r-sm, 10px)',
  color: 'var(--v2-ink-0)',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  height: 38,
}
const filtColStyle = { display: 'flex', flexDirection: 'column', gap: 4 }
const ghostBtnStyle = {
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '0 12px', height: 36,
  borderRadius: 'var(--v2-r-sm, 10px)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
}
const thStyle = {
  padding: '10px 16px', fontSize: 11, fontWeight: 600,
  whiteSpace: 'nowrap', textTransform: 'uppercase',
  letterSpacing: '0.5px', background: 'var(--surface-2)',
}
const thNum   = { ...thStyle, textAlign: 'right' }
const tdStyle = { padding: '13px 16px', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle' }
const tdNum   = { ...tdStyle, textAlign: 'right' }
