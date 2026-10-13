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
import SegmentToggle from '../../components/v2/SegmentToggle'
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
  const [seg, setSeg]     = useState('all')            // 'all' | 'private' | 'government'
  const [data, setData]   = useState(null)             // { all, private, government }
  const [err, setErr]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [sel, setSel]     = useState(null)             // person shown in the chart
  const [series, setSeries] = useState(null)           // monthly rows for `sel`
  const [serr, setSerr]   = useState('')

  const range = useMemo(() => {
    if (mode === 'all') return { from: ALL_TIME_FROM, to: `${addMonths(nowYM, 1)}-01` }
    return { from: `${month}-01`, to: `${addMonths(month, 1)}-01` }
  }, [mode, month, nowYM])

  const load = useCallback(async () => {
    if (!allowed) return
    setBusy(true); setErr('')
    const norm = (data) => (data || []).map(r => ({
      id: r.user_id, name: r.name, role: r.role,
      income: Number(r.income_ex_gst) || 0,
      base: Number(r.base) || 0, variable: Number(r.variable) || 0, incentive: Number(r.incentive) || 0,
      tada: Number(r.ta_da) || 0, cut: Number(r.leave_cut) || 0,
      cost: Number(r.net_cost) || 0, profit: Number(r.profit) || 0, months: Number(r.months) || 0,
    }))
    // All three views in one go so switching the segment is instant and the
    // "not split by segment" overhead can be worked out (All - Private - Government).
    const call = (segment) => supabase.rpc('employee_profitability', { p_from: range.from, p_to: range.to, p_segment: segment })
    const [a, p, g] = await Promise.all([call(null), call('PRIVATE'), call('GOVERNMENT')])
    const bad = a.error || p.error || g.error
    if (bad) { setErr(bad.message || 'Could not load profitability.'); setData(null) }
    else setData({ all: norm(a.data), private: norm(p.data), government: norm(g.data) })
    setBusy(false)
  }, [allowed, range.from, range.to])

  useEffect(() => { load() }, [load])

  // people that can be charted (from the All view = everyone with income or pay)
  const people = useMemo(() => (data?.all || []).map(r => ({ id: r.id, name: r.name, role: r.role })), [data])
  useEffect(() => {
    if (!sel && people.length) {
      const first = (data.all || []).find(r => EARNING.has(r.role) || r.income > 0) || data.all[0]
      if (first) setSel(first.id)
    }
  }, [people, data, sel])

  // the chart always shows the person's whole history from the month they joined.
  // sel === ALL_PEOPLE adds every person's month together = the whole team in one chart.
  const peopleKey = people.map(p => p.id).join(',')
  useEffect(() => {
    if (!allowed || !sel) return
    let off = false
    setSerr(''); setSeries(null)
    const to = `${addMonths(nowYM, 1)}-01`
    const one = (uid) => supabase.rpc('employee_profit_monthly', { p_user_id: uid, p_from: ALL_TIME_FROM, p_to: to })
    const ids = sel === ALL_PEOPLE ? peopleKey.split(',').filter(Boolean) : [sel]
    if (!ids.length) { setSeries([]); return }
    Promise.all(ids.map(one)).then(results => {
      if (off) return
      const bad = results.find(r => r.error)
      if (bad) { setSerr(bad.error.message || 'Could not load the chart.'); return }
      const byMonth = new Map()
      results.forEach(({ data: d }) => (d || []).forEach(r => {
        const ym = String(r.month).slice(0, 7)
        const m = byMonth.get(ym) || { ym, income: 0, base: 0, variable: 0, incentive: 0, ta: 0, da: 0, hotel: 0, other: 0, cut: 0, cost: 0, profit: 0 }
        m.income += Number(r.income_ex_gst) || 0
        m.base += Number(r.base) || 0; m.variable += Number(r.variable) || 0; m.incentive += Number(r.incentive) || 0
        m.ta += Number(r.ta) || 0; m.da += Number(r.da) || 0; m.hotel += Number(r.hotel) || 0; m.other += Number(r.other) || 0
        m.cut += Number(r.leave_cut) || 0; m.cost += Number(r.net_cost) || 0; m.profit += Number(r.profit) || 0
        byMonth.set(ym, m)
      }))
      setSeries([...byMonth.values()].sort((a, b) => a.ym.localeCompare(b.ym)))
    })
    return () => { off = true }
  }, [allowed, sel, nowYM, peopleKey])

  const rows = data ? data[seg] : null
  const earning = useMemo(() => (rows || []).filter(r => EARNING.has(r.role) || r.income > 0), [rows])
  const support = useMemo(() => (seg === 'all' ? (rows || []).filter(r => !EARNING.has(r.role) && r.income === 0) : []), [rows, seg])
  const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0)
  const totals = useMemo(() => {
    const income = sum(rows || [], 'income'), cost = sum(rows || [], 'cost')
    return { income, cost, profit: income - cost }
  }, [rows])
  // pay that cannot be tied to a segment (support staff, people with no quotes yet)
  const unsplit = useMemo(() => {
    if (!data || seg === 'all') return 0
    return Math.max(0, sum(data.all, 'cost') - sum(data.private, 'cost') - sum(data.government, 'cost'))
  }, [data, seg])

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
        <SegmentToggle value={seg} onChange={setSeg} style={{ marginBottom: 0 }} />
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

      {!err && data === null && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading profitability...</div>}

      {rows && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <Card label="Income (without GST)" value={formatCurrency(totals.income)} sub="approved payments received" />
            <Card label="Pay cost" value={formatCurrency(totals.cost)} sub="salary + incentive + TA/DA - leave cut" />
            <Card label="Profit" value={formatCurrency(totals.profit)} valueColor={totals.profit >= 0 ? 'var(--success)' : 'var(--danger)'}
              sub={totals.income > 0 ? `${Math.round((totals.profit / totals.income) * 100)}% of income` : ''} />
          </div>

          <PersonPanel
            people={people} sel={sel} onSel={setSel}
            series={series} err={serr}
            highlightYM={mode === 'month' ? month : null}
          />

          <Block
            title={seg === 'all' ? 'Earning team' : `Earning team - ${seg === 'private' ? 'Private' : 'Government'} only`}
            sub={seg === 'all'
              ? 'Sales and telecallers - income each person brought in'
              : "Income from this segment. A person's pay is attributed in proportion to the income they brought from it."}
            rows={earning} withIncome onPick={setSel} />
          {seg === 'all' ? (
            <Block title="Support team" sub="Operations, HR, accounts - cost only (no sales income)" rows={support} onPick={setSel} />
          ) : unsplit >= 1 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
              Not split by segment: {formatCurrency(unsplit)} of pay (support staff such as operations, HR and accounts, and
              people with no quotes yet). It is included under <b>All</b>.
            </div>
          ) : null}

          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Income counts a quote against the person who created it, by the date its payment was approved, with GST taken out (TDS stays in).
            Cost is what the company owes that month, after leave cuts. Incentive is paid-so-far for months before Sept 2026 and earned from Sept 2026.
            Agency partners are not listed (they earn commission, not salary). Months before a person joined (and after they left) are not counted.
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

