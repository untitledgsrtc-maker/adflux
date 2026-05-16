// src/pages/v2/SalaryAdminV2.jsx
//
// Phase 36 — admin Salary Sheet.
//
// Owner directive (16 May 2026): Mehulbhai/Diya need a per-rep monthly
// salary breakdown that auto-computes leave deduction so they can
// upload exact rupees per rep instead of one lump sum.
//
// Reads from supabase_phase36_salary_policy.sql RPC:
//   compute_monthly_salary(user_id, year, month) → jsonb with
//   base + variable + incentive + ta_da + leave breakdown + NET.
//
// Layout:
//   Month picker (defaults to current IST month)
//   Per-rep table:
//     Name · Base · Variable · Incentive · TA · Leave (paid/unpaid)
//     · Deduction · NET PAYABLE
//   CSV export button (Mehulbhai's monthly upload).
//
// Role gate: admin / co_owner only. Reps cannot see /salary.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2, AlertTriangle, Wallet, IndianRupee } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { SalaryPayoutModal } from '../../components/incentives/SalaryPayoutModal'

function fmtINR(n) {
  if (n == null || isNaN(n)) return '—'
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(n)))
}

function currentMonthYM() {
  // IST-anchored current month in YYYY-MM for the input[type=month].
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000)
  const y = ist.getFullYear()
  const m = String(ist.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Phase 38 — `embedded` prop suppresses own page-head when mounted
// inside PeopleV2 (which renders the shared "People" head once). When
// embedded, the month picker + CSV export move to a toolbar row above
// the table.
export default function SalaryAdminV2({ embedded = false }) {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = ['admin', 'co_owner'].includes(profile?.role)

  useEffect(() => {
    if (profile && !isAdmin) navigate('/work')
  }, [profile, isAdmin, navigate])

  const [month, setMonth]   = useState(currentMonthYM())
  const [rows,  setRows]    = useState([])    // [{ user, salary, ... }]
  const [paidMap, setPaidMap] = useState({})  // { user_id: { paid, hasFull } } from salary_payouts
  const [policy, setPolicy] = useState(null)
  const [err,   setErr]     = useState('')
  const [loading, setLoading] = useState(true)
  const [payoutTarget, setPayoutTarget] = useState(null) // { user_id, name, computed }

  async function load() {
    setLoading(true); setErr('')
    const [y, m] = month.split('-').map(n => parseInt(n, 10))
    if (!y || !m) { setErr('Pick a month.'); setLoading(false); return }

    // Pull active reps + policy + this month's salary_payouts in parallel.
    const [usersRes, polRes, payRes] = await Promise.all([
      supabase.from('users')
        .select('id, name, role')
        .in('role', ['sales', 'agency', 'telecaller', 'admin', 'co_owner'])
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase.from('salary_policy')
        .select('*')
        .order('effective_from', { ascending: false })
        .limit(1),
      supabase.from('salary_payouts')
        .select('user_id, amount_paid, is_full_payment')
        .eq('month_year', month),
    ])
    if (usersRes.error) { setErr(usersRes.error.message); setLoading(false); return }
    setPolicy(polRes.data?.[0] || null)

    // Roll up payouts by user_id.
    const pm = {}
    for (const p of (payRes.data || [])) {
      const k = p.user_id
      if (!pm[k]) pm[k] = { paid: 0, hasFull: false }
      pm[k].paid += Number(p.amount_paid || 0)
      if (p.is_full_payment) pm[k].hasFull = true
    }
    setPaidMap(pm)

    // RPC per rep. Cheap (24 reps × 1 RPC). Sequential keeps Supabase
    // load light + avoids RLS bursts.
    const out = []
    for (const u of (usersRes.data || [])) {
      const { data, error: rpcErr } = await supabase.rpc('compute_monthly_salary', {
        p_user_id: u.id, p_year: y, p_month: m,
      })
      if (rpcErr) {
        out.push({ user: u, error: rpcErr.message })
      } else {
        out.push({ user: u, ...((data && typeof data === 'object') ? data : {}) })
      }
    }
    setRows(out)
    setLoading(false)
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin, month]) // eslint-disable-line
  useAutoRefresh(load, { enabled: isAdmin })

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.base       += Number(r.base || 0)
      acc.variable   += Number(r.variable || 0)
      acc.incentive  += Number(r.incentive || 0)
      acc.ta_da      += Number(r.ta_da || 0)
      acc.deduction  += Number(r.unpaid_deduction || 0)
      acc.net        += Number(r.net_payable || 0)
      return acc
    }, { base: 0, variable: 0, incentive: 0, ta_da: 0, deduction: 0, net: 0 })
  }, [rows])

  function exportCSV() {
    const header = [
      'Name', 'Role', 'Base', 'Variable', 'Score %',
      'Incentive', 'TA/DA',
      'Leave Total', 'Leave Paid', 'Leave Unpaid',
      'Unpaid Deduction', 'NET PAYABLE',
    ]
    const lines = rows.map(r => [
      r.user?.name || '',
      r.user?.role || '',
      r.base || 0,
      r.variable || 0,
      r.score_pct || 0,
      r.incentive || 0,
      r.ta_da || 0,
      r.leave_days_total || 0,
      r.leave_days_paid || 0,
      r.leave_days_unpaid || 0,
      r.unpaid_deduction || 0,
      r.net_payable || 0,
    ].map(v => String(v).replace(/,/g, ' ')).join(','))
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `salary-${month}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (!isAdmin) return null

  return (
    <div className="v2d-salary" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {embedded ? (
        // Phase 38 — toolbar row when inside PeopleV2.
        <div style={{ display: 'flex', alignItems: 'end', gap: 8, justifyContent: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Month</label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button
            type="button"
            onClick={exportCSV}
            disabled={loading || rows.length === 0}
            className="v2d-cta"
            style={{ height: 38 }}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      ) : (
        <div className="v2d-page-head">
          <div>
            <div className="v2d-page-kicker">HR · Payroll</div>
            <h1 className="v2d-page-title">Salary Sheet</h1>
            <div className="v2d-page-sub">
              Per-rep monthly breakdown: base + variable + incentive + TA – leave
              deduction. Policy: {policy ? `${policy.paid_quota_days} paid days/year · base ÷ ${policy.unpaid_divisor} per unpaid day` : 'loading…'}.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
            <div>
              <label style={labelStyle}>Month</label>
              <input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
                style={inputStyle}
              />
            </div>
            <button
              type="button"
              onClick={exportCSV}
              disabled={loading || rows.length === 0}
              className="v2d-cta"
              style={{ height: 38 }}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
      )}

      {/* Phase 38 — 4 summary cards. Matches owner-approved
          people_module_mockup.html. Reuses totals + paidMap already
          computed; no extra query. */}
      {!loading && rows.length > 0 && (() => {
        const totalPaid = Object.values(paidMap).reduce((s, v) => s + Number(v.paid || 0), 0)
        const pending = Math.max(0, totals.net - totalPaid)
        const repsNotFull = rows.filter(r => {
          const pm = paidMap[r.user.id] || { paid: 0, hasFull: false }
          return !pm.hasFull && Number(r.net_payable || 0) > pm.paid
        }).length
        const totalLeaveDays = rows.reduce((s, r) => s + Number(r.leave_days_unpaid || 0), 0)
        const paidPct = totals.net > 0 ? Math.round((totalPaid / totals.net) * 100) : 0
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <SummaryCard
              label="Net Payable"
              value={fmtINR(totals.net)}
              sub={`${rows.length} reps · ${month}`}
            />
            <SummaryCard
              label="Already Paid"
              value={fmtINR(totalPaid)}
              valueColor="var(--v2-green, #10B981)"
              sub={`${paidPct}% of ${month} payable`}
            />
            <SummaryCard
              label="Pending"
              value={fmtINR(pending)}
              valueColor="var(--v2-amber, #F59E0B)"
              sub={`${repsNotFull} reps not paid in full`}
            />
            <SummaryCard
              label="Unpaid Leave Cut"
              value={totals.deduction > 0 ? '−' + fmtINR(totals.deduction) : '—'}
              valueColor={totals.deduction > 0 ? 'var(--v2-rose, #EF4444)' : 'var(--v2-ink-2)'}
              sub={`${totalLeaveDays.toFixed(1)} days · base ÷ ${policy?.unpaid_divisor || 26}`}
            />
          </div>
        )
      })()}

      {err && (
        <div style={{
          padding: '8px 12px', borderRadius: 8,
          background: 'rgba(239,68,68,.08)', color: 'var(--v2-rose, #EF4444)',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      {payoutTarget && (
        <SalaryPayoutModal
          staff={payoutTarget}
          monthYear={month}
          computed={payoutTarget.computed}
          onClose={() => setPayoutTarget(null)}
          onSaved={() => load()}
        />
      )}

      <div className="v2d-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ marginTop: 8 }}>Computing salary for {month}…</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
            <div className="v2d-empty-ic" style={{ marginBottom: 12 }}>
              <Wallet size={28} strokeWidth={1.6} />
            </div>
            <div className="v2d-empty-t">No reps to compute</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="v2d-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1300 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
                  <th style={thStyle}>Name</th>
                  <th style={thNum}>Base</th>
                  <th style={thNum}>Variable</th>
                  <th style={thNum}>Score</th>
                  <th style={thNum}>Incentive</th>
                  <th style={thNum}>TA/DA</th>
                  <th style={thNum}>Leave</th>
                  <th style={thNum}>Deduction</th>
                  <th style={{ ...thNum, color: 'var(--accent, #FFE600)' }}>NET</th>
                  <th style={thNum}>Paid</th>
                  <th style={thNum}>Payout</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.user.id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>
                        {r.user.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {r.user.role}
                      </div>
                    </td>
                    <td style={tdNum}>{fmtINR(r.base)}</td>
                    <td style={tdNum}>{fmtINR(r.variable)}</td>
                    <td style={tdNum}>
                      <span style={{
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 11, color: 'var(--v2-ink-2)',
                      }}>
                        {r.score_pct != null ? `${r.score_pct}%` : '—'}
                      </span>
                    </td>
                    <td style={tdNum}>{fmtINR(r.incentive)}</td>
                    <td style={tdNum}>{fmtINR(r.ta_da)}</td>
                    <td style={tdNum}>
                      <div style={{
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 11, color: 'var(--v2-ink-1)',
                      }}>
                        {Number(r.leave_days_total || 0).toFixed(1)}d
                      </div>
                      {(r.leave_days_unpaid > 0 || r.leave_days_paid > 0) && (
                        <div style={{ fontSize: 10, color: 'var(--v2-ink-2)' }}>
                          {Number(r.leave_days_paid || 0).toFixed(1)} paid · {Number(r.leave_days_unpaid || 0).toFixed(1)} unpaid
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdNum, color: r.unpaid_deduction > 0 ? 'var(--v2-rose, #EF4444)' : 'var(--v2-ink-2)' }}>
                      {r.unpaid_deduction > 0 ? '-' + fmtINR(r.unpaid_deduction).replace('₹', '₹') : '—'}
                    </td>
                    <td style={{
                      ...tdNum,
                      fontWeight: 700,
                      color: 'var(--accent, #FFE600)',
                    }}>
                      {fmtINR(r.net_payable)}
                    </td>
                    <td style={tdNum}>
                      {(() => {
                        const pm = paidMap[r.user.id] || { paid: 0, hasFull: false }
                        const net = Number(r.net_payable || 0)
                        const pending = Math.max(0, net - pm.paid)
                        return (
                          <div>
                            <div style={{
                              color: pm.paid > 0 ? 'var(--success, #10B981)' : 'var(--v2-ink-2)',
                              fontWeight: pm.paid > 0 ? 600 : 400,
                            }}>
                              {pm.paid > 0 ? fmtINR(pm.paid) : '—'}
                            </div>
                            {pm.hasFull ? (
                              <div style={{ fontSize: 9, color: 'var(--success, #10B981)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                                FULL
                              </div>
                            ) : pending > 0 && pm.paid > 0 ? (
                              <div style={{ fontSize: 9, color: 'var(--warning, #F59E0B)' }}>
                                pending {fmtINR(pending)}
                              </div>
                            ) : null}
                          </div>
                        )
                      })()}
                    </td>
                    <td style={tdNum}>
                      <button
                        type="button"
                        onClick={() => setPayoutTarget({
                          user_id: r.user.id,
                          name: r.user.name,
                          computed: Number(r.net_payable || 0),
                        })}
                        className="btn btn-y"
                        style={{
                          padding: '6px 10px', fontSize: 11, fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        <IndianRupee size={12} /> Payout
                      </button>
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--v2-line)', background: 'rgba(255,255,255,.02)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--v2-ink-0)' }}>TOTAL</td>
                  <td style={tdNum}>{fmtINR(totals.base)}</td>
                  <td style={tdNum}>{fmtINR(totals.variable)}</td>
                  <td style={tdNum}>—</td>
                  <td style={tdNum}>{fmtINR(totals.incentive)}</td>
                  <td style={tdNum}>{fmtINR(totals.ta_da)}</td>
                  <td style={tdNum}>—</td>
                  <td style={{ ...tdNum, color: totals.deduction > 0 ? 'var(--v2-rose, #EF4444)' : 'var(--v2-ink-2)' }}>
                    {totals.deduction > 0 ? '-' + fmtINR(totals.deduction).replace('₹', '₹') : '—'}
                  </td>
                  <td style={{ ...tdNum, fontWeight: 800, color: 'var(--accent, #FFE600)', fontSize: 14 }}>
                    {fmtINR(totals.net)}
                  </td>
                  <td style={{ ...tdNum, fontWeight: 700, color: 'var(--success, #10B981)' }}>
                    {(() => {
                      const tp = Object.values(paidMap).reduce((s, v) => s + Number(v.paid || 0), 0)
                      return tp > 0 ? fmtINR(tp) : '—'
                    })()}
                  </td>
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
  borderRadius: 8,
  color: 'var(--v2-ink-0)',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  height: 38,
}
// Phase 38 — summary card used above the salary table.
function SummaryCard({ label, value, sub, valueColor }) {
  return (
    <div style={{
      background: 'var(--v2-bg-1, #0f1525)',
      border: '1px solid var(--v2-line, #1f2a44)',
      borderRadius: 14,
      padding: '18px 20px',
    }}>
      <div style={{
        fontSize: 11, color: 'var(--v2-ink-2, #8b95ad)',
        textTransform: 'uppercase', letterSpacing: '.10em', fontWeight: 600,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)',
        fontSize: 26, fontWeight: 700,
        color: valueColor || 'var(--v2-ink-0, #f1f5f9)',
        marginTop: 6,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: 11, color: 'var(--v2-ink-2, #8b95ad)', marginTop: 4,
        }}>
          {sub}
        </div>
      )}
    </div>
  )
}

const thStyle = { padding: '10px 14px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.08em' }
const thNum   = { ...thStyle, textAlign: 'right' }
const tdStyle = { padding: '12px 14px', fontSize: 13, color: 'var(--v2-ink-1)', verticalAlign: 'top' }
const tdNum   = { ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }
