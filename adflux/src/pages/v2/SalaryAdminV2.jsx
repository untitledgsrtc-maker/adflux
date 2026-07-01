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

// Phase 47.9 — IST current month YYYY-MM via shared util.
import { istCurrentMonthYM } from '../../utils/istDate'
function currentMonthYM() { return istCurrentMonthYM() }

// Phase 38 — `embedded` prop suppresses own page-head when mounted
// inside PeopleV2 (which renders the shared "People" head once). When
// embedded, the month picker + CSV export move to a toolbar row above
// the table.
export default function SalaryAdminV2({ embedded = false }) {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = ['admin', 'co_owner', 'accounts'].includes(profile?.role) // Phase 182 — accounts = payroll access

  useEffect(() => {
    if (profile && !isAdmin) navigate('/work')
  }, [profile, isAdmin, navigate])

  const [month, setMonth]   = useState(currentMonthYM())
  const [rows,  setRows]    = useState([])    // [{ user, salary, ... }]
  const [paidMap, setPaidMap] = useState({})  // { user_id: { paid, hasFull } } from salary_payouts
  // Phase 40 — { user_id: { ta_override, da_night, hotel, other } }
  // from approved ta_da_requests rows in the selected month.
  const [taBreakdown, setTaBreakdown] = useState({})
  const [policy, setPolicy] = useState(null)
  const [err,   setErr]     = useState('')
  const [loading, setLoading] = useState(true)
  const [payoutTarget, setPayoutTarget] = useState(null) // { user_id, name, computed }
  // Phase 38.2 — mockup filter row (embedded mode only).
  const [roleFilter, setRoleFilter] = useState('all')
  const [searchQ, setSearchQ]       = useState('')

  async function load() {
    setLoading(true); setErr('')
    const [y, m] = month.split('-').map(n => parseInt(n, 10))
    if (!y || !m) { setErr('Pick a month.'); setLoading(false); return }

    // Pull active reps + policy + salary_payouts + TA claim
    // breakdown in parallel.
    const monthStart = `${month}-01`
    const monthEnd = (() => {
      const d = new Date(y, m, 0)
      return d.toISOString().slice(0, 10)
    })()
    const [usersRes, polRes, payRes, taRes] = await Promise.all([
      supabase.from('users')
        .select('id, name, role')
        // Phase 101.A2 — agency dropped (commission-only, no salary).
        .in('role', ['sales', 'telecaller', 'admin', 'co_owner'])
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase.from('salary_policy')
        .select('*')
        .order('effective_from', { ascending: false })
        .limit(1),
      supabase.from('salary_payouts')
        .select('user_id, amount_paid, is_full_payment')
        .eq('month_year', month),
      // Phase 40 — approved TA claims broken down by kind for the
      // hover tooltip on the TA/DA column. (GPS portion is whatever
      // remains after subtracting these from r.ta_da.)
      supabase.from('ta_da_requests')
        .select('user_id, kind, claim_amount, claim_km')
        .eq('status', 'approved')
        .gte('claim_date', monthStart)
        .lte('claim_date', monthEnd),
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

    // Phase 40 — TA breakdown by kind. Bike claim_km × ₹3 added to
    // claim_amount for ta_override (legacy field).
    const tb = {}
    for (const c of (taRes.data || [])) {
      const k = c.user_id
      if (!tb[k]) tb[k] = { ta_override: 0, da_night: 0, hotel: 0, other: 0 }
      const amt = Number(c.claim_amount || 0) + Number(c.claim_km || 0) * 3
      const kind = c.kind || 'other'
      if (tb[k][kind] != null) tb[k][kind] += amt
      else tb[k].other += amt
    }
    setTaBreakdown(tb)

    // Phase 182 — RPC per rep, now run in parallel (Promise.all preserves
    // array order, so `out` is identical to the old sequential build — just
    // not one-at-a-time). Salary tab re-runs this on every tab-focus, so the
    // serial 24-RPC chain was the sluggishness.
    const out = await Promise.all((usersRes.data || []).map(async (u) => {
      const { data, error: rpcErr } = await supabase.rpc('compute_monthly_salary', {
        p_user_id: u.id, p_year: y, p_month: m,
      })
      if (rpcErr) return { user: u, error: rpcErr.message }
      return { user: u, ...((data && typeof data === 'object') ? data : {}) }
    }))
    setRows(out)
    setLoading(false)
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin, month]) // eslint-disable-line
  useAutoRefresh(load, { enabled: isAdmin })

  // Phase 38.2 — apply role + search filters before render. Filters
  // only have visible controls in embedded mode but logic is shared.
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (roleFilter !== 'all' && r.user?.role !== roleFilter) return false
      if (searchQ.trim()) {
        const q = searchQ.toLowerCase()
        if (!(r.user?.name || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, roleFilter, searchQ])

  const totals = useMemo(() => {
    return filteredRows.reduce((acc, r) => {
      acc.totalSalary += Number(r.monthly_salary || 0)
      acc.base       += Number(r.base || 0)
      acc.variable   += Number(r.variable || 0)
      acc.incentive  += Number(r.incentive || 0)
      acc.ta_da      += Number(r.ta_da || 0)
      acc.deduction  += Number(r.unpaid_deduction || 0)
      acc.net        += Number(r.net_payable || 0)
      return acc
    }, { totalSalary: 0, base: 0, variable: 0, incentive: 0, ta_da: 0, deduction: 0, net: 0 })
  }, [filteredRows])

  function exportCSV() {
    const header = [
      'Name', 'Role', 'Total Salary', 'Base', 'Variable', 'Score %',
      'Incentive', 'TA/DA',
      'Leave Total', 'Leave Paid', 'Leave Unpaid',
      'Unpaid Deduction', 'NET PAYABLE',
    ]
    const lines = filteredRows.map(r => [
      r.user?.name || '',
      r.user?.role || '',
      r.monthly_salary || 0,
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
        // Phase 38.2 — mockup-matching filter row. Month + Role +
        // Search on the left; Export + Bulk Full-Pay on the right.
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div style={filtColStyle}>
            <label style={labelStyle}>Month</label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={filtColStyle}>
            <label style={labelStyle}>Role</label>
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              style={{ ...inputStyle, minWidth: 160 }}
            >
              <option value="all">All roles</option>
              <option value="sales">Sales</option>
              <option value="telecaller">Telecaller</option>
              <option value="agency">Agency</option>
              <option value="admin">Admin</option>
              <option value="co_owner">Co-owner</option>
            </select>
          </div>
          <div style={filtColStyle}>
            <label style={labelStyle}>Search rep</label>
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Name…"
              style={{ ...inputStyle, minWidth: 160 }}
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
          <button
            type="button"
            disabled
            title="Coming next sprint — pays remaining balance for every rep below in one click."
            style={{ ...ctaBtnStyle, opacity: 0.45, cursor: 'not-allowed' }}
          >
            <Wallet size={14} /> Bulk full-pay
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
          padding: '8px 12px', borderRadius: 'var(--v2-r-sm, 10px)',
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
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            No reps match the current Role / Search filter. Clear filters to see all {rows.length} reps.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="v2d-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1400 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
                  <th style={thStyle}>Name</th>
                  {/* Phase 40 — Total = full monthly salary contract
                      (base + variable cap), shown before Base/Variable
                      breakdown so accounts can see "this rep is on
                      ₹50k slot → after score gets ₹35k variable". */}
                  <th style={thNum}>Total Salary</th>
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
                {filteredRows.map(r => (
                  <tr key={r.user.id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>
                        {r.user.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {r.user.role}
                      </div>
                    </td>
                    {/* Phase 40 — Total Salary = monthly_salary
                        contract from staff_incentive_profiles. */}
                    <td style={{ ...tdNum, color: 'var(--v2-ink-0)', fontWeight: 600 }}>
                      {fmtINR(r.monthly_salary)}
                    </td>
                    <td style={tdNum}>{fmtINR(r.base)}</td>
                    <td style={tdNum}>{fmtINR(r.variable)}</td>
                    <td style={tdNum}>
                      <span style={{
                        fontFamily: 'inherit',
                        fontSize: 11,
                        color: (Number(r.score_pct || 0) >= 80) ? 'var(--v2-green, #10B981)'
                             : (Number(r.score_pct || 0) >= 50) ? 'var(--v2-amber, #F59E0B)'
                             :                                    'var(--v2-rose, #EF4444)',
                      }}>
                        {r.score_pct != null ? `${r.score_pct}%` : '—'}
                      </span>
                    </td>
                    <td style={tdNum}>{fmtINR(r.incentive)}</td>
                    {/* Phase 40 — TA/DA cell hover tooltip shows
                        breakdown by kind (GPS · DA night · Hotel ·
                        Other). taBreakdown captured separately from
                        approved ta_da_requests; GPS = ta_da - claims. */}
                    {(() => {
                      const tb = taBreakdown[r.user.id] || { ta_override: 0, da_night: 0, hotel: 0, other: 0 }
                      const claimsTotal = tb.ta_override + tb.da_night + tb.hotel + tb.other
                      const gpsOnly = Math.max(0, Number(r.ta_da || 0) - claimsTotal)
                      const tip = `GPS-TA ${fmtINR(gpsOnly)} · DA night ${fmtINR(tb.da_night)} · Hotel ${fmtINR(tb.hotel)} · Other ${fmtINR(tb.other + tb.ta_override)}`
                      return (
                        <td style={tdNum} title={tip}>
                          {fmtINR(r.ta_da)}
                        </td>
                      )
                    })()}
                    <td style={tdNum}>
                      <div style={{
                        fontFamily: 'inherit',
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
                      {(() => {
                        const pm = paidMap[r.user.id] || { paid: 0, hasFull: false }
                        const done = pm.hasFull
                        return (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: '5px 10px', fontSize: 12 }}
                            onClick={() => setPayoutTarget({
                              user_id: r.user.id,
                              name: r.user.name,
                              computed: Number(r.net_payable || 0),
                            })}
                          >
                            <IndianRupee size={13} style={{ marginRight: 4 }} />
                            {done ? 'View' : 'Payout'}
                          </button>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--v2-line)', background: 'rgba(255,255,255,.02)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--v2-ink-0)' }}>
                    TOTAL{filteredRows.length !== rows.length ? ` · ${filteredRows.length} of ${rows.length}` : ''}
                  </td>
                  <td style={{ ...tdNum, fontWeight: 700, color: 'var(--v2-ink-0)' }}>{fmtINR(totals.totalSalary)}</td>
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
  borderRadius: 'var(--v2-r-sm, 10px)',
  color: 'var(--v2-ink-0)',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  height: 38,
}
// Phase 41.4 — SummaryCard restyled to MATCH the Incentive page
// .inc-summary-card spec exactly (owner directive: copy Incentive
// styling to Salary, not the other way). Surface bg, border-radius
// 12, label 12px 0.5 letter-spacing, value 22px without display
// font — identical to .inc-summary-card / .inc-summary-label /
// .inc-summary-value in incentives.css.
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
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700,
        color: valueColor || 'var(--text)',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: 12, color: 'var(--text-muted)', marginTop: 4,
        }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// Phase 41.4 — th/td padding matches .staff-table spec from
// incentives.css (owner directive: copy Incentive styling to
// Salary). th 10/16 + surface2 thead bg + 0.5px letter-spacing,
// td 13/16 + vertical-align middle, no mono font on currency.
const thStyle = { padding: '10px 16px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--surface-2)' }
const thNum   = { ...thStyle, textAlign: 'right' }
const tdStyle = { padding: '13px 16px', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle' }
const tdNum   = { ...tdStyle, textAlign: 'right' }

// Phase 41.4 — toolbar styles use .btn / .btn-y / .btn-ghost class
// names where possible; remaining inline ones use canonical tokens.
const filtColStyle = { display: 'flex', flexDirection: 'column', gap: 4 }
const ghostBtnStyle = {
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '0 12px', height: 36,
  borderRadius: 'var(--v2-r-sm, 10px)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
}
const ctaBtnStyle = {
  background: 'var(--accent, #FFE600)', border: 'none',
  color: 'var(--accent-fg, #0f172a)', padding: '0 14px', height: 36,
  borderRadius: 'var(--v2-r-sm, 10px)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
}
