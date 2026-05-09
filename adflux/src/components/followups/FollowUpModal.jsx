// src/components/followups/FollowUpModal.jsx
import { useState } from 'react'
import { X, Calendar, MessageSquare, CheckCircle } from 'lucide-react'
import { todayISO, addDaysISO } from '../../utils/formatters'

/**
 * Props:
 *   followUp   — the follow_up row (with quotes join)
 *   mode       — 'reschedule' | 'mark_done'
 *   onClose    — fn()
 *   onReschedule  — fn(id, newDate, note)
 *   onMarkDone    — fn(id)
 */
export function FollowUpModal({ followUp, mode = 'reschedule', onClose, onReschedule, onMarkDone }) {
  const [date, setDate] = useState(() => addDaysISO(1))
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

  // Phase 11d (rev13) — rewrote to use the working `mo`/`md` modal
  // classes from v2.css. The previous version used `modal-overlay` /
  // `field-label` / `field-input` classes that aren't styled in the
  // dark v2 theme — labels and inputs lost their layout, icons floated
  // free of text. Owner reported "followup UI not good".
  return (
    <div className="mo" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="md" style={{ maxWidth: 460 }}>
        <div className="md-h">
          <div>
            <div className="md-t">
              {mode === 'reschedule' ? '📅 Reschedule Follow-up' : '✓ Mark Done'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {quoteNum && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--accent, #FFE600)', background: 'rgba(255,230,0,0.08)',
                  borderRadius: 4, padding: '1px 6px',
                }}>{quoteNum}</span>
              )}
              <span>{clientName}</span>
            </div>
          </div>
          <button className="md-x" onClick={onClose}>✕</button>
        </div>

        <div className="md-b">
          {mode === 'mark_done' ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 12, padding: '16px 0', textAlign: 'center',
            }}>
              <CheckCircle size={36} style={{ color: '#81c784' }} />
              <p style={{ margin: 0 }}>Mark this follow-up as <strong>done</strong>?</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--gray)' }}>
                This will close the follow-up for {clientName}.
              </p>
            </div>
          ) : (
            <form onSubmit={handleReschedule} id="reschedule-form">
              <div className="fg">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={13} /> New Date
                </label>
                <input
                  type="date"
                  value={date}
                  min={todayISO()}
                  onChange={e => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="fg">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MessageSquare size={13} /> Note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Add a note about this follow-up…"
                  rows={3}
                  style={{ minHeight: 64, resize: 'vertical' }}
                />
              </div>
            </form>
          )}

          {err && (
            <p style={{
              marginTop: 8, fontSize: 12,
              color: '#ef9a9a',
              background: 'rgba(229,57,53,.08)',
              border: '1px solid rgba(229,57,53,.3)',
              borderRadius: 6, padding: '6px 10px',
            }}>{err}</p>
          )}
        </div>

        <div className="md-f">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {mode === 'mark_done' ? (
            <button
              className="btn btn-y"
              onClick={handleMarkDone}
              disabled={saving}
              style={{ background: '#81c784', color: '#0a0e1a' }}
            >
              {saving ? 'Saving…' : '✓ Mark Done'}
            </button>
          ) : (
            <button
              className="btn btn-y"
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
