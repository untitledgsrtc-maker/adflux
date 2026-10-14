// src/pages/v2/MyWorkV2.jsx - Phase 365. The person's Work page (timeclock + tasks).
// Running clock, start without a task, my board (drag or Start / Finish), tasks I asked
// for, my hours (+ add forgotten time), evening report after 7 PM. Writes only through
// the work_* database functions. Hours have NO pay effect.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Play, Pause, Check, Plus, Loader2, Send, Clock, Users } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { istTodayISO } from '../../utils/istDate'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { openWhatsAppShare } from '../../utils/whatsappSummary'
import { fmtDur, fmtClock, dayStartISO, addDaysISO, fmtTimeIST, fmtDateShort, istHour, dueState, initialsOf } from '../../utils/workUtils'
import WorkBoard from '../../components/work/WorkBoard'
import NewTaskModal from '../../components/work/NewTaskModal'
import TaskDetailModal from '../../components/work/TaskDetailModal'

export default function MyWorkV2() {
  const { profile } = useAuth()
  const uid = profile?.id
  const [tab, setTab] = useState('work')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [member, setMember] = useState(null)       // my work_members row or null
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [running, setRunning] = useState(null)
  const [entries, setEntries] = useState([])       // today's entries
  const [parts, setParts] = useState([])
  const [viewFrom, setViewFrom] = useState(null)   // null = Today (today's tasks + anything overdue)
  const [viewTo, setViewTo] = useState(null)
  const [asked, setAsked] = useState([])
  const [shared, setShared] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [newTask, setNewTask] = useState(false)
  const [openTask, setOpenTask] = useState(null)
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)

  const today = istTodayISO()
  const isAdmin = profile?.role === 'admin'
  const isHead = isAdmin || !!member?.is_head
  const isMember = isAdmin || !!member

  const load = useCallback(async () => {
    if (!uid) return
    setErr('')
    const t0 = dayStartISO(today)
    const [m, pr, us, run, en, pa, ak, sh] = await Promise.all([
      supabase.from('work_members').select('user_id,is_head').eq('user_id', uid).maybeSingle(),
      supabase.from('work_projects').select('id,name,kind').eq('is_active', true).order('name'),
      supabase.from('users').select('id,name,designation,role').eq('is_active', true).neq('role', 'agency').order('name'),
      supabase.from('work_time_entries').select('*').eq('user_id', uid).is('ended_at', null).maybeSingle(),
      supabase.from('work_time_entries').select('*').eq('user_id', uid).gte('started_at', t0).order('started_at'),
      supabase.from('work_task_parts')
        .select('id,task_id,assignee_id,label,due_date,status,started_at,finished_at,seconds,task:work_tasks(id,title,project_id,created_by,due_date,status)')
        .eq('assignee_id', uid).or(`status.neq.finished,finished_at.gte.${dayStartISO(addDaysISO(today, -14))}`).limit(300),
      supabase.from('work_tasks')
        .select('id,title,project_id,due_date,status,created_at,parts:work_task_parts(id,assignee_id,label,status,due_date)')
        .eq('created_by', uid).order('created_at', { ascending: false }).limit(60),
      supabase.from('work_report_shares').select('shared_at').eq('user_id', uid).eq('work_date', today).maybeSingle(),
    ])
    const e = [m, pr, us, run, en, pa, ak, sh].find((r) => r.error)
    if (e) { setErr(e.error.message || 'Could not load.'); setLoading(false); return }
    setMember(m.data); setProjects(pr.data || []); setUsers(us.data || [])
    setRunning(run.data || null); setEntries(en.data || []); setParts(pa.data || [])
    setAsked(ak.data || []); setShared(sh.data || null)
    setLoading(false)
  }, [uid, today])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load, { userId: uid, pollSeconds: 60 })
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])

  const projName = useMemo(() => { const m = new Map(projects.map((p) => [p.id, p.name])); return (id) => m.get(id) || '' }, [projects])
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

  const addProject = async (name) => {
    const { data, error } = await supabase.rpc('work_add_project', { p_name: name, p_kind: 'client' })
    if (error) throw error
    await load()
    return data
  }

  // board items
  const items = useMemo(() => parts.map((p) => ({
    id: p.id, taskId: p.task_id, status: p.status, title: p.task?.title || 'Task', label: p.label,
    client: projName(p.task?.project_id), due: p.due_date || p.task?.due_date, assigneeId: p.assignee_id,
    assigneeName: nameOf(p.assignee_id), finishedDay: p.finished_at ? new Date(p.finished_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null, partsTotal: 1, partsDone: 0, seconds: p.seconds, cost: null,
  })), [parts, projName, nameOf])

  // Date filter. Default = Today: today's tasks + everything overdue + what was finished TODAY (yesterday's
  // finished ones drop off). A From - To range shows the tasks due in the range and the ones finished in it.
  const isToday = !viewFrom
  const rFrom = viewFrom || today
  const rTo = (viewTo && viewTo >= rFrom) ? viewTo : rFrom
  const boardItems = items.filter((i) => {
    if (i.status === 'finished') return isToday ? i.finishedDay === today : (i.finishedDay >= rFrom && i.finishedDay <= rTo)
    if (isToday) return !i.due || i.due <= today
    return i.due && i.due >= rFrom && i.due <= rTo
  })
  const dayOpen = boardItems.filter((i) => i.status !== 'finished').length
  const dayLate = boardItems.filter((i) => i.status !== 'finished' && i.due && i.due < today).length
  const rangeLabel = isToday ? 'Today' : (rFrom === rTo ? fmtDateShort(rFrom) : `${fmtDateShort(rFrom)} - ${fmtDateShort(rTo)}`)

  const runSecs = running ? (now - new Date(running.started_at).getTime()) / 1000 : 0
  const doneSecs = entries.filter((e) => e.ended_at && e.status === 'approved')
    .reduce((s, e) => s + (new Date(e.ended_at) - new Date(e.started_at)) / 1000, 0)
  const todaySecs = doneSecs + runSecs
  const firstIn = entries.find((e) => e.status === 'approved')?.started_at
  const lateCount = items.filter((i) => i.status !== 'finished' && dueState(i.due, i.status).cls === 'bad').length

  const onStart = (it) => rpc('work_clock_start', { p_project: null, p_label: null, p_part: it.id })
  const onFinish = (it) => rpc('work_finish_part', { p_part: it.id, p_note: null }, 'Finished. The person who asked is told.')
  const onMove = (id, to) => rpc('work_move_part', { p_part: id, p_to: to })

  if (!uid) return null

  return (
    <div className="wk">
      <div className="wk-head">
        <div>
          <div className="wk-eyebrow">{new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' })}</div>
          <h1 className="wk-title">My Work</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {isMember && <div className="wk-card" style={{ padding: '8px 14px' }}><span className="wk-sm">Today </span><b className="wk-num" style={{ fontSize: 20 }}>{fmtDur(todaySecs)}</b>{firstIn && <span className="wk-sm"> · in {fmtTimeIST(firstIn)}</span>}</div>}
          {isHead && <Link to="/team-work" className="wk-btn o"><Users size={16} aria-hidden="true" /> Team view</Link>}
          <button className="wk-btn y" onClick={() => setNewTask(true)}><Plus size={16} aria-hidden="true" /> New task</button>
        </div>
      </div>

      {err && <div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div>}
      {loading && !err && <div className="wk-empty"><Loader2 className="spin" size={26} aria-hidden="true" /></div>}

      {!loading && !err && (
        <>
          <div className="wk-tabs" role="tablist">
            {isMember && <button role="tab" aria-selected={tab === 'work'} className={`wk-tab${tab === 'work' ? ' on' : ''}`} onClick={() => setTab('work')}>My work</button>}
            <button role="tab" aria-selected={tab === 'asked'} className={`wk-tab${tab === 'asked' ? ' on' : ''}`} onClick={() => setTab('asked')}>Asked by me <span className="wk-cnt">{asked.length}</span></button>
            {isMember && <button role="tab" aria-selected={tab === 'hours'} className={`wk-tab${tab === 'hours' ? ' on' : ''}`} onClick={() => setTab('hours')}>My hours</button>}
            <Link to="/work-profile" className="wk-tab">My profile</Link>
            <Link to="/my-offer" className="wk-tab">Leave request</Link>
            <Link to="/my-performance" className="wk-tab">Salary slips</Link>
          </div>

          {tab === 'work' && isMember && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
                {running
                  ? <RunningCard running={running} secs={runSecs} projName={projName} busy={busy}
                      onPause={() => rpc('work_clock_stop', {})}
                      onFinish={running.part_id ? () => rpc('work_finish_part', { p_part: running.part_id, p_note: null }, 'Finished.') : null} />
                  : <StartForm projects={projects} busy={busy} entries={entries}
                      onAddProject={addProject}
                      onStart={(project, label) => rpc('work_clock_start', { p_project: project, p_label: label, p_part: null })} />}
                <EveningCard hour={istHour()} entries={entries} items={items} secs={todaySecs} name={profile?.name}
                  projName={projName} shared={shared} uid={uid} today={today} firstIn={firstIn} onShared={load} />
              </div>
              <div className="wk-row" style={{ marginTop: 22 }}>
                <b style={{ fontSize: 18 }}>My tasks</b>
                <span className="wk-sm">{items.filter((i) => i.status !== 'finished').length} open in total{lateCount ? ` · ${lateCount} late` : ''}</span>
              </div>
              <div className="wk-row" style={{ marginTop: 10, flexWrap: 'wrap', justifyContent: 'flex-start', gap: 8, alignItems: 'center' }}>
                <span className="wk-sm">From</span>
                <input className="wk-input" type="date" style={{ width: 160, minHeight: 40 }} value={rFrom} aria-label="From date"
                  onChange={(e) => { const v = e.target.value; if (!v) { setViewFrom(null); setViewTo(null) } else { setViewFrom(v); if (!viewTo || viewTo < v) setViewTo(v) } }} />
                <span className="wk-sm">To</span>
                <input className="wk-input" type="date" style={{ width: 160, minHeight: 40 }} value={rTo} min={rFrom} aria-label="To date"
                  onChange={(e) => { const v = e.target.value; if (v) { setViewFrom(viewFrom || rFrom); setViewTo(v) } }} />
                <button className={`wk-btn sm ${isToday ? 'y' : 'g'}`} onClick={() => { setViewFrom(null); setViewTo(null) }}>Today</button>
                <span className="wk-sm">{rangeLabel} · {dayOpen} open{dayLate ? ` · ${dayLate} overdue` : ''}</span>
              </div>
              <div className="wk-sm" style={{ marginTop: 4 }}>Drag your own task forward: Assigned to In process starts the clock, In process to Finished stops it. Or use Start / Finish.</div>
              <WorkBoard items={boardItems} uid={uid} onMove={onMove} onOpen={setOpenTask} onStart={onStart} onFinish={onFinish} />
            </>
          )}

          {tab === 'asked' && <AskedTab asked={asked} nameOf={nameOf} projName={projName} onOpen={setOpenTask} />}
          {tab === 'hours' && isMember && <HoursTab entries={entries} projects={projects} projName={projName} onAddManual={(a) => rpc('work_add_manual_time', a, 'Sent for approval.')} onAddProject={addProject} />}
          {!isMember && tab !== 'asked' && <div className="wk-empty">You can ask for work and follow it here.</div>}
        </>
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

function RunningCard({ running, secs, projName, busy, onPause, onFinish }) {
  return (
    <div className="wk-run">
      <div className="wk-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Play size={14} aria-hidden="true" /> Running now</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{running.task_label}</div>
      <div className="wk-sm">{projName(running.project_id)}</div>
      <div className="wk-timer" aria-live="off">{fmtClock(secs)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: onFinish ? '1fr 1fr' : '1fr', gap: 10 }}>
        <button className="wk-btn g lg" disabled={busy} onClick={onPause}><Pause size={18} aria-hidden="true" /> Pause</button>
        {onFinish && <button className="wk-btn y lg" disabled={busy} onClick={onFinish}><Check size={18} aria-hidden="true" /> Finish</button>}
      </div>
    </div>
  )
}

function StartForm({ projects, busy, entries, onAddProject, onStart }) {
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
    await onStart(pid, label.trim())
    setLabel('')
  }

  return (
    <div className="wk-card">
      <div style={{ fontSize: 18, fontWeight: 700 }}>Start the clock</div>
      <div className="wk-field"><label htmlFor="sf-client">Client</label>
        {!adding ? (
          <select id="sf-client" className="wk-input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Pick a client</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : (
          <input id="sf-client" className="wk-input" value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="New client name" maxLength={80} autoFocus />
        )}
        <button className="wk-chip" style={{ marginTop: 8 }} onClick={() => { setAdding((a) => !a); setNewClient('') }}>
          {adding ? 'Pick from list' : '+ New client'}
        </button>
      </div>
      <div className="wk-field"><label htmlFor="sf-label">What are you doing</label>
        <input id="sf-label" className="wk-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Type, or tap one below"
          onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
        {sugg.length > 0 && <div className="wk-chips">{sugg.map((s) => <button key={s} className="wk-chip" onClick={() => setLabel(s)}>{s}</button>)}</div>}
      </div>
      <button className="wk-btn y lg" style={{ marginTop: 18 }} disabled={busy} onClick={go}><Play size={18} aria-hidden="true" /> Start</button>
      <div className="wk-sm" style={{ marginTop: 10, textAlign: 'center' }}>First start of the day is your clock-in. Last stop is your clock-out.</div>
    </div>
  )
}

function EveningCard({ hour, entries, items, secs, name, projName, shared, uid, today, firstIn, onShared }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (hour < 19) return null
  const finished = items.filter((i) => i.status === 'finished' && i.finishedDay === today).length   // finished TODAY only
  const proc = items.filter((i) => i.status === 'in_process').length
  const late = items.filter((i) => i.status !== 'finished' && dueState(i.due, i.status).cls === 'bad').length
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
        const s = ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000
        total += s; byProj.set(e.project_id, (byProj.get(e.project_id) || 0) + s)
      })
      const last = rows.filter((e) => e.ended_at).slice(-1)[0]
      const lines = [
        `${name || 'Team member'} - Day report`, fmtDateShort(today), '',
        `In ${fmtTimeIST(rows[0]?.started_at)} | Out ${last ? fmtTimeIST(last.ended_at) : '-'} (${fmtDur(total)})`,
        `Finished: ${finished} | In process: ${proc} | Late: ${late}`, '',
        ...[...byProj.entries()].sort((a, b) => b[1] - a[1]).map(([p, s]) => `${projName(p) || 'Other'} - ${fmtDur(s)}`),
      ]
      if (note.trim()) lines.push('', `Note: ${note.trim()}`)
      const text = lines.join('\n')
      if (Capacitor.isNativePlatform()) openWhatsAppShare(text)
      else window.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`   // works on iPhone, Android and desktop
      supabase.rpc('work_mark_report_shared', { p_date: today, p_note: note.trim() || null })
        .then(({ error }) => { if (error) console.warn('report mark failed', error.message); onShared() })
    } catch (e) { toastError(e, 'Could not open WhatsApp.') } finally { setTimeout(() => setBusy(false), 1500) }
  }
  return (
    <div className="wk-card" style={{ borderColor: 'var(--accent)' }}>
      <div className="wk-row"><b style={{ fontSize: 18 }}>Your day report</b><span className="wk-pill warn"><Clock size={14} aria-hidden="true" /> after 7 PM</span></div>
      <div className="wk-sm" style={{ margin: '4px 0 10px' }}>{fmtDateShort(today)}</div>
      <div className="wk-row"><span className="wk-sm">Hours tracked</span><b className="wk-num">{fmtDur(secs)}</b></div>
      <div className="wk-row" style={{ marginTop: 6 }}><span className="wk-sm">Clock in</span><b className="wk-num">{firstIn ? fmtTimeIST(firstIn) : '-'}</b></div>
      <div className="wk-row" style={{ marginTop: 6 }}><span className="wk-sm">Finished / in process / late</span><b className="wk-num">{finished} / {proc} / {late}</b></div>
      <div className="wk-field"><label htmlFor="ev-note">Note for the team (optional)</label>
        <input id="ev-note" className="wk-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
      <button className="wk-btn y lg" style={{ marginTop: 14 }} disabled={busy} onClick={share}><Send size={18} aria-hidden="true" /> Share to your team group</button>
      {shared && <div className="wk-sm" style={{ marginTop: 8, textAlign: 'center' }}>Last shared {fmtTimeIST(shared.shared_at)}</div>}
    </div>
  )
}

function AskedTab({ asked, nameOf, projName, onOpen }) {
  if (!asked.length) return <div className="wk-empty">Tasks you ask for show here, with who is on them and how far they are.</div>
  return (
    <div className="wk-card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="wk-table" style={{ minWidth: 640 }}>
        <thead><tr><th>Task</th><th>Client</th><th>Who</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          {asked.map((t) => {
            const done = t.parts.filter((p) => p.status === 'finished').length
            const ds = dueState(t.due_date, t.status)
            return (
              <tr key={t.id} className="click" onClick={() => onOpen(t.id)}>
                <td><b>{t.title}</b></td>
                <td className="wk-sm">{projName(t.project_id) || '-'}</td>
                <td>{t.parts.map((p) => nameOf(p.assignee_id).split(' ')[0]).join(', ')}</td>
                <td><span className={`wk-pill ${ds.cls}`}>{ds.label}</span></td>
                <td><span className={`wk-pill ${t.status === 'finished' ? 'ok' : t.status === 'in_process' ? 'warn' : ''}`}>
                  {t.status === 'finished' ? 'Finished' : t.parts.length > 1 ? `${done} of ${t.parts.length} done` : t.status === 'in_process' ? 'In process' : 'Assigned'}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function HoursTab({ entries, projects, projName, onAddManual, onAddProject }) {
  const today = istTodayISO()
  const [show, setShow] = useState(false)
  const [project, setProject] = useState('')
  const [label, setLabel] = useState('')
  const [from, setFrom] = useState('10:00')
  const [to, setTo] = useState('11:00')
  const [day, setDay] = useState(today)
  const [note, setNote] = useState('')
  const submit = async () => {
    if (!project || !label.trim()) return toastError('', 'Pick a client and say what you did.')
    await onAddManual({
      p_project: project, p_label: label.trim(),
      p_start: `${day}T${from}:00+05:30`, p_end: `${day}T${to}:00+05:30`, p_note: note.trim() || null,
    })
    setShow(false); setLabel(''); setNote('')
  }
  return (
    <div>
      <div className="wk-row" style={{ marginBottom: 12 }}>
        <b style={{ fontSize: 18 }}>Today</b>
        <button className="wk-btn o sm" onClick={() => setShow((s) => !s)}><Plus size={16} aria-hidden="true" /> Add forgotten time</button>
      </div>
      {show && (
        <div className="wk-card" style={{ marginBottom: 14 }}>
          <div className="wk-sm">Needs your head's approval before it counts. Up to 12 hours, last 7 days.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <div className="wk-field"><label>Day</label><input className="wk-input" type="date" value={day} max={today} min={addDaysISO(today, -7)} onChange={(e) => setDay(e.target.value)} /></div>
            <div className="wk-field"><label>From</label><input className="wk-input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="wk-field"><label>To</label><input className="wk-input" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="wk-field"><label>Client</label>
            <select className="wk-input" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Pick a client</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="wk-field"><label>What did you do</label><input className="wk-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></div>
          <div className="wk-field"><label>Why (optional)</label><input className="wk-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></div>
          <button className="wk-btn y" style={{ marginTop: 14 }} onClick={submit}>Send for approval</button>
        </div>
      )}
      {entries.length === 0 ? <div className="wk-empty">No time recorded today. Start the clock from My work.</div> : (
        <div className="wk-card" style={{ padding: 0 }}>
          <table className="wk-table">
            <thead><tr><th>Client</th><th>What</th><th>From</th><th>To</th><th>Time</th></tr></thead>
            <tbody>
              {entries.map((e) => {
                const s = ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000
                return (
                  <tr key={e.id}>
                    <td>{projName(e.project_id) || '-'}</td>
                    <td>{e.task_label}{e.status === 'pending' && <span className="wk-pill warn" style={{ marginLeft: 8 }}>waiting approval</span>}
                      {e.status === 'declined' && <span className="wk-pill bad" style={{ marginLeft: 8 }}>declined</span>}
                      {e.auto_stopped && <span className="wk-pill" style={{ marginLeft: 8 }}>auto-stopped</span>}</td>
                    <td className="wk-sm">{fmtTimeIST(e.started_at)}</td>
                    <td className="wk-sm">{e.ended_at ? fmtTimeIST(e.ended_at) : 'running'}</td>
                    <td className="wk-num">{fmtDur(s)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
