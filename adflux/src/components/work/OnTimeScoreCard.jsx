// Phase 414 - the work team's variable pay = tasks finished ON TIME. This shows the person where they stand this month.
// Reads monthly_score (self-or-admin gate; it holds the ONE pay rule). Display only - writes nothing.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import { formatCurrency } from '../../utils/formatters'
import { addDaysISO } from '../../utils/workUtils'

export const FULL_AT = 85
export const ZERO_BELOW = 60
export const MIN_TASKS = 3

export function monthStartISO() { return istTodayISO().slice(0, 8) + '01' }

// Phase 690 - the office team (staff, HR, Accounts, Office Admin) is scored by work_office_score:
// tasks given on time 40 + hours 35 + in by 10:15 25. Pays from December 2026; shown from now so people see it coming.
export const OFFICE_ROLES = ['staff', 'hr', 'accounts', 'office_admin']
export function paidOnTime(role) { return OFFICE_ROLES.includes(role) }
export const NEW_SCORE_PAYS = () => monthStartISO() >= '2026-12-01'

// Month so far = 1st to yesterday (today is not over). null when the month has no finished day yet.
export function monthRange() {
  const from = monthStartISO()
  const to = addDaysISO(istTodayISO(), -1)
  return to < from ? null : [from, to]
}

// One office_scores call per range, shared by every card on the page (60 s cache). Resolves to rows or null.
const officeCache = new Map()
export function loadOfficeScores(from, to) {
  const k = `${from}|${to}`
  const hit = officeCache.get(k)
  if (hit && Date.now() - hit.t < 60000) return hit.p
  const p = supabase.rpc('office_scores', { p_from: from, p_to: to }).then(({ data, error }) => {
    if (error) { officeCache.delete(k); return null }
    return data || []
  })
  officeCache.set(k, { t: Date.now(), p })
  return p
}

export function scoreBand(v) {
  if (v == null) return { cls: '', pill: 'Too early' }
  if (v >= FULL_AT) return { cls: 'ok', pill: 'Full' }
  if (v < ZERO_BELOW) return { cls: 'bad', pill: 'None' }
  return { cls: 'warn', pill: 'Part' }
}

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

// Phase 483 - evening reports shared this month: { days, shared } or null. Display only, never touches pay.
export async function loadReports(userId) {
  const { data, error } = await supabase.rpc('work_report_stats', { p_user_id: userId, p_month_start: monthStartISO() })
  if (error || !data) return null
  return { days: Number(data.days) || 0, shared: Number(data.shared) || 0 }
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
  const [rep, setRep] = useState(null)
  useEffect(() => { let on = true; if (userId) loadReports(userId).then((v) => { if (on) setRep(v) }); return () => { on = false } }, [userId])
  const [o, setO] = useState(undefined)
  useEffect(() => {
    let on = true
    const r = monthRange()
    if (!r) { setO(null); return undefined }
    loadOfficeScores(r[0], r[1]).then((rows) => { if (on) setO((rows || []).find((x) => x.user_id === userId) || null) })
    return () => { on = false }
  }, [userId])
  if (s === undefined || o === undefined) return <div className="wk-card"><div className="wk-sm">Loading your work score...</div></div>
  if (s === null && !o) return null
  const pays = NEW_SCORE_PAYS()
  const score = o?.score == null ? null : Number(o.score)
  const b = scoreBand(score)
  const wd = Number(o?.work_days) || 0
  const parts = o ? [
    ['Tasks given to you, done on time', `${o.given_on_time} of ${o.given}`, o.task_pts, 40],
    ['Hours on tasks', `${Math.round(Number(o.hours))}h of ${Math.round(wd * 8)}h`, o.hours_pts, 35],
    ['In by 10:15', `${o.on_time_days} of ${o.full_days} days`, o.punct_pts, 25],
  ] : []
  return (
    <div className="wk-card">
      <div className="wk-ch"><h3>Work score - this month</h3></div>
      <div style={{ padding: '4px 20px 18px' }}>
        <div className="wk-row" style={{ alignItems: 'baseline' }}>
          <span className="wk-num" style={{ fontSize: 34, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{score == null ? '-' : Math.round(score)}<span style={{ fontSize: 16, opacity: 0.7 }}> / 100</span></span>
          <span className={`wk-pill ${pays ? b.cls : ''}`}>{pays ? b.pill : 'Pays from 1 Dec'}</span>
        </div>
        <div className="wk-bar" style={{ height: 8, margin: '10px 0' }}><i style={{ width: `${Math.min(100, score || 0)}%` }} /></div>
        {parts.map(([label, detail, pts, max]) => (
          <div key={label} className="wk-row" style={{ marginTop: 4 }}>
            <span className="wk-sm">{label} <span style={{ opacity: 0.75 }}>· {detail}</span></span>
            <span className="wk-num">{Math.round(Number(pts) || 0)} / {max}</span>
          </div>
        ))}
        {score == null && <div className="wk-sm">The score starts after your first working day of the month.</div>}
        {pays && score != null && <div className="wk-sm" style={{ marginTop: 6 }}>{score >= FULL_AT ? 'On track - full variable.' : score < ZERO_BELOW ? `Below ${ZERO_BELOW} - no variable.` : `Part of the variable. ${FULL_AT} gets the full amount.`}</div>}
        {!pays && s && <div className="wk-sm" style={{ marginTop: 6 }}>November pay still uses tasks finished on time: <b className="wk-num">{s.pct == null ? 'not enough tasks' : `${Math.round(s.pct)}%`}</b>. This new score decides the variable from 1 December.</div>}
        {s && <div className="wk-sm" style={{ marginTop: 6 }}>Variable so far: <b className="wk-num">{formatCurrency(s.earned)}</b> of {formatCurrency(s.cap)}</div>}
        {rep && rep.days > 0 && <div className="wk-sm" style={{ marginTop: 6 }}>Evening reports shared: <b className="wk-num">{rep.shared} of {rep.days}</b> working days. For information only - it does not change your pay.</div>}
        <div className="wk-sm" style={{ marginTop: 6, opacity: 0.8 }}>Only tasks someone else gives you count. Target 8 hours a working day. Office starts 10:00 - start your first timer by 10:15. Sundays, holidays and approved leave are left out. Counts up to yesterday.</div>
      </div>
    </div>
  )
}

export function OnTimeCell({ userId }) {
  const [o, setO] = useState(undefined)
  const [rep, setRep] = useState(null)
  useEffect(() => {
    let on = true
    const r = monthRange()
    if (r) loadOfficeScores(r[0], r[1]).then((rows) => { if (on) setO((rows || []).find((x) => x.user_id === userId) || null) })
    else setO(null)
    loadReports(userId).then((v) => { if (on) setRep(v) })
    return () => { on = false }
  }, [userId])
  const repTxt = rep && rep.days > 0 ? ` · reports ${rep.shared}/${rep.days}` : ''
  if (o === undefined) return <span className="wk-sm">...</span>
  if (!o || o.score == null) return <span className="wk-sm">-{repTxt}</span>
  const b = scoreBand(Number(o.score))
  const tip = `Work score this month: tasks ${Math.round(o.task_pts)}/40 (${o.given_on_time} of ${o.given} given done on time), hours ${Math.round(o.hours_pts)}/35 (${Math.round(o.hours)}h), in by 10:15 ${Math.round(o.punct_pts)}/25 (${o.on_time_days} of ${o.full_days} days)`
  return <span className={`wk-pill ${b.cls}`} title={tip}>Score {Math.round(o.score)}{repTxt}</span>
}
