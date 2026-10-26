// src/pages/v2/MyWorkV2.jsx - Phase 365. The person's Work page (timeclock + tasks).
// Running clock, start without a task, my board (drag or Start / Finish), tasks I asked
// for, my hours (+ add forgotten time), evening report after 7 PM. Writes only through
// the work_* database functions. Hours have NO pay effect.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Play, Pause, Check, Plus, Send, Clock, Users, User, CalendarX, FileText, Moon, ChevronRight } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { istTodayISO } from '../../utils/istDate'
import { toastError, toastSuccess, pushToast } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { openWhatsAppShare } from '../../utils/whatsappSummary'
import { openExternalUrl } from '../../utils/openExternal'
import { fmtDur, fmtClock, dayStartISO, addDaysISO, fmtTimeIST, fmtDateShort, istHour, dueState, initialsOf, clientColor } from '../../utils/workUtils'
import WorkBoard from '../../components/work/WorkBoard'
import NewTaskModal from '../../components/work/NewTaskModal'
import PostponeModal from '../../components/work/PostponeModal'
import TaskDetailModal from '../../components/work/TaskDetailModal'
import OnTimeScoreCard from '../../components/work/OnTimeScoreCard'
import UserAvatar from '../../components/common/UserAvatar'
import WorkCalendar from '../../components/work/WorkCalendar'
import DateField from '../../components/work/DateField'

