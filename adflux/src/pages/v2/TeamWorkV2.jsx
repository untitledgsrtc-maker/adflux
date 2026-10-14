// src/pages/v2/TeamWorkV2.jsx - Phase 365. The head / admin view of the Work module:
// Overview, Tasks board, People (live timers + who is on the timeclock), Clients, Timeline,
// Hours & cost (cost = admin + accounts only), Approvals (added-later time).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Plus, Loader2, Check, X, AlertTriangle, Clock } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { istTodayISO } from '../../utils/istDate'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { fmtDur, fmtClock, dayStartISO, addDaysISO, fmtTimeIST, fmtDateShort, dueState, initialsOf, clientColor } from '../../utils/workUtils'
import WorkBoard from '../../components/work/WorkBoard'
import NewTaskModal from '../../components/work/NewTaskModal'
import TaskDetailModal from '../../components/work/TaskDetailModal'

const TABS = [['overview', 'Overview'], ['tasks', 'Tasks'], ['people', 'People'], ['clients', 'Clients'],
  ['timeline', 'Timeline'], ['hours', 'Hours & cost'], ['approvals', 'Approvals']]
const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Past 7 days'], ['30', 'Past 30 days'], ['custom', 'Pick a date']]

export default function TeamWorkV2() {
  const { profile, loading: authLoading } = useAuth()
  const uid = profile?.id
  const role = profile?.role
  const isAdmin = role === 'admin'
  const canCost = role === 'admin' || role === 'accounts'
  const today = istTodayISO()

  const [tab, setTab] = useState('overview')
  const [range, setRange] = useState('today')
  const [custom, setCustom] = useState(today)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [isHead, setIsHead] = useState(null)      // null while checking
  const [members, setMembers] = useState([])
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])
  const [running, setRunning] = useState([])
  const [pending, setPending] = useState([])
  const [parts, setParts] = useState([])
  const [templates, setTemplates] = useState([])
  const [report, setReport] = useState(null)
  const [cost, setCost] = useState(null)
  const [costMap, setCostMap] = useState({})
  const [shares, setShares] = useState([])
  const [taskTitles, setTaskTitles] = useState({})
  const [now, setNow] = useState(Date.now())
  const [newTask, setNewTask] = useState(false)
  const [openTask, setOpenTask] = useState(null)
  const [fPerson, setFPerson] = useState('')
  const [fClient, setFClient] = useState('')
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)

  const [from, to] = useMemo(() => {
    if (range === 'today') return [today, today]
    if (range === 'yesterday') return [addDaysISO(today, -1), addDaysISO(today, -1)]
    if (range === '7') return [addDaysISO(today, -6), today]
    if (range === '30') return [addDaysISO(today, -29), today]
    return [custom, custom]
  }, [range, custom, today])

  const load = useCallback(async () => {
    if (!uid) return
    setErr('')
    const t0 = dayStartISO(today)
    const q = await Promise.all([
      supabase.from('work_members').select('user_id,is_head'),
      supabase.from('users').select('id,name,designation,role,is_active').order('name'),
      supabase.from('work_projects').select('id,name,kind,is_active').order('name'),
      supabase.from('work_time_entries').select('*').is('ended_at', null),
      supabase.from('work_time_entries').select('*').eq('status', 'pending').order('started_at', { ascending: false }).limit(100),
      supabase.from('work_task_parts')
        .select('id,task_id,assignee_id,label,due_date,status,finished_at,seconds,task:work_tasks(id,title,project_id,created_by,due_date,template_id,created_at)')
        .or(`status.neq.finished,finished_at.gte.${dayStartISO(addDaysISO(today, -7))}`).limit(600),
      supabase.from('work_templates').select('id,title,project_id,assignee_id,repeat_kind,weekday,month_day,is_active,last_run_date').eq('is_active', true),
      supabase.rpc('work_hours_report', { p_from: from, p_to: to }),
      canCost ? supabase.rpc('work_cost_report', { p_from: from, p_to: to }) : Promise.resolve({ data: null }),
      canCost ? supabase.rpc('work_cost_report', { p_from: addDaysISO(today, -92), p_to: today }) : Promise.resolve({ data: null }),
      supabase.from('work_report_shares').select('user_id,shared_at').eq('work_date', today),
    ])
    const e = q.slice(0, 8).find((r) => r.error)
    if (e) { setErr(e.error.message || 'Could not load.'); setLoading(false); return }
    const rep = q[7].data
    if (!rep || !rep.by_person) { setIsHead(false); setLoading(false); return }   // not a head
    setIsHead(true)
    setMembers(q[0].data || []); setUsers(q[1].data || []); setProjects(q[2].data || [])
    setRunning(q[3].data || []); setPending(q[4].data || []); setParts(q[5].data || [])
    setTemplates(q[6].data || []); setReport(rep); setCost(q[8].data)
    const m = {}; (q[9].data?.by_task || []).forEach((t) => { m[t.task_id] = t }); setCostMap(m)
    setShares(q[10].data || [])
    setLoading(false)
  }, [uid, from, to, today, canCost])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load, { userId: uid, pollSeconds: 60 })
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])

  // task titles for the cost table
  useEffect(() => {
    const ids = (cost?.by_task || []).map((t) => t.task_id).filter((id) => !taskTitles[id])
    if (!ids.length) return
    supabase.from('work_tasks').select('id,title').in('id', ids.slice(0, 200)).then(({ data }) => {
      if (data) setTaskTitles((p) => ({ ...p, ...Object.fromEntries(data.map((t) => [t.id, t.title])) }))
    })
  }, [cost]) // eslint-disable-line

  const nameOf = useMemo(() => { const m = new Map(users.map((u) => [u.id, u.name])); return (id) => m.get(id) || 'Someone' }, [users])
  const projName = useMemo(() => { const m = new Map(projects.map((p) => [p.id, p.name])); return (id) => m.get(id) || '' }, [projects])
  const activeProjects = useMemo(() => projects.filter((p) => p.is_active), [projects])

  const rpc = async (name, args, okMsg) => {
    if (latch.current) return false
    latch.current = true; setBusy(true)
    try {
      const { error } = await supabase.rpc(name, args)
      if (error) throw error
      if (okMsg) toastSuccess(okMsg)
      await load(); return true
    } catch (e) { toastError(e, 'That did not work.'); return false } finally { latch.current = false; setBusy(false) }
  }
  const addProject = async (name) => {
    const { data, error } = await supabase.rpc('work_add_project', { p_name: name, p_kind: 'client' })
    if (error) throw error
    await load(); return data
  }

  const byPerson = useMemo(() => { const m = {}; (report?.by_person || []).forEach((p) => { m[p.user_id] = p }); return m }, [report])
  const runBy = useMemo(() => { const m = {}; running.forEach((r) => { m[r.user_id] = r }); return m }, [running])
  const taskCostByTask = costMap

  const items = useMemo(() => {
    const total = {}, done = {}
    parts.forEach((p) => { total[p.task_id] = (total[p.task_id] || 0) + 1; if (p.status === 'finished') done[p.task_id] = (done[p.task_id] || 0) + 1 })
    return parts
      .filter((p) => (!fPerson || p.assignee_id === fPerson) && (!fClient || p.task?.project_id === fClient))
      .map((p) => ({
        id: p.id, taskId: p.task_id, status: p.status, title: p.task?.title || 'Task', label: p.label,
        client: projName(p.task?.project_id), due: p.due_date || p.task?.due_date, assigneeId: p.assignee_id,
        assigneeName: nameOf(p.assignee_id), partsTotal: total[p.task_id] || 1, partsDone: done[p.task_id] || 0,
        seconds: taskCostByTask[p.task_id]?.seconds ?? p.seconds, cost: taskCostByTask[p.task_id]?.cost ?? null,
      }))
  }, [parts, fPerson, fClient, projName, nameOf, taskCostByTask])

  if (authLoading || !uid) return null
  if (isHead === false) return <Navigate to="/my-work" replace />

  const openCount = parts.filter((p) => p.status !== 'finished').length
  const lateParts = parts.filter((p) => p.status !== 'finished' && dueState(p.due_date || p.task?.due_date, p.status).cls === 'bad')
  const finishedToday = parts.filter((p) => p.status === 'finished' && p.finished_at && p.finished_at >= dayStartISO(today)).length
  const teamSecs = (report?.by_person || []).reduce((s, p) => s + Number(p.seconds || 0), 0)
  const memberIds = members.map((m) => m.user_id)
  const sharedSet = new Set(shares.map((s) => s.user_id))
  const firedToday = parts.filter((p) => p.task?.template_id && p.task?.created_at >= dayStartISO(today))

  return (
    <div className="wk">
      <div className="wk-head">
        <div>
          <div className="wk-eyebrow">{new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short' })}</div>
          <h1 className="wk-title">Team work</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link to="/my-work" className="wk-btn o">My work</Link>
          <button className="wk-btn y" onClick={() => setNewTask(true)}><Plus size={16} aria-hidden="true" /> New task</button>
        </div>
      </div>

      <div className="wk-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`wk-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {l}{k === 'approvals' && pending.length > 0 && <span className="wk-cnt">{pending.length}</span>}
          </button>
        ))}
      </div>

      {['overview', 'timeline', 'hours', 'clients'].includes(tab) && (
        <div className="wk-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="wk-tabs" style={{ margin: 0 }}>
            {RANGES.map(([k, l]) => <button key={k} className={`wk-tab${range === k ? ' on' : ''}`} onClick={() => setRange(k)}>{l}</button>)}
          </div>
          {range === 'custom' && <input type="date" className="wk-input" style={{ width: 170 }} value={custom} max={today} onChange={(e) => setCustom(e.target.value)} aria-label="Pick a date" />}
        </div>
      )}

      {err && <div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div>}
      {loading && !err && <div className="wk-empty"><Loader2 className="spin" size={26} aria-hidden="true" /></div>}

      {!loading && !err && tab === 'overview' && (
        <>
          <HeroSegs live eyebrow={`Team · ${range === 'today' ? 'today' : range === 'yesterday' ? 'yesterday' : 'selected dates'}`} segs={[
            ['Team hours', fmtDur(teamSecs), `${Object.keys(byPerson).length} ${Object.keys(byPerson).length === 1 ? 'person' : 'people'} tracked`],
            ['Working now', `${running.length} of ${memberIds.length}`, 'Live timers'],
            ['Open tasks', String(openCount), 'Assigned and in process'],
            ['Finished today', String(finishedToday)],
          ]} />
          <div className="wk-card" style={{ marginBottom: 16 }}>
            <b style={{ fontSize: 18 }}>Needs you</b>
            {[
              lateParts.length > 0 && { icon: AlertTriangle, tone: 'bad', text: `${lateParts.length} task part${lateParts.length > 1 ? 's' : ''} late`, go: () => setTab('tasks') },
              pending.length > 0 && { icon: Clock, tone: 'warn', text: `${pending.length} added-later time${pending.length > 1 ? 's' : ''} waiting for you`, go: () => setTab('approvals') },
            ].filter(Boolean).map((r, i) => (
              <div key={i} className="wk-row" style={{ minHeight: 52, borderBottom: '1px solid var(--border)' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><r.icon size={18} style={{ color: r.tone === 'bad' ? 'var(--danger)' : 'var(--warning)' }} aria-hidden="true" />{r.text}</span>
                <button className="wk-btn g sm" onClick={r.go}>Open</button>
              </div>
            ))}
            {lateParts.length === 0 && pending.length === 0 && <div className="wk-sm" style={{ marginTop: 8 }}>All handled. Nothing is stuck.</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <div className="wk-card"><b style={{ fontSize: 18 }}>Who is working</b>
              {memberIds.length === 0 && <div className="wk-sm" style={{ marginTop: 8 }}>No one is on the timeclock yet. Add people in the People tab.</div>}
              {memberIds.map((id) => {
                const r = runBy[id]
                return (
                  <div key={id} className="wk-row" style={{ minHeight: 44, borderBottom: '1px solid var(--border)' }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="wk-dot" style={{ background: r ? 'var(--success)' : 'var(--border-strong)' }} aria-hidden="true" />
                      <b>{nameOf(id)}</b>
                    </span>
                    <span className="wk-sm">{r ? `${projName(r.project_id) || r.task_label} - ${fmtClock((now - new Date(r.started_at)) / 1000)}` : 'Not running'}</span>
                  </div>
                )
              })}
            </div>
            <div className="wk-card"><b style={{ fontSize: 18 }}>Fired this morning</b>
              {firedToday.length === 0 && <div className="wk-sm" style={{ marginTop: 8 }}>No repeating task fired today (none set, or a Sunday / holiday).</div>}
              {firedToday.map((p) => (
                <div key={p.id} className="wk-row" style={{ minHeight: 44, borderBottom: '1px solid var(--border)' }}>
                  <span>{p.task?.title}</span><span className="wk-sm">{nameOf(p.assignee_id)}</span>
                </div>
              ))}
            </div>
            <div className="wk-card"><b style={{ fontSize: 18 }}>Evening report</b>
              <div className="wk-sm" style={{ marginBottom: 6 }}>Shared today</div>
              {memberIds.map((id) => (
                <div key={id} className="wk-row" style={{ minHeight: 40 }}>
                  <span>{nameOf(id)}</span>
                  {sharedSet.has(id) ? <span className="wk-pill ok"><Check size={14} aria-hidden="true" /> shared</span> : <span className="wk-pill">not yet</span>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && !err && tab === 'tasks' && (
        <>
          <HeroSegs eyebrow="Board · filtered" segs={[
            ['In process', String(items.filter((i) => i.status === 'in_process').length), 'Being worked on'],
            ['Assigned', String(items.filter((i) => i.status === 'assigned').length), 'Not started'],
            ['Late', String(lateParts.length), lateParts.length ? 'Past due date' : 'None'],
          ]} />
          <div className="wk-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
            <select className="wk-input" style={{ width: 220 }} value={fPerson} onChange={(e) => setFPerson(e.target.value)} aria-label="Filter by person">
              <option value="">All people</option>{memberIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
            <select className="wk-input" style={{ width: 240 }} value={fClient} onChange={(e) => setFClient(e.target.value)} aria-label="Filter by client">
              <option value="">All clients</option>{activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="wk-sm">{items.filter((i) => i.status !== 'finished').length} open · {lateParts.length} late</span>
          </div>
          <div className="wk-sm" style={{ marginTop: 8 }}>Drag a card to change its status. A task with several people finishes when every part is finished.</div>
          <WorkBoard items={items} uid={uid} showCost={canCost} onMove={(id, to2) => rpc('work_move_part', { p_part: id, p_to: to2 })} onOpen={setOpenTask} />
        </>
      )}

      {!loading && !err && tab === 'people' && (
        <PeopleTab members={members} users={users} nameOf={nameOf} runBy={runBy} byPerson={byPerson} projName={projName}
          now={now} isAdmin={isAdmin} busy={busy} onSet={(u, m, h) => rpc('work_set_member', { p_user: u, p_member: m, p_head: h })} />
      )}

      {!loading && !err && tab === 'clients' && (
        <ClientsTab projects={projects} report={report} cost={cost} canCost={canCost}
          onAdd={async (n) => { try { await addProject(n); toastSuccess('Client added.') } catch (e) { toastError(e, 'Could not add.') } }}
          onUpdate={(id, name, active, merge) => rpc('work_update_project', { p_id: id, p_name: name, p_active: active, p_merge_into: merge || null })} />
      )}

      {!loading && !err && tab === 'timeline' && (
        <TimelineTab memberIds={memberIds} nameOf={nameOf} byPerson={byPerson} from={from} to={to} projName={projName} />
      )}

      {!loading && !err && tab === 'hours' && (
        <HoursTab report={report} cost={cost} canCost={canCost} projName={projName} nameOf={nameOf} taskTitles={taskTitles} onOpen={setOpenTask} />
      )}

      {!loading && !err && tab === 'approvals' && (
        <>
        <HeroSegs eyebrow="Waiting for you" segs={[['Requests', String(pending.length), 'Forgotten time']]} />
        <div className="wk-card" style={{ padding: 0, overflowX: 'auto' }}>
          {pending.length === 0 ? <div className="wk-empty">Nothing waiting. Added-later time shows here for your OK.</div> : (
            <table className="wk-table" style={{ minWidth: 640 }}>
              <thead><tr><th>Person</th><th>Client</th><th>What</th><th>When</th><th>Time</th><th /></tr></thead>
              <tbody>
                {pending.map((e) => (
                  <tr key={e.id}>
                    <td><b>{nameOf(e.user_id)}</b></td>
                    <td className="wk-sm">{projName(e.project_id) || '-'}</td>
                    <td>{e.task_label}{e.note && <div className="wk-sm">{e.note}</div>}</td>
                    <td className="wk-sm">{fmtDateShort(e.started_at.slice(0, 10))} {fmtTimeIST(e.started_at)}</td>
                    <td className="wk-num">{fmtDur((new Date(e.ended_at) - new Date(e.started_at)) / 1000)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="wk-btn y sm" disabled={busy} onClick={() => rpc('work_decide_time', { p_entry: e.id, p_approve: true }, 'Approved.')}><Check size={14} aria-hidden="true" /> Approve</button>{' '}
                      <button className="wk-btn o sm" disabled={busy} onClick={() => rpc('work_decide_time', { p_entry: e.id, p_approve: false }, 'Declined.')}><X size={14} aria-hidden="true" /> Decline</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>
      )}

      {newTask && (
        <NewTaskModal projects={activeProjects} users={users.filter((u) => u.is_active && u.role !== 'agency')} meId={uid} onAddProject={addProject}
          onClose={() => setNewTask(false)} onCreated={() => { setNewTask(false); load() }} />
      )}
      {openTask && (
        <TaskDetailModal taskId={openTask} uid={uid} isHead nameOf={nameOf} projectName={projName}
          onClose={() => setOpenTask(null)} onChanged={load} />
      )}
    </div>
  )
}

function HeroSegs({ eyebrow, segs, live }) {
  return (
    <div className="wk-hero" style={{ marginBottom: 16 }}>
      <span className="wk-grp">{live && <span className="wk-ldot" aria-hidden="true" />}<span className="wk-eyb">{eyebrow}</span></span>
      <div className="wk-hsegs" style={{ gridTemplateColumns: `repeat(${segs.length}, minmax(0, 1fr))` }}>
        {segs.map(([l, v, sub], i) => (
          <div key={l} className="wk-hseg">
            <div className="wk-hs">{l}</div>
            <div className="wk-num" style={{ fontSize: i === 0 ? 34 : 26, fontWeight: 600, color: i === 0 ? 'var(--accent)' : '#fff' }}>{v}</div>
            {sub && <div className="wk-hs">{sub}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function PeopleTab({ members, users, nameOf, runBy, byPerson, projName, now, isAdmin, busy, onSet }) {
  const [add, setAdd] = useState('')
  const ids = new Set(members.map((m) => m.user_id))
  const candidates = users.filter((u) => u.is_active && !ids.has(u.id) && u.role !== 'agency')
  return (
    <div>
      <HeroSegs eyebrow="Work team" segs={[['People', String(members.length), `${members.filter((m) => m.is_head).length} head`], ['Working now', String(Object.keys(runBy).length), 'Live timers']]} />
      {isAdmin && (
        <div className="wk-card" style={{ marginBottom: 14 }}>
          <b>Put someone on the timeclock</b>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <select className="wk-input" style={{ flex: 1, minWidth: 220 }} value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Person">
              <option value="">Pick a person</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}{u.designation ? ` - ${u.designation}` : ''}</option>)}
            </select>
            <button className="wk-btn y" disabled={!add || busy} onClick={async () => { if (await onSet(add, true, false)) setAdd('') }}>Add</button>
          </div>
        </div>
      )}
      <div className="wk-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="wk-table" style={{ minWidth: 640 }}>
          <thead><tr><th>Person</th><th>Now</th><th>Hours in range</th><th>Head</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {members.map((m) => {
              const r = runBy[m.user_id]
              return (
                <tr key={m.user_id}>
                  <td><Link to={`/work-profile?user=${m.user_id}`} style={{ color: 'inherit', fontWeight: 700 }}>{nameOf(m.user_id)}</Link></td>
                  <td className="wk-sm">{r ? <><span className="wk-dot" style={{ background: 'var(--success)', marginRight: 6 }} />{projName(r.project_id) || r.task_label} · {fmtClock((now - new Date(r.started_at)) / 1000)}</> : 'Not running'}</td>
                  <td className="wk-num">{fmtDur(byPerson[m.user_id]?.seconds || 0)}</td>
                  <td>{isAdmin ? (
                    <button type="button" role="switch" aria-checked={m.is_head} aria-label={`Head: ${nameOf(m.user_id)}`} disabled={busy}
                      className={`wk-sw${m.is_head ? ' on' : ''}`} onClick={() => onSet(m.user_id, true, !m.is_head)}><i /></button>
                  ) : (m.is_head ? 'Yes' : '')}</td>
                  {isAdmin && <td><button className="wk-btn o sm" disabled={busy} onClick={() => onSet(m.user_id, false, false)}>Remove</button></td>}
                </tr>
              )
            })}
            {members.length === 0 && <tr><td colSpan={5} className="wk-empty">No one yet. People get on the timeclock when they are given a task, or add them above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClientsTab({ projects, report, cost, canCost, onAdd, onUpdate }) {
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [edit, setEdit] = useState(null)
  const [en, setEn] = useState('')
  const [merge, setMerge] = useState('')
  const hours = useMemo(() => { const m = {}; (report?.by_project || []).forEach((p) => { m[p.project_id] = p }); return m }, [report])
  const costBy = useMemo(() => { const m = {}; (cost?.by_project || []).forEach((p) => { m[p.project_id] = p }); return m }, [cost])
  const [notSame, setNotSame] = useState([])
  const dup = useMemo(() => {
    const norm = (n) => n.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|co|company)\b/g, '').replace(/[^a-z0-9]/g, '')
    const seen = new Map()
    for (const p of projects.filter((x) => x.is_active)) {
      const k = norm(p.name); if (!k) continue
      if (seen.has(k)) {
        const a = seen.get(k)
        const key = [a.id, p.id].sort().join('|')
        if (!notSame.includes(key)) return [a, p]
      } else seen.set(k, p)
    }
    return null
  }, [projects, notSame])
  const rows = projects.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (hours[b.id]?.seconds || 0) - (hours[a.id]?.seconds || 0) || a.name.localeCompare(b.name))
  return (
    <div>
      <HeroSegs eyebrow="Clients worked on" segs={[['Clients', String(projects.filter((p) => p.is_active).length), `${(report?.by_project || []).length} with time in these dates`]]} />
      {dup && (
        <div className="wk-grp" style={{ padding: 16, borderRadius: 14, background: 'rgba(59,130,246,.12)', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 200 }}><b>Possible duplicate:</b> {dup[0].name} and {dup[1].name}</div>
          <button className="wk-btn sm" onClick={() => onUpdate(dup[1].id, dup[1].name, true, dup[0].id)}>Merge into {dup[0].name}</button>
          <button className="wk-btn o sm" onClick={() => setNotSame((x) => [...x, dup.map((d) => d.id).sort().join('|')])}>Not the same</button>
        </div>
      )}
      <div className="wk-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <input className="wk-input" style={{ width: 240 }} placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
        <input className="wk-input" style={{ width: 240 }} placeholder="New client name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="New client name" />
        <button className="wk-btn y" disabled={!name.trim()} onClick={async () => { await onAdd(name.trim()); setName('') }}><Plus size={16} aria-hidden="true" /> Add client</button>
      </div>
      <div className="wk-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="wk-table" style={{ minWidth: 640 }}>
          <thead><tr><th>Client</th><th>People</th><th>Last day</th><th>Hours</th>{canCost && <th>Cost</th>}<th /></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((p) => (
              <tr key={p.id} style={{ opacity: p.is_active ? 1 : .55 }}>
                <td><b>{p.name}</b> {!p.is_active && <span className="wk-pill">archived</span>}</td>
                <td className="wk-num">{hours[p.id]?.people || 0}</td>
                <td className="wk-sm">{hours[p.id]?.last_day ? fmtDateShort(hours[p.id].last_day) : '-'}</td>
                <td className="wk-num">{fmtDur(hours[p.id]?.seconds || 0)}</td>
                {canCost && <td className="wk-num">{costBy[p.id] ? `Rs ${Number(costBy[p.id].cost).toLocaleString('en-IN')}` : '-'}</td>}
                <td><button className="wk-btn o sm" onClick={() => { setEdit(p); setEn(p.name); setMerge('') }}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="wk-modal-back" onClick={() => setEdit(null)}>
          <div className="wk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit client">
            <b style={{ fontSize: 20 }}>Edit client</b>
            <div className="wk-field"><label>Name</label><input className="wk-input" value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} /></div>
            <button className="wk-btn y" style={{ marginTop: 12 }} onClick={async () => { await onUpdate(edit.id, en, edit.is_active, null); setEdit(null) }}>Save name</button>
            <button className="wk-btn o" style={{ marginTop: 10, marginLeft: 8 }} onClick={async () => { await onUpdate(edit.id, edit.name, !edit.is_active, null); setEdit(null) }}>{edit.is_active ? 'Archive' : 'Bring back'}</button>
            <div className="wk-field"><label>Merge into another client (moves all hours and tasks, then removes this one)</label>
              <select className="wk-input" value={merge} onChange={(e) => setMerge(e.target.value)}>
                <option value="">Pick the client to keep</option>
                {projects.filter((p) => p.id !== edit.id && p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <button className="wk-btn o" disabled={!merge} onClick={async () => { await onUpdate(edit.id, edit.name, true, merge); setEdit(null) }}>Merge</button>
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineTab({ memberIds, nameOf, byPerson, from, to, projName }) {
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)
  const cap = 8.5 * 3600 * days
  const rows = [...memberIds].sort((a, b) => (byPerson[b]?.seconds || 0) - (byPerson[a]?.seconds || 0))
  const [open, setOpen] = useState(null)
  const [all, setAll] = useState([])
  const [nowMs, setNowMs] = useState(Date.now())
  useEffect(() => {
    let live = true
    supabase.from('work_time_entries').select('*').eq('status', 'approved')
      .gte('started_at', dayStartISO(from)).lt('started_at', dayStartISO(addDaysISO(to, 1))).order('started_at').limit(2000)
      .then(({ data }) => { if (live) setAll(data || []) })
    const i = setInterval(() => setNowMs(Date.now()), 60000)
    return () => { live = false; clearInterval(i) }
  }, [from, to])
  const detail = open ? all.filter((e) => e.user_id === open) : []
  const single = from === to
  const H0 = 8, H1 = 21
  const hourOf = (iso) => { const d = new Date(new Date(iso).getTime() + 5.5 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60 }
  const pct = (h) => Math.max(0, Math.min(100, (h - H0) / (H1 - H0) * 100))
  const nowH = hourOf(new Date(nowMs).toISOString())
  const byUser = {}; all.forEach((e) => { (byUser[e.user_id] = byUser[e.user_id] || []).push(e) })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: open ? 'minmax(0,1.3fr) minmax(0,1fr)' : '1fr', gap: 16, alignItems: 'start' }}>
      <div className="wk-card flush">
        <div className="wk-ch"><h3>{single ? 'Today, by person' : 'Hours, by person'}</h3></div>
        {rows.length === 0 && <div className="wk-empty">No one is on the timeclock yet.</div>}
        {single ? (
          <div style={{ padding: 16, overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 12, marginBottom: 6 }}>
                <span />
                <div style={{ position: 'relative', height: 18 }}>
                  {Array.from({ length: H1 - H0 + 1 }, (_, i) => i).filter((i) => i % 1 === 0).map((i) => (
                    <span key={i} className="wk-num wk-mu" style={{ position: 'absolute', left: `${pct(H0 + i)}%`, fontSize: 11, transform: 'translateX(-50%)' }}>{String(H0 + i).padStart(2, '0')}</span>
                  ))}
                </div>
              </div>
              {rows.map((id) => (
                <div key={id} className="wk-hov" onClick={() => setOpen(id)} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 12, alignItems: 'center', minHeight: 48, borderRadius: 10 }}>
                  <span className="wk-grp" style={{ paddingLeft: 8, flexWrap: 'nowrap' }}><span className="wk-av" style={{ width: 28, height: 28 }}>{initialsOf(nameOf(id))}</span><b style={{ fontSize: 13 }}>{nameOf(id)}</b></span>
                  <div style={{ position: 'relative', height: 26, background: 'var(--w-hov)', borderRadius: 6 }}>
                    {(byUser[id] || []).map((e) => {
                      const s0 = hourOf(e.started_at), e0 = e.ended_at ? hourOf(e.ended_at) : nowH
                      return <span key={e.id} title={`${projName(e.project_id) || '-'} · ${e.task_label}`}
                        style={{ position: 'absolute', left: `${pct(s0)}%`, width: `${Math.max(0.6, pct(e0) - pct(s0))}%`, top: 3, bottom: 3, borderRadius: 6, background: clientColor(projName(e.project_id)), boxShadow: e.ended_at ? 'none' : '0 0 0 2px var(--accent)' }} />
                    })}
                    <span style={{ position: 'absolute', left: `${pct(nowH)}%`, top: -4, bottom: -4, width: 2, background: 'var(--accent)' }} />
                  </div>
                </div>
              ))}
              <div className="wk-sm" style={{ marginTop: 10, paddingLeft: 182 }}>Yellow line is now. Outlined blocks are running. Colour = client.</div>
            </div>
          </div>
        ) : rows.map((id) => {
          const s = byPerson[id]?.seconds || 0
          return (
            <div key={id} className="wk-hrow wk-hov" style={{ padding: '6px 16px', borderBottom: '1px solid var(--border)' }} onClick={() => setOpen(id)}>
              <span><b>{nameOf(id)}</b>{s === 0 && <span className="wk-pill" style={{ marginLeft: 8 }}>no clock-in</span>}</span>
              <div className="wk-bar-h"><i style={{ width: `${Math.min(100, s / cap * 100)}%` }} /></div>
              <span className="wk-num" style={{ textAlign: 'right' }}>{fmtDur(s)}</span>
            </div>
          )
        })}
        <div className="wk-sm" style={{ padding: 12 }}>Tap a person for their day. No screenshots, no activity score.</div>
      </div>
      {open && (
        <div className="wk-card">
          <div className="wk-row"><b style={{ fontSize: 18 }}>{nameOf(open)}</b><button className="wk-btn o sm" onClick={() => setOpen(null)}>Close</button></div>
          <div className="wk-sm">{from === to ? fmtDateShort(from) : `${fmtDateShort(from)} to ${fmtDateShort(to)}`}</div>
          {detail.length === 0 && <div className="wk-sm" style={{ marginTop: 10 }}>No time recorded.</div>}
          {detail.map((e) => (
            <div key={e.id} className="wk-log">
              <span className="wk-dot" style={{ background: clientColor(projName(e.project_id)), marginTop: 5 }} />
              <div style={{ flex: 1 }}><b>{projName(e.project_id) || '-'}</b><div className="wk-sm">{e.task_label}</div></div>
              <div className="wk-sm" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{fmtTimeIST(e.started_at)} - {e.ended_at ? fmtTimeIST(e.ended_at) : 'running'}<br />{fmtDur(((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HoursTab({ report, cost, canCost, projName, nameOf, taskTitles, onOpen }) {
  const proj = [...(report?.by_project || [])].sort((a, b) => b.seconds - a.seconds)
  const max = proj[0]?.seconds || 1
  const costBy = {}; (cost?.by_project || []).forEach((p) => { costBy[p.project_id] = p })
  return (
    <div>
      {canCost && cost && cost.total_cost != null && (
        <HeroSegs eyebrow="Cost · selected dates" segs={[
          ['Team cost', `Rs ${Number(cost.total_cost).toLocaleString('en-IN')}`, 'Salary-based'],
          ['Hours tracked', fmtDur(cost.total_seconds)],
          ['Cost per hour', `Rs ${cost.total_seconds ? Math.round(cost.total_cost / (cost.total_seconds / 3600)) : 0}`, 'Average'],
          ['Not on any task', `${cost.total_seconds ? Math.round(cost.unassigned_seconds / cost.total_seconds * 100) : 0}%`],
        ]} />
      )}
      <div className="wk-card"><b style={{ fontSize: 18 }}>Hours per client</b>
        {proj.length === 0 && <div className="wk-sm" style={{ marginTop: 8 }}>No time in this range.</div>}
        {proj.slice(0, 40).map((p) => (
          <div key={p.project_id || 'none'} className="wk-hrow">
            <span className="wk-grp" style={{ flexWrap: 'nowrap' }}><span className="wk-dot" style={{ background: clientColor(projName(p.project_id)) }} />{projName(p.project_id) || 'No client'}</span>
            <div className="wk-bar-h"><i style={{ width: `${p.seconds / max * 100}%`, background: clientColor(projName(p.project_id)) }} /></div>
            <span className="wk-num" style={{ textAlign: 'right' }}>{fmtDur(p.seconds)}{canCost && costBy[p.project_id] ? ` · Rs ${Number(costBy[p.project_id].cost).toLocaleString('en-IN')}` : ''}</span>
          </div>
        ))}
      </div>
      {canCost && cost && (cost.by_task || []).length > 0 && (
        <div className="wk-card" style={{ marginTop: 16, padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px 0' }}><b style={{ fontSize: 18 }}>Task cost</b><div className="wk-sm">Admin and accounts only. Click a task for who spent how long.</div></div>
          <table className="wk-table" style={{ minWidth: 560 }}>
            <thead><tr><th>Task</th><th>People</th><th>Hours</th><th>Cost</th></tr></thead>
            <tbody>
              {[...cost.by_task].sort((a, b) => b.cost - a.cost).slice(0, 80).map((t) => (
                <tr key={t.task_id} className="click" onClick={() => onOpen(t.task_id)}>
                  <td><b>{taskTitles[t.task_id] || 'Task'}</b></td><td className="wk-num">{t.people}</td>
                  <td className="wk-num">{fmtDur(t.seconds)}</td><td className="wk-num">Rs {Number(t.cost).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canCost && <div className="wk-sm" style={{ marginTop: 12 }}>Cost figures are shown to admin and accounts only.</div>}
    </div>
  )
}
