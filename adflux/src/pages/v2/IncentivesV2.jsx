// src/pages/v2/IncentivesV2.jsx
//
// Admin: renders IncentiveDashboard (team-wide slabs, monthly rollups,
// payout liability, settings panel). Sales: redirects to My Performance
// since the /incentives route has historically doubled as the sales
// personal view — but under v2 sales has a dedicated /my-performance
// route, so for sales we just render MyPerformance inline.
//
// Thin v2 wrapper: legacy IncentiveDashboard has its own internal
// chrome — we just give it a v2 page head.

import { useAuthStore } from '../../store/authStore'
import { IncentiveDashboard } from '../../components/incentives/IncentiveDashboard'
import { MyPerformance } from '../../components/incentives/MyPerformance'
import '../../styles/incentives.css'

// Phase 38 — `embedded` prop suppresses own page-head when mounted
// inside PeopleV2 (which renders the shared "People" head once).
export default function IncentivesV2({ embedded = false }) {
  const profile = useAuthStore(s => s.profile)
  if (!profile) return null

  if (profile.role === 'admin') {
    return (
      <div className="v2d-inc">
        {!embedded && (
          <div className="v2d-page-head">
            <div>
              <div className="v2d-page-kicker">Compensation</div>
              <h1 className="v2d-page-title">Incentives</h1>
              <div className="v2d-page-sub">
                Staff profiles, monthly performance, slab tracking and payout liability.
              </div>
            </div>
          </div>
        )}
        <div className="v2d-inc-body">
          <IncentiveDashboard />
        </div>
      </div>
    )
  }

  // Sales role fallback — preserved so old /incentives bookmarks still work.
  return (
    <div className="v2d-inc">
      {!embedded && (
        <div className="v2d-page-head">
          <div>
            <div className="v2d-page-kicker">Your numbers</div>
            <h1 className="v2d-page-title">My Performance</h1>
            <div className="v2d-page-sub">
              Track your monthly revenue, incentive slab progress and history.
            </div>
          </div>
        </div>
      )}
      <div className="v2d-inc-body">
        <MyPerformance />
      </div>
    </div>
  )
}
