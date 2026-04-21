// src/pages/Dashboard.jsx
import { useAuth } from '../hooks/useAuth'
import { RevenueSummary }      from '../components/dashboard/RevenueSummary'
import { PipelineFunnel }      from '../components/dashboard/PipelineFunnel'
import { OutstandingPayments } from '../components/dashboard/OutstandingPayments'
import { TopPerformers }       from '../components/dashboard/TopPerformers'
import { IncentiveLiability }  from '../components/dashboard/IncentiveLiability'
import { ActivityFeed }        from '../components/dashboard/ActivityFeed'
import { FollowUpsDueToday }   from '../components/dashboard/FollowUpsDueToday'
import { SalesDashboard }      from '../components/dashboard/SalesDashboard'
import '../styles/dashboard.css'

export default function Dashboard() {
  const { isAdmin, profile } = useAuth()

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="db-header">
          <div>
            <h1 className="db-title">Welcome back, {profile?.name?.split(' ')[0] || 'there'} 👋</h1>
            <p className="db-subtitle">Here's your sales snapshot</p>
          </div>
        </div>
        <SalesDashboard />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="db-header">
        <div>
          <h1 className="db-title">Dashboard</h1>
          <p className="db-subtitle">Company-wide overview</p>
        </div>
      </div>

      {/* Row 1 — KPI cards full width */}
      <RevenueSummary />

      {/* Row 2 — Funnel + Outstanding */}
      <div className="db-two-col">
        <PipelineFunnel />
        <OutstandingPayments />
      </div>

      {/* Row 3 — Top Performers + Incentive Liability */}
      <div className="db-two-col">
        <TopPerformers />
        <IncentiveLiability />
      </div>

      {/* Row 4 — Follow-ups + Activity */}
      <div className="db-two-col">
        <FollowUpsDueToday />
        <ActivityFeed />
      </div>
    </div>
  )
}
