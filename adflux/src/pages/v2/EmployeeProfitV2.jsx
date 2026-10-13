// src/pages/v2/EmployeeProfitV2.jsx
//
// Phase 364 - per-employee profitability (People -> Profitability tab).
// Owner ask 13 Oct 2026: "per employee profitability - income (without GST) vs
// salary, incentive, TA/DA and other paid - monthly filter and all-time filter."
//
// One definition lives in the database: employee_profitability(p_from, p_to)
// (db/functions/employee_profitability.sql). Income = approved payments received
// in the period on quotes the person created, GST stripped. Cost = what the salary
// engine owes for those months (base + variable + incentive + TA/DA - leave cut).
// Display only; admin + accounts only (the function returns nothing for anyone else).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istCurrentMonthYM } from '../../utils/istDate'
import { formatCurrency } from '../../utils/formatters'

const ALL_TIME_FROM = '2026-04-01'   // start of FY 2026-27 (first month with data)
const EARNING = new Set(['sales', 'telecaller'])

// pure string month math (no Date -> no timezone drift)
function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const roleLabel = (r) => ({ sales: 'Sales', telecaller: 'Telecaller', operation_executive: 'Operations',
  operation_head: 'Ops head', hr: 'HR', accounts: 'Accounts', admin: 'Admin', co_owner: 'Co-owner' }[r] || r)

export default function EmployeeProfitV2() {
  const role = useAuthStore(s => s.profile?.role)
  const allowed = role === 'admin' || role === 'accounts'
  const nowYM = istCurrentMonthYM()

  const [mode, setMode]   = useState('month')          // 'month' | 'all'
  const [month, setMonth] = useState(nowYM)
  const [rows, setRows]   = useState(null)
  const [err, setErr]     = useState('')
  const [busy, setBusy]   = useState(false)

  const range = useMemo(() => {
    if (mode === 'all') return { from: ALL_TIME_FROM, to: `${addMonths(nowYM, 1)}-01` }
    return { from: `${month}-01`, to: `${addMonths(month, 1)}-01` }
  }, [mode, month, nowYM])

  const load = useCallback(async () => {
    if (!allowed) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('employee_profitability', { p_from: range.from, p_to: range.to })
    if (error) { setErr(error.message || 'Could not load profitability.'); setRows(null) }
    else setRows((data || []).map(r => ({
      id: r.user_id, name: r.name, role: r.role,
      income: Number(r.income_ex_gst) || 0,
      base: Number(r.base) || 0, variable: Number(r.variable) || 0, incentive: Number(r.incentive) || 0,
      tada: Number(r.ta_da) || 0, cut: Number(r.leave_cut) || 0,
      cost: Number(r.net_cost) || 0, profit: Number(r.profit) || 0, months: Number(r.months) || 0,
    })))
    setBusy(false)
  }, [allowed, range.from, range.to])

  useEffect(() => { load() }, [load])

  const earning = useMemo(() => (rows || []).filter(r => EARNING.has(r.role) || r.income > 0), [rows])
  const support = useMemo(() => (rows || []).filter(r => !EARNING.has(r.role) && r.income === 0), [rows])
  const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0)
  const totals = useMemo(() => {
    const income = sum(rows || [], 'income'), cost = sum(rows || [], 'cost')
    return { income, cost, profit: income - cost }
  }, [rows])

  if (!allowed) {
    return <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>This tab is for admin and accounts only.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {[['month', 'Monthly'], ['all', 'All time']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMode(k)} style={{
              padding: '0 16px', height: 38, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              fontFamily: 'inherit',
              background: mode === k ? 'var(--accent, #FFE600)' : 'transparent',
              color: mode === k ? 'var(--accent-fg, #0f172a)' : 'var(--text-muted)',
            }}>{l}</button>
          ))}
        </div>
        {mode === 'month' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button type="button" aria-label="Previous month" onClick={() => setMonth(m => addMonths(m, -1))} style={navBtn}><ChevronLeft size={16} /></button>
            <input type="month" value={month} max={nowYM} onChange={e => e.target.value && setMonth(e.target.value)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 10, padding: '0 10px', height: 38, fontFamily: 'inherit', fontSize: 13 }} />
            <button type="button" aria-label="Next month" disabled={month >= nowYM} onClick={() => setMonth(m => addMonths(m, 1))}
              style={{ ...navBtn, opacity: month >= nowYM ? 0.4 : 1, cursor: month >= nowYM ? 'default' : 'pointer' }}><ChevronRight size={16} /></button>
          </div>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {mode === 'all' ? `Apr 2026 to ${monthLabel(nowYM)}` : monthLabel(month)}
        </span>
        <button type="button" onClick={load} disabled={busy} style={{ ...navBtn, width: 'auto', padding: '0 12px', gap: 6, marginLeft: 'auto' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {err && (
        <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 10, padding: '12px 14px', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Could not load: {err}</span>
          <button type="button" onClick={load} style={{ ...navBtn, width: 'auto', padding: '0 12px' }}>Retry</button>
        </div>
      )}

      {!err && rows === null && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading profitability...</div>}

      {rows && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <Card label="Income (without GST)" value={formatCurrency(totals.income)} sub="approved payments received" />
            <Card label="Pay cost" value={formatCurrency(totals.cost)} sub="salary + incentive + TA/DA - leave cut" />
            <Card label="Profit" value={formatCurrency(totals.profit)} valueColor={totals.profit >= 0 ? 'var(--success)' : 'var(--danger)'}
              sub={totals.income > 0 ? `${Math.round((totals.profit / totals.income) * 100)}% of income` : ''} />
          </div>

          <Block title="Earning team" sub="Sales and telecallers - income each person brought in" rows={earning} withIncome />
          <Block title="Support team" sub="Operations, HR, accounts - cost only (no sales income)" rows={support} />

          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Income counts a quote against the person who created it, by the date its payment was approved, with GST taken out (TDS stays in).
            Cost is what the company owes that month, after leave cuts. Incentive is paid-so-far for months before Sept 2026 and earned from Sept 2026.
            Agency partners are not listed (they earn commission, not salary).
          </div>
        </>
      )}
    </div>
  )
}