export default function MyWorkV2() {
  const { profile } = useAuth()
  const uid = profile?.id
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(['asked', 'hours', 'calendar'].includes(sp.get('tab')) ? sp.get('tab') : 'work')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [member, setMember] = useState(null)       // my work_members row or null
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [running, setRunning] = useState(null)
  const [entries, setEntries] = useState([])       // today's entries
  const [parts, setParts] = useState([])
  const [nudgedIds, setNudgedIds] = useState([])   // Phase 484
  const nudgedParts = useMemo(() => new Set(nudgedIds), [nudgedIds])
  const [postponing, setPostponing] = useState(null)   // item being postponed (Postpone box)
  const [tagged, setTagged] = useState([])             // tasks postponed at MY request (I was tagged)
  const [viewFrom, setViewFrom] = useState(null)   // null = Today (today's tasks + anything overdue)
  const [viewTo, setViewTo] = useState(null)
  const [asked, setAsked] = useState([])
  const [shared, setShared] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [skew, setSkew] = useState(0)   // Phase 446: server clock minus this PC's clock (ms)
  const [newTask, setNewTask] = useState(false)
  const [openTask, setOpenTask] = useState(null)
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)

  const today = istTodayISO()
  const isAdmin = profile?.role === 'admin'
  const isHead = isAdmin || !!member?.is_head
  const isMember = isAdmin || !!member
  // A person who is not on the timeclock (sales / telecaller asking for work) has no Work tab: open on 'Asked by me'.
  useEffect(() => { if (!loading && !isMember && tab === 'work') setTab('asked') }, [loading, isMember, tab])

  const load = useCallback(async () => {
    if (!uid) return
    setErr('')
    const t0 = dayStartISO(today)
    const [m, pr, us, run, en, pa, ak, sh] = await Promise.all([
      supabase.from('work_members').select('user_id,is_head').eq('user_id', uid).maybeSingle(),
      supabase.from('work_projects').select('id,name,kind').eq('is_active', true).order('name'),
      supabase.from('users').select('id,name,designation,role,profile_image_url').eq('is_active', true).neq('role', 'agency').order('name'),
      supabase.from('work_time_entries').select('*').eq('user_id', uid).is('ended_at', null).maybeSingle(),
      supabase.from('work_time_entries').select('*').eq('user_id', uid).gte('started_at', t0).order('started_at'),
      supabase.from('work_task_parts')
        .select('id,task_id,assignee_id,label,due_date,due_time,created_at,status,started_at,finished_at,seconds,postponed_until,postponed_by_users,postponed_by_client,postpone_count,task:work_tasks(id,title,project_id,created_by,due_date,status,is_auto,is_urgent)')
        .eq('assignee_id', uid).or(`status.neq.finished,finished_at.gte.${dayStartISO(addDaysISO(today, -14))}`).limit(300),
      supabase.from('work_tasks')
        .select('id,title,project_id,due_date,status,created_at,parts:work_task_parts(id,assignee_id,label,status,due_date,reject_kind,reject_reason)')
        .eq('created_by', uid).order('created_at', { ascending: false }).limit(60),
      supabase.from('work_report_shares').select('shared_at').eq('user_id', uid).eq('work_date', today).maybeSingle(),
    ])
    const e = [m, pr, us, run, en, pa, ak, sh].find((r) => r.error)
    if (e) { setErr(e.error.message || 'Could not load.'); setLoading(false); return }
    setMember(m.data); setProjects(pr.data || []); setUsers(us.data || [])
    setRunning(run.data || null); setEntries(en.data || []); setParts(pa.data || [])
    setAsked(ak.data || []); setShared(sh.data || null)
    setLoading(false)
    // Phase 446: how far this PC's clock is from the server's (half the round trip allowed for)
    try {
      const t0 = Date.now()
      const { data: srv } = await supabase.rpc('work_server_time')
      if (srv) setSkew(Date.parse(srv) - (t0 + (Date.now() - t0) / 2))
    } catch { /* keep the last value */ }
    // tasks someone postponed and tagged ME as the one who asked (read only, best effort)
    // Phase 484: tasks someone nudged me about in the last 2 days stay on today's board (best effort)
    supabase.from('work_task_nudges').select('part_id').eq('user_id', uid).gte('created_at', dayStartISO(addDaysISO(today, -2)))
      .then(({ data }) => setNudgedIds((data || []).map((r) => r.part_id)))
    supabase.from('work_task_parts').select('id,assignee_id,postponed_until,postponed_by_client,task:work_tasks(title)')
      .eq('status', 'postponed').contains('postponed_by_users', [uid]).limit(30)
      .then(({ data }) => setTagged(data || []))
  }, [uid, today])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load, { userId: uid, pollSeconds: 60 })
  // Phase 405 - a task assigned to me (or changed) appears at once, with a message. No refresh needed.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  useEffect(() => {
    if (!uid) return undefined
    const ch = supabase.channel(`my-work-parts-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_task_parts', filter: `assignee_id=eq.${uid}` }, async (ev) => {
        loadRef.current?.()
        if (ev.eventType !== 'INSERT') return
        let title = 'A new task'
        try {
          const { data } = await supabase.from('work_tasks').select('title').eq('id', ev.new?.task_id).maybeSingle()
          if (data?.title) title = data.title
        } catch { /* generic message */ }
        pushToast(`New task for you: ${title}`, 'success')
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('New task for you', { body: title, tag: `wk-part-${ev.new?.id}` }) } catch { /* not supported here */ }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid])
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const i = setInterval(tick, 1000)
    // a hidden / minimised window can pause its timers: catch up the moment it is seen again
    document.addEventListener('visibilitychange', tick); window.addEventListener('focus', tick)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick) }
  }, [])
  const [idleFreeze, setIdleFreeze] = useState(null)
  useEffect(() => {
    const h = (e) => setIdleFreeze(e.detail?.began || null)
    window.addEventListener('wk-idle-freeze', h)
    return () => window.removeEventListener('wk-idle-freeze', h)
  }, [])

  const projName = useMemo(() => { const m = new Map(projects.map((p) => [p.id, p.name])); return (id) => m.get(id) || '' }, [projects])
  const photoOf = useMemo(() => { const m = new Map(users.map((u) => [u.id, u.profile_image_url])); return (id) => m.get(id) || null }, [users])
  const nameOf = useMemo(() => { const m = new Map(users.map((u) => [u.id, u.name])); return (id) => m.get(id) || 'Someone' }, [users])

  const rpc = async (name, args, okMsg) => {
    if (latch.current) return false
    latch.current = true; setBusy(true)
    try {
      const { error } = await supabase.rpc(name, args)
      if (error) throw error
      if (okMsg) toastSuccess(okMsg)
      await load()
      return true
    } catch (e) { toastError(e, 'That did not work.'); return false } finally { latch.current = false; setBusy(false) }
  }

  // A typed timer becomes a real task card for herself (due today) and the timer moves onto it.
  const createCardAndStart = async (project, label) => {
    if (latch.current) return
    try {
      const { data: taskId, error } = await supabase.rpc('work_create_task', {
        p_title: label, p_project: project, p_note: null, p_due: today, p_parts: [{ assignee: uid, label: '', due: null }], p_steps: [],
      })
      if (error) throw error
      const { data: pr, error: e2 } = await supabase.from('work_task_parts').select('id').eq('task_id', taskId).eq('assignee_id', uid).maybeSingle()
      if (e2 || !pr) throw e2 || new Error('task card not found')
      const started = await rpc('work_clock_start', { p_project: null, p_label: null, p_part: pr.id })   // also stops the typed timer
      if (started) toastSuccess('Task card created. It is under In process.')
    } catch (e) { toastError(e, 'Could not create the task.') }
  }

  const addProject = async (name) => {
    const { data, error } = await supabase.rpc('work_add_project', { p_name: name, p_kind: 'client' })
    if (error) throw error
    await load()
    return data
  }

  // board items
  const items = useMemo(() => parts.map((p) => ({
    postponedUntil: p.postponed_until, postponeCount: p.postpone_count || 0,
    postponedBy: [...(p.postponed_by_users || []).map((id) => nameOf(id)), p.postponed_by_client ? `${p.postponed_by_client} (client)` : ''].filter(Boolean).join(', '),
    id: p.id, taskId: p.task_id, finishedAt: p.finished_at, status: p.status, title: p.task?.title || 'Task', label: p.label,
    createdDay: p.created_at ? new Date(p.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null,
    urgent: !!p.task?.is_urgent, client: projName(p.task?.project_id), due: p.due_date || p.task?.due_date, dueTime: p.due_time, assigneeId: p.assignee_id,
    assigneeName: nameOf(p.assignee_id), assigneePhoto: photoOf(p.assignee_id), finishedDay: p.finished_at ? new Date(p.finished_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null, partsTotal: 1, partsDone: 0, seconds: p.seconds, cost: null,
  })), [parts, projName, nameOf, photoOf])

  // Date filter. Default = Today: today's tasks + everything overdue + what was finished TODAY (yesterday's
  // finished ones drop off). A From - To range shows the tasks due in the range and the ones finished in it.
  const isToday = !viewFrom
  const rFrom = viewFrom || today
  const rTo = (viewTo && viewTo >= rFrom) ? viewTo : rFrom
  // Phase 479: made by hand = on the board only if given TODAY (any due date) or due within 2 days; older hand-made far-dated ones wait behind the later bar. Phase 448: made by hand = always on the board; made by the system (repeating / from a quote / HR / finance) = only when due within 2 days
  const showNow = (i) => !i.due || i.due <= addDaysISO(today, 2) || (!i.p?.task?.is_auto && i.createdDay === today) || nudgedParts.has(i.id)   // Phase 484: nudged in the last 2 days = on today's board
  const boardItems = items.filter((i) => {
    if (i.status === 'postponed') return true   // the Postponed column always shows what is waiting
    if (i.status === 'finished') return isToday ? i.finishedDay === today : (i.finishedDay >= rFrom && i.finishedDay <= rTo)
    // Phase 437: today's board = no date / due today or earlier / due within 2 days / given to me in the last 2 days (so a task assigned today for the 24th shows at once)
    if (isToday) return showNow(i)
    return i.due && i.due >= rFrom && i.due <= rTo
  })
  const isOpen = (i) => i.status !== 'finished' && i.status !== 'postponed'
  const dayOpen = boardItems.filter(isOpen).length
  // Phase 436: tasks given to me for a LATER date are not on today's board - say so, with one tap to see them
  const laterCount = isToday ? items.filter((i) => isOpen(i) && !showNow(i)).length : 0
  const showingUpcoming = viewFrom === today && viewTo === addDaysISO(today, 90)   // Phase 481: the Show upcoming view needs a way back
  const dayLate = boardItems.filter((i) => isOpen(i) && i.due && i.due < today).length
  const rangeLabel = isToday ? 'Today' : (rFrom === rTo ? fmtDateShort(rFrom) : `${fmtDateShort(rFrom)} - ${fmtDateShort(rTo)}`)

  // Phase 406: the shown time skips minutes she was away (break_seconds) and stands still while the "Still working?" question is open.
  const runSecs = running ? Math.max(0, ((idleFreeze ? new Date(idleFreeze).getTime() : now + skew) - new Date(running.started_at).getTime()) / 1000 - (running.break_seconds || 0)) : 0
  const doneSecs = entries.filter((e) => e.ended_at && e.status === 'approved')
    .reduce((s, e) => s + Math.max(0, (new Date(e.ended_at) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0)), 0)   // Phase 517: finished sessions also skip away time (break_seconds), same as runSecs + the shared WhatsApp text
  const todaySecs = doneSecs + runSecs
  const firstIn = entries.find((e) => e.status === 'approved')?.started_at
  const lateCount = items.filter((i) => isOpen(i) && dueState(i.due, i.status).cls === 'bad').length

  // Phase 450: lunch is 1 PM - from 12:55 to 1:30 PM a running timer gets a "pause before you go" bar (once a day it can be dismissed)
  const istNowMin = (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now)); return Number(p[0].value) * 60 + Number(p[2].value) })()
  const lunchKey = `lunch_dismissed_${today}`
  let lunchHidden = false
  try { lunchHidden = !!localStorage.getItem(lunchKey) } catch { /* storage blocked */ }
  const [lunchGone, setLunchGone] = useState(false)
  const showLunch = !!running && istNowMin >= 12 * 60 + 55 && istNowMin <= 13 * 60 + 30 && !lunchHidden && !lunchGone
  const onStart = (it) => rpc('work_clock_start', { p_project: null, p_label: null, p_part: it.id })
  const onFinish = (it) => rpc('work_finish_part', { p_part: it.id, p_note: null }, 'Finished. The person who asked is told.')
  const onMove = (id, to) => rpc('work_move_part', { p_part: id, p_to: to })

  if (!uid) return null

  const dateLine = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  const openAll = items.filter(isOpen).length
  const showTabs = [
    isMember && ['work', 'My work'],
    ['asked', 'Asked by me', asked.length],
    isMember && ['hours', 'My hours'],
    ['calendar', 'Calendar'],
  ].filter(Boolean)

  return (
    <div className="wk">
      <div className="wk-head">
        <div>
          <div className="wk-eyebrow">{dateLine}</div>
          <h1 className="wk-title">My Work</h1>
        </div>
        <div className="wk-grp">
          {isHead && <Link to="/team-work" className="wk-btn o"><Users size={16} aria-hidden="true" /> Team view</Link>}
          <button className="wk-btn y" onClick={() => setNewTask(true)}><Plus size={16} aria-hidden="true" /> {isHead ? 'New task' : 'Ask for work'}</button>
        </div>
      </div>

      {err && <div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div>}
      {loading && !err && (
        <div className="wk-grid">
          <div className="wk-c8"><div className="wk-skel" style={{ height: 190, borderRadius: 16 }} /></div>
          <div className="wk-c4"><div className="wk-skel" style={{ height: 190, borderRadius: 16 }} /></div>
          <div className="wk-c12"><div className="wk-skel" style={{ height: 260, borderRadius: 16 }} /></div>
        </div>
      )}

      {!loading && !err && (
        <>
          <div className="wk-tabs" role="tablist">
            {showTabs.map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`wk-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
                {l}{n > 0 && <span className="wk-cnt">{n}</span>}
              </button>
            ))}
          </div>

          {tab === 'work' && isMember && (
            <div className="wk-grid">
              <div className="wk-c8" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {running && !window.__TAURI_INTERNALS__ && (now + skew) - Math.max(new Date(running.started_at).getTime(), running.last_confirmed_at ? new Date(running.last_confirmed_at).getTime() : 0) > 2.5 * 3600 * 1000 && (
                  <div className="wk-card" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderColor: 'var(--w-wat, #FBBF24)' }}>
                    <span>Still working? Your timer has run a long time with no check. It stops by itself if you do not answer.</span>
                    <span className="wk-grp">
                      <button className="wk-btn y sm" disabled={busy} onClick={() => rpc('work_confirm_working', {})}>Yes, still working</button>
                      <button className="wk-btn o sm" disabled={busy} onClick={() => rpc('work_clock_stop', {})}>Stop timer</button>
                    </span>
                  </div>
                )}
                {showLunch && (
                  <div className="wk-card" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderColor: 'var(--w-wat, #FBBF24)' }}>
                    <span>Lunch is at 1 PM. Going for lunch? Pause your timer before you leave.</span>
                    <span className="wk-grp">
                      <button className="wk-btn y sm" disabled={busy} onClick={() => rpc('work_clock_stop', {})}>Pause now</button>
                      <button className="wk-btn o sm" onClick={() => { try { localStorage.setItem(lunchKey, '1') } catch { /* ignore */ } setLunchGone(true) }}>I am working</button>
                    </span>
                  </div>
                )}
                {running
                  ? <RunningCard running={running} secs={runSecs} projName={projName} busy={busy}
                      onMakeTask={running.part_id ? null : () => createCardAndStart(running.project_id, running.task_label)}
                      onPause={() => rpc('work_clock_stop', {})}
                      onFinish={running.part_id ? () => rpc('work_finish_part', { p_part: running.part_id, p_note: null }, 'Finished.') : null} />
                  : <StartForm projects={projects} busy={busy} entries={entries}
                      openCards={items.filter((i) => i.status === 'assigned' || i.status === 'in_process')}
                      onStartCard={(id) => rpc('work_clock_start', { p_project: null, p_label: null, p_part: id })}
                      onResume={(en) => {
                        if (en.part_id) return rpc('work_clock_start', { p_project: null, p_label: null, p_part: en.part_id })
                        const t = String(en.task_label || '').trim().toLowerCase()
                        const same = items.find((i) => (i.status === 'assigned' || i.status === 'in_process') && String(i.title || '').trim().toLowerCase() === t)
                        return same ? rpc('work_clock_start', { p_project: null, p_label: null, p_part: same.id }) : createCardAndStart(en.project_id, en.task_label)
                      }}
                      onFinishCard={(partId) => rpc('work_finish_part', { p_part: partId, p_note: null }, 'Finished.')}
                      onCreateAndStart={createCardAndStart}
                      onAddProject={addProject}
                      onStart={(project, label) => rpc('work_clock_start', { p_project: project, p_label: label, p_part: null })} />}
                {istHour() >= 19 && <TodayStrip secs={todaySecs} firstIn={firstIn} />}
              </div>
              <div className="wk-c4">
                <div className="wk-stack">
                  {istHour() >= 19
                    ? <EveningCard hour={istHour()} entries={entries} items={items} secs={todaySecs} name={profile?.name}
                        projName={projName} shared={shared} uid={uid} today={today} firstIn={firstIn} onShared={load} />
                    : <TodayStrip secs={todaySecs} firstIn={firstIn} />}
                </div>
              </div>
              <div className="wk-c12 wk-trio">
                  {profile?.role === 'staff' && <OnTimeScoreCard userId={uid} />}
                  <div className="wk-card flush">
                    <div className="wk-list">
                      {[['/work-profile', User, 'My profile'], ['/my-offer', CalendarX, 'Leave request'], ['/my-performance', FileText, 'Salary slips']].map(([to, Ic, label]) => (
                        <Link key={to} to={to} className="wk-row wk-hov" style={{ padding: '16px 20px', color: 'inherit', textDecoration: 'none' }}>
                          <span className="wk-grp" style={{ gap: 12 }}><Ic size={16} aria-hidden="true" />{label}</span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  </div>
                  {tagged.length > 0 && (
                    <div className="wk-card flush">
                      <div className="wk-ch"><h3>Postponed at your request</h3></div>
                      <div className="wk-list">
                        {tagged.map((t) => (
                          <div key={t.id} className="wk-row" style={{ padding: '12px 20px' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 500 }}>{t.task?.title || 'Task'}</div>
                              <div className="wk-sm">{nameOf(t.assignee_id)}</div>
                            </div>
                            <span className="wk-pill warn">Back {t.postponed_until ? fmtDateShort(t.postponed_until).replace(/^\w+,\s*/, '') : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
              <div className="wk-c12">
                <div className="wk-row" style={{ flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                  <div className="wk-grp" style={{ gap: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Tasks</h2>
                    <span className="wk-mu">
                      {rangeLabel} · <span className="wk-num">{dayOpen}</span> open
                      {dayLate > 0 && <> · <span className="wk-num" style={{ color: 'var(--danger)' }}>{dayLate}</span> overdue</>}
                      {openAll > dayOpen && <> · <span className="wk-num">{openAll}</span> open in total</>}
                    </span>
                  </div>
                  <div className="wk-grp">
                    <span className="wk-sm">From</span>
                    <DateField className="wk-input" style={{ width: 150 }} value={rFrom} aria-label="From date"
                      onChange={(e) => { const v = e.target.value; if (!v) { setViewFrom(null); setViewTo(null) } else { setViewFrom(v); if (!viewTo || viewTo < v) setViewTo(v) } }} />
                    <span className="wk-sm">To</span>
                    <DateField className="wk-input" style={{ width: 150 }} value={rTo} min={rFrom} aria-label="To date"
                      onChange={(e) => { const v = e.target.value; if (v) { setViewFrom(viewFrom || rFrom); setViewTo(v) } }} />
                    <button className={`wk-btn ${isToday ? 'y' : 'o'}`} onClick={() => { setViewFrom(null); setViewTo(null) }}>Today</button>
                  </div>
                </div>
                {showingUpcoming && (
                  <div className="wk-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', marginBottom: 14, borderColor: 'var(--accent)' }}>
                    <span>Showing tasks for the next 90 days too.</span>
                    <button className="wk-btn o sm" onClick={() => { setViewFrom(null); setViewTo(null) }}>Hide later tasks</button>
                  </div>
                )}
                {laterCount > 0 && (
                  <div className="wk-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', marginBottom: 14, borderColor: 'var(--accent)' }}>
                    <span><b className="wk-num">{laterCount}</b> {laterCount === 1 ? 'task is' : 'tasks are'} given to you for a later date.</span>
                    <button className="wk-btn y sm" onClick={() => { setViewFrom(today); setViewTo(addDaysISO(today, 90)) }}>Show upcoming</button>
                  </div>
                )}
                <WorkBoard items={boardItems} uid={uid} runningPartId={running?.part_id || null} onMove={onMove} onOpen={setOpenTask} onStart={onStart} onFinish={onFinish} onPostpone={(it) => setPostponing(it)} />
                <div className="wk-sm" style={{ marginTop: 10 }}>Drag your own task forward: Assigned to In process starts the clock, In process to Finished stops it. Or use Start / Finish.</div>
              </div>
            </div>
          )}

          {tab === 'calendar' && <WorkCalendar uid={uid} isHead={isHead} nameOf={nameOf} onOpen={setOpenTask} />}
          {tab === 'asked' && <AskedTab asked={asked} nameOf={nameOf} photoOf={photoOf} projName={projName} onOpen={setOpenTask} onNew={() => setNewTask(true)} />}
          {tab === 'hours' && isMember && <HoursTab uid={uid} entries={entries} projects={projects} projName={projName} onAddManual={(a) => rpc('work_add_manual_time', a, 'Sent for approval.')} onAddProject={addProject} />}
          {!isMember && tab !== 'asked' && <div className="wk-empty">You can ask for work and follow it here.</div>}
        </>
      )}

      <div className="wk-sm" style={{ marginTop: 16, opacity: 0.6, textAlign: 'right' }}>Version {typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'}</div>

      {postponing && (
        <PostponeModal item={postponing} users={users} projects={projects} meId={uid} onClose={() => setPostponing(null)} onDone={() => { setPostponing(null); load() }} />
      )}

      {newTask && (
        <NewTaskModal projects={projects} users={users} meId={uid} onAddProject={addProject}
          onClose={() => setNewTask(false)} onCreated={() => { setNewTask(false); load() }} />
      )}
      {openTask && (
        <TaskDetailModal taskId={openTask} uid={uid} isHead={isHead} nameOf={nameOf} projectName={projName}
          onClose={() => setOpenTask(null)} onChanged={load} />
      )}
    </div>
  )
}

function TodayStrip({ secs, firstIn }) {
  return (
    <div className="wk-card flush">
      <div className="wk-ch"><h3><span className="wk-tile"><Clock size={16} aria-hidden="true" /></span>Today</h3></div>
      <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {firstIn || secs > 0 ? (
          <>
            <div><div className="wk-eyb">Hours today</div><div className="wk-num" style={{ fontSize: 24, fontWeight: 600 }}>{fmtDur(secs)}</div></div>
            <div><div className="wk-eyb">First clock-in</div><div className="wk-mono" style={{ fontSize: 22, fontWeight: 500 }}>{firstIn ? fmtTimeIST(firstIn) : '-'}</div></div>
          </>
        ) : (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontWeight: 600 }}>Not clocked in yet</div>
            <div className="wk-sm">Your day starts when you start your first timer.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function RunningCard({ running, secs, projName, busy, onPause, onFinish, onMakeTask }) {
  return (
    <div className="wk-hero">
      <div className="wk-row">
        <span className="wk-grp"><span className="wk-ldot" aria-hidden="true" /><span className="wk-eyb">Running · {projName(running.project_id) || 'No client'}</span></span>
        <span className="wk-mono wk-hs">Started {fmtTimeIST(running.started_at)}</span>
      </div>
      <div className="wk-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 20 }}>
        <div>
          <div className="wk-timer" aria-live="off">{fmtClock(secs)}</div>
          <div className="wk-hs">{running.task_label}</div>
        </div>
        <div className="wk-grp" style={{ flexWrap: 'nowrap' }}>
          <button className="wk-btn glass" disabled={busy} onClick={onPause}><Pause size={16} aria-hidden="true" /> Pause</button>
          {onMakeTask && <button className="wk-btn glass" disabled={busy} onClick={onMakeTask}><Plus size={16} aria-hidden="true" /> Make this a task</button>}
          {onFinish && <button className="wk-btn y" disabled={busy} onClick={onFinish}><Check size={16} aria-hidden="true" /> Finish</button>}
        </div>
      </div>
    </div>
  )
}

// Words that say nothing about WHICH task it is.
const MATCH_SKIP = new Set(['work', 'and', 'the', 'for', 'edit', 'new', 'with', 'from', 'task'])
const words = (t) => new Set((t || '').toLowerCase().replace(/[^a-z0-9\u0900-\u0dff ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !MATCH_SKIP.has(w)))
// A typed name that clearly describes one of the person's own open task cards (2 shared words, or all words of a short title).
function matchCard(label, cards) {
  const a = words(label); if (a.size === 0) return null
  let best = null; let bestScore = 0
  for (const c of cards || []) {
    const b = words(c.title); if (b.size === 0) continue
    let n = 0; a.forEach((w) => { if (b.has(w)) n += 1 })
    const ok = n >= 2 || (n >= 1 && b.size <= 2 && n === b.size)
    if (ok && n > bestScore) { best = c; bestScore = n }
  }
  return best
}

function StartForm({ projects, busy, entries, openCards, onStartCard, onResume, onFinishCard, onCreateAndStart, onAddProject, onStart }) {
  const [project, setProject] = useState(() => { try { return localStorage.getItem('wk_last_project') || '' } catch { return '' } })
  const [label, setLabel] = useState('')
  const [newClient, setNewClient] = useState('')
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState([])
  useEffect(() => {
    let live = true
    supabase.from('work_time_entries').select('task_label,project_id').order('started_at', { ascending: false }).limit(120)
      .then(({ data }) => { if (live) setHistory(data || []) })
    return () => { live = false }
  }, [entries.length])
  const sugg = useMemo(() => {
    const seen = new Set(); const out = []
    for (const h of history) {
      const l = (h.task_label || '').trim(); if (!l) continue
      if (project && h.project_id && h.project_id !== project) continue
      const k = l.toLowerCase(); if (seen.has(k)) continue
      seen.add(k); out.push(l); if (out.length >= 6) break
    }
    return out
  }, [history, project])

  const go = async () => {
    let pid = project
    try {
      if (adding && newClient.trim()) pid = await onAddProject(newClient.trim())
    } catch (e) { return toastError(e, 'Could not add the client.') }
    if (!pid) return toastError('', 'Pick a client.')
    if (!label.trim()) return toastError('', 'Type what you are doing.')
    try { localStorage.setItem('wk_last_project', pid) } catch { /* ignore */ }
    // If what was typed is really one of my task cards, offer the card: then Finish works and the head sees the task done.
    const typed = label.trim().toLowerCase()
    const same = (openCards || []).find((c) => String(c.title || '').trim().toLowerCase() === typed)
    if (same) { await onStartCard(same.id); setLabel(''); return }   // exact same name: reuse that card, no question
    const card = matchCard(label, openCards)
    if (card) {
      const useCard = await confirmDialog({
        title: 'Is this your task card?',
        message: `"${card.title}"${card.due ? ` (due ${card.due})` : ''} is on your list. Start the timer on that card so it can be finished here?`,
        confirmLabel: 'Use the task card', cancelLabel: 'No, just track time',
      })
      if (useCard) { await onStartCard(card.id); setLabel(''); return }
    }
    // Nothing matched: every new typed name becomes a real task card (due today) so it shows under In process and Finish works.
    await onCreateAndStart(pid, label.trim())
    setLabel('')
  }

  // Paused / stopped just now: one tap goes back to the same task (card or typed).
  const lastEntry = (entries || []).filter((e) => e.ended_at && e.status === 'approved').sort((a, b) => new Date(a.ended_at) - new Date(b.ended_at)).slice(-1)[0]
  const lastCard = lastEntry?.part_id ? (openCards || []).find((c) => c.id === lastEntry.part_id) : null
  const canResume = !!lastEntry && (!lastEntry.part_id || !!lastCard)

  return (
    <div className="wk-hero">
      {canResume && (
        <div className="wk-row" style={{ flexWrap: 'wrap', gap: 12, padding: '12px 14px', margin: '10px 0 4px', borderRadius: 14, background: 'rgba(255,255,255,.08)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="wk-eyb">Paused at {fmtTimeIST(lastEntry.ended_at)}</div>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastEntry.task_label}</div>
          </div>
          <div className="wk-grp" style={{ flexWrap: 'nowrap' }}>
            <button className="wk-btn y" disabled={busy} onClick={() => onResume(lastEntry)}><Play size={16} aria-hidden="true" /> Resume</button>
            {lastEntry.part_id && <button className="wk-btn glass" disabled={busy} onClick={() => onFinishCard(lastEntry.part_id)}><Check size={16} aria-hidden="true" /> Finish</button>}
          </div>
        </div>
      )}
      <span className="wk-eyb">Not running · start work</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end', marginTop: 14 }}>
        <div className="wk-field" style={{ margin: 0 }}>
          <label htmlFor="sf-client">Client</label>
          {!adding ? (
            <select id="sf-client" className="wk-input" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Pick a client</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <input id="sf-client" className="wk-input" value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="New client name" maxLength={80} autoFocus />
          )}
        </div>
        <div className="wk-field" style={{ margin: 0 }}>
          <label htmlFor="sf-label">What are you doing</label>
          <input id="sf-label" className="wk-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="For example: LED loop, 15 sec cut"
            onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
        </div>
        <button className="wk-btn y" disabled={busy} onClick={go}><Play size={16} aria-hidden="true" /> Start</button>
      </div>
      <div className="wk-grp" style={{ marginTop: 14 }}>
        <button className="wk-chip" onClick={() => { setAdding((a) => !a); setNewClient('') }}>{adding ? 'Pick from list' : '+ New client'}</button>
        {sugg.length > 0 && <span className="wk-eyb">Recent</span>}
        {sugg.map((s) => <button key={s} className="wk-chip" onClick={() => setLabel(s)}>{s}</button>)}
      </div>
      <div className="wk-hs" style={{ marginTop: 12 }}>First start of the day is your clock-in. Last stop is your clock-out.</div>
    </div>
  )
}

function EveningCard({ hour, entries, items, secs, name, projName, shared, uid, today, firstIn, onShared }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const evening = hour >= 19
  // Phase 464: people work after 7 PM. Keep the numbers fresh while this card is open (every 45 s and when the window is used again),
  // so what gets shared is the LATEST work, not what the page loaded at 7:00.
  useEffect(() => {
    if (!evening || !onShared) return undefined
    const t = setInterval(() => onShared(), 45000)
    const f = () => onShared()
    window.addEventListener('focus', f)
    return () => { clearInterval(t); window.removeEventListener('focus', f) }
  }, [evening, onShared])
  if (!evening) return null
  const finished = items.filter((i) => i.status === 'finished' && i.finishedDay === today).length   // finished TODAY only
  // Phase 518: day score = tasks finished today WITH a due date that were on time (same test as work_ontime_stats: finished before the due
  // day, or on the due day at/before the due time). Display only, never touches pay. No due date = not counted.
  const scored = items.filter((i) => i.status === 'finished' && i.finishedDay === today && i.due)
  const onTimeToday = scored.filter((i) => {
    if (i.finishedDay < i.due) return true
    if (i.finishedDay > i.due) return false
    if (!i.dueTime) return true
    const ft = new Date(i.finishedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })
    return ft <= String(i.dueTime).slice(0, 8).padEnd(8, ':00')
  }).length
  const dayScore = scored.length ? Math.round(onTimeToday / scored.length * 100) : null
  const proc = items.filter((i) => i.status === 'in_process').length
  const late = items.filter((i) => i.status !== 'finished' && i.status !== 'postponed' && dueState(i.due, i.status).cls === 'bad').length
  // The WhatsApp window MUST open straight from the tap: iPhone blocks a link opened after an
  // await (that is why the share did nothing and only "Last shared" updated). So the text is built
  // from the entries already on the page, opened first, and the "shared" mark is saved afterwards.
  const share = () => {
    if (busy) return
    setBusy(true)
    try {
      const rows = (entries || []).filter((e) => e.status === 'approved')
      const byProj = new Map(); let total = 0
      rows.forEach((e) => {
        const s = Math.max(0, ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0))
        total += s; byProj.set(e.project_id, (byProj.get(e.project_id) || 0) + s)
      })
      const running = rows.some((e) => !e.ended_at)
      const last = rows.filter((e) => e.ended_at).slice(-1)[0]
      const dateLbl = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
      const proj = [...byProj.entries()].sort((x, y) => y[1] - x[1])
      const lines = [
        '🟡 UNTITLED · DAY SUMMARY',
        `📅 ${dateLbl}`,
        `👤 ${name || 'Team member'} · Work team`,
        '',
        '📋 *TASKS*',
        `• Finished:   ${finished}`,
        `• In process: ${proc}${proc ? ' 🟡' : ''}`,
        `• Late:       ${late}${late ? ' 🔴' : ''}`,
        ...(dayScore != null ? [`⭐ *DAY SCORE: ${dayScore}%* (${onTimeToday} of ${scored.length} finished on time)`] : []),
        '',
        '⏱ *TIME*',
        `• Clock in:  ${rows[0] ? fmtTimeIST(rows[0].started_at) : '-'}`,
        `• Clock out: ${running ? `${fmtTimeIST(new Date().toISOString())} (timer still running)` : (last ? fmtTimeIST(last.ended_at) : '-')}`,
        `• Hours:     ${fmtDur(total)}`,
        '',
        '📊 *BY CLIENT*',
        ...(proj.length ? proj.map(([pid, sec]) => `• ${projName(pid) || 'Other'}: ${fmtDur(sec)}`) : ['• -']),
      ]
      if (note.trim()) lines.push('', `Note: ${note.trim()}`)
      const text = lines.join('\n')
      if (Capacitor.isNativePlatform()) openWhatsAppShare(text)
      else openExternalUrl(`https://wa.me/?text=${encodeURIComponent(text)}`)   // Phase 486: new tab/window, so the app page stays open (was location.href = the app was replaced and could not be returned to)
      supabase.rpc('work_mark_report_shared', { p_date: today, p_note: note.trim() || null })
        .then(({ error }) => { if (error) console.warn('report mark failed', error.message); onShared() })
    } catch (e) { toastError(e, 'Could not open WhatsApp.') } finally { setTimeout(() => setBusy(false), 1500) }
  }
  return (
    <div className="wk-card flush">
      <div className="wk-ch">
        <div><h3><span className="wk-tile"><Moon size={16} aria-hidden="true" /></span>Evening report</h3><div className="wk-csub">{fmtDateShort(today)} · ready to share</div></div>
      </div>
      <div style={{ padding: 18, display: 'grid', gap: 12 }}>
        <div className="wk-rep">
          <div className="wk-row"><span className="wk-mu">Hours</span><span className="wk-num">{fmtDur(secs)}</span></div>
          <div className="wk-row"><span className="wk-mu">Clock-in</span><span className="wk-num">{firstIn ? fmtTimeIST(firstIn) : '-'}</span></div>
          <div className="wk-row"><span className="wk-mu">Clock-out</span><span className="wk-num">{(() => {
            const ap = (entries || []).filter((e) => e.status === 'approved')
            if (!ap.length) return '-'
            if (ap.some((e) => !e.ended_at)) return 'still working'
            const l = ap.filter((e) => e.ended_at).slice(-1)[0]
            return l ? fmtTimeIST(l.ended_at) : '-'
          })()}</span></div>
          <div className="wk-row"><span className="wk-mu">Finished</span><span className="wk-num">{finished}</span></div>
          <div className="wk-row"><span className="wk-mu">In process</span><span className="wk-num">{proc}</span></div>
          <div className="wk-row"><span className="wk-mu">Late</span><span className="wk-num" style={{ color: late ? 'var(--danger)' : undefined }}>{late}</span></div>
          <div className="wk-row"><span className="wk-mu">Day score</span><span className="wk-num">{dayScore == null ? '-' : `${dayScore}% · ${onTimeToday} of ${scored.length} on time`}</span></div>
        </div>
        <div className="wk-field" style={{ margin: 0 }}><label htmlFor="ev-note">Note (optional)</label>
          <textarea id="ev-note" className="wk-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Anything the team should know" /></div>
        <button className="wk-btn y lg" disabled={busy} onClick={share}><Send size={16} aria-hidden="true" /> Share to your team group</button>
        <div className="wk-sm">{shared ? `Last shared ${fmtTimeIST(shared.shared_at)}. ` : ''}Opens WhatsApp with this report filled in.</div>
      </div>
    </div>
  )
}

const PART_PILL = { assigned: ['', 'Assigned'], in_process: ['in', 'In process'], finished: ['ok', 'Finished'], postponed: ['warn', 'Postponed'] }

function AskedTab({ asked, nameOf, photoOf, projName, onOpen, onNew }) {
  const waiting = asked.reduce((n, t) => n + t.parts.filter((p) => p.status !== 'finished').length, 0)
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="wk-hero">
        <span className="wk-eyb">Waiting on others</span>
        <div className="wk-num" style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>{waiting} {waiting === 1 ? 'part' : 'parts'}</div>
        <div className="wk-hs">Still with other people across your open requests</div>
      </div>
      <div className="wk-card flush">
        <div className="wk-ch">
          <h3><span className="wk-tile"><Send size={16} aria-hidden="true" /></span>Tasks I created for others</h3>
          <button className="wk-btn o sm" onClick={onNew}><Plus size={14} aria-hidden="true" /> New task</button>
        </div>
        {asked.length === 0 ? (
          <div className="wk-empty"><b>You have not asked anyone for work</b>Tasks you create for other people show here with their progress.</div>
        ) : (
          <div className="wk-list">
            {asked.map((t) => {
              const done = t.parts.filter((p) => p.status === 'finished').length
              const ds = dueState(t.due_date, t.status)
              return (
                <div key={t.id} className="wk-hov" tabIndex={0} role="button" onClick={() => onOpen(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t.id) }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, padding: '16px 20px', alignItems: 'center' }}>
                  <div><b>{t.title}</b><div className="wk-sm">{projName(t.project_id) || 'No client'}</div></div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {t.parts.map((p) => {
                      const [tone, lbl] = PART_PILL[p.status] || ['', p.status]
                      return (
                        <div key={p.id}>
                        <div className="wk-grp" style={{ flexWrap: 'nowrap' }}>
                          <UserAvatar className="wk-av" name={nameOf(p.assignee_id)} url={photoOf(p.assignee_id)} size={26} />
                          <span style={{ flex: 1 }}>{nameOf(p.assignee_id).split(' ')[0]}{p.label && <span className="wk-mu"> · {p.label}</span>}</span>
                          {p.reject_kind === 'declined' && p.status === 'assigned'
                            ? <span className="wk-pill bad">Declined</span>
                            : <span className={`wk-pill ${tone}`}>{lbl}</span>}
                        </div>
                        {p.reject_kind === 'declined' && p.status === 'assigned' && p.reject_reason && (
                          <div className="wk-sm" style={{ color: 'var(--danger)', marginTop: 4 }}>{nameOf(p.assignee_id).split(' ')[0]} declined: {p.reject_reason}</div>
                        )}
                        </div>
                      )
                    })}
                  </div>
                  <div>
                    <div className="wk-row" style={{ fontSize: 12, marginBottom: 6 }}><span className="wk-mu">Parts done</span><span className="wk-num">{done} of {t.parts.length}</span></div>
                    <div className="wk-bar" style={{ margin: 0 }}><i style={{ width: `${t.parts.length ? Math.round(done / t.parts.length * 100) : 0}%`, background: done === t.parts.length ? 'var(--success)' : undefined }} /></div>
                    <div style={{ marginTop: 8 }}><span className={`wk-pill ${t.status === 'finished' ? 'ok' : ds.cls}`}>{t.status === 'finished' ? 'Finished' : ds.label}</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const HRANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Past 7 days'], ['30', 'Past 30 days'], ['custom', 'Pick a date']]

function HoursTab({ uid, entries: todayEntries, projects, projName, onAddManual, onAddProject }) {
  const today = istTodayISO()
  const [range, setRange] = useState('today')
  const [custom, setCustom] = useState(today)
  const [rows, setRows] = useState(null)
  const [project, setProject] = useState('')
  const [label, setLabel] = useState('')
  const [from, setFrom] = useState('10:00')
  const [to, setTo] = useState('11:00')
  const [day, setDay] = useState(today)
  const [note, setNote] = useState('')
  const [rf, rt] = useMemo(() => {
    if (range === 'today') return [today, today]
    if (range === 'yesterday') return [addDaysISO(today, -1), addDaysISO(today, -1)]
    if (range === '7') return [addDaysISO(today, -6), today]
    if (range === '30') return [addDaysISO(today, -29), today]
    return [custom, custom]
  }, [range, custom, today])
  useEffect(() => {
    let live = true
    setRows(null)
    supabase.from('work_time_entries').select('*').eq('user_id', uid)
      .gte('started_at', dayStartISO(rf)).lt('started_at', dayStartISO(addDaysISO(rt, 1))).order('started_at').limit(1500)
      .then(({ data }) => { if (live) setRows(data || []) })
    return () => { live = false }
  }, [uid, rf, rt, todayEntries.length])
  const all = rows || []
  const approved = all.filter((e) => e.status === 'approved')
  const asks = todayEntries.filter((e) => e.status !== 'approved')
  const dur = (e) => Math.max(0, ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0))
  const total = approved.reduce((n, e) => n + dur(e), 0)
  const byClient = Object.entries(approved.reduce((m, e) => { m[e.project_id || ''] = (m[e.project_id || ''] || 0) + dur(e); return m }, {})).sort((a, b) => b[1] - a[1])
  const dayKey = (e) => new Date(new Date(e.started_at).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)
  const byDay = Object.entries(approved.reduce((m, e) => { (m[dayKey(e)] = m[dayKey(e)] || []).push(e); return m }, {})).sort((a, b) => b[0].localeCompare(a[0]))
  const submit = async () => {
    if (!project || !label.trim()) return toastError('', 'Pick a client and say what you did.')
    // Phase 519: a time before 7 AM is almost always "2:10" typed without PM (4 meeting entries went in as 02:10 AM on 26 Oct and became the
    // clock-in). Ask once; "Change to PM" shifts start and end by 12 h, "Keep AM" sends it as typed.
    let fromT = from, toT = to, earlyOk = false
    const hh = (t) => Number((t || '').slice(0, 2))
    if (from && hh(from) < 7) {
      const pm = (t) => `${String(hh(t) + 12).padStart(2, '0')}${(t || '').slice(2)}`
      const flip = await confirmDialog({
        title: 'Is this AM or PM?',
        message: `The start time is ${from} in the early morning. If you meant ${pm(from)} (PM), change it. Otherwise keep it as AM.`,
        confirmLabel: 'Change to PM', cancelLabel: 'Keep AM',
      })
      if (flip) { fromT = pm(from); if (to && hh(to) < 12) toT = pm(to) }
      else earlyOk = true   // Phase 520: the server refuses a start before 7 AM unless AM was confirmed
    }
    await onAddManual({
      p_project: project, p_label: label.trim(),
      p_start: `${day}T${fromT}:00+05:30`, p_end: `${day}T${toT}:00+05:30`, p_note: note.trim() || null, ...(earlyOk ? { p_early_ok: true } : {}),   // only sent when AM was confirmed, so the app also works before Phase 520 SQL is applied
    })
    setLabel(''); setNote('')
  }
  const rangeText = rf === rt ? fmtDateShort(rf) : `${fmtDateShort(rf)} to ${fmtDateShort(rt)}`
  return (
    <div className="wk-grid">
      <div className="wk-c12">
        <div className="wk-grp" style={{ marginBottom: 14 }}>
          <div className="wk-tabs" style={{ margin: 0 }}>
            {HRANGES.map(([k, l]) => <button key={k} className={`wk-tab${range === k ? ' on' : ''}`} onClick={() => setRange(k)}>{l}</button>)}
          </div>
          {range === 'custom' && <DateField className="wk-input" style={{ width: 170 }} value={custom} max={today} onChange={(e) => setCustom(e.target.value)} aria-label="Pick a date" />}
        </div>
        <div className="wk-hero">
          <span className="wk-eyb">Tracked · {rangeText}</span>
          <div className="wk-num" style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>{rows === null ? '...' : fmtDur(total)}</div>
          <div className="wk-hs">Across {byClient.length} {byClient.length === 1 ? 'client' : 'clients'}</div>
        </div>
      </div>
      <div className="wk-c8">
        {rf === rt && (
          <div className="wk-card flush" style={{ marginBottom: 24 }}>
            <div className="wk-ch"><h3><span className="wk-tile"><Clock size={16} aria-hidden="true" /></span>{rf === today ? 'Today' : 'The day'}, by hour</h3></div>
            <DayStrip entries={approved} projName={projName} showNow={rf === today} />
          </div>
        )}
        <div className="wk-card" style={{ marginBottom: 24 }}>
          <b style={{ fontSize: 18 }}>Hours per client</b>
          {byClient.length === 0 && <div className="wk-sm" style={{ marginTop: 8 }}>No time in these dates.</div>}
          {byClient.map(([pid, sec]) => (
            <div key={pid || 'none'} className="wk-hrow">
              <span className="wk-grp" style={{ flexWrap: 'nowrap' }}><span className="wk-dot" style={{ background: clientColor(projName(pid)) }} />{projName(pid) || 'No client'}</span>
              <div className="wk-bar-h"><i style={{ width: `${sec / byClient[0][1] * 100}%`, background: clientColor(projName(pid)) }} /></div>
              <span className="wk-num" style={{ textAlign: 'right' }}>{fmtDur(sec)}</span>
            </div>
          ))}
        </div>
        <div className="wk-card flush">
          <div className="wk-ch"><h3><span className="wk-tile"><Clock size={16} aria-hidden="true" /></span>Days</h3></div>
          {byDay.length === 0 ? (
            <div className="wk-empty"><b>No time tracked in these dates</b>Start a timer on My work, or add time you forgot to track.</div>
          ) : byDay.map(([d, list]) => (
            <div key={d}>
              <div className="wk-row" style={{ padding: '14px 20px', background: 'var(--w-hov)' }}>
                <b>{fmtDateShort(d)}</b><b className="wk-num">{fmtDur(list.reduce((n, e) => n + dur(e), 0))}</b>
              </div>
              {list.map((e) => (
                <div key={e.id} className="wk-row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="wk-grp" style={{ flexWrap: 'nowrap' }}><span className="wk-dot" style={{ background: clientColor(projName(e.project_id)) }} />{projName(e.project_id) || '-'}</div>
                    <div className="wk-sm">{e.task_label} · {fmtTimeIST(e.started_at)} to {e.ended_at ? fmtTimeIST(e.ended_at) : 'running'}{e.auto_stopped && ' · auto-stopped'}</div>
                  </div>
                  {!e.ended_at && <span className="wk-pill y">Running</span>}
                  <span className="wk-num">{fmtDur(dur(e))}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="wk-c4">
        <div className="wk-stack">
          <div className="wk-card flush">
            <div className="wk-ch"><h3><span className="wk-tile"><Plus size={16} aria-hidden="true" /></span>Add forgotten time</h3></div>
            <div style={{ padding: 18, display: 'grid', gap: 14 }}>
              <div className="wk-field" style={{ margin: 0 }}><label>Client</label>
                <select className="wk-input" value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">Pick a client</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div className="wk-field" style={{ margin: 0 }}><label>What</label>
                <input className="wk-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="What you worked on" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 8 }}>
                <div className="wk-field" style={{ margin: 0 }}><label>Day</label><DateField className="wk-input" value={day} max={today} min={addDaysISO(today, -7)} onChange={(e) => setDay(e.target.value)} /></div>
                <div className="wk-field" style={{ margin: 0 }}><label>Start</label><input className="wk-input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div className="wk-field" style={{ margin: 0 }}><label>End</label><input className="wk-input" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              </div>
              <div className="wk-field" style={{ margin: 0 }}><label>Note</label>
                <input className="wk-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why the timer was off" /></div>
              <button className="wk-btn y" onClick={submit}><Send size={16} aria-hidden="true" /> Send for approval</button>
              <div className="wk-sm">Your head approves it before it counts. Up to 12 hours, last 7 days.</div>
            </div>
          </div>
          {asks.length > 0 && (
            <div className="wk-card flush">
              <div className="wk-ch"><h3><span className="wk-tile"><Check size={16} aria-hidden="true" /></span>My requests</h3></div>
              <div className="wk-list">
                {asks.map((e) => (
                  <div key={e.id} className="wk-row" style={{ padding: '12px 20px' }}>
                    <div style={{ flex: 1 }}><div>{projName(e.project_id) || '-'}</div><div className="wk-sm wk-mono">{e.task_label}</div></div>
                    <span className={`wk-pill ${e.status === 'declined' ? 'bad' : 'warn'}`}>{e.status === 'declined' ? 'Declined' : 'Waiting'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// One-person version of the head's Timeline: 08-21 strip, blocks coloured by client,
// running block outlined, yellow line = now.
function DayStrip({ entries, projName, showNow = true }) {
  const H0 = 8, H1 = 21
  const hourOf = (iso) => { const d = new Date(new Date(iso).getTime() + 5.5 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60 }
  const pct = (h) => Math.max(0, Math.min(100, (h - H0) / (H1 - H0) * 100))
  const nowH = hourOf(new Date().toISOString())
  return (
    <div style={{ padding: 16, overflowX: 'auto' }}>
      <div style={{ minWidth: 560 }}>
        <div style={{ position: 'relative', height: 18, marginBottom: 6 }}>
          {Array.from({ length: H1 - H0 + 1 }, (_, i) => (
            <span key={i} className="wk-num wk-mu" style={{ position: 'absolute', left: `${pct(H0 + i)}%`, fontSize: 12, transform: 'translateX(-50%)' }}>{String(H0 + i).padStart(2, '0')}</span>
          ))}
        </div>
        <div style={{ position: 'relative', height: 28, background: 'var(--w-hov)', borderRadius: 6 }}>
          {entries.map((e) => {
            const s0 = hourOf(e.started_at), e0 = e.ended_at ? hourOf(e.ended_at) : nowH
            return <span key={e.id} title={`${projName(e.project_id) || '-'} - ${e.task_label}`}
              style={{ position: 'absolute', left: `${pct(s0)}%`, width: `${Math.max(0.6, pct(e0) - pct(s0))}%`, top: 3, bottom: 3, borderRadius: 6, background: clientColor(projName(e.project_id)), boxShadow: e.ended_at ? 'none' : '0 0 0 2px var(--accent)' }} />
          })}
          {showNow && <span style={{ position: 'absolute', left: `${pct(nowH)}%`, top: -4, bottom: -4, width: 2, background: 'var(--accent)' }} />}
        </div>
        <div className="wk-sm" style={{ marginTop: 10 }}>Yellow line is now. Outlined block is running. Colour = client.</div>
      </div>
    </div>
  )
}
