// Phase 365 - New task side panel: what, client, note, due date, people + their part,
// checklist steps, repeat. Anyone signed in can ask anyone (owner decision).
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, Trash2, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'
import { istTodayISO } from '../../utils/istDate'
import { addDaysISO } from '../../utils/workUtils'

export default function NewTaskModal({ projects, users, meId, onClose, onCreated, onAddProject }) {
  const today = istTodayISO()
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [newClient, setNewClient] = useState('')
  const [note, setNote] = useState('')
  const [due, setDue] = useState(addDaysISO(today, 1))
  const [parts, setParts] = useState([{ assignee: meId || '', label: '', due: '' }])
  const [steps, setSteps] = useState('')
  const [repeat, setRepeat] = useState('once')
  const [weekday, setWeekday] = useState(1)
  const [monthDay, setMonthDay] = useState(1)
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)

  // Task suggestions from past work: recent tasks + who did them. Best-effort - modal works without it.
  const [past, setPast] = useState([]) // [{ title, project_id, assignees:Set }]
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [t, pt] = await Promise.all([
          supabase.from('work_tasks').select('id, title, project_id').order('created_at', { ascending: false }).limit(600),
          supabase.from('work_task_parts').select('task_id, assignee_id').order('created_at', { ascending: false }).limit(1800),
        ])
        if (t.error || pt.error || !live) return
        const who = new Map()
        for (const r of pt.data || []) { if (!who.has(r.task_id)) who.set(r.task_id, new Set()); who.get(r.task_id).add(r.assignee_id) }
        setPast((t.data || []).map((r) => ({ title: String(r.title || '').trim(), project_id: r.project_id, assignees: who.get(r.id) || new Set() })).filter((r) => r.title))
      } catch { /* no suggestions */ }
    })()
    return () => { live = false }
  }, [])

  const picked = parts.map((p) => p.assignee).filter(Boolean)
  const suggestions = useMemo(() => {
    const q = title.trim().toLowerCase()
    const by = new Map()
    for (const r of past) {
      const key = r.title.toLowerCase()
      if (q && (!key.includes(q) || key === q)) continue
      let score = 1
      if (picked.some((id) => r.assignees.has(id))) score += 4
      if (project && r.project_id === project) score += 3
      const cur = by.get(key)
      if (cur) cur.score += score
      else by.set(key, { title: r.title, score })
    }
    return [...by.values()].sort((a, b) => b.score - a.score).slice(0, 6)
  }, [past, title, project, picked.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  const setPart = (i, k, v) => setParts((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  const save = async () => {
    if (latch.current) return
    if (!title.trim()) return toastError('', 'Give the task a name.')
    const clean = parts.filter((p) => p.assignee)
    if (!clean.length) return toastError('', 'Pick at least one person.')
    if (repeat !== 'once' && clean.length !== 1) return toastError('', 'A repeating task is for one person.')
    latch.current = true; setBusy(true)
    try {
      let pid = project || null
      if (!pid && newClient.trim()) pid = await onAddProject(newClient.trim())
      if (repeat !== 'once') {
        const { error } = await supabase.rpc('work_save_template', {
          p_title: title.trim(), p_project: pid, p_assignee: clean[0].assignee, p_repeat: repeat,
          p_weekday: repeat === 'weekly' ? Number(weekday) : null,
          p_month_day: repeat === 'monthly' ? Number(monthDay) : null,
          p_start: today, p_end: null,
        })
        if (error) throw error
        toastSuccess('Repeating task saved - it starts at 7 AM on working days.')
      } else {
        const { error } = await supabase.rpc('work_create_task', {
          p_title: title.trim(), p_project: pid, p_note: note.trim() || null, p_due: due || null,
          p_parts: clean.map((p) => ({ assignee: p.assignee, label: p.label.trim(), due: p.due || null })),
          p_steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
        })
        if (error) throw error
        toastSuccess('Task assigned.')
      }
      onCreated()
    } catch (e) {
      toastError(e, 'Could not save the task.')
    } finally {
      latch.current = false; setBusy(false)
    }
  }

  return (
    <div className="wk-modal-back" onClick={onClose}>
      <div className="wk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New task">
        <div className="wk-row">
          <div className="wk-title" style={{ fontSize: 22 }}>New task</div>
          <button className="wk-btn o sm" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /> Close</button>
        </div>

        <div className="wk-field"><label htmlFor="nt-title">What</label>
          <input id="nt-title" className="wk-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Make 2 reels" />
          {suggestions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="wk-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} aria-hidden="true" />
                {picked.length || project ? 'Suggested from past work' : 'Common tasks'}
              </div>
              <div className="wk-chips">
                {suggestions.map((sg) => <button key={sg.title} type="button" className="wk-chip" onClick={() => setTitle(sg.title.slice(0, 120))}>{sg.title}</button>)}
              </div>
            </div>
          )}</div>

        <div className="wk-field"><label htmlFor="nt-client">Client (optional)</label>
          <select id="nt-client" className="wk-input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">- none / type a new one below -</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!project && <input className="wk-input" style={{ marginTop: 8 }} value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="New client name" maxLength={80} />}
        </div>

        <div className="wk-field"><label>People and their part</label>
          {parts.map((p, i) => (
            <div key={i} className="wk-part">
              <select className="wk-input" value={p.assignee} onChange={(e) => setPart(i, 'assignee', e.target.value)} aria-label="Person">
                <option value="">Pick a person</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.designation ? ` - ${u.designation}` : ''}</option>)}
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8, marginTop: 8 }}>
                <input className="wk-input" value={p.label} onChange={(e) => setPart(i, 'label', e.target.value)} placeholder="Their part, e.g. Reel 1" maxLength={80} />
                <input className="wk-input" type="date" value={p.due} onChange={(e) => setPart(i, 'due', e.target.value)} aria-label="Due date for this person" />
              </div>
              {parts.length > 1 && (
                <button className="wk-btn o sm" style={{ marginTop: 8 }} onClick={() => setParts((x) => x.filter((_, j) => j !== i))}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              )}
            </div>
          ))}
          {parts.length < 12 && (
            <button className="wk-btn o sm" style={{ marginTop: 10, borderStyle: 'dashed', color: 'var(--accent)' }}
              onClick={() => setParts((x) => [...x, { assignee: '', label: '', due: '' }])}>
              <Plus size={16} aria-hidden="true" /> Add another person
            </button>
          )}
        </div>

        <div className="wk-field"><label htmlFor="nt-due">Due date (whole task)</label>
          <input id="nt-due" className="wk-input" type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} />
          <div className="wk-chips">
            <button className="wk-chip" onClick={() => setDue(today)}>Today</button>
            <button className="wk-chip" onClick={() => setDue(addDaysISO(today, 1))}>Tomorrow</button>
            <button className="wk-chip" onClick={() => setDue(addDaysISO(today, 7))}>Next week</button>
          </div>
        </div>

        <div className="wk-field"><label htmlFor="nt-note">Note (optional)</label>
          <textarea id="nt-note" className="wk-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>

        <div className="wk-field"><label htmlFor="nt-steps">Checklist - one step per line (optional)</label>
          <textarea id="nt-steps" className="wk-input" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Get logo\nRough cut\nAdd subtitles'} /></div>

        <div className="wk-field"><label>Repeat</label>
          <div className="wk-seg" style={{ display: 'flex' }}>
            {[['once', 'None'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([k, l]) => (
              <button key={k} style={{ flex: 1 }} className={repeat === k ? 'on' : ''} onClick={() => setRepeat(k)}>{l}</button>
            ))}
          </div>
          {repeat === 'weekly' && (
            <select className="wk-input" style={{ marginTop: 8 }} value={weekday} onChange={(e) => setWeekday(e.target.value)} aria-label="Day of week">
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          )}
          {repeat === 'monthly' && (
            <input className="wk-input" style={{ marginTop: 8 }} type="number" min={1} max={28} value={monthDay} onChange={(e) => setMonthDay(e.target.value)} aria-label="Day of month" />
          )}
          {repeat !== 'once' && <div className="wk-sm" style={{ marginTop: 6 }}>Created at 7 AM on working days. Skips Sundays and holidays.</div>}
        </div>

        <button className="wk-btn y lg" style={{ marginTop: 20 }} disabled={busy} onClick={save}>
          {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : null} Assign
        </button>
      </div>
    </div>
  )
}
