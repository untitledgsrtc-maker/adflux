// src/components/followups/FollowUpBanner.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, AlertTriangle, ChevronRight } from 'lucide-react'
import { useFollowUps } from '../../hooks/useFollowUps'
import { todayISO } from '../../utils/formatters'

export function FollowUpBanner() {
  const navigate = useNavigate()
  const { fetchDue } = useFollowUps()
  const [due, setDue] = useState([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    fetchDue().then(({ data }) => setDue(data || []))
  }, [])

  if (dismissed || due.length === 0) return null

  const today = todayISO()
  const overdue = due.filter(f => f.follow_up_date < today)
  const todayOnly = due.filter(f => f.follow_up_date === today)
  const isUrgent = overdue.length > 0

  return (
    <div className={`fu-banner ${isUrgent ? 'fu-banner--urgent' : 'fu-banner--today'}`}>
      <div className="fu-banner-inner">
        <div className="fu-banner-icon">
          {isUrgent ? <AlertTriangle size={15} /> : <Bell size={15} />}
        </div>
        <div className="fu-banner-text">
          {overdue.length > 0 && (
            <span className="fu-banner-count fu-banner-count--overdue">
              {overdue.length} overdue
            </span>
          )}
          {todayOnly.length > 0 && (
            <span className="fu-banner-count fu-banner-count--today">
              {todayOnly.length} due today
            </span>
          )}
          <span className="fu-banner-label">follow-up{due.length !== 1 ? 's' : ''} pending</span>
        </div>
        <button
          className="fu-banner-action"
          onClick={() => navigate('/follow-ups')}
        >
          View all <ChevronRight size={13} />
        </button>
        <button
          className="fu-banner-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
