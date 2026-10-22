// Phase 365 - one task: parts, checklist, comments, task log, due date. Opens from the board
// and from "Asked by me". Everything it writes goes through the work_* functions.
import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Check, Loader2, Send, Play, Undo2, Trash2, UserMinus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'
import { confirmDialog } from '../v2/ConfirmDialog'
import UserAvatar from '../common/UserAvatar'
import RejectModal from './RejectModal'
import { fmtDur, fmtDateShort, dueState, STATUS_LABEL, initialsOf } from '../../utils/workUtils'

const EVENT_TEXT = {
  declined: 'declined this task',
  sent_back: 'sent finished work back',
  postponed: 'postponed this task',
  unpostponed: 'brought this task back',
  returned: 'task came back on its date',
  created: 'created the task', started: 'started', paused: 'paused', finished: 'finished their part',
  reopened: 'reopened a part', moved: 'moved a part', reassigned: 'reassigned a part', removed: 'removed a person',
  due_changed: 'changed a due date', commented: 'added a comment',
}

export default function TaskDetailModal({ taskId, uid, isHead, nameOf, projectName, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [comment, setComment] = useState('')
  const [step, setStep] = useState('')
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState([])
  const [rej, setRej] = useState(null)   // { part, kind }
  const latch = useRef(false)

  const load = useCallback(async () => {
    setErr('')
    const [t, p, s, c, l] = await Promise.all([
      supabase.from('work_tasks').select('id,title,project_id,note,created_by,due_date,status,template_id,finished_at,created_at,is_urgent').eq('id', taskId).maybeSingle(),
      supabase.from('work_task_parts').select('id,task_id,assignee_id,label,due_date,status,started_at,finished_at,finish_note,seconds,created_at,postponed_until,postponed_by_users,postponed_by_client,postpone_count,reject_kind,reject_reason,rejected_by,rejected_at').eq('task_id', taskId).order('created_at'),
      supabase.from('work_task_steps').select('*').eq('task_id', taskId).order('position'),
      supabase.from('work_task_comments').select('*').eq('task_id', taskId).order('created_at'),
      supabase.from('work_task_log').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).limit(60),
    ])
    const e = t.error || p.error || s.error || c.error || l.error
    if (e || !t.data) { setErr(e?.message || 'Task not found.'); return }
    setData({ task: t.data, parts: p.data || [], steps: s.data || [], comments: c.data || [], log: l.data || [] })
  }, [taskId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('users').select('id,name').eq('is_active', true).neq('role', 'agency').order('name')
      .then(({ data: u }) => setPeople(u || []))
  }, [])

  const run = async (fn) => {
    if (latch.current) return
    latch.current = true; setBusy(true)
    try { await fn(); await load(); onChanged?.() } catch (e) { toastError(e, 'Could not save.') } finally { latch.current = false; setBusy(false) }
  }
  const rpc = async (name, args) => { const { error } = await supabase.rpc(name, args); if (error) throw error }

  const task = data?.task
  // Phase 418 - the creator (before anyone starts it and before its due date) or a head / admin can delete. The server decides and says why not.
  const deleteTask = async () => {
    if (latch.current || !task) return
    const ok = await confirmDialog({ title: 'Delete this task?', message: `"${task.title}" will be removed for everyone on it and they will be told. A copy is kept so an admin can bring it back.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    latch.current = true; setBusy(true)
    try {
      const { error } = await supabase.rpc('work_delete_task', { p_task: task.id })
      if (error) throw error
      toastSuccess('Task deleted.')
      onChanged?.(); onClose?.()
    } catch (e) { toastError(e, 'Could not delete the task.') } finally { latch.current = false; setBusy(false) }
  }
  const canEdit = task && (isHead || task.created_by === uid)
  const dayName = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })

  return (
    <div className="wk-modal-back" onClick={onClose}>
      <div className="wk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Task detail">
        <div className="wk-row">
          <div>
            <div className="wk-sm">{task ? (projectName(task.project_id) || 'No client') : ''}</div>
            <div className="wk-title" style={{ fontSize: 22 }}>{task?.title || 'Task'}</div>
          </div>
          <span className="wk-grp" style={{ gap: 8 }}>
            {task && (isHead || task.created_by === uid) && (
              <button className="wk-btn o sm" disabled={busy} onClick={deleteTask} aria-label="Delete task" style={{ color: 'var(--danger)' }}>
                <Trash2 size={16} aria-hidden="true" /> Delete task
              </button>
            )}
            <button className="wk-btn o sm" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /> Close</button>
          </span>
        </div>

        {err && <div className="wk-err" style={{ marginTop: 12 }} role="alert"><span>{err}</span><button className="wk-btn sm g" onClick={load}>Retry</button></div>}
        {!data && !err && <div className="wk-empty"><Loader2 className="spin" size={22} aria-hidden="true" /></div>}

        {data && (
          <>
            <div className="wk-row" style={{ marginTop: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
              <span className={`wk-pill ${task.status === 'finished' ? 'ok' : dueState(task.due_date, task.status).cls}`}>{STATUS_LABEL[task.status]}</span>
              {task.is_urgent && <span className="wk-pill bad">Urgent</span>}
              {canEdit && task.status !== 'finished' && (
                <button className="wk-btn o sm" disabled={busy} onClick={() => run(() => rpc('work_set_urgent', { p_task: task.id, p_urgent: !task.is_urgent }))}>{task.is_urgent ? 'Not urgent' : 'Mark urgent'}</button>
              )}
              {task.due_date && <span className="wk-pill">Due {fmtDateShort(task.due_date)}</span>}
              {canEdit && (
                <input type="date" className="wk-input" style={{ width: 170, minHeight: 40 }} value={task.due_date || ''} aria-label="Change due date"
                  onChange={(e) => run(() => rpc('work_set_due', { p_task: task.id, p_part: null, p_due: e.target.value || null }))} />
              )}
            </div>
            {task.note && <div className="wk-card" style={{ marginTop: 12 }}><div className="wk-sm">Note</div><div>{task.note}</div></div>}

            <div style={{ marginTop: 16 }}><b>People</b>
              {data.parts.map((p) => (
                <div key={p.id} className="wk-part">
                  <div className="wk-row">
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <UserAvatar className="wk-av" name={nameOf(p.assignee_id)} userId={p.assignee_id} />
                      <b>{nameOf(p.assignee_id)}</b>
                    </span>
                    <span className={`wk-pill ${p.status === 'finished' ? 'ok' : p.status === 'in_process' || p.status === 'postponed' ? 'warn' : ''}`}>{STATUS_LABEL[p.status]}</span>
                  </div>
                  <div className="wk-sm" style={{ marginTop: 4 }}>
                    {p.label || 'Their part'}{p.due_date ? ` - due ${fmtDateShort(p.due_date)}` : ''}{p.seconds != null ? ` - ${fmtDur(p.seconds)}` : ''}
                  </div>
                  {p.assignee_id === uid && !canEdit && p.status !== 'finished' && p.status !== 'postponed' && (
                    <input type="date" className="wk-input" style={{ width: 170, minHeight: 40, marginTop: 8 }} value={p.due_date || task.due_date || ''} aria-label="Change my due date"
                      onChange={(e) => run(() => rpc('work_set_due', { p_task: task.id, p_part: p.id, p_due: e.target.value || null }))} />
                  )}
                  {p.finish_note && <div className="wk-sm">Note: {p.finish_note}</div>}
                  {p.reject_reason && p.status !== 'finished' && (
                    <div className="wk-sm" style={{ color: 'var(--danger)', marginTop: 4 }}>
                      {p.reject_kind === 'declined' ? 'Declined' : 'Sent back'} by {nameOf(p.rejected_by)}: {p.reject_reason}
                    </div>
                  )}
                  {p.status === 'postponed' && (
                    <div className="wk-sm" style={{ color: 'var(--w-wat, #FBBF24)' }}>
                      Postponed until {p.postponed_until ? fmtDateShort(p.postponed_until) : ''} - asked by {[...(p.postponed_by_users || []).map((id) => nameOf(id)), p.postponed_by_client ? `${p.postponed_by_client} (client)` : ''].filter(Boolean).join(', ') || 'someone'}
                      {p.postpone_count > 1 ? ` - postponed ${p.postpone_count} times` : ''}
                    </div>
                  )}
                  {p.status !== 'finished' && (isHead || task.created_by === uid || p.assignee_id === uid) && (
                    <select className="wk-input" style={{ marginTop: 8, minHeight: 40 }} value="" disabled={busy} aria-label="Give this task to someone else"
                      onChange={(e) => { const to = e.target.value; if (to) run(() => rpc('work_reassign_part', { p_part: p.id, p_to: to })) }}>
                      <option value="">Give to someone else…</option>
                      {people.filter((u) => u.id !== p.assignee_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  )}
                  {p.status !== 'finished' && (data?.parts || []).length > 1 && (isHead || task.created_by === uid) && (
                    <button className="wk-btn o sm" style={{ marginTop: 8, marginLeft: 8 }} disabled={busy}
                      onClick={async () => { const ok = await confirmDialog({ title: `Remove ${nameOf(p.assignee_id)} from this task?`, message: 'They will be told. The others stay on the task.', confirmLabel: 'Remove', danger: true }); if (ok) run(() => rpc('work_remove_part', { p_part: p.id })) }}>
                      <UserMinus size={14} aria-hidden="true" /> Remove from task
                    </button>
                  )}
                  {((p.status !== 'finished' && p.status !== 'postponed' && (p.assignee_id === uid || isHead)) || (p.status === 'finished' && (isHead || task.created_by === uid))) && (
                    <button className="wk-btn o sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => setRej({ part: p.id, kind: p.status === 'finished' ? 'sent_back' : 'declined', who: nameOf(p.assignee_id) })}>
                      <Undo2 size={14} aria-hidden="true" /> {p.status === 'finished' ? 'Reject and send back' : 'Reject task'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="wk-row"><b>Checklist</b><span className="wk-sm">{data.steps.filter((s) => s.done).length} of {data.steps.length} done</span></div>
              {data.steps.length > 0 && <div className="wk-bar" style={{ height: 8 }}><i style={{ width: `${Math.round(data.steps.filter((s) => s.done).length / data.steps.length * 100)}%` }} /></div>}
              {data.steps.map((s) => (
                <label key={s.id} className="wk-log" style={{ alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={s.done} disabled={busy} onChange={(e) => run(() => rpc('work_toggle_step', { p_step: s.id, p_done: e.target.checked }))} style={{ width: 20, height: 20 }} />
                  <span style={{ textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--text-muted)' : 'var(--text)' }}>{s.label}</span>
                </label>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input className="wk-input" value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" maxLength={120}
                  onKeyDown={(e) => { if (e.key === 'Enter' && step.trim()) run(async () => { await rpc('work_add_step', { p_task: task.id, p_label: step.trim() }); setStep('') }) }} />
                <button className="wk-btn g" disabled={busy || !step.trim()} onClick={() => run(async () => { await rpc('work_add_step', { p_task: task.id, p_label: step.trim() }); setStep('') })}>Add</button>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="wk-row"><b>Comments</b><span className="wk-sm">{data.comments.length}</span></div>
              {data.comments.map((c) => (
                <div key={c.id} className="wk-part">
                  <div className="wk-row"><b>{nameOf(c.user_id)}</b><span className="wk-sm">{dayName(c.created_at)}</span></div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input className="wk-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" maxLength={1000}
                  onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) run(async () => { await rpc('work_add_comment', { p_task: task.id, p_body: comment.trim() }); setComment('') }) }} />
                <button className="wk-btn y" aria-label="Send comment" disabled={busy || !comment.trim()}
                  onClick={() => run(async () => { await rpc('work_add_comment', { p_task: task.id, p_body: comment.trim() }); setComment('') })}>
                  <Send size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="wk-sm" style={{ marginTop: 6 }}>Everyone on the task is told.</div>
            </div>

            <div style={{ marginTop: 18 }}>
              <b>Task log</b>
              {data.log.length === 0 && <div className="wk-sm" style={{ marginTop: 6 }}>Nothing yet.</div>}
              {data.log.map((l) => (
                <div key={l.id} className="wk-log">
                  <Check size={14} aria-hidden="true" style={{ marginTop: 3, color: 'var(--text-muted)' }} />
                  <div style={{ flex: 1 }}><b>{nameOf(l.user_id)}</b> {EVENT_TEXT[l.event] || l.event}{l.detail?.seconds != null ? ` (${fmtDur(l.detail.seconds)})` : ''}</div>
                  <div className="wk-sm" style={{ whiteSpace: 'nowrap' }}>{dayName(l.created_at)}</div>
                </div>
              ))}
            </div>
            {(() => {
              const mine = data.parts.find((p) => p.assignee_id === uid && p.status !== 'finished')
              if (!mine) return null
              return (
                <div style={{ position: 'sticky', bottom: -20, margin: '20px -20px -20px', padding: 16, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
                  {mine.status === 'postponed'
                    ? <button className="wk-btn y lg" disabled={busy} onClick={() => run(() => rpc('work_move_part', { p_part: mine.id, p_to: 'assigned' }))}>Bring back now</button>
                    : mine.status === 'assigned'
                    ? <button className="wk-btn y lg" disabled={busy} onClick={() => run(() => rpc('work_clock_start', { p_project: null, p_label: null, p_part: mine.id }))}><Play size={16} aria-hidden="true" /> Start my part</button>
                    : <button className="wk-btn y lg" disabled={busy} onClick={() => run(() => rpc('work_finish_part', { p_part: mine.id, p_note: null }))}><Check size={16} aria-hidden="true" /> Finish my part</button>}
                </div>
              )
            })()}
          </>
        )}
      </div>
      {rej && <RejectModal part={rej.part} kind={rej.kind} who={rej.who} title={task?.title} onClose={() => setRej(null)} onDone={() => { setRej(null); load(); onChanged?.() }} />}
    </div>
  )
}
