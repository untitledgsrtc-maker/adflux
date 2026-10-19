// src/components/work/WorkCalendar.jsx - Phase 432. Month calendar for the Work module.
// Every task part shows on its due date, holidays and Sundays are marked, the side panel lists the picked day.
// Everyone sees their own tasks; a head / admin can switch to Everyone. Read only - opening a task uses the normal task box.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, CalendarOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import { addDaysISO, fmtDateShort, STATUS_LABEL } from '../../utils/workUtils'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}` }

export default function WorkCalendar({ uid, isHead, nameOf, onOpen, defaultScope = 'mine' }) {
  const today = istTodayISO()
  const [cur, setCur] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [sel, setSel] = useState(today)
  const [scope, setScope] = useState(defaultScope)
  const [parts, setParts] = useState([])
  const [holidays, setHolidays] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const first = ymd(cur.y, cur.m, 1)
  const daysIn = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate()
  const last = ymd(cur.y, cur.m, daysIn)
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7   // Monday first

  const load = useCallback(async () => {
    if (!uid) return
    setLoading(true); setErr('')
    let q = supabase.from('work_task_parts')
      .select('id,task_id,assignee_id,due_date,due_time,status,task:work_tasks(id,title)')
      .gte('due_date', first).lte('due_date', last).order('due_time', { nullsFirst: false }).limit(1500)
    if (scope === 'mine' || !isHead) q = q.eq('assignee_id', uid)
    const [p, h] = await Promise.all([q, supabase.from('holidays').select('holiday_date,name').eq('is_active', true).gte('holiday_date', first).lte('holiday_date', last)])
    const e = [p, h].find((r) => r.error)
    if (e) { setErr(e.error.message || 'Could not load the calendar.'); setLoading(false); return }
    setParts(p.data || [])
    setHolidays(Object.fromEntries((h.data || []).map((r) => [r.holiday_date, r.name])))
    setLoading(false)
  }, [uid, first, last, scope, isHead])
  useEffect(() => { load() }, [load])

  const byDay = useMemo(() => {
    const m = {}
    for (const p of parts) (m[p.due_date] ||= []).push(p)
    return m
  }, [parts])

  const go = (n) => setCur((c) => { const t = c.m + n; return { y: c.y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })
  const title = new Date(Date.UTC(cur.y, cur.m, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' })
  const dayParts = byDay[sel] || []
  const isSunday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(ymd(cur.y, cur.m, d))

  return (
    <div className="wkc">
      <div className="wk-row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="wk-grp">
          <button className="wk-btn o sm" onClick={() => go(-1)} aria-label="Previous month"><ChevronLeft size={16} aria-hidden="true" /></button>
          <h2 style={{ margin: 0, fontSize: 22, minWidth: 170, textAlign: 'center' }}>{title}</h2>
          <button className="wk-btn o sm" onClick={() => go(1)} aria-label="Next month"><ChevronRight size={16} aria-hidden="true" /></button>
          <button className="wk-btn o sm" onClick={() => { setCur({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }); setSel(today) }}>Today</button>
        </div>
        {isHead && (
          <div className="wk-seg" role="group" aria-label="Whose tasks">
            {[['mine', 'Mine'], ['all', 'Everyone']].map(([k, l]) => (
              <button key={k} className={`wk-tab${scope === k ? ' on' : ''}`} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="wk-err" role="alert" style={{ marginBottom: 14 }}><span>{err}</span><button className="wk-btn o sm" onClick={load}>Retry</button></div>}

      <div className="wkc-wrap">
        <div className="wk-card wkc-grid-card" aria-busy={loading}>
          <div className="wkc-grid" role="grid" aria-label={title}>
            {DOW.map((d) => <div key={d} className="wkc-dow" role="columnheader">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`b${i}`} className="wkc-cell wkc-blank" />
              const list = byDay[d] || []
              const open = list.filter((p) => p.status !== 'finished').length
              const hol = holidays[d]
              const off = hol || isSunday(d)
              return (
                <button key={d} role="gridcell" className={`wkc-cell${d === sel ? ' sel' : ''}${d === today ? ' today' : ''}${off ? ' off' : ''}`}
                  onClick={() => setSel(d)} aria-label={`${fmtDateShort(d)}${hol ? `, holiday ${hol}` : ''}, ${list.length} tasks`}>
                  <span className="wkc-num">{Number(d.slice(8))}</span>
                  {hol && <span className="wkc-hol" title={hol}>{hol}</span>}
                  {list.slice(0, 2).map((p) => (
                    <span key={p.id} className={`wkc-ev${p.status === 'finished' ? ' done' : ''}`}>{p.task?.title || 'Task'}</span>
                  ))}
                  {list.length > 2 && <span className="wkc-more">+{list.length - 2} more</span>}
                  {list.length > 0 && <span className={`wkc-dot${open ? '' : ' ok'}`} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
          {loading && <div className="wk-sm" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={14} className="wkc-spin" aria-hidden="true" /> Loading</div>}
        </div>

        <div className="wk-card wkc-side">
          <div className="wk-eyb">{new Date(`${sel}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long' })}</div>
          <h3 style={{ margin: '2px 0 12px', fontSize: 20 }}>{new Date(`${sel}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long' })}</h3>
          {(holidays[sel] || isSunday(sel)) && (
            <div className="wkc-offnote"><CalendarOff size={14} aria-hidden="true" /> {holidays[sel] ? `Holiday: ${holidays[sel]}` : 'Sunday'} - repeating tasks wait for the next working day</div>
          )}
          {dayParts.length === 0 && <div className="wk-empty">No tasks on this day.</div>}
          {dayParts.map((p) => (
            <button key={p.id} className="wkc-item" onClick={() => onOpen?.(p.task_id)}>
              <span className="wkc-it-t">{p.task?.title || 'Task'}</span>
              <span className="wk-sm">
                {p.due_time ? `${fmtTime(p.due_time)} - ` : ''}{scope === 'all' && isHead ? `${nameOf(p.assignee_id)} - ` : ''}{STATUS_LABEL[p.status] || p.status}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
