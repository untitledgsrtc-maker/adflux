// src/pages/v2/WorkProfileV2.jsx - Phase 365. A person's work profile: details, photo,
// monthly check-in attendance calendar, hours + tasks this month. Own profile by default;
// a head opens anyone's with ?user=<id>. Check-in = the first timer start of the IST day
// (by 9:30 on time, to 11:30 late, after that half day - same rules as sales).
// Attendance here does NOT change pay: leave deduction still comes from the leave requests.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { istTodayISO } from '../../utils/istDate'
import ProfilePicUploader from '../../components/profile/ProfilePicUploader'
import { fmtDur, fmtTimeIST, initialsOf, addDaysISO } from '../../utils/workUtils'

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const istParts = (iso) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const g = (t) => f.find((x) => x.type === t)?.value
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, mins: Number(g('hour')) * 60 + Number(g('minute')) }
}
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const shiftMonth = (ym, n) => { const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) }

export default function WorkProfileV2({ embedded = false, userId = null }) {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const uid = profile?.id
  const targetId = userId || params.get('user') || uid
  const own = targetId === uid
  const today = istTodayISO()
  const [ym, setYm] = useState(today.slice(0, 7))
  const [person, setPerson] = useState(null)
  const [manager, setManager] = useState('')
  const [entries, setEntries] = useState([])
  const [leaves, setLeaves] = useState([])
  const [holidays, setHolidays] = useState([])
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!targetId) return
    setLoading(true); setErr('')
    const start = `${ym}-01`
    const end = addDaysISO(shiftMonth(ym, 1) + '-01', 0)
    const t0 = `${start}T00:00:00+05:30`, t1 = `${end}T00:00:00+05:30`
    const [u, en, lv, ho, pa] = await Promise.all([
      supabase.from('users').select('id,name,email,designation,city,manager_id,profile_image_url,created_at').eq('id', targetId).maybeSingle(),
      supabase.from('work_time_entries').select('started_at,ended_at,status,break_seconds').eq('user_id', targetId).eq('status', 'approved').gte('started_at', t0).lt('started_at', t1).limit(1500),
      supabase.from('leaves').select('leave_date,status,is_half_day').eq('user_id', targetId).gte('leave_date', start).lt('leave_date', end).limit(100),
      supabase.from('holidays').select('holiday_date,name').eq('is_active', true).gte('holiday_date', start).lt('holiday_date', end),
      supabase.from('work_task_parts').select('id,status,due_date,finished_at').eq('assignee_id', targetId).gte('due_date', start).lt('due_date', end).limit(1000),
    ])
    const e = [u, en, lv, ho, pa].find((r) => r.error)
    if (e) { setErr(e.error.message || 'Could not load.'); setLoading(false); return }
    setPerson(u.data); setEntries(en.data || []); setLeaves(lv.data || []); setHolidays(ho.data || []); setParts(pa.data || [])
    if (u.data?.manager_id) {
      const m = await supabase.from('users').select('name').eq('id', u.data.manager_id).maybeSingle()
      setManager(m.data?.name || '')
    } else setManager('')
    setLoading(false)
  }, [targetId, ym])
  useEffect(() => { load() }, [load])

  // per day: first start (check-in), total seconds
  const days = useMemo(() => {
    const m = {}
    entries.forEach((e) => {
      const { ymd, mins } = istParts(e.started_at)
      const secs = e.ended_at ? Math.max(0, (new Date(e.ended_at) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0)) : 0
      const d = m[ymd] || (m[ymd] = { first: e.started_at, firstMins: mins, secs: 0 })
      if (new Date(e.started_at) < new Date(d.first)) { d.first = e.started_at; d.firstMins = mins }
      d.secs += secs
    })
    return m
  }, [entries])
  const leaveBy = useMemo(() => { const m = {}; leaves.forEach((l) => { if (l.status === 'approved') m[l.leave_date] = l }); return m }, [leaves])
  const holBy = useMemo(() => { const m = {}; holidays.forEach((h) => { m[h.holiday_date] = h }); return m }, [holidays])

  const cells = useMemo(() => {
    const first = new Date(`${ym}-01T00:00:00Z`)
    const dow = (first.getUTCDay() + 6) % 7                       // Monday first
    const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    const out = Array.from({ length: dow }, () => null)
    for (let d = 1; d <= dim; d++) {
      const ymd = `${ym}-${String(d).padStart(2, '0')}`
      const day = days[ymd]
      const isSun = new Date(`${ymd}T00:00:00Z`).getUTCDay() === 0
      let kind = 'future', label = ''
      if (ymd > today) kind = 'future'
      else if (day) {
        kind = day.firstMins <= 9 * 60 + 30 ? 'ok' : day.firstMins <= 11 * 60 + 30 ? 'late' : 'half'
        label = fmtTimeIST(day.first)
      } else if (leaveBy[ymd]) { kind = 'leave'; label = 'Leave' }
      else if (holBy[ymd]) { kind = 'off'; label = 'Holiday' }
      else if (isSun) { kind = 'off'; label = 'Sunday' }
      else kind = 'absent'
      out.push({ d, ymd, kind, label, secs: day?.secs || 0 })
    }
    return out
  }, [ym, days, leaveBy, holBy, today])

  const present = cells.filter((c) => c && ['ok', 'late', 'half'].includes(c.kind))
  const onTime = cells.filter((c) => c?.kind === 'ok').length
  const late = cells.filter((c) => c?.kind === 'late' || c?.kind === 'half').length
  const avgIn = present.length ? Math.round(present.reduce((s, c) => s + days[c.ymd].firstMins, 0) / present.length) : null
  const monthSecs = Object.values(days).reduce((s, d) => s + d.secs, 0)
  // Tasks DUE this month: total, finished on/before the due date, and overdue (not done, due date passed
  // or finished after the due date).
  const taskTotal = parts.length
  const taskOnTime = parts.filter((p) => p.status === 'finished' && p.finished_at && istParts(p.finished_at).ymd <= p.due_date).length
  const taskOverdue = parts.filter((p) => (p.status !== 'finished' && p.due_date < today) || (p.status === 'finished' && p.finished_at && istParts(p.finished_at).ymd > p.due_date)).length
  const tasksFinished = parts.filter((p) => p.status === 'finished').length
  // Work score (display only, no pay effect): 40 tasks on time + 30 on-time clock-in + 30 hours vs 8 h/day.
  // Days before today only; leave, Sundays and holidays are not counted; a part with no data is left out
  // and the rest is scaled to 100.
  const score = (() => {
    const due = parts.filter((p) => p.due_date && (p.due_date <= today || p.status === 'finished'))
    const dueOnTime = due.filter((p) => p.status === 'finished' && p.finished_at && istParts(p.finished_at).ymd <= p.due_date).length
    const work = cells.filter((c) => c && c.ymd < today && ['ok', 'late', 'half', 'absent'].includes(c.kind))
    const inOnTime = work.filter((c) => c.kind === 'ok').length
    const hoursPct = work.length ? work.reduce((t, c) => t + Math.min(c.secs, 8 * 3600) / (8 * 3600), 0) / work.length : null
    const parts3 = [
      { key: 'tasks', label: 'Tasks on time', max: 40, frac: due.length ? dueOnTime / due.length : null, note: due.length ? `${dueOnTime} of ${due.length} due` : 'No tasks due yet' },
      { key: 'clock', label: 'On-time clock-in', max: 30, frac: work.length ? inOnTime / work.length : null, note: work.length ? `${inOnTime} of ${work.length} working days` : 'No working days yet' },
      { key: 'hours', label: 'Hours vs 8 h a day', max: 30, frac: hoursPct, note: hoursPct == null ? 'No working days yet' : `${Math.round(hoursPct * 100)}% of target` },
    ]
    const avail = parts3.filter((x) => x.frac != null)
    const possible = avail.reduce((t, x) => t + x.max, 0)
    const earned = avail.reduce((t, x) => t + x.max * x.frac, 0)
    return { parts: parts3, total: possible ? Math.round(earned / possible * 100) : null }
  })()
  const TONE = { ok: 'var(--success-soft)', late: 'var(--warning-soft)', half: 'var(--warning-soft)', leave: 'var(--danger-soft)', absent: 'var(--danger-soft)', off: 'transparent', future: 'transparent' }
  const COLOR = { ok: 'var(--success)', late: 'var(--warning)', half: 'var(--warning)', leave: 'var(--danger)', absent: 'var(--danger)', off: 'var(--text-muted)', future: 'var(--text-muted)' }

  if (!uid) return null
  const joined = person?.created_at ? new Date(person.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
  const kpi = (label, value, sub, tone) => (
    <div className="wk-card" key={label}>
      <div className="wk-eyb">{label}</div>
      <div className="wk-kpi-n" style={{ color: tone || undefined }}>{value}</div>
      {sub && <div className="wk-sm">{sub}</div>}
    </div>
  )
  return (
    <div className="wk" style={embedded ? { padding: 0 } : undefined}>
      {!embedded && (
        <div className="wk-head">
          <div>
            <div className="wk-eyebrow">{own ? 'My profile' : 'Team member'}</div>
            <h1 className="wk-title">{person?.name || 'Profile'}</h1>
          </div>
          <Link to={own ? '/my-work' : '/team-work'} className="wk-btn o">Back</Link>
        </div>
      )}
      {err && <div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div>}
      {loading && !person && !err && (
        <div className="wk-grid">
          <div className="wk-c12"><div className="wk-skel" style={{ height: 110, borderRadius: 16 }} /></div>
          <div className="wk-c4"><div className="wk-skel" style={{ height: 320, borderRadius: 16 }} /></div>
          <div className="wk-c8"><div className="wk-skel" style={{ height: 320, borderRadius: 16 }} /></div>
        </div>
      )}
      {!loading && !person && !err && <div className="wk-empty"><b>Profile not found</b>This profile could not be found.</div>}
      {person && (
        <div className="wk-grid">
          <div className="wk-c12">
            <div className="wk-hero">
              <span className="wk-eyb">{monthLabel(ym)} · hours tracked</span>
              <div className="wk-num" style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>{fmtDur(monthSecs)}</div>
              <div className="wk-hs">{present.length} {present.length === 1 ? 'day' : 'days'} present · {tasksFinished} of {taskTotal} tasks finished</div>
            </div>
          </div>

          <div className="wk-c4">
            <div className="wk-card" style={{ textAlign: 'center' }}>
              {own ? <ProfilePicUploader /> : (
                person.profile_image_url
                  ? <img src={person.profile_image_url} alt="" style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover' }} />
                  : <div className="wk-av" style={{ width: 96, height: 96, fontSize: 32, margin: '0 auto' }}>{initialsOf(person.name)}</div>
              )}
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, marginTop: 12 }}>{person.name}</div>
              <div className="wk-mu">{person.designation || 'Team member'}</div>
              <dl className="wk-dl" style={{ textAlign: 'left' }}>
                <dt>Reports to</dt><dd>{manager || '-'}</dd>
                <dt>City</dt><dd>{person.city || '-'}</dd>
                <dt>Joined</dt><dd className="wk-mono">{joined}</dd>
                <dt>Email</dt><dd style={{ wordBreak: 'break-all' }}>{person.email || '-'}</dd>
              </dl>
              {own && (
                <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
                  <Link to="/my-offer" className="wk-btn o sm">Leave request</Link>
                  <Link to="/my-performance" className="wk-btn o sm">Salary slips</Link>
                </div>
              )}
            </div>
          </div>

          <div className="wk-c8">
            <div className="wk-row" style={{ marginBottom: 16 }}>
              <div className="wk-grp">
                <button className="wk-btn o ic" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, minWidth: 150, textAlign: 'center' }}>{monthLabel(ym)}</h2>
                <button className="wk-btn o ic" aria-label="Next month" disabled={ym >= today.slice(0, 7)} onClick={() => setYm(shiftMonth(ym, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
              </div>
            </div>
            <div className="wk-card" style={{ marginBottom: 16 }}>
              <div className="wk-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
                <div><div className="wk-eyb">Work score</div><div className="wk-kpi-n" style={{ color: score.total == null ? undefined : score.total >= 75 ? 'var(--success)' : score.total >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{score.total == null ? '-' : score.total}<span className="wk-sm"> / 100</span></div></div>
                <div className="wk-sm" style={{ maxWidth: 260, textAlign: 'right' }}>For you to see how the month is going. It does not change salary.</div>
              </div>
              {score.parts.map((x) => (
                <div key={x.key} style={{ marginBottom: 10 }}>
                  <div className="wk-row" style={{ fontSize: 13, marginBottom: 4 }}><span>{x.label}</span><span className="wk-num">{x.frac == null ? '-' : Math.round(x.max * x.frac)} / {x.max}</span></div>
                  <div className="wk-bar-h"><i style={{ width: `${x.frac == null ? 0 : x.frac * 100}%` }} /></div>
                  <div className="wk-sm" style={{ marginTop: 2 }}>{x.note}</div>
                </div>
              ))}
            </div>
            <div className="wk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              {kpi('Present days', present.length)}
              {kpi('On time', onTime, 'By 09:30', 'var(--success)')}
              {kpi('Late', late, 'Incl. half days', 'var(--warning)')}
              {kpi('Average check-in', avgIn == null ? '-' : `${String(Math.floor(avgIn / 60)).padStart(2, '0')}:${String(avgIn % 60).padStart(2, '0')}`)}
              {kpi('Tasks this month', taskTotal, `${tasksFinished} finished`)}
              {kpi('Done on time', taskOnTime, null, 'var(--success)')}
              {kpi('Overdue', taskOverdue, taskOverdue ? 'Needs attention' : null, taskOverdue ? 'var(--danger)' : undefined)}
            </div>
          </div>

          <div className="wk-c12">
            <div className="wk-card flush">
              <div className="wk-ch">
                <h3><span className="wk-tile"><Calendar size={16} aria-hidden="true" /></span>Attendance</h3>
                <div className="wk-grp" style={{ fontSize: 12 }}>
                  <span className="wk-pill ok">On time</span><span className="wk-pill warn">Late or half day</span>
                  <span className="wk-pill bad">No clock-in</span><span className="wk-pill">Sunday or holiday</span>
                </div>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
                  {WD.map((w) => <div key={w} className="wk-sm" style={{ textAlign: 'center', paddingBottom: 4 }}>{w}</div>)}
                  {cells.map((c, i) => c ? (
                    <div key={c.ymd} className="wk-cal" title={c.label ? `${c.d}: ${c.label}` : undefined}
                      style={{ background: TONE[c.kind], color: COLOR[c.kind], borderColor: c.ymd === today ? 'var(--accent)' : c.kind === 'future' ? 'var(--border)' : 'transparent' }}>
                      <span className="wk-num" style={{ fontSize: 12, color: c.kind === 'future' ? 'var(--text-muted)' : 'var(--text)' }}>{c.d}</span>
                      {c.label && c.kind !== 'future' && <span className={c.kind === 'ok' || c.kind === 'late' || c.kind === 'half' ? 'wk-mono' : ''} style={{ fontWeight: 500, fontSize: 14 }}>{c.label}</span>}
                      {c.kind === 'absent' && <span style={{ fontSize: 13 }}>No clock-in</span>}
                      {c.kind === 'half' && <span style={{ fontSize: 12 }}>Half day</span>}
                      {c.secs > 0 && <span className="wk-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDur(c.secs)}</span>}
                    </div>
                  ) : <div key={`e${i}`} />)}
                </div>
                <div className="wk-sm" style={{ marginTop: 14 }}>First timer start of the day is the check-in: by 9:30 on time, to 11:30 late, after that a half day. Attendance does not change pay by itself.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
