// src/pages/FollowUps.jsx
import { useAuthStore } from '../store/authStore'
import { FollowUpAdminView } from '../components/followups/FollowUpAdminView'
import { FollowUpSalesView } from '../components/followups/FollowUpSalesView'
import '../styles/followups.css'

export default function FollowUps() {
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Follow-ups</h1>
          <p className="page-subtitle">
            {isAdmin
              ? 'Track all team follow-ups and reminders'
              : 'Your pending follow-ups and reminders'}
          </p>
        </div>
      </div>

      {isAdmin ? <FollowUpAdminView /> : <FollowUpSalesView />}
    </div>
  )
}
