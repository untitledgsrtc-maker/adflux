// src/pages/v2/MyWorkV2.jsx - Phase 365. The person's Work page (timeclock + tasks).
// Running clock, start without a task, my board (drag or Start / Finish), tasks I asked
// for, my hours (+ add forgotten time), evening report after 7 PM. Writes only through
// the work_* database functions. Hours have NO pay effect.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Play, Pause, Check, Plus, Send, Clock, Users, User, CalendarX, FileText, ChevronRight, Moon } from 'lucide-react'
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

  const dateLine = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' })
  const openAll = items.filter((i) => i.status !== 'finished').length
  const showTabs = [
    isMember && ['work', 'My work'],
    ['asked', 'Asked by me', asked.length],
    isMember && ['hours', 'My hours'],
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
          <button className="wk-btn y" onClick={() => setNewTask(true)}><Plus size={16} aria-hidden="true" /> New task</button>
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
              <div className="wk-c8">
                {running
                  ? <RunningCard running={running} secs={runSecs} projName={projName} busy={busy}
                      onPause={() => rpc('work_clock_stop', {})}
                      onFinish={running.part_id ? () => rpc('work_finish_part', { p_part: running.part_id, p_note: null }, 'Finished.') : null} />
                  : <StartForm projects={projects} busy={busy} entries={entries}
                      onAddProject={addProject}
                      onStart={(project, label) => rpc('work_clock_start', { p_project: project, p_label: label, p_part: null })} />}
              </div>
              <div className="wk-c4">
                <div className="wk-stack">
                  {istHour() >= 19
                    ? <EveningCard hour={istHour()} entries={entries} items={items} secs={todaySecs} name={profile?.name}
                        projName={projName} shared={shared} uid={uid} today={today} firstIn={firstIn} onShared={load} />
                    : <TodayStrip secs={todaySecs} firstIn={firstIn} />}
                  <Shortcuts />
                </div>
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
                    <input className="wk-input" type="date" style={{ width: 150 }} value={rFrom} aria-label="From date"
                      onChange={(e) => { const v = e.target.value; if (!v) { setViewFrom(null); setViewTo(null) } else { setViewFrom(v); if (!viewTo || viewTo < v) setViewTo(v) } }} />
                    <span className="wk-sm">To</span>
                    <input className="wk-input" type="date" style={{ width: 150 }} value={rTo} min={rFrom} aria-label="To date"
                      onChange={(e) => { const v = e.target.value; if (v) { setViewFrom(viewFrom || rFrom); setViewTo(v) } }} />
                    <button className={`wk-btn ${isToday ? 'y' : 'o'}`} onClick={() => { setViewFrom(null); setViewTo(null) }}>Today</button>
                  </div>
                </div>
                {boardItems.length === 0 ? (
                  <div className="wk-card">
                    <div className="wk-empty"><b>Nothing for {isToday ? 'today' : 'these dates'}</b>
                      No tasks due {isToday ? 'today and nothing overdue' : 'in this range'}. Ask your head for work or pick other dates.
                      <div style={{ marginTop: 12 }}><button className="wk-btn" onClick={() => setNewTask(true)}><Plus size={16} aria-hidden="true" /> Ask for work</button></div>
                    </div>
                  </div>
                ) : (
                  <WorkBoard items={boardItems} uid={uid} onMove={onMove} onOpen={setOpenTask} onStart={onStart} onFinish={onFinish} />
                )}
                <div className="wk-sm" style={{ marginTop: 10 }}>Drag your own task forward: Assigned to In process starts the clock, In process to Finished stops it. Or use Start / Finish.</div>
              </div>
            </div>
          )}

          {tab === 'asked' && <AskedTab asked={asked} nameOf={nameOf} projName={projName} onOpen={setOpenTask} onNew={() => setNewTask(true)} />}
          {tab === 'hours' && isMember && <HoursTab entries={entries} projects={projects} projName={projName} secs={todaySecs} onAddManual={(a) => rpc('work_add_manual_time', a, 'Sent for approval.')} onAddProject={addProject} />}
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

