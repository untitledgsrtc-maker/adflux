// src/pages/v2/WorkProfileV2.jsx - Phase 365. A person's work profile: details, photo,
// monthly check-in attendance calendar, hours + tasks this month. Own profile by default;
// a head opens anyone's with ?user=<id>. Check-in = the first timer start of the IST day
// (by 9:30 on time, to 11:30 late, after that half day - same rules as sales).
// Attendance here does NOT change pay: leave deduction still comes from the leave requests.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
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

export default function WorkProfileV2() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const uid = profile?.id
  const targetId = params.get('user') || uid
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
      supabase.from('work_time_entries').select('started_at,ended_at,status').eq('user_id', targetId).eq('status', 'approved').gte('started_at', t0).lt('started_at', t1).limit(1500),
      supabase.from('leaves').select('leave_date,status,is_half_day').eq('user_id', targetId).gte('leave_date', start).lt('leave_date', end).limit(100),
      supabase.from('holidays').select('holiday_date,name').eq('is_active', true).gte('holiday_date', start).lt('holiday_date', end),
      supabase.from('work_task_parts').select('id,status,due_date,finished_at').eq('assignee_id', targetId).eq('status', 'finished').gte('finished_at', t0).lt('finished_at', t1).limit(500),
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
      const secs = e.ended_at ? (new Date(e.ended_at) - new Date(e.started_at)) / 1000 : 0
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
  const lateFinish = parts.filter((p) => p.due_date && p.finished_at && istParts(p.finished_at).ymd > p.due_date).length
  const TONE = { ok: 'var(--success-soft)', late: 'var(--warning-soft)', half: 'var(--warning-soft)', leave: 'var(--danger-soft)', absent: 'var(--danger-soft)', off: 'transparent', future: 'transparent' }
  const COLOR = { ok: 'var(--success)', late: 'var(--warning)', half: 'var(--warning)', leave: 'var(--danger)', absent: 'var(--danger)', off: 'var(--text-muted)', future: 'var(--text-muted)' }

  if (!uid) return null
  return (
    <div className="wk">
      <div className="wk-head">
        <div>
          <div className="wk-eyebrow">{own ? 'My profile' : 'Team member'}</div>
          <h1 className="wk-title">{person?.name || 'Profile'}</h1>
        </div>
        <Link to={own ? '/my-work' : '/team-work'} className="wk-btn o">Back</Link>
      </div>
      {err && <div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div>}
      {loading && !person && !err && <div className="wk-empty"><Loader2 className="spin" size={26} aria-hidden="true" /></div>}
      {!loading && !person && !err && <div className="wk-empty">This profile could not be found.</div>}
      {person && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
          <div className="wk-card" style={{ textAlign: 'center' }}>
            {own ? <ProfilePicUploader /> : (
              person.profile_image_url
                ? <img src={person.profile_image_url} alt="" style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover' }} />
                : <div className="wk-av" style={{ width: 96, height: 96, fontSize: 32, margin: '0 auto' }}>{initialsOf(person.name)}</div>
            )}
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, marginTop: 10 }}>{person.name}</div>
            <div className="wk-sm">{person.designation || 'Team member'}</div>
            <table className="wk-table" style={{ marginTop: 12, textAlign: 'left' }}><tbody>
              <tr><td className="wk-sm">Reports to</td><td>{manager || '-'}</td></tr>
              <tr><td className="wk-sm">City</td><td>{person.city || '-'}</td></tr>
              <tr><td className="wk-sm">Joined</td><td>{person.created_at ? new Date(person.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td></tr>
              <tr><td className="wk-sm">Email</td><td style={{ wordBreak: 'break-all' }}>{person.email || '-'}</td></tr>
            </tbody></table>
            {own && (
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                <Link to="/my-offer" className="wk-btn o sm">My Offer - leave request</Link>
                <Link to="/my-performance" className="wk-btn o sm">Salary slips</Link>
              </div>
            )}
          </div>

          <div>
            <div className="wk-kpis" style={{ marginTop: 0 }}>
              <div className="wk-card"><div className="wk-sm">Present</div><div className="wk-kpi-n">{present.length}</div></div>
              <div className="wk-card"><div className="wk-sm">On time</div><div className="wk-kpi-n" style={{ color: 'var(--success)' }}>{onTime}</div></div>
              <div className="wk-card"><div className="wk-sm">Late</div><div className="wk-kpi-n" style={{ color: 'var(--warning)' }}>{late}</div></div>
              <div className="wk-card"><div className="wk-sm">Avg check-in</div><div className="wk-kpi-n">{avgIn == null ? '-' : `${String(Math.floor(avgIn / 60)).padStart(2, '0')}:${String(avgIn % 60).padStart(2, '0')}`}</div></div>
            </div>
            <div className="wk-card" style={{ marginTop: 14 }}>
              <div className="wk-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
                <b style={{ fontSize: 18 }}>Check-in attendance - {monthLabel(ym)}</b>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="wk-btn o sm" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
                  <button className="wk-btn o sm" aria-label="Next month" disabled={ym >= today.slice(0, 7)} onClick={() => setYm(shiftMonth(ym, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
                {WD.map((w) => <div key={w} className="wk-sm" style={{ textAlign: 'center' }}>{w}</div>)}
                {cells.map((c, i) => c ? (
                  <div key={c.ymd} title={c.label ? `${c.d}: ${c.label}` : undefined}
                    style={{ minHeight: 54, borderRadius: 10, padding: '6px 8px', background: TONE[c.kind], color: COLOR[c.kind], border: `1px solid ${c.ymd === today ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <b className="wk-num" style={{ fontSize: 15 }}>{c.d}</b>
                    <span style={{ fontSize: 11 }}>{c.kind === 'absent' ? 'No clock-in' : c.label}</span>
                  </div>
                ) : <div key={`e${i}`} />)}
              </div>
              <div className="wk-chips">
                <span className="wk-pill ok">On time - by 9:30</span><span className="wk-pill warn">Late / half day</span>
                <span className="wk-pill bad">Leave / no clock-in</span><span className="wk-pill">Sunday / holiday</span>
              </div>
              <div className="wk-sm" style={{ marginTop: 10 }}>First timer start of the day is the check-in: by 9:30 on time, to 11:30 late, after that a half day. Attendance does not change pay by itself.</div>
            </div>
            <div className="wk-card" style={{ marginTop: 14 }}>
              <b style={{ fontSize: 18 }}>This month at work</b>
              <div className="wk-row" style={{ marginTop: 10 }}><span className="wk-sm">Hours tracked</span><b className="wk-num">{fmtDur(monthSecs)}</b></div>
              <div className="wk-row" style={{ marginTop: 8 }}><span className="wk-sm">Tasks finished</span><b className="wk-num">{parts.length}</b></div>
              <div className="wk-row" style={{ marginTop: 8 }}><span className="wk-sm">Finished after the due date</span><b className="wk-num" style={{ color: lateFinish ? 'var(--warning)' : 'var(--text)' }}>{lateFinish}</b></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
