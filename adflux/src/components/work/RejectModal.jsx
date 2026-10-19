// Phase 413 - the Reject box. Two uses, same box: a person DECLINES a task given to them, or a head / the person who asked
// SENDS BACK finished work. A reason is required either way; the other side is told.
import { useRef, useState } from 'react'
import { X, Loader2, Undo2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'

const QUICK = {
  declined: ['Too busy right now', 'Not my skill', 'Missing details', 'Wrong person'],
  sent_back: ['Needs changes', 'Wrong file or size', 'Not complete', 'Check the details again'],
}

export default function RejectModal({ part, title, who, kind, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)
  const decline = kind === 'declined'

  const save = async () => {
    if (latch.current) return
    if (reason.trim().length < 3) return toastError('', 'Write the reason, at least a few words.')
    latch.current = true; setBusy(true)
    try {
      const { error } = await supabase.rpc('work_reject_part', { p_part: part, p_reason: reason.trim() })
      if (error) throw error
      toastSuccess(decline ? 'Declined. The person who asked is told.' : 'Sent back. They are told and it is in Assigned again.')
      onDone()
    } catch (e) { toastError(e, 'Could not reject.') } finally { latch.current = false; setBusy(false) }
  }

  return (
    <div className="wk-modal-back" style={{ zIndex: 9100 }} onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="wk-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={decline ? 'Decline task' : 'Send task back'}>
        <div className="wk-row">
          <div className="wk-title" style={{ fontSize: 22 }}>{decline ? 'Decline this task' : 'Send back for changes'}</div>
          <button className="wk-btn o sm" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /> Close</button>
        </div>
        <div className="wk-sm" style={{ margin: '6px 0 14px' }}><b>{title}</b>{who ? ` · ${who}` : ''}</div>
        <div className="wk-field"><label htmlFor="rj-why">Reason (required)</label>
          <textarea id="rj-why" className="wk-input" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={decline ? 'Why can you not do this?' : 'What needs to change?'} style={{ resize: 'vertical' }} />
          <div className="wk-chips">
            {QUICK[kind].map((q) => <button key={q} type="button" className="wk-chip" onClick={() => setReason(q)}>{q}</button>)}
          </div>
        </div>
        <div className="wk-sm" style={{ marginBottom: 12 }}>
          {decline ? 'The task stays in Assigned with your reason on it. The person who asked is told and can give it to someone else.'
                   : 'It goes back to Assigned with your reason on it. Time and cost on it are cleared, and they start again.'}
        </div>
        <button className="wk-btn y lg" disabled={busy || reason.trim().length < 3} onClick={save}>
          {busy ? <Loader2 size={16} className="wk-spin" aria-hidden="true" /> : <Undo2 size={16} aria-hidden="true" />} {decline ? 'Decline task' : 'Send back'}
        </button>
      </div>
    </div>
  )
}
