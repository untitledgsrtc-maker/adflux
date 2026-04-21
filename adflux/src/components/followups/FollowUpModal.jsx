// src/components/followups/FollowUpModal.jsx
import { useState } from 'react'
import { X, Calendar, MessageSquare, CheckCircle } from 'lucide-react'

/**
 * Props:
 *   followUp   — the follow_up row (with quotes join)
 *   mode       — 'reschedule' | 'mark_done'
 *   onClose    — fn()
 *   onReschedule  — fn(id, newDate, note)
 *   onMarkDone    — fn(id)
 */
export function FollowUpModal({ followUp, mode = 'reschedule', onClose, onReschedule, onMarkDone }) {
  const [date, setDate] = useState(() => {
    // Default to tomorrow
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })
  const [note, setNote] = useState(followUp?.note || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleReschedule(e) {
    e.preventDefault()
    if (!date) { setErr('Please pick a date.'); return }
    setSaving(true)
    setErr('')
    const { error } = await onReschedule(followUp.id, date, note)
    setSaving(false)
    if (error) setErr(error.message || 'Failed to reschedule.')
    else onClose()
  }

  async function handleMarkDone() {
    setSaving(true)
    const { error } = await onMarkDone(followUp.id)
    setSaving(false)
    if (error) setErr(error.message || 'Failed to mark done.')
    else onClose()
  }

  const clientName = followUp?.quotes?.client_name || '—'
  const quoteNum   = followUp?.quotes?.quote_number  || ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box--sm" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">
              {mode === 'reschedule' ? 'Reschedule Follow-up' : 'Mark Done'}
            </div>
            <div className="modal-subtitle">
              {quoteNum && <span className="fu-modal-qnum">{quoteNum}</span>}
              {clientName}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {mode === 'mark_done' ? (
            <div className="fu-done-confirm">
              <CheckCircle size={36} style={{ color: 'var(--success)' }} />
              <p>Mark this follow-up as <strong>done</strong>?</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                This will close the follow-up for {clientName}.
              </p>
            </div>
          ) : (
            <form onSubmit={handleReschedule} id="reschedule-form">
              <div className="form-field">
                <label className="field-label">
                  <Calendar size={13} /> New Date
                </label>
                <input
                  type="date"
                  className="field-input"
                  value={date}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label className="field-label">
                  <MessageSquare size={13} /> Note (optional)
                </label>
                <textarea
                  className="field-input field-textarea"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Add a note about this follow-up…"
                  rows={3}
                />
              </div>
            </form>
          )}

          {err && <p className="form-error" style={{ marginTop: 8 }}>{err}</p>}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {mode === 'mark_done' ? (
            <button
              className="btn btn-success"
              onClick={handleMarkDone}
              disabled={saving}
            >
              {saving ? 'Saving…' : '✓ Mark Done'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="submit"
              form="reschedule-form"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Reschedule'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