function Block({ title, sub, rows, withIncome, onPick }) {
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
                    <div
                      style={{ fontWeight: 600, cursor: onPick ? 'pointer' : 'default', textDecoration: onPick ? 'underline dotted' : 'none', textUnderlineOffset: 3 }}
                      onClick={onPick ? () => { onPick(r.id); window.scrollTo({ top: 0, behavior: 'smooth' }) } : undefined}
                      title={onPick ? 'Show month-by-month chart' : undefined}
                    >{r.name}</div>
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


const SEGS = [
  ['base',      'Base salary (70%)', 'var(--blue, #3B82F6)'],
  ['variable',  'Variable (30%)',    'var(--accent, #FFE600)'],
  ['incentive', 'Incentive',         'var(--success, #10B981)'],
  ['ta',        'Travel (TA)',       'var(--warning, #F59E0B)'],
  ['da',        'Daily allowance',   'var(--danger, #EF4444)'],
  ['other',     'Hotel / other',     'var(--text-subtle, #64748b)'],
]
const shortMon = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })
}
const ALL_PEOPLE = '__all__'
const compact = (v) => {
  const a = Math.abs(v), sgn = v < 0 ? '-' : ''
  if (a >= 1e7) return `${sgn}${(a / 1e7).toFixed(1)}Cr`
  if (a >= 1e5) return `${sgn}${(a / 1e5).toFixed(1)}L`
  if (a >= 1e3) return `${sgn}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`
  return `${sgn}${Math.round(a)}`
}

function PersonPanel({ people, sel, onSel, series, err, highlightYM }) {
  const isAll = sel === ALL_PEOPLE
  const person = people.find(p => p.id === sel)
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Person view{isAll ? ' - Whole team' : person ? ` - ${person.name}` : ''}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Month by month, from the month they joined: what they cost vs what they brought in
          </div>
        </div>
        <select value={sel || ''} onChange={e => onSel(e.target.value || null)}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 10, padding: '0 10px', height: 38, fontFamily: 'inherit', fontSize: 13, minWidth: 200 }}>
          {people.length === 0 && <option value="">No people</option>}
          {people.length > 0 && <option value={ALL_PEOPLE}>All people (whole team)</option>}
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {err ? (
        <div style={{ padding: 16, color: 'var(--danger)', fontSize: 13 }}>Could not load the chart: {err}</div>
      ) : !sel ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Pick a person to see their chart.</div>
      ) : series === null ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
      ) : series.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pay or income recorded for this person yet.</div>
      ) : (
        <PersonChart series={series} highlightYM={highlightYM} />
      )}
    </div>
  )
}