function Shortcuts() {
  const rows = [[User, 'My profile', '/work-profile'], [CalendarX, 'Leave request', '/my-offer'], [FileText, 'Salary slips', '/my-performance']]
  return (
    <div className="wk-card flush">
      <div className="wk-list">
        {rows.map(([Icon, label, to]) => (
          <Link key={label} to={to} className="wk-lrow">
            <Icon size={18} aria-hidden="true" /><span style={{ flex: 1 }}>{label}</span>
            <ChevronRight size={16} aria-hidden="true" className="wk-mu" />
          </Link>
        ))}
      </div>
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

function RunningCard({ running, secs, projName, busy, onPause, onFinish }) {
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
          {onFinish && <button className="wk-btn y" disabled={busy} onClick={onFinish}><Check size={16} aria-hidden="true" /> Finish</button>}
        </div>
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
    <div className="wk-hero">
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
    <div className="wk-card flush">
      <div className="wk-ch">
        <div><h3><span className="wk-tile"><Moon size={16} aria-hidden="true" /></span>Evening report</h3><div className="wk-csub">{fmtDateShort(today)} · ready to share</div></div>
      </div>
      <div style={{ padding: 18, display: 'grid', gap: 12 }}>
        <div className="wk-rep">
          <div className="wk-row"><span className="wk-mu">Hours</span><span className="wk-num">{fmtDur(secs)}</span></div>
          <div className="wk-row"><span className="wk-mu">Clock-in</span><span className="wk-num">{firstIn ? fmtTimeIST(firstIn) : '-'}</span></div>
          <div className="wk-row"><span className="wk-mu">Finished</span><span className="wk-num">{finished}</span></div>
          <div className="wk-row"><span className="wk-mu">In process</span><span className="wk-num">{proc}</span></div>
          <div className="wk-row"><span className="wk-mu">Late</span><span className="wk-num" style={{ color: late ? 'var(--danger)' : undefined }}>{late}</span></div>
        </div>
        <div className="wk-field" style={{ margin: 0 }}><label htmlFor="ev-note">Note (optional)</label>
          <textarea id="ev-note" className="wk-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Anything the team should know" /></div>
        <button className="wk-btn y lg" disabled={busy} onClick={share}><Send size={16} aria-hidden="true" /> Share to your team group</button>
        <div className="wk-sm">{shared ? `Last shared ${fmtTimeIST(shared.shared_at)}. ` : ''}Opens WhatsApp with this report filled in.</div>
      </div>
    </div>
  )
}

const PART_PILL = { assigned: ['', 'Assigned'], in_process: ['in', 'In process'], finished: ['ok', 'Finished'] }

function AskedTab({ asked, nameOf, projName, onOpen, onNew }) {
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
                        <div key={p.id} className="wk-grp" style={{ flexWrap: 'nowrap' }}>
                          <span className="wk-av" style={{ width: 26, height: 26, fontSize: 11 }}>{nameOf(p.assignee_id).slice(0, 2).toUpperCase()}</span>
                          <span style={{ flex: 1 }}>{nameOf(p.assignee_id).split(' ')[0]}{p.label && <span className="wk-mu"> · {p.label}</span>}</span>
                          <span className={`wk-pill ${tone}`}>{lbl}</span>
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

function HoursTab({ entries, projects, projName, secs, onAddManual, onAddProject }) {
  const today = istTodayISO()
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
    setLabel(''); setNote('')
  }
  const approved = entries.filter((e) => e.status === 'approved')
  const asks = entries.filter((e) => e.status !== 'approved')
  const longDay = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' })
  return (
    <div className="wk-grid">
      <div className="wk-c12">
        <div className="wk-hero">
          <span className="wk-eyb">Tracked today</span>
          <div className="wk-num" style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>{fmtDur(secs)}</div>
          <div className="wk-hs">Across {new Set(approved.map((e) => e.project_id)).size || 0} clients</div>
        </div>
      </div>
      <div className="wk-c8">
        <div className="wk-card flush">
          <div className="wk-ch"><h3><span className="wk-tile"><Clock size={16} aria-hidden="true" /></span>Days</h3></div>
          {approved.length === 0 ? (
            <div className="wk-empty"><b>No time tracked today</b>Start a timer on My work, or add time you forgot to track.</div>
          ) : (
            <div>
              <div className="wk-row" style={{ padding: '14px 20px', background: 'var(--w-hov, rgba(51,65,85,.45))' }}>
                <b>{longDay}</b><b className="wk-num">{fmtDur(secs)}</b>
              </div>
              {approved.map((e) => {
                const s = ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000
                return (
                  <div key={e.id} className="wk-row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>{projName(e.project_id) || '-'}</div>
                      <div className="wk-sm">{e.task_label} · {fmtTimeIST(e.started_at)} to {e.ended_at ? fmtTimeIST(e.ended_at) : 'running'}
                        {e.auto_stopped && ' · auto-stopped'}</div>
                    </div>
                    {!e.ended_at && <span className="wk-pill y"><span className="wk-ldot" style={{ width: 6, height: 6, boxShadow: 'none' }} aria-hidden="true" />Running</span>}
                    <span className="wk-num">{fmtDur(s)}</span>
                  </div>
                )
              })}
            </div>
          )}
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
                <div className="wk-field" style={{ margin: 0 }}><label>Day</label><input className="wk-input" type="date" value={day} max={today} min={addDaysISO(today, -7)} onChange={(e) => setDay(e.target.value)} /></div>
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
