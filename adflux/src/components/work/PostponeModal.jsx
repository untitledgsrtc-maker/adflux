// Phase 395 - the Postpone box. Opens when a task is dropped into the Postponed column (or from the task detail).
// Asks WHO asked for the delay (one or more team members and / or a client name) and the NEW DATE. No approval step:
// the tagged people are told and can see the task. On the new date the system returns it to Assigned by itself.
import { useMemo, useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'
import { istTodayISO } from '../../utils/istDate'
import { addDaysISO } from '../../utils/workUtils'

export default function PostponeModal({ item, users, meId, onClose, onDone }) {
  const today = istTodayISO()
  const [until, setUntil] = useState(addDaysISO(today, 1))
  const [picked, setPicked] = useState([])      // user ids
  const [client, setClient] = useState('')
  const [reason, setReason] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (users || []).filter((u) => !t || String(u.name || '').toLowerCase().includes(t)).slice(0, 40)
  }, [users, q, item.assigneeId])
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 6 ? p : [...p, id]))
  const nameOf = (id) => users.find((u) => u.id === id)?.name || 'Someone'

  const save = async () => {
    if (latch.current) return
    if (!picked.length && !client.trim()) return toastError('', 'Say who asked for the delay: tag a team member or type the client.')
    if (!until || until <= today) return toastError('', 'Pick a date after today.')
    latch.current = true; setBusy(true)
    try {
      const { error } = await supabase.rpc('work_postpone_part', {
        p_part: item.id, p_until: until, p_by_users: picked, p_by_client: client.trim() || null, p_reason: reason.trim() || null,
      })
      if (error) throw error
      toastSuccess('Postponed. It comes back to Assigned on that day.')
      onDone()
    } catch (e) { toastError(e, 'Could not postpone.') } finally { latch.current = false; setBusy(false) }
  }

  return (
    <div className="wk-modal-back" onClick={onClose}>
      <div className="wk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Postpone task">
        <div className="wk-row">
          <div className="wk-title" style={{ fontSize: 22 }}>Postpone task</div>
          <button className="wk-btn o sm" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /> Close</button>
        </div>
        <div className="wk-sm" style={{ margin: '6px 0 14px' }}><b>{item.title}</b>{item.label ? ` · ${item.label}` : ''}</div>

        <div className="wk-field"><label>Postponed by (tag one or more people)</label>
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
                <span>{u.name}{u.designation ? <span className="wk-sm"> · {u.designation}</span> : null}</span>
                {picked.includes(u.id) && <span className="wk-pill ok">Tagged</span>}
              </button>
            ))}
            {list.length === 0 && <div className="wk-sm" style={{ padding: 12 }}>No one found.</div>}
          </div>
        </div>

        <div className="wk-field"><label htmlFor="pp-client">Or a client asked (type the name)</label>
          <input id="pp-client" className="wk-input" value={client} onChange={(e) => setClient(e.target.value)} maxLength={80} placeholder="For example: Anee Marcom" /></div>

        <div className="wk-field"><label htmlFor="pp-date">Comes back on</label>
          <input id="pp-date" className="wk-input" type="date" value={until} min={addDaysISO(today, 1)} onChange={(e) => setUntil(e.target.value)} />
          <div className="wk-chips">
            <button className="wk-chip" onClick={() => setUntil(addDaysISO(today, 1))}>Tomorrow</button>
            <button className="wk-chip" onClick={() => setUntil(addDaysISO(today, 3))}>In 3 days</button>
            <button className="wk-chip" onClick={() => setUntil(addDaysISO(today, 7))}>Next week</button>
          </div>
        </div>

        <div className="wk-field"><label htmlFor="pp-why">Reason (optional)</label>
          <input id="pp-why" className="wk-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="One line" /></div>

        <div className="wk-sm" style={{ marginBottom: 12 }}>On that day, at 7 AM, it goes back to Assigned by itself. The tagged people are told and can see the task.</div>
        <button className="wk-btn y lg" disabled={busy} onClick={save}>
          {busy ? <Loader2 size={16} className="wk-spin" aria-hidden="true" /> : null} Postpone
        </button>
      </div>
    </div>
  )
}
