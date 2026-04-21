// src/components/followups/FollowUpSalesView.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, CheckCircle, RefreshCw, ExternalLink, Clock } from 'lucide-react'
import { useFollowUps } from '../../hooks/useFollowUps'
import { FollowUpModal } from './FollowUpModal'
import { formatDate, todayISO } from '../../utils/formatters'

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today',   label: 'Due Today' },
  { key: 'done',    label: 'Done' },
]

export function FollowUpSalesView() {
  const navigate = useNavigate()
  const { followUps, loading, fetchFollowUps, markDone, reschedule } = useFollowUps()
  const [filter, setFilter] = useState('pending')
  const [modal, setModal]   = useState(null)

  useEffect(() => { fetchFollowUps() }, [])

  const today = todayISO()

  const filtered = followUps.filter(f => {
    if (filter === 'done')    return f.is_done
    if (filter === 'overdue') return !f.is_done && f.follow_up_date < today
    if (filter === 'today')   return !f.is_done && f.follow_up_date === today
    return !f.is_done // pending
  })

  const overdueCount = followUps.filter(f => !f.is_done && f.follow_up_date < today).length

  return (
    <div className="fu-admin-wrap">
      {/* Alert if overdue */}
      {overdueCount > 0 && (
        <div className="fu-banner fu-banner--urgent" style={{ marginBottom: 0 }}>
          <div className="fu-banner-inner">
            <span className="fu-banner-count fu-banner-count--overdue">
              {overdueCount} overdue
            </span>
            <span className="fu-banner-label">follow-up{overdueCount !== 1 ? 's' : ''} need attention</span>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="fu-filter-bar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`fu-filter-btn ${filter === f.key ? 'fu-filter-btn--active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="fu-loading"><div className="spinner" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="fu-empty">
          <CheckCircle size={32} style={{ color: 'var(--success)' }} />
          <p>Nothing here — you're all caught up!</p>
        </div>
      ) : (
        <div className="fu-rows">
          {filtered.map(f => {
            const isOverdue = !f.is_done && f.follow_up_date < today
            const isToday   = !f.is_done && f.follow_up_date === today

            return (
              <div
                key={f.id}
                className={[
                  'fu-row',
                  f.is_done ? 'fu-row--done' : '',
                  isOverdue ? 'fu-row--overdue' : '',
                  isToday   ? 'fu-row--today' : '',
                ].join(' ')}
              >
                <div className="fu-row-icon">
                  {f.is_done
                    ? <CheckCircle size={15} style={{ color: 'var(--success)' }} />
                    : isOverdue
                    ? <Calendar size={15} style={{ color: 'var(--danger)' }} />
                    : <Calendar size={15} style={{ color: 'var(--blue)' }} />}
                </div>

                <div className="fu-row-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      className="fu-quote-link"
                      onClick={() => navigate(`/quotes/${f.quote_id}`)}
                    >
                      {f.quotes?.quote_number || '—'}
                      <ExternalLink size={11} />
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {f.quotes?.client_name || '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', align: 'center', gap: 8 }}>
                    <span className="fu-row-date">{formatDate(f.follow_up_date)}</span>
                    {f.note && <span className="fu-row-note"> · {f.note}</span>}
                  </div>
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
            )
          })}
        </div>
      )}

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
