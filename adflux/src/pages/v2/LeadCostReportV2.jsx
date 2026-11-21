// src/pages/v2/LeadCostReportV2.jsx
//
// Phase 639 - Cost per lead, monthly, admin only (/admin/lead-cost).
// All numbers come from the read-only RPC lead_cost_report(p_month)
// (supabase_phase639_lead_cost_report.sql) so this page and the rep's own
// card on My Performance can never disagree. Read-only, no writes.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, Calculator, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency } from '../../utils/formatters'
import { istCurrentMonthYM } from '../../utils/istDate'

function prevMonthYM() {
  const [y, m] = istCurrentMonthYM().split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const rs = (v) => (v == null ? '-' : formatCurrency(Number(v)))
const rs1 = (v) => (v == null ? '-' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}`)
const hrs = (min) => `${(Number(min || 0) / 60).toFixed(1)} h`
const pct = (cost, won) => (Number(won) > 0 ? `${Math.round((Number(cost) / Number(won)) * 100)}%` : '-')

export default function LeadCostReportV2() {
  const profile = useAuthStore((s) => s.profile)
  const isAdmin = profile?.role === 'admin'
  const [month, setMonth] = useState(prevMonthYM())
  const [rows, setRows] = useState(null)   // null = loading
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setRows(null); setErr('')
    const { data, error } = await supabase.rpc('lead_cost_report', { p_month: `${month}-01` })
    if (error) { setErr(error.message || 'Could not load the report'); setRows([]); return }
    setRows(data || [])
  }, [month])

  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  const sales = useMemo(() => (rows || []).filter((r) => r.role === 'sales'), [rows])
  const tcs = useMemo(() => (rows || []).filter((r) => r.role === 'telecaller'), [rows])

  const totals = useMemo(() => {
    const sum = (arr, k) => arr.reduce((s, r) => s + Number(r[k] || 0), 0)
    const field = sales.filter((r) => !r.no_meetings)   // shared / office logins stay out of the averages
    const all = rows || []
    return {
      cost: sum(all, 'total_cost'),
      won: sum(all, 'won_value'),
      perMeeting: sum(field, 'meetings') ? sum(field, 'meeting_cost') / sum(field, 'meetings') : null,
      perTcCall: sum(tcs, 'real_calls') ? sum(tcs, 'call_cost') / sum(tcs, 'real_calls') : null,
    }
  }, [rows, sales, tcs])

  if (!isAdmin) {
    return (
      <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
        <div className="v2d-empty-t">Admin only</div>
        <div className="v2d-empty-s">This report shows salary-based costs, so only admin can open it.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="v2d-page-head" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="v2d-page-kicker">Team · Money</div>
          <h1 className="v2d-page-title">Cost per Lead</h1>
          <div className="v2d-page-sub">
            Salary for days worked + travel, split into calling time and field time using real hours
            (clock-in to last real action). A real call is 10 seconds or more.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="month" value={month} max={istCurrentMonthYM()} aria-label="Month"
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            style={{ minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--v2-line)',
              background: 'var(--v2-bg-1)', color: 'var(--v2-ink-0)', font: 'inherit' }} />
          <button type="button" className="btn btn-ghost" onClick={load} title="Reload" style={{ minHeight: 40 }}>
            <RefreshCw size={16} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {err && (
        <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 10,
          background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--v2-ink-0)', fontSize: 13 }}>
          <AlertTriangle size={16} strokeWidth={1.6} />
          <span style={{ flex: 1 }}>{err}</span>
          <button type="button" className="btn btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {rows === null ? (
        <div className="v2d-panel" style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>Working out the month…</div>
        </div>
      ) : rows.length === 0 && !err ? (
        <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
          <div className="v2d-empty-ic" style={{ marginBottom: 12 }}><Calculator size={22} strokeWidth={1.6} /></div>
          <div className="v2d-empty-t">No working days in this month</div>
          <div className="v2d-empty-s">Pick another month. Costs appear once sales or telecallers have clocked in.</div>
        </div>
      ) : rows.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
            <Card label="Team cost" value={rs(totals.cost)} sub="Salary for days worked + travel" />
            <Card label="Cost per field meeting" value={rs(totals.perMeeting)} sub="Sales, shared logins left out" />
            <Card label="Cost per telecaller call" value={rs1(totals.perTcCall)} sub="Real calls only" />
            <Card label="Won this month" value={rs(totals.won)} sub={`Cost is ${pct(totals.cost, totals.won)} of won value (excl. GST)`} />
          </div>

          <Section title="Sales" rows={sales} kind="sales" />
          <Section title="Telecallers" rows={tcs} kind="tc" />

          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', lineHeight: 1.6 }}>
            Salary = monthly salary ÷ 26 × days worked, from each person's incentive profile (no leave cuts, no incentive).
            Travel = daily TA, rejected days left out. Field cost = salary not spent talking + travel. Won = quotes won in
            the month, credited to whoever made the quote. Calls from a phone the app cannot read are not counted.
          </div>
        </>
      )}
    </div>
  )
}

function Card({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
      <div className="tabular-nums" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Chip({ children }) {
  return (
    <span style={{ display: 'inline-block', marginLeft: 6, padding: '2px 8px', borderRadius: 999, fontSize: 12,
      background: 'var(--warning-soft)', border: '1px solid var(--warning)', color: 'var(--v2-ink-0)', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Section({ title, rows, kind }) {
  if (!rows.length) return null
  const sales = kind === 'sales'
  return (
    <div className="v2d-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--v2-ink-0)' }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="staff-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: sales ? 1180 : 1040 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
              <th style={th}>Name</th>
              <th style={thN}>Days</th>
              <th style={thN}>Hours</th>
              <th style={thN}>Talk time</th>
              {!sales && <th style={thN}>Calls tapped</th>}
              <th style={thN}>Real calls</th>
              <th style={thN}>Per call</th>
              {sales && <th style={thN}>Meetings</th>}
              {sales && <th style={thN}>Per meeting</th>}
              <th style={thN}>Leads worked</th>
              <th style={thN}>Per lead</th>
              <th style={thN}>Total cost</th>
              <th style={thN}>Won</th>
              <th style={thN}>Cost vs won</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                <td style={td}>
                  <span style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>{r.name}</span>
                  {r.no_meetings && <Chip>No field meetings · shared login?</Chip>}
                  {r.days < 5 && <Chip>Part month</Chip>}
                </td>
                <td style={tdN}>{r.days}</td>
                <td style={tdN}>{hrs(r.work_min)}</td>
                <td style={tdN}>{hrs(r.talk_min)}</td>
                {!sales && <td style={tdN}>{r.tapped_calls}</td>}
                <td style={tdN}>{r.real_calls}</td>
                <td style={tdN}>{rs1(r.cost_per_call)}</td>
                {sales && <td style={tdN}>{r.meetings}</td>}
                {sales && <td style={tdN}>{rs(r.cost_per_meeting)}</td>}
                <td style={tdN}>{r.leads_touched}</td>
                <td style={tdN}>{rs1(r.cost_per_lead)}</td>
                <td style={{ ...tdN, fontWeight: 600 }}>{rs(r.total_cost)}</td>
                <td style={tdN}>{r.won_count ? `${r.won_count} · ${rs(r.won_value)}` : '-'}</td>
                <td style={tdN}>{pct(r.total_cost, r.won_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th = { padding: '10px 16px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase',
  letterSpacing: '0.5px', background: 'var(--surface-2)', textAlign: 'left' }
const thN = { ...th, textAlign: 'right' }
const td = { padding: '12px 16px', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle' }
const tdN = { ...td, textAlign: 'right', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }
