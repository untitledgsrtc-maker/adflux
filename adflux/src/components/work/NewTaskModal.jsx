// Phase 365 / 404 - New task popup (same look as Postpone): what, tag people + their part, client, due date + optional time,
// note, checklist steps, repeat. Anyone signed in can ask anyone (owner decision).
import { useMemo, useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
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
  const [partOf, setPartOf] = useState(meId ? { [meId]: '' } : {})   // assignee id -> their part label
  const [q, setQ] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [steps, setSteps] = useState('')
  const [repeat, setRepeat] = useState('once')
  const [weekday, setWeekday] = useState(1)
  const [monthDay, setMonthDay] = useState(1)
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)

  const picked = Object.keys(partOf)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (users || []).filter((u) => !t || String(u.name || '').toLowerCase().includes(t)).slice(0, 40)
  }, [users, q])
  const toggle = (id) => setPartOf((m) => { const n = { ...m }; if (id in n) delete n[id]; else if (Object.keys(n).length < 12) n[id] = ''; return n })
  const nameOf = (id) => users.find((u) => u.id === id)?.name || 'Someone'

  const save = async () => {
    if (latch.current) return
    if (!title.trim()) return toastError('', 'Give the task a name.')
    const clean = picked.map((id) => ({ assignee: id, label: partOf[id] || '' }))
    if (!clean.length) return toastError('', 'Pick at least one person.')
    if (dueTime && due === today && dueTime <= new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })) return toastError('', 'That time has already passed today.')
    if (repeat === 'once' && !due) return toastError('', 'Pick a due date. A task cannot be created without one.')
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
          p_title: title.trim(), p_project: pid, p_note: note.trim() || null, p_due: due,
          p_parts: clean.map((p) => ({ assignee: p.assignee, label: p.label.trim(), due: null })),
          p_due_time: due && dueTime ? dueTime : null,
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
          <input id="nt-title" className="wk-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Make 2 reels" /></div>

        <div className="wk-field"><label htmlFor="nt-client">Client (optional)</label>
          <select id="nt-client" className="wk-input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">- none / type a new one below -</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!project && <input className="wk-input" style={{ marginTop: 8 }} value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="New client name" maxLength={80} />}
        </div>

        <div className="wk-field"><label>Assign to (tag one or more people)</label>
          {picked.length > 0 && (
            <div className="wk-chips" style={{ marginBottom: 8 }}>
              {picked.map((id) => <button key={id} type="button" className="wk-chip" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => toggle(id)}>{nameOf(id)} <X size={12} aria-hidden="true" /></button>)}
            </div>
          )}
          <input className="wk-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name" />
          <div style={{ maxHeight: 170, overflowY: 'auto', marginTop: 8, border: '1px solid var(--border)', borderRadius: 10 }}>
            {list.map((u) => (
              <button key={u.id} type="button" className="wk-row wk-hov" onClick={() => toggle(u.id)}
                style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                <span>{u.name}{u.designation ? <span className="wk-sm"> - {u.designation}</span> : null}</span>
                {picked.includes(u.id) && <span className="wk-pill ok">Tagged</span>}
              </button>
            ))}
            {list.length === 0 && <div className="wk-sm" style={{ padding: 12 }}>No one found.</div>}
          </div>
          {picked.length > 1 && picked.map((id) => (
            <input key={id} className="wk-input" style={{ marginTop: 8 }} value={partOf[id]} maxLength={80}
              onChange={(e) => setPartOf((m) => ({ ...m, [id]: e.target.value }))} placeholder={`${nameOf(id)}'s part, e.g. Reel 1 (optional)`} />
          ))}
        </div>

        <div className="wk-field"><label htmlFor="nt-due">Due date *</label>
          <input id="nt-due" className="wk-input" type="date" value={due} min={today} required onChange={(e) => setDue(e.target.value)} />
          <div className="wk-chips">
            <button className="wk-chip" onClick={() => setDue(today)}>Today</button>
            <button className="wk-chip" onClick={() => setDue(addDaysISO(today, 1))}>Tomorrow</button>
            <button className="wk-chip" onClick={() => setDue(addDaysISO(today, 7))}>Next week</button>
          </div>
        </div>

        <div className="wk-field"><label htmlFor="nt-time">Due time (optional)</label>
          <input id="nt-time" className="wk-input" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          <div className="wk-chips">
            {[['11:00', '11 AM'], ['14:00', '2 PM'], ['17:00', '5 PM'], ['19:00', '7 PM']].map(([v, l]) => <button key={v} type="button" className="wk-chip" onClick={() => setDueTime(v)}>{l}</button>)}
            {dueTime && <button type="button" className="wk-chip" onClick={() => setDueTime('')}>Clear</button>}
          </div>
          {dueTime && <div className="wk-sm" style={{ marginTop: 6 }}>If it is not finished by then, the assignee gets an alert.</div>}
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
