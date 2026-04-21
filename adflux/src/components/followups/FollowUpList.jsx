// src/components/followups/FollowUpList.jsx
import { useEffect, useState } from 'react'
import { Calendar, CheckCircle, Clock, RefreshCw, Plus } from 'lucide-react'
import { useFollowUps } from '../../hooks/useFollowUps'
import { useAuthStore } from '../../store/authStore'
import { FollowUpModal } from './FollowUpModal'
import { formatDate } from '../../utils/formatters'

/**
 * Props:
 *   quoteId       — uuid of the quote
 *   assignedTo    — uuid of the sales person (for new manual follow-ups)
 */
export function FollowUpList({ quoteId, assignedTo }) {
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'

  const { followUps, loading, fetchFollowUps, markDone, reschedule, createFollowUp } =
    useFollowUps(quoteId)

  const [modal, setModal]   = useState(null) // { followUp, mode }
  const [adding, setAdding] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newNote, setNewNote] = useState('')
  const [addErr, setAddErr]   = useState('')
  const [addSaving, setAddSaving] = useState(false)

  useEffect(() => { fetchFollowUps() }, [quoteId])

  async function handleAdd(e) {
    e.preventDefault()
    if (!newDate) { setAddErr('Date is required.'); return }
    setAddSaving(true)
    setAddErr('')
    const { error } = await createFollowUp({
      quote_id: quoteId,
      assigned_to: assignedTo || profile?.id,
      follow_up_date: newDate,
      note: newNote || null,
    })
    setAddSaving(false)
    if (error) { setAddErr(error.message || 'Failed to add.'); return }
    setAdding(false)
    setNewDate('')
    setNewNote('')
    fetchFollowUps()
  }

  const today = new Date().toISOString().split('T')[0]

  const getRowClass = (f) => {
    if (f.is_done) return 'fu-row fu-row--done'
    if (f.follow_up_date < today) return 'fu-row fu-row--overdue'
    if (f.follow_up_date === today) return 'fu-row fu-row--today'
    return 'fu-row'
  }

  return (
    <div className="fu-list-wrap">
      {/* Header */}
      <div className="fu-list-header">
        <span className="fu-list-title">Follow-ups</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setAdding(a => !a)}
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <form className="fu-add-form" onSubmit={handleAdd}>
          <div className="fu-add-row">
            <input
              type="date"
              className="field-input"
              value={newDate}
              min={today}
              onChange={e => setNewDate(e.target.value)}
              required
            />
            <input
              type="text"
              className="field-input"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Note (optional)"
            />
            <button className="btn btn-primary btn-sm" type="submit" disabled={addSaving}>
              {addSaving ? '…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setAdding(false); setAddErr('') }}
            >
              Cancel
            </button>
          </div>
          {addErr && <p className="form-error">{addErr}</p>}
        </form>
      )}

      {/* List */}
      {loading ? (
        <div className="fu-loading">
          <div className="spinner" /> Loading…
        </div>
      ) : followUps.length === 0 ? (
        <div className="fu-empty">
          <Clock size={28} style={{ color: 'var(--text-muted)' }} />
          <p>No follow-ups yet. Auto-created when quote is sent.</p>
        </div>
      ) : (
        <div className="fu-rows">
          {followUps.map(f => (
            <div key={f.id} className={getRowClass(f)}>
              <div className="fu-row-icon">
                {f.is_done
                  ? <CheckCircle size={15} style={{ color: 'var(--success)' }} />
                  : f.follow_up_date < today
                  ? <Calendar size={15} style={{ color: 'var(--danger)' }} />
                  : <Calendar size={15} style={{ color: 'var(--blue)' }} />
                }
              </div>
              <div className="fu-row-info">
                <span className="fu-row-date">{formatDate(f.follow_up_date)}</span>
                {f.note && <span className="fu-row-note">{f.note}</span>}
                {f.is_done && f.done_at && (
                  <span className="fu-row-done-at">
                    Done {new Date(f.done_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="fu-row-actions">
                {!f.is_done && (
                  <>
                    <button
                      className="fu-action-btn fu-action-btn--done"
                      title="Mark done"
                      onClick={() => setModal({ followUp: f, mode: 'mark_done' })}
                    >
                      <CheckCircle size={13} />
                    </button>
                    <button
                      className="fu-action-btn fu-action-btn--reschedule"
                      title="Reschedule"
                      onClick={() => setModal({ followUp: f, mode: 'reschedule' })}
                    >
                      <RefreshCw size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <FollowUpModal
          followUp={modal.followUp}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onMarkDone={async (id) => {
            const r = await markDone(id)
            fetchFollowUps()
            return r
          }}
          onReschedule={async (id, date, note) => {
            const r = await reschedule(id, date, note)
            fetchFollowUps()
            return r
          }}
        />
      )}
    </div>
  )
}
