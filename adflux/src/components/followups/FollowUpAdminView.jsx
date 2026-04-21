// src/components/followups/FollowUpAdminView.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar, CheckCircle, Clock, RefreshCw,
  AlertTriangle, ExternalLink, Filter
} from 'lucide-react'
import { useFollowUps } from '../../hooks/useFollowUps'
import { FollowUpModal } from './FollowUpModal'
import { formatDate } from '../../utils/formatters'

// filter options
const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today',   label: 'Due Today' },
  { key: 'done',    label: 'Done' },
  { key: 'all',     label: 'All' },
]

export function FollowUpAdminView() {
  const navigate = useNavigate()
  const { followUps, loading, fetchFollowUps, markDone, reschedule } = useFollowUps()
  const [filter, setFilter] = useState('pending')
  const [modal, setModal]   = useState(null)

  useEffect(() => { fetchFollowUps() }, [])

  const today = new Date().toISOString().split('T')[0]

  const filtered = followUps.filter(f => {
    if (filter === 'all')     return true
    if (filter === 'done')    return f.is_done
    if (filter === 'overdue') return !f.is_done && f.follow_up_date < today
    if (filter === 'today')   return !f.is_done && f.follow_up_date === today
    if (filter === 'pending') return !f.is_done
    return true
  })

  // Summary counts
  const overdue  = followUps.filter(f => !f.is_done && f.follow_up_date < today).length
  const dueToday = followUps.filter(f => !f.is_done && f.follow_up_date === today).length
  const pending  = followUps.filter(f => !f.is_done).length
  const done     = followUps.filter(f => f.is_done).length

  function getRowClass(f) {
    if (f.is_done) return 'fu-admin-row fu-admin-row--done'
    if (f.follow_up_date < today) return 'fu-admin-row fu-admin-row--overdue'
    if (f.follow_up_date === today) return 'fu-admin-row fu-admin-row--today'
    return 'fu-admin-row'
  }

  return (
    <div className="fu-admin-wrap">
      {/* Summary bar */}
      <div className="fu-summary-bar">
        <div className="fu-summary-chip fu-summary-chip--overdue">
          <AlertTriangle size={13} /> {overdue} overdue
        </div>
        <div className="fu-summary-chip fu-summary-chip--today">
          <Clock size={13} /> {dueToday} today
        </div>
        <div className="fu-summary-chip fu-summary-chip--pending">
          <Calendar size={13} /> {pending} pending
        </div>
        <div className="fu-summary-chip fu-summary-chip--done">
          <CheckCircle size={13} /> {done} done
        </div>
      </div>

      {/* Filter tabs */}
      <div className="fu-filter-bar">
        <Filter size={13} style={{ color: 'var(--text-muted)' }} />
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

      {/* Table */}
      {loading ? (
        <div className="fu-loading"><div className="spinner" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="fu-empty">
          <CheckCircle size={32} style={{ color: 'var(--success)' }} />
          <p>Nothing here. All clear!</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Quote</th>
                <th>Client</th>
                <th>Due Date</th>
                <th>Note</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} className={getRowClass(f)}>
                  <td>
                    <button
                      className="fu-quote-link"
                      onClick={() => navigate(`/quotes/${f.quote_id}`)}
                    >
                      {f.quotes?.quote_number || '—'}
                      <ExternalLink size={11} />
                    </button>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{f.quotes?.client_name || '—'}</div>
                    {f.quotes?.client_company && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {f.quotes.client_company}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={
                      f.is_done ? 'fu-date-chip fu-date-chip--done'
                      : f.follow_up_date < today ? 'fu-date-chip fu-date-chip--overdue'
                      : f.follow_up_date === today ? 'fu-date-chip fu-date-chip--today'
                      : 'fu-date-chip'
                    }>
                      {formatDate(f.follow_up_date)}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {f.note || '—'}
                    </span>
                  </td>
                  <td>
                    {f.is_done
                      ? <span className="fu-status-done">Done</span>
                      : f.follow_up_date < today
                      ? <span className="fu-status-overdue">Overdue</span>
                      : f.follow_up_date === today
                      ? <span className="fu-status-today">Due Today</span>
                      : <span className="fu-status-upcoming">Upcoming</span>
                    }
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!f.is_done && (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
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
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