function PersonChart({ series, highlightYM }) {
  const W = 760, H = 250, PL = 46, PR = 12, PT = 18, PB = 30
  const gross = (r) => SEGS.reduce((a, [k]) => a + r[k], 0)
  const maxV = Math.max(1000, ...series.map(r => Math.max(gross(r), r.income)))
  const step = Math.pow(10, Math.floor(Math.log10(maxV)))
  const top = Math.ceil(maxV / step) * step
  const n = series.length
  const slot = (W - PL - PR) / n
  const bw = Math.min(54, slot * 0.58)
  const y = (v) => PT + (H - PT - PB) * (1 - v / top)
  const x = (i) => PL + slot * i + slot / 2
  const incomePts = series.map((r, i) => `${x(i)},${y(r.income)}`).join(' ')
  const totals = series.reduce((a, r) => ({ income: a.income + r.income, cost: a.cost + r.cost }), { income: 0, cost: 0 })
  const first = series[0].ym

  return (
    <div style={{ padding: '14px 16px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        From {shortMon(first)} {first.slice(0, 4)} · {n} month{n === 1 ? '' : 's'} · income {formatCurrency(totals.income)} vs pay {formatCurrency(totals.cost)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxHeight: 280 }} role="img" aria-label="Monthly pay cost versus income">
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(top * t)} y2={y(top * t)} stroke="var(--border)" strokeWidth="1" />
            <text x={PL - 6} y={y(top * t) + 4} fontSize="10" textAnchor="end" fill="var(--text-muted)">{compact(top * t)}</text>
          </g>
        ))}
        {series.map((r, i) => {
          let acc = 0
          const hl = highlightYM && r.ym === highlightYM
          return (
            <g key={r.ym}>
              {hl && <rect x={x(i) - slot / 2 + 2} y={PT - 6} width={slot - 4} height={H - PT - PB + 6} rx="6" fill="var(--surface-2)" />}
              {SEGS.map(([k, , c]) => {
                const v = r[k]; if (v <= 0) return null
                const h = (H - PT - PB) * (v / top)
                const yy = y(acc + v); acc += v
                return <rect key={k} x={x(i) - bw / 2} y={yy} width={bw} height={Math.max(h, 0.5)} fill={c} />
              })}
              <text x={x(i)} y={y(gross(r)) - 5} fontSize="10" textAnchor="middle" fill="var(--text)">{compact(gross(r))}</text>
              <text x={x(i)} y={H - 10} fontSize="11" textAnchor="middle" fill="var(--text-muted)">{shortMon(r.ym)}</text>
            </g>
          )
        })}
        {n > 1 && <polyline points={incomePts} fill="none" stroke="var(--text)" strokeWidth="2" strokeDasharray="5 4" />}
        {series.map((r, i) => (
          <g key={`i${r.ym}`}>
            <circle cx={x(i)} cy={y(r.income)} r="4.5" fill="var(--bg, #0f172a)" stroke="var(--text)" strokeWidth="2" />
            {r.income > 0 && <text x={x(i) + bw / 2 + 4} y={y(r.income) + 3} fontSize="10" fill="var(--text)" fontWeight="700">{compact(r.income)}</text>}
          </g>
        ))}
      </svg>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', margin: '4px 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
        {SEGS.map(([k, label, c]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} />{label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--text)', display: 'inline-block' }} />Income (without GST)
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: 'left' }}>Month</th>
              <th style={thS}>Income</th><th style={thS}>Salary</th><th style={thS}>Incentive</th>
              <th style={thS}>TA</th><th style={thS}>DA</th><th style={thS}>Other</th>
              <th style={thS}>Leave cut</th><th style={thS}>Total cost</th><th style={thS}>Profit</th>
            </tr>
          </thead>
          <tbody>
            {series.map(r => (
              <tr key={r.ym} style={{ borderTop: '1px solid var(--border)', background: highlightYM === r.ym ? 'var(--surface-2)' : 'transparent' }}>
                <td style={{ ...tdS, textAlign: 'left', fontWeight: 600 }}>{shortMon(r.ym)} {r.ym.slice(0, 4)}</td>
                <td style={tdS}>{formatCurrency(r.income)}</td>
                <td style={tdS}>{formatCurrency(r.base + r.variable)}</td>
                <td style={tdS}>{formatCurrency(r.incentive)}</td>
                <td style={tdS}>{formatCurrency(r.ta)}</td>
                <td style={tdS}>{formatCurrency(r.da)}</td>
                <td style={tdS}>{formatCurrency(r.hotel + r.other)}</td>
                <td style={{ ...tdS, color: r.cut > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{r.cut > 0 ? `- ${formatCurrency(r.cut)}` : '-'}</td>
                <td style={{ ...tdS, fontWeight: 600 }}>{formatCurrency(r.cost)}</td>
                <td style={{ ...tdS, fontWeight: 700, color: r.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(r.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
