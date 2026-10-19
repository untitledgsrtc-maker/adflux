// Phase 414 - the work team's variable pay = tasks finished ON TIME. This shows the person where they stand this month.
// Reads monthly_score (self-or-admin gate; it holds the ONE pay rule). Display only - writes nothing.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import { formatCurrency } from '../../utils/formatters'

export const FULL_AT = 85
export const ZERO_BELOW = 60
export const MIN_TASKS = 3

export function monthStartISO() { return istTodayISO().slice(0, 8) + '01' }

// shared fetch: { counted, onTime, pct, cap, earned } or null
export async function loadOnTime(userId) {
  const { data, error } = await supabase.rpc('monthly_score', { p_user_id: userId, p_month_start: monthStartISO() })
  if (error) return null
  const r = Array.isArray(data) ? data[0] : data
  if (!r) return null
  const counted = Number(r.working_days) || 0
  const pct = Number(r.avg_score_pct) || 0
  return { counted, onTime: counted >= MIN_TASKS ? Math.round(pct * counted / 100) : null, pct: counted >= MIN_TASKS ? pct : null, cap: Number(r.variable_cap) || 0, earned: Number(r.variable_earned) || 0 }
}

export function bandOf(s) {
  if (!s) return null
  if (s.pct == null) return { cls: '', label: `Not enough tasks yet (${s.counted} of ${MIN_TASKS}). Full variable for now.` }
  if (s.pct >= FULL_AT) return { cls: 'ok', label: 'On track - full variable' }
  if (s.pct < ZERO_BELOW) return { cls: 'bad', label: 'Below the minimum - no variable' }
  return { cls: 'warn', label: `Part of the variable. ${FULL_AT}% on time gets the full amount.` }
}

export default function OnTimeScoreCard({ userId }) {
  const [s, setS] = useState(undefined)   // undefined = loading, null = unavailable
  useEffect(() => { let on = true; if (userId) loadOnTime(userId).then((v) => { if (on) setS(v) }); return () => { on = false } }, [userId])
  if (s === undefined) return <div className="wk-card"><div className="wk-sm">Loading your on-time score...</div></div>
  if (s === null) return null
  const b = bandOf(s)
  const late = s.pct == null ? null : s.counted - s.onTime
  return (
    <div className="wk-card">
      <div className="wk-ch"><h3>On-time score - this month</h3></div>
      <div style={{ padding: '4px 20px 18px' }}>
        <div className="wk-row" style={{ alignItems: 'baseline' }}>
          <span className="wk-num" style={{ fontSize: 34, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{s.pct == null ? '-' : `${Math.round(s.pct)}%`}</span>
          <span className={`wk-pill ${b.cls}`}>{s.pct == null ? 'Too early' : b.cls === 'ok' ? 'Full' : b.cls === 'bad' ? 'None' : 'Part'}</span>
        </div>
        <div className="wk-bar" style={{ height: 8, margin: '10px 0' }}><i style={{ width: `${Math.min(100, s.pct || 0)}%` }} /></div>
        <div className="wk-sm">{s.pct == null ? b.label : `${s.onTime} of ${s.counted} tasks finished on time${late > 0 ? ` - ${late} late` : ''}`}</div>
        {s.pct != null && <div className="wk-sm" style={{ marginTop: 6 }}>{b.label}</div>}
        <div className="wk-sm" style={{ marginTop: 6 }}>Variable so far: <b className="wk-num">{formatCurrency(s.earned)}</b> of {formatCurrency(s.cap)}</div>
        <div className="wk-sm" style={{ marginTop: 6, opacity: 0.8 }}>Counts tasks whose due date has passed. Postponed tasks and leave days are not counted.</div>
      </div>
    </div>
  )
}

export function OnTimeCell({ userId }) {
  const [s, setS] = useState(undefined)
  useEffect(() => { let on = true; loadOnTime(userId).then((v) => { if (on) setS(v) }); return () => { on = false } }, [userId])
  if (s === undefined) return <span className="wk-sm">...</span>
  if (!s) return <span className="wk-sm">-</span>
  const b = bandOf(s)
  return s.pct == null
    ? <span className="wk-sm" title={b.label}>{s.counted} of {MIN_TASKS} tasks</span>
    : <span className={`wk-pill ${b.cls}`} title={b.label}>{Math.round(s.pct)}% · {s.onTime}/{s.counted}</span>
}
