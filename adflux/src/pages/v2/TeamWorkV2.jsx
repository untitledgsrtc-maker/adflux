// src/pages/v2/TeamWorkV2.jsx - Phase 365. The head / admin view of the Work module:
// Overview, Tasks board, People (live timers + who is on the timeclock), Clients, Timeline,
// Hours & cost (cost = admin + accounts only), Approvals (added-later time).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Plus, Loader2, Check, X, AlertTriangle, Clock, Users, Repeat, Moon, Pencil, GitMerge, Archive, ArchiveRestore, Building2, Calendar, Trash2 } from 'lucide-react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { istTodayISO } from '../../utils/istDate'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { fmtDur, fmtClock, dayStartISO, addDaysISO, fmtTimeIST, fmtDateShort, dueState, initialsOf, clientColor, istHour } from '../../utils/workUtils'
import ActivityTab from '../../components/work/ActivityTab'
import WorkBoard from '../../components/work/WorkBoard'
import UserAvatar from '../../components/common/UserAvatar'
import NewTaskModal from '../../components/work/NewTaskModal'
import PostponeModal from '../../components/work/PostponeModal'
import TaskDetailModal from '../../components/work/TaskDetailModal'

const TABS = [['overview', 'Overview'], ['tasks', 'Tasks'], ['people', 'People'], ['clients', 'Clients'],
  ['timeline', 'Timeline'], ['hours', 'Hours & cost'], ['activity', 'Activity'], ['approvals', 'Approvals']]
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
  const [postponing, setPostponing] = useState(null)   // item being postponed (Postpone box)
  const [showLater, setShowLater] = useState(false)   // Tasks board: also show open tasks due after the chosen range
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
      supabase.from('users').select('id,name,designation,role,is_active,profile_image_url').order('name'),
      supabase.from('work_projects').select('id,name,kind,is_active').order('name'),
      supabase.from('work_time_entries').select('*').is('ended_at', null),
      supabase.from('work_time_entries').select('*').eq('status', 'pending').order('started_at', { ascending: false }).limit(100),
      supabase.from('work_task_parts')
        .select('id,task_id,assignee_id,label,due_date,status,finished_at,seconds,postponed_until,postponed_by_users,postponed_by_client,postpone_count,task:work_tasks(id,title,project_id,created_by,due_date,template_id,created_at)')
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
  const photoOf = (id) => users.find((u) => u.id === id)?.profile_image_url || null
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
    // Board follows the date filter: open work due on/before the range end (overdue included) or already
    // in process; finished work only if it finished inside the range. Later-dated open work is opt-in.
    const f0 = Date.parse(dayStartISO(from)), f1 = Date.parse(dayStartISO(addDaysISO(to, 1)))
    const inRange = (p) => {
      if (p.status === 'finished') {
        const ft = p.finished_at ? Date.parse(p.finished_at) : NaN
        return ft >= f0 && ft < f1
      }
      if (p.status === 'postponed') return true   // the Postponed column always shows what is waiting
      const d = p.due_date || p.task?.due_date
      return showLater || p.status === 'in_process' || !d || d <= to
    }
    return parts
      .filter((p) => inRange(p) && (!fPerson || p.assignee_id === fPerson) && (!fClient || p.task?.project_id === fClient))
      .map((p) => ({
        postponedUntil: p.postponed_until, postponeCount: p.postpone_count || 0,
        postponedBy: [...(p.postponed_by_users || []).map((id) => nameOf(id)), p.postponed_by_client ? `${p.postponed_by_client} (client)` : ''].filter(Boolean).join(', '),
        id: p.id, taskId: p.task_id, finishedAt: p.finished_at, status: p.status, title: p.task?.title || 'Task', label: p.label,
        client: projName(p.task?.project_id), due: p.due_date || p.task?.due_date, assigneeId: p.assignee_id,
        assigneeName: nameOf(p.assignee_id), assigneePhoto: users.find((u) => u.id === p.assignee_id)?.profile_image_url || null, partsTotal: total[p.task_id] || 1, partsDone: done[p.task_id] || 0,
        seconds: taskCostByTask[p.task_id]?.seconds ?? p.seconds, cost: taskCostByTask[p.task_id]?.cost ?? null,
      }))
  }, [parts, fPerson, fClient, projName, nameOf, taskCostByTask, users, from, to, showLater])
  const laterCount = useMemo(() => showLater ? 0 : parts.filter((p) => p.status !== 'finished' && p.status !== 'postponed' && p.status !== 'in_process' && (p.due_date || p.task?.due_date) > to && (!fPerson || p.assignee_id === fPerson) && (!fClient || p.task?.project_id === fClient)).length, [parts, to, showLater, fPerson, fClient])

  if (authLoading || !uid) return null
  if (isHead === false) return <Navigate to="/my-work" replace />

  const rangeLabel = from === to ? fmtDateShort(from) : `${fmtDateShort(from)} to ${fmtDateShort(to)}`
  const taskClient = {}
  const taskPeople = {}
  parts.forEach((p) => {
    if (p.task_id && p.task?.project_id) taskClient[p.task_id] = projName(p.task.project_id)
    if (p.task_id && p.assignee_id) { const a = (taskPeople[p.task_id] = taskPeople[p.task_id] || []); if (!a.includes(p.assignee_id)) a.push(p.assignee_id) }
  })
  const openCount = parts.filter((p) => p.status !== 'finished' && p.status !== 'postponed').length
  const lateParts = parts.filter((p) => p.status !== 'finished' && p.status !== 'postponed' && dueState(p.due_date || p.task?.due_date, p.status).cls === 'bad')
  const finishedToday = parts.filter((p) => p.status === 'finished' && p.finished_at && p.finished_at >= dayStartISO(today)).length
  const teamSecs = (report?.by_person || []).reduce((s, p) => s + Number(p.seconds || 0), 0)
  const memberIds = members.map((m) => m.user_id)
  const sharedSet = new Set(shares.map((s) => s.user_id))
  const needs = [
    pending.length > 0 && { key: 'pend', icon: Clock, tone: 'warn', pill: 'Waiting', action: 'Review', text: `${pending.length} forgotten-time request${pending.length > 1 ? 's' : ''}`, sub: [...new Set(pending.map((e) => nameOf(e.user_id).split(' ')[0]))].join(', '), go: () => setTab('approvals') },
    lateParts.length > 0 && { key: 'late', icon: AlertTriangle, tone: 'bad', pill: 'Overdue', action: 'Open', text: `${lateParts.length} task${lateParts.length > 1 ? 's' : ''} past due date`, sub: [...new Set(lateParts.map((p) => p.task?.title).filter(Boolean))].slice(0, 2).join(' · '), go: () => setTab('tasks') },
  ].filter(Boolean)
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

      {(
        <div className="wk-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="wk-eyb">Filters</span>
          <div className="wk-tabs" style={{ margin: 0 }}>
            {RANGES.filter(([k]) => k !== 'custom').map(([k, l]) => <button key={k} className={`wk-tab${range === k ? ' on' : ''}`} onClick={() => setRange(k)}>{l}</button>)}
          </div>
          <button className={`wk-btn ${range === 'custom' ? 'y' : 'o'}`} onClick={() => setRange('custom')}><Calendar size={16} aria-hidden="true" /> Pick a date</button>
          {range === 'custom' && <input type="date" className="wk-input" style={{ width: 170 }} value={custom} max={today} onChange={(e) => setCustom(e.target.value)} aria-label="Pick a date" />}
        </div>
      )}

      <div className="wk-tabs" role="tablist" style={{ width: '100%', display: 'flex', overflowX: 'auto' }}>
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`wk-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {l}{k === 'approvals' && pending.length > 0 && <span className="wk-cnt">{pending.length}</span>}
          </button>
        ))}
      </div>

      {err && <div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div>}
      {loading && !err && <div className="wk-empty"><Loader2 className="spin" size={26} aria-hidden="true" /></div>}

      {!loading && !err && tab === 'overview' && (
        <>
          <HeroSegs live action={<button className="wk-btn sm" style={{ background: '#fff', color: '#0f172a' }} onClick={() => setTab('timeline')}>Open timeline</button>} eyebrow={`Team · ${rangeLabel}`} segs={[
            ['Team hours', fmtDur(teamSecs), `${Object.keys(byPerson).length} ${Object.keys(byPerson).length === 1 ? 'person' : 'people'} tracked`],
            ['Working now', `${running.length} of ${memberIds.length}`, 'Live timers'],
            ['Open tasks', String(openCount), 'Assigned and in process'],
            ['Finished today', String(finishedToday), 'Since 00:00'],
          ]} />
          <div className="wk-grid" style={{ gap: 24 }}>
            <div className="wk-c8">
              <div className="wk-card flush">
                <div className="wk-ch"><h3><span className="wk-tile" style={{ background: 'rgba(239,68,68,.14)', color: 'var(--danger)' }}><AlertTriangle size={16} aria-hidden="true" /></span>Needs you</h3></div>
                {needs.length === 0 ? (
                  <div className="wk-empty"><b>Nothing needs you</b>No approvals waiting, nothing overdue.</div>
                ) : (
                  <div className="wk-list">
                    {needs.map((r) => (
                      <div key={r.key} className="wk-row wk-hov" style={{ padding: '16px 20px', gap: 16 }} onClick={r.go}>
                        <span className="wk-tile" style={{ background: r.tone === 'bad' ? 'rgba(239,68,68,.14)' : 'rgba(245,158,11,.14)', color: r.tone === 'bad' ? 'var(--danger)' : 'var(--warning)' }}><r.icon size={16} aria-hidden="true" /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{r.text}</div>
                          <div className="wk-sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>
                        </div>
                        <span className={`wk-pill ${r.tone}`}>{r.pill}</span>
                        <button className="wk-btn o sm" onClick={r.go}>{r.action} →</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="wk-c4">
              <div className="wk-card flush">
                <div className="wk-ch"><h3><span className="wk-tile" style={{ background: 'rgba(59,130,246,.14)', color: 'var(--info, #60a5fa)' }}><Users size={16} aria-hidden="true" /></span>Who is working</h3></div>
                {running.length === 0 ? (
                  <div className="wk-empty"><b>No one is working right now</b>Running timers appear here live.</div>
                ) : (
                  <div className="wk-list">
                    {running.map((r) => (
                      <div key={r.id} className="wk-row" style={{ padding: '12px 20px' }}>
                        <span className="wk-grp" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
                          <UserAvatar className="wk-av" name={nameOf(r.user_id)} url={photoOf(r.user_id)} size={36} />
                          <span style={{ minWidth: 0 }}>
                            <Link to={`/work-profile?user=${r.user_id}`} style={{ color: 'inherit', fontWeight: 500 }}>{nameOf(r.user_id)}</Link>
                            <div className="wk-sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <span className="wk-dot" style={{ background: clientColor(projName(r.project_id)), width: 8, height: 8, marginRight: 6 }} />{projName(r.project_id) || 'No client'} · {r.task_label}
                            </div>
                          </span>
                        </span>
                        <span className="wk-num">{fmtClock((now - new Date(r.started_at)) / 1000)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {memberIds.filter((id) => !runBy[id]).length > 0 && (
                  <div className="wk-sm" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
                    Not running: {memberIds.filter((id) => !runBy[id]).map((id) => nameOf(id).split(' ')[0]).join(', ')}
                  </div>
                )}
              </div>
            </div>
            <div className="wk-c6">
              <div className="wk-card flush">
                <div className="wk-ch"><div><h3><span className="wk-tile"><Repeat size={16} aria-hidden="true" /></span>Fired this morning</h3><div className="wk-csub">Repeating tasks</div></div></div>
                {firedToday.length === 0 ? (
                  <div className="wk-empty"><b>No repeating tasks today</b>None set, or a Sunday / holiday.</div>
                ) : (
                  <div className="wk-list">
                    {firedToday.map((p) => (
                      <div key={p.id} className="wk-row" style={{ padding: '14px 20px' }}>
                        <div><div style={{ fontWeight: 500 }}>{p.task?.title}</div><div className="wk-sm">{projName(p.task?.project_id) || 'No client'}</div></div>
                        <UserAvatar className="wk-av" name={nameOf(p.assignee_id)} url={photoOf(p.assignee_id)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="wk-c6">
              <div className="wk-card flush">
                <div className="wk-ch"><div><h3><span className="wk-tile"><Moon size={16} aria-hidden="true" /></span>Evening report</h3><div className="wk-csub">{istHour() >= 19 ? 'After 7 PM' : 'Opens at 7 PM'}</div></div></div>
                <div style={{ padding: 18, display: 'grid', gap: 16 }}>
                  {[['Shared', 'ok', memberIds.filter((id) => sharedSet.has(id))], ['Not yet', 'warn', memberIds.filter((id) => !sharedSet.has(id))]].map(([lbl, tone, ids]) => (
                    <div key={lbl}>
                      <span className={`wk-pill ${tone}`}>{lbl}</span>
                      <div className="wk-grp" style={{ marginTop: 8 }}>
                        {ids.length === 0 && <span className="wk-sm">No one</span>}
                        {ids.map((id) => <span key={id} className="wk-chip"><UserAvatar className="wk-av" name={nameOf(id)} url={photoOf(id)} size={22} />{nameOf(id).split(' ')[0]}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && !err && tab === 'tasks' && (
        <>
          <HeroSegs eyebrow="Board · filtered" segs={[
            ['In process', String(items.filter((i) => i.status === 'in_process').length), 'Being worked on'],
            ['Assigned', String(items.filter((i) => i.status === 'assigned').length), 'Not started'],
            ['Overdue', String(lateParts.length), 'Past due date'],
          ]} />
          <div className="wk-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
            <select className="wk-input" style={{ width: 220 }} value={fPerson} onChange={(e) => setFPerson(e.target.value)} aria-label="Filter by person">
              <option value="">All people</option>{memberIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
            <select className="wk-input" style={{ width: 240 }} value={fClient} onChange={(e) => setFClient(e.target.value)} aria-label="Filter by client">
              <option value="">All clients</option>{activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="wk-sm">{canCost ? '₹ Cost shows for admin and accounts only · ' : ''}{items.filter((i) => i.status !== 'finished' && i.status !== 'postponed').length} open · {lateParts.length} overdue</span>
            {(laterCount > 0 || showLater) && (
              <button className="wk-btn o sm" onClick={() => setShowLater((v) => !v)}>
                {showLater ? 'Hide later tasks' : `Show ${laterCount} later task${laterCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
          <div className="wk-sm" style={{ marginTop: 8 }}>Drag a card to change its status. A task with several people finishes when every part is finished.</div>
          <WorkBoard items={items} uid={uid} showCost={canCost} actForAll onMove={(id, to2) => rpc('work_move_part', { p_part: id, p_to: to2 })}
            onStart={(it) => rpc('work_move_part', { p_part: it.id, p_to: 'in_process' })} onFinish={(it) => rpc('work_move_part', { p_part: it.id, p_to: 'finished' })} onOpen={setOpenTask} onPostpone={(it) => setPostponing(it)} />
        </>
      )}

      {!loading && !err && tab === 'people' && (
        <PeopleTab members={members} users={users} nameOf={nameOf} runBy={runBy} byPerson={byPerson} projName={projName}
          now={now} isAdmin={isAdmin} busy={busy} onSet={(u, m, h) => rpc('work_set_member', { p_user: u, p_member: m, p_head: h })} />
      )}

      {!loading && !err && tab === 'clients' && (
        <ClientsTab projects={projects} report={report} cost={cost} canCost={canCost} parts={parts}
          onAdd={async (n) => { try { await addProject(n); toastSuccess('Client added.') } catch (e) { toastError(e, 'Could not add.') } }}
          onUpdate={(id, name, active, merge) => rpc('work_update_project', { p_id: id, p_name: name, p_active: active, p_merge_into: merge || null })} />
      )}

      {!loading && !err && tab === 'timeline' && (
        <TimelineTab photoOf={photoOf} memberIds={memberIds} nameOf={nameOf} byPerson={byPerson} from={from} to={to} projName={projName} />
      )}

      {!loading && !err && tab === 'hours' && (
        <HoursTab report={report} cost={cost} canCost={canCost} projName={projName} nameOf={nameOf} taskTitles={taskTitles} taskClient={taskClient} taskPeople={taskPeople} users={users} rangeLabel={rangeLabel} onOpen={setOpenTask} />
      )}

      {!loading && !err && tab === 'activity' && (
        <ActivityTab users={users} memberIds={memberIds} nameOf={nameOf} projName={projName} canSettings={['admin', 'co_owner'].includes(role)} />
      )}

      {!loading && !err && tab === 'approvals' && (() => {
        const secs = (e) => Math.max(0, (new Date(e.ended_at) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0))
        const total = pending.reduce((t, e) => t + secs(e), 0)
        const users_ = (id) => users.find((u) => u.id === id)
        return (
          <>
            <HeroSegs eyebrow="Waiting for you" segs={[['Requests', `${pending.length} ${pending.length === 1 ? 'request' : 'requests'}`, pending.length ? `Forgotten time, ${fmtDur(total)} in total` : 'Forgotten time']]} />
            <div className="wk-card flush">
              <div className="wk-ch"><h3><span className="wk-tile" style={{ background: 'rgba(16,185,129,.14)', color: 'var(--success)' }}><Check size={16} aria-hidden="true" /></span>Forgotten-time requests</h3></div>
              {pending.length === 0 ? <div className="wk-empty"><b>Nothing waiting</b>Added-later time shows here for your OK.</div> : (
                <div className="wk-list">
                  {pending.map((e) => (
                    <div key={e.id} className="wk-row" style={{ padding: '14px 20px', gap: 16, flexWrap: 'wrap' }}>
                      <span className="wk-grp" style={{ flexWrap: 'nowrap', minWidth: 190, gap: 12 }}>
                        <span className="wk-av" style={{ width: 36, height: 36 }}>{users_(e.user_id)?.profile_image_url ? <img src={users_(e.user_id).profile_image_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initialsOf(nameOf(e.user_id))}</span>
                        <span><div style={{ fontWeight: 500 }}>{nameOf(e.user_id)}</div><div className="wk-sm wk-num">{fmtDateShort(e.started_at.slice(0, 10))} · {fmtTimeIST(e.started_at)}-{fmtTimeIST(e.ended_at)}</div></span>
                      </span>
                      <span className="wk-sm" style={{ minWidth: 130 }}><span className="wk-dot" style={{ background: clientColor(projName(e.project_id)), width: 8, height: 8, marginRight: 6 }} />{projName(e.project_id) || 'No client'}</span>
                      <span className="wk-num" style={{ minWidth: 70 }}>{fmtDur(secs(e))}</span>
                      <span className="wk-sm" style={{ flex: 1, minWidth: 160 }}>{e.note || e.task_label}</span>
                      <span style={{ whiteSpace: 'nowrap', display: 'flex', gap: 8 }}>
                        <button className="wk-btn o sm" disabled={busy} onClick={() => rpc('work_decide_time', { p_entry: e.id, p_approve: false }, 'Declined.')}><X size={14} aria-hidden="true" /> Decline</button>
                        <button className="wk-btn y sm" disabled={busy} onClick={() => rpc('work_decide_time', { p_entry: e.id, p_approve: true }, 'Approved.')}><Check size={14} aria-hidden="true" /> Approve</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      })()}

      {postponing && (
        <PostponeModal item={postponing} users={users.filter((u) => u.is_active && u.role !== 'agency')} meId={uid} onClose={() => setPostponing(null)} onDone={() => { setPostponing(null); load() }} />
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

function HeroSegs({ eyebrow, segs, live, action }) {
  return (
    <div className="wk-hero" style={{ marginBottom: 16 }}>
      <span className="wk-row" style={{ alignItems: 'center' }}><span className="wk-grp">{live && <span className="wk-ldot" aria-hidden="true" />}<span className="wk-eyb">{eyebrow}</span></span>{action}</span>
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
  const [adding, setAdding] = useState(false)
  const ids = new Set(members.map((m) => m.user_id))
  const candidates = users.filter((u) => u.is_active && !ids.has(u.id) && u.role !== 'agency')
  const userOf = (id) => users.find((u) => u.id === id) || {}
  const heads = members.filter((m) => m.is_head).length
  return (
    <div>
      <HeroSegs eyebrow="Work team" segs={[['People', `${members.length} ${members.length === 1 ? 'person' : 'people'}`, `${heads} head`], ['Working now', String(Object.keys(runBy).length), 'Live timers']]} />
      <div className="wk-card flush">
        <div className="wk-ch">
          <h3><span className="wk-tile" style={{ background: 'rgba(59,130,246,.14)', color: 'var(--info, #60a5fa)' }}><Users size={16} aria-hidden="true" /></span>Work team</h3>
          {isAdmin && <button className="wk-btn o sm" onClick={() => setAdding((v) => !v)}><Plus size={14} aria-hidden="true" /> Add person</button>}
        </div>
        {isAdmin && adding && (
          <div className="wk-row" style={{ padding: '12px 20px', justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <select className="wk-input" style={{ flex: 1, minWidth: 220 }} value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Person">
              <option value="">Pick a person</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}{u.designation ? ` - ${u.designation}` : ''}</option>)}
            </select>
            <button className="wk-btn y sm" disabled={!add || busy} onClick={async () => { if (await onSet(add, true, false)) { setAdd(''); setAdding(false) } }}>Add</button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="wk-table" style={{ minWidth: 640 }}>
            <thead><tr><th>Person</th><th>Running now</th><th style={{ textAlign: 'right' }}>Hours</th><th>Head</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {members.map((m) => {
                const r = runBy[m.user_id]
                const u = userOf(m.user_id)
                const nm = nameOf(m.user_id)
                const pretty = nm === nm.toUpperCase() ? nm.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : nm
                return (
                  <tr key={m.user_id}>
                    <td>
                      <span className="wk-grp" style={{ flexWrap: 'nowrap', gap: 12 }}>
                        <span className="wk-av" style={{ width: 36, height: 36 }}>{u.profile_image_url ? <img src={u.profile_image_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initialsOf(nm)}</span>
                        <span><Link to={`/work-profile?user=${m.user_id}`} style={{ color: 'inherit', fontWeight: 500 }}>{pretty}</Link>{u.designation && <div className="wk-sm">{u.designation}</div>}</span>
                      </span>
                    </td>
                    <td className="wk-sm">{r
                      ? <><span className="wk-pill ok" style={{ marginRight: 8 }}>Running</span><span className="wk-dot" style={{ background: clientColor(projName(r.project_id)), width: 8, height: 8, marginRight: 6 }} />{projName(r.project_id) || 'No client'} · {r.task_label} · <span className="wk-num">{fmtClock((now - new Date(r.started_at)) / 1000)}</span></>
                      : 'Not clocked in'}</td>
                    <td className="wk-num" style={{ textAlign: 'right' }}>{fmtDur(byPerson[m.user_id]?.seconds || 0)}</td>
                    <td>{isAdmin ? (
                      <span className="wk-grp" style={{ flexWrap: 'nowrap', gap: 8 }}>
                        <button type="button" role="switch" aria-checked={m.is_head} aria-label={`Head: ${nm}`} disabled={busy}
                          className={`wk-sw${m.is_head ? ' on' : ''}`} onClick={() => onSet(m.user_id, true, !m.is_head)}><i /></button>
                        <span className="wk-sm">{m.is_head ? 'Yes' : 'No'}</span>
                      </span>
                    ) : (m.is_head ? 'Yes' : 'No')}</td>
                    {isAdmin && <td style={{ textAlign: 'right' }}><button className="wk-btn g sm" aria-label={`Remove ${nm}`} title="Remove from timeclock" disabled={busy} onClick={() => onSet(m.user_id, false, false)}><Trash2 size={15} aria-hidden="true" /></button></td>}
                  </tr>
                )
              })}
              {members.length === 0 && <tr><td colSpan={5} className="wk-empty">No one yet. People get on the timeclock when they are given a task, or add them above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ClientsTab({ projects, report, cost, canCost, parts, onAdd, onUpdate }) {
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [edit, setEdit] = useState(null)
  const [en, setEn] = useState('')
  const [merge, setMerge] = useState('')
  const hours = useMemo(() => { const m = {}; (report?.by_project || []).forEach((p) => { m[p.project_id] = p }); return m }, [report])
  const costBy = useMemo(() => { const m = {}; (cost?.by_project || []).forEach((p) => { m[p.project_id] = p }); return m }, [cost])
  const openBy = useMemo(() => {
    const sets = {}
    ;(parts || []).forEach((p) => {
      if (p.status === 'finished') return
      const pid = p.task?.project_id; if (!pid) return
      ;(sets[pid] = sets[pid] || new Set()).add(p.task_id)
    })
    const m = {}; Object.keys(sets).forEach((k) => { m[k] = sets[k].size }); return m
  }, [parts])
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
  const worked = (p) => (hours[p.id]?.seconds || 0) > 0 || (openBy[p.id] || 0) > 0
  const searching = q.trim().length > 0
  const rows = projects.filter((p) => (searching ? p.name.toLowerCase().includes(q.toLowerCase()) : (showAll || worked(p))))
    .sort((a, b) => (hours[b.id]?.seconds || 0) - (hours[a.id]?.seconds || 0) || a.name.localeCompare(b.name))
  const workedCount = projects.filter(worked).length
  const hiddenCount = projects.length - workedCount
  const doAdd = async () => { if (!name.trim()) return; await onAdd(name.trim()); setName(''); setAdding(false) }
  return (
    <div>
      <HeroSegs eyebrow="Clients worked on" segs={[['Clients', String(workedCount), `In the selected dates${dup ? ' · 1 possible duplicate' : ''}`]]} />
      {dup && (
        <div className="wk-grp" style={{ padding: 16, borderRadius: 14, background: 'rgba(59,130,246,.12)', marginBottom: 14, gap: 12 }}>
          <span className="wk-tile" style={{ background: 'rgba(59,130,246,.18)', color: 'var(--blue, #60a5fa)' }}><GitMerge size={16} aria-hidden="true" /></span>
          <div style={{ flex: 1, minWidth: 200 }}><b style={{ fontWeight: 500 }}>Possible duplicate:</b> {dup[0].name} and {dup[1].name}</div>
          <button className="wk-btn sm" onClick={() => onUpdate(dup[1].id, dup[1].name, true, dup[0].id)}><GitMerge size={14} aria-hidden="true" /> Merge</button>
          <button className="wk-btn o sm" onClick={() => setNotSame((x) => [...x, dup.map((d) => d.id).sort().join('|')])}>Not the same</button>
        </div>
      )}
      <div className="wk-card flush">
        <div className="wk-ch">
          <h3><span className="wk-tile"><Building2 size={16} aria-hidden="true" /></span>Clients</h3>
          <div className="wk-grp" style={{ gap: 8 }}>
            <input className="wk-input" style={{ width: 200 }} placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
            <button className="wk-btn o sm" onClick={() => setAdding((v) => !v)}><Plus size={14} aria-hidden="true" /> Add client</button>
          </div>
        </div>
        {adding && (
          <div className="wk-row" style={{ padding: '12px 20px', justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <input className="wk-input" style={{ width: 260 }} placeholder="New client name" value={name} maxLength={80} autoFocus
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doAdd() }} aria-label="New client name" />
            <button className="wk-btn y sm" disabled={!name.trim()} onClick={doAdd}>Add</button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table className="wk-table" style={{ minWidth: 560 }}>
            <thead><tr><th>Client</th><th style={{ textAlign: 'right' }}>Hours</th>{canCost && <th style={{ textAlign: 'right' }}>Cost</th>}<th style={{ textAlign: 'right' }}>Open tasks</th><th /></tr></thead>
            <tbody>
              {rows.slice(0, 300).map((p) => (
                <tr key={p.id} style={{ opacity: p.is_active ? 1 : .55 }}>
                  <td><span className="wk-dot" style={{ background: clientColor(p.name), marginRight: 10 }} /><b style={{ fontWeight: 500 }}>{p.name}</b> {!p.is_active && <span className="wk-pill">archived</span>}</td>
                  <td className="wk-num" style={{ textAlign: 'right' }}>{fmtDur(hours[p.id]?.seconds || 0)}</td>
                  {canCost && <td className="wk-num" style={{ textAlign: 'right' }}>{costBy[p.id] ? `Rs ${Number(costBy[p.id].cost).toLocaleString('en-IN')}` : '-'}</td>}
                  <td className="wk-num" style={{ textAlign: 'right' }}>{openBy[p.id] || 0}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="wk-btn g sm" aria-label={`Edit ${p.name}`} title="Edit" onClick={() => { setEdit(p); setEn(p.name); setMerge('') }}><Pencil size={15} aria-hidden="true" /></button>
                    <button className="wk-btn g sm" aria-label={`Merge ${p.name}`} title="Merge into another client" onClick={() => { setEdit(p); setEn(p.name); setMerge('') }}><GitMerge size={15} aria-hidden="true" /></button>
                    <button className="wk-btn g sm" aria-label={p.is_active ? `Archive ${p.name}` : `Bring back ${p.name}`} title={p.is_active ? 'Archive' : 'Bring back'} onClick={() => onUpdate(p.id, p.name, !p.is_active, null)}>{p.is_active ? <Archive size={15} aria-hidden="true" /> : <ArchiveRestore size={15} aria-hidden="true" />}</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="wk-empty">No clients with time or open tasks in these dates.</td></tr>}
            </tbody>
          </table>
        </div>
        {!searching && hiddenCount > 0 && (
          <div className="wk-sm" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
            <button className="wk-btn g sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show only clients with work' : `Show all clients (${projects.length})`}</button>
          </div>
        )}
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

function TimelineTab({ photoOf, memberIds, nameOf, byPerson, from, to, projName }) {
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
  const isToday = single && from === istTodayISO()
  const dayList = Array.from({ length: days }, (_, k) => addDaysISO(from, k))
  const istDay = (iso) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)
  const secsOf = (e) => Math.max(0, ((e.ended_at ? new Date(e.ended_at) : new Date(nowMs)) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0))
  const totalSecs = all.reduce((n, e) => n + secsOf(e), 0)
  const peopleWorked = new Set(all.map((e) => e.user_id)).size
  const H0 = 8, H1 = 21
  const hourOf = (iso) => { const d = new Date(new Date(iso).getTime() + 5.5 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60 }
  const pct = (h) => Math.max(0, Math.min(100, (h - H0) / (H1 - H0) * 100))
  const nowH = hourOf(new Date(nowMs).toISOString())
  const runningNow = new Set(all.filter((e) => !e.ended_at).map((e) => e.user_id)).size
  const legend = [...new Set(all.map((e) => projName(e.project_id) || 'Internal'))]
  const shortName = (n) => { const w = String(n || '').trim().split(/\s+/); const t = (x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase(); return w.slice(0, 2).map(t).join(' ') }
  const byUser = {}; all.forEach((e) => { (byUser[e.user_id] = byUser[e.user_id] || []).push(e) })
  return (
    <div>
    {isToday
      ? <HeroSegs live eyebrow={`Now · ${fmtTimeIST(new Date(nowMs).toISOString())}`} segs={[['Running now', `${runningNow} running`, 'Click a person for their day']]} />
      : <HeroSegs eyebrow={`Timeline · ${single ? fmtDateShort(from) : `${fmtDateShort(from)} to ${fmtDateShort(to)}`}`} segs={[
          ['Tracked', fmtDur(totalSecs), `${peopleWorked} ${peopleWorked === 1 ? 'person' : 'people'} worked`],
          ['Days', String(days), single ? 'One day' : 'In this range'],
        ]} />}
    <div style={{ display: 'grid', gridTemplateColumns: open ? 'minmax(0,1.3fr) minmax(0,1fr)' : '1fr', gap: 16, alignItems: 'start' }}>
      <div className="wk-card flush">
        <div className="wk-ch"><h3>{single ? (isToday ? 'Today, by person' : `${fmtDateShort(from)}, by person`) : 'Days, by person'}</h3>
          {single && legend.length > 0 && <div className="wk-grp" style={{ gap: 12 }}>{legend.map((n) => <span key={n} className="wk-sm"><span className="wk-dot" style={{ background: clientColor(n === 'Internal' ? '' : n), width: 8, height: 8, marginRight: 6 }} />{n}</span>)}</div>}
        </div>
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
                  <span className="wk-grp" style={{ paddingLeft: 8, flexWrap: 'nowrap' }}><UserAvatar className="wk-av" name={nameOf(id)} url={photoOf(id)} size={28} /><b style={{ fontSize: 13, fontWeight: 500 }}>{shortName(nameOf(id))}</b></span>
                  <div style={{ position: 'relative', height: 26, background: 'var(--w-hov)', borderRadius: 6 }}>
                    {(byUser[id] || []).map((e) => {
                      const s0 = hourOf(e.started_at), e0 = e.ended_at ? hourOf(e.ended_at) : nowH
                      return <span key={e.id} title={`${projName(e.project_id) || '-'} · ${e.task_label}`}
                        style={{ position: 'absolute', left: `${pct(s0)}%`, width: `${Math.max(0.6, pct(e0) - pct(s0))}%`, top: 3, bottom: 3, borderRadius: 6, background: clientColor(projName(e.project_id)), boxShadow: e.ended_at ? 'none' : '0 0 0 2px var(--accent)' }} />
                    })}
                    {isToday && <span style={{ position: 'absolute', left: `${pct(nowH)}%`, top: -4, bottom: -4, width: 2, background: 'var(--accent)' }} />}
                  </div>
                </div>
              ))}
              <div className="wk-sm" style={{ marginTop: 10, paddingLeft: 182 }}>{isToday ? 'Yellow line is now. Outlined blocks are running. Colour = client.' : 'Colour = client.'}</div>
            </div>
          </div>
        ) : (
          <div style={{ padding: 16, overflowX: 'auto' }}>
            <div style={{ minWidth: Math.max(640, 170 + days * 22 + 90) }}>
              <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 70px', gap: 12, marginBottom: 6 }}>
                <span />
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days}, 1fr)`, gap: 2 }}>
                  {dayList.map((d) => <span key={d} className="wk-num wk-mu" style={{ fontSize: 10, textAlign: 'center' }}>{String(Number(d.slice(8))).padStart(2, '0')}</span>)}
                </div>
                <span className="wk-sm" style={{ textAlign: 'right' }}>Total</span>
              </div>
              {rows.map((id) => {
                const per = {}; (byUser[id] || []).forEach((e) => { const k = istDay(e.started_at); per[k] = (per[k] || 0) + secsOf(e) })
                const tot = Object.values(per).reduce((n, v) => n + v, 0)
                return (
                  <div key={id} className="wk-hov" onClick={() => setOpen(id)} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 70px', gap: 12, alignItems: 'center', minHeight: 48, borderRadius: 10 }}>
                    <span className="wk-grp" style={{ paddingLeft: 8, flexWrap: 'nowrap' }}><UserAvatar className="wk-av" name={nameOf(id)} url={photoOf(id)} size={28} /><b style={{ fontSize: 13, fontWeight: 500 }}>{shortName(nameOf(id))}</b></span>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days}, 1fr)`, gap: 2, height: 26, background: 'var(--w-hov)', borderRadius: 6, padding: '0 2px', alignItems: 'end' }}>
                      {dayList.map((d) => {
                        const v = per[d] || 0
                        return <span key={d} title={`${fmtDateShort(d)} - ${v ? fmtDur(v) : 'no time'}`}
                          style={{ height: v ? `${Math.max(12, Math.min(100, v / (9 * 3600) * 100))}%` : 2, background: v ? 'var(--accent)' : 'var(--border)', borderRadius: 3, opacity: v ? 1 : .6 }} />
                      })}
                    </div>
                    <span className="wk-num" style={{ textAlign: 'right' }}>{tot ? fmtDur(tot) : '-'}</span>
                  </div>
                )
              })}
              <div className="wk-sm" style={{ marginTop: 10, paddingLeft: 182 }}>Each bar is one day (full height = 9 hours).</div>
            </div>
          </div>
        )}
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
              <div className="wk-sm" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{fmtTimeIST(e.started_at)} - {e.ended_at ? fmtTimeIST(e.ended_at) : 'running'}<br />{fmtDur(Math.max(0, ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0)))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  )
}

function HoursTab({ report, cost, canCost, projName, nameOf, taskTitles, taskClient, taskPeople, users, rangeLabel, onOpen }) {
  const proj = [...(report?.by_project || [])].sort((a, b) => b.seconds - a.seconds)
  const totalSecs = proj.reduce((t, p) => t + Number(p.seconds || 0), 0) || 1
  const costBy = {}; (cost?.by_project || []).forEach((p) => { costBy[p.project_id] = p })
  return (
    <div>
      {canCost && cost && cost.total_cost != null && (
        <HeroSegs eyebrow={`Cost · ${rangeLabel}`} segs={[
          ['Team cost', `Rs ${Number(cost.total_cost).toLocaleString('en-IN')}`, 'Salary-based'],
          ['Hours tracked', fmtDur(cost.total_seconds)],
          ['Cost per hour', `Rs ${cost.total_seconds ? Math.round(cost.total_cost / (cost.total_seconds / 3600)) : 0}`, 'Average'],
          ['Not on any task', `${cost.total_seconds ? Math.round(cost.unassigned_seconds / cost.total_seconds * 100) : 0}%`, fmtDur(cost.unassigned_seconds || 0)],
        ]} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start' }}>
        <div className="wk-card flush">
          <div className="wk-ch"><div><h3>Share of time by client</h3><div className="wk-csub">Hours are on clients</div></div></div>
          {proj.length === 0 && <div className="wk-empty">No time in this range.</div>}
          <div style={{ padding: '4px 20px 16px' }}>
            {proj.slice(0, 40).map((p) => {
              const pc = Math.round(p.seconds / totalSecs * 100)
              const col = clientColor(projName(p.project_id))
              return (
                <div key={p.project_id || 'none'} style={{ padding: '10px 0' }}>
                  <div className="wk-row" style={{ marginBottom: 6 }}>
                    <span className="wk-grp" style={{ flexWrap: 'nowrap', gap: 10 }}><span className="wk-dot" style={{ background: col }} />{projName(p.project_id) || 'No client'}</span>
                    <span className="wk-num">{pc}%</span>
                  </div>
                  <div className="wk-bar-h"><i style={{ width: `${pc}%`, background: col }} /></div>
                  <div className="wk-sm" style={{ marginTop: 4 }}>{fmtDur(p.seconds)}{canCost && costBy[p.project_id] ? ` · Rs ${Number(costBy[p.project_id].cost).toLocaleString('en-IN')}` : ''}</div>
                </div>
              )
            })}
          </div>
        </div>
        {canCost && cost && (cost.by_task || []).length > 0 && (
          <div className="wk-card flush" style={{ overflowX: 'auto' }}>
            <div className="wk-ch"><div><h3>Task cost</h3><div className="wk-csub">Admin and accounts only. Click a task for who spent how long.</div></div></div>
            <table className="wk-table" style={{ minWidth: 460 }}>
              <thead><tr><th>Task</th><th style={{ textAlign: 'right' }}>People</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Cost</th></tr></thead>
              <tbody>
                {[...cost.by_task].sort((a, b) => b.cost - a.cost).slice(0, 80).map((t) => (
                  <tr key={t.task_id} className="click" onClick={() => onOpen(t.task_id)}>
                    <td>
                      <b style={{ fontWeight: 500 }}>{taskTitles[t.task_id] || 'Task'}</b>
                      {taskClient[t.task_id] && <div className="wk-sm"><span className="wk-dot" style={{ background: clientColor(taskClient[t.task_id]), width: 8, height: 8, marginRight: 6 }} />{taskClient[t.task_id]}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {(taskPeople[t.task_id] || []).length > 0 ? (
                        <span className="wk-grp" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap', gap: 0 }}>
                          {(taskPeople[t.task_id] || []).slice(0, 3).map((id, i) => { const u = (users || []).find((x) => x.id === id) || {}; return (
                            <span key={id} className="wk-av" title={nameOf(id)} style={{ width: 28, height: 28, fontSize: 10, marginLeft: i ? -8 : 0, border: '2px solid var(--surface)' }}>
                              {u.profile_image_url ? <img src={u.profile_image_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initialsOf(nameOf(id))}
                            </span>) })}
                        </span>
                      ) : <span className="wk-num">{t.people}</span>}
                    </td>
                    <td className="wk-num" style={{ textAlign: 'right' }}>{fmtDur(t.seconds)}</td>
                    <td className="wk-num" style={{ textAlign: 'right' }}>Rs {Number(t.cost).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!canCost && <div className="wk-sm" style={{ marginTop: 12 }}>Cost figures are shown to admin and accounts only.</div>}
    </div>
  )
}
