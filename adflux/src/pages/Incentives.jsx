// src/pages/Incentives.jsx
import { useAuthStore } from '../store/authStore'
import { IncentiveDashboard } from '../components/incentives/IncentiveDashboard'
import { MyPerformance } from '../components/incentives/MyPerformance'
import '../styles/incentives.css'

export default function Incentives() {
  const profile = useAuthStore(s => s.profile)

  if (!profile) return null

  if (profile.role === 'admin') {
    return (
      <div className="page">
        <div className="inc-header">
          <div className="inc-header-left">
            <h1>Incentives</h1>
            <p>Staff profiles, monthly performance, slab tracking and payout liability</p>
          </div>
        </div>
        <IncentiveDashboard />
      </div>
    )
  }

  // Sales role
  return (
    <div className="page">
      <div className="inc-header">
        <div className="inc-header-left">
          <h1>My Performance</h1>
          <p>Track your monthly revenue, incentive slab progress and history</p>
        </div>
      </div>
      <MyPerformance />
    </div>
  )
}
