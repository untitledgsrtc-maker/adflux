// src/pages/v2/MyPerformanceV2.jsx
//
// v2 "My Performance" page.
//
// Phase 33G (I5) — old MyPerformanceView slab card removed in favour
// of PerformanceScoreCard alone.
//
// Phase 34Z.34 (15 May 2026) — owner reported the rich revenue /
// active campaigns / 12-month history view was missing here. That
// content moved to /incentives during Phase 33G but reps go to
// /my-performance from the sidebar. Brought both back into one
// page: meeting-score card on top, revenue + slab + history below.

import { useState } from 'react'
import PerformanceScoreCard from '../../components/incentives/PerformanceScoreCard'
import TcWeeklyTiles from '../../components/incentives/TcWeeklyTiles'
import { MyPerformance } from '../../components/incentives/MyPerformance'
import TotalPayableCard from '../../components/incentives/TotalPayableCard'
import PresentationStatCard from '../../components/incentives/PresentationStatCard' // Phase 181
import SalarySlipsCard from '../../components/incentives/SalarySlipsCard' // Phase 185
import DailyScoresCard from '../../components/incentives/DailyScoresCard' // Phase 186
import AgencyEarningsView from '../../components/agency/AgencyEarningsView'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { useAuthStore } from '../../store/authStore'
import '../../styles/incentives.css'

export default function MyPerformanceV2() {
  // Phase 34Z.59 — bump a refresh key on tab-resume so the three
  // self-fetching cards (PerformanceScoreCard / MyPerformance /
  // TotalPayableCard) remount and re-pull. Owner reported saves not
  // reflecting on the dashboard until a tab switch.
  const [refreshKey, setRefreshKey] = useState(0)
  useAutoRefresh(() => setRefreshKey(k => k + 1))

  // Phase 101.A2 — agency = commission-only partner. Routes to
  // dedicated AgencyEarningsView ledger instead of the score /
  // variable / TA / salary cards. Same /my-performance URL preserved
  // (sidebar label already says "My Earnings" for agency via Phase
  // 11g AGENCY_NAV — V2AppShell.jsx:135-139). Non-agency rendering
  // below is byte-identical to baseline; useAutoRefresh mount
  // preserved per CLAUDE.md §28 sales-frozen contract.
  const profile = useAuthStore(s => s.profile)
  if (profile?.role === 'agency') {
    return <AgencyEarningsView refreshKey={refreshKey} />
  }

  return (
    <div className="v2d-perf">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Your numbers</div>
          <h1 className="v2d-page-title">My Performance</h1>
          <div className="v2d-page-sub">
            Monthly score, salary projection, revenue, active campaigns
            and 12-month history.
          </div>
        </div>
      </div>

      {/* Phase 33E — task-completion score (meetings done vs target)
          + 70/30 base + variable salary projection. */}
      <PerformanceScoreCard key={`score-${refreshKey}`} />

      {/* Phase 186 — per-day score breakdown behind the monthly average. */}
      <DailyScoresCard key={`daily-${refreshKey}`} />

      {/* Phase 53 — TC-only weekly KPI strip + variable-unlock gate.
          Hidden for sales / agency / staff. Surfaces connect rate
          (observability), qualified handoffs / week (gate), quotes /
          week (gate). */}
      <TcWeeklyTiles key={`tc-${refreshKey}`} />

      {/* Phase 34Z.34 — revenue / incentive slab / active campaigns /
          12-month history. Same component /incentives renders for the
          sales role. Two cards same page means reps stop flipping
          between two URLs to read their numbers. */}
      <div style={{ marginTop: 14 }}>
        <MyPerformance key={`perf-${refreshKey}`} />
      </div>

      {/* Phase 34Z.38 — single grand-total summary at the bottom.
          Base + Variable + Incentive + TA/DA = one rupee number the
          rep can read first thing. Owner directive 15 May 2026. */}
      <TotalPayableCard key={`tp-${refreshKey}`} />

      {/* Phase 181 — time spent presenting the GSRTC deck this month. */}
      <PresentationStatCard key={`present-${refreshKey}`} />

      {/* Phase 185 — download own salary slip (PDF) for any fully-paid month. */}
      <SalarySlipsCard key={`slip-${refreshKey}`} />
    </div>
  )
}