const navBtn = {
  width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
}
const thS = { padding: '10px 14px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--surface-2)', color: 'var(--text-muted)', textAlign: 'right' }
const tdS = { padding: '13px 14px', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

function Card({ label, value, sub, valueColor }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor || 'var(--text)', fontFamily: 'var(--font-display)' }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  )
}

function Block({ title, sub, rows, withIncome }) {
  const s = (k) => rows.reduce((a, r) => a + r[k], 0)
  const tProfit = s('income') - s('cost')
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No people with income or pay in this period.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>Employee</th>
                {withIncome && <th style={thS}>Income</th>}
                <th style={thS}>Salary</th>
                <th style={thS}>Incentive</th>
                <th style={thS}>TA / DA</th>
                <th style={thS}>Leave cut</th>
                <th style={thS}>Total cost</th>
                {withIncome && <th style={thS}>Profit</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...tdS, textAlign: 'left' }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {roleLabel(r.role)}
                      {withIncome && r.income > 0 && r.cost === 0 && (
                        <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600, color: 'var(--warning)', background: 'var(--tint-warning)', border: '1px solid var(--tint-warning-bd)' }}>No salary on file</span>
                      )}
                    </div>
                  </td>
                  {withIncome && <td style={tdS}>{formatCurrency(r.income)}</td>}
                  <td style={tdS}>{formatCurrency(r.base + r.variable)}</td>
                  <td style={tdS}>{formatCurrency(r.incentive)}</td>
                  <td style={tdS}>{formatCurrency(r.tada)}</td>
                  <td style={{ ...tdS, color: r.cut > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{r.cut > 0 ? `- ${formatCurrency(r.cut)}` : '-'}</td>
                  <td style={{ ...tdS, fontWeight: 600 }}>{formatCurrency(r.cost)}</td>
                  {withIncome && (
                    <td style={{ ...tdS, fontWeight: 700, color: r.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(r.profit)}</td>
                  )}
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface-2)' }}>
                <td style={{ ...tdS, textAlign: 'left', fontWeight: 700 }}>Total · {rows.length}</td>
                {withIncome && <td style={{ ...tdS, fontWeight: 700 }}>{formatCurrency(s('income'))}</td>}
                <td style={{ ...tdS, fontWeight: 700 }}>{formatCurrency(s('base') + s('variable'))}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{formatCurrency(s('incentive'))}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{formatCurrency(s('tada'))}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{s('cut') > 0 ? `- ${formatCurrency(s('cut'))}` : '-'}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{formatCurrency(s('cost'))}</td>
                {withIncome && <td style={{ ...tdS, fontWeight: 700, color: tProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(tProfit)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
