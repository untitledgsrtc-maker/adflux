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

import PerformanceScoreCard from '../../components/incentives/PerformanceScoreCard'
import { MyPerformance } from '../../components/incentives/MyPerformance'
import TotalPayableCard from '../../components/incentives/TotalPayableCard'
import { DidYouKnow } from '../../components/v2/DidYouKnow'
import '../../styles/incentives.css'

export default function MyPerformanceV2() {
  return (
    <div className="v2d-perf">
      {/* Phase 34.9 (C) discoverability — most reps don't realize
          there's an incentive forecaster on every quote detail page. */}
      <DidYouKnow id="perf-quote-forecaster-2026-05-13" title="See per-quote incentive">
        Open any quote — bottom card shows "If you close this this month, +₹X
        to your monthly". Helps decide which deal to push first.
      </DidYouKnow>

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
      <PerformanceScoreCard />

      {/* Phase 34Z.34 — revenue / incentive slab / active campaigns /
          12-month history. Same component /incentives renders for the
          sales role. Two cards same page means reps stop flipping
          between two URLs to read their numbers. */}
      <div style={{ marginTop: 14 }}>
        <MyPerformance />
      </div>

      {/* Phase 34Z.38 — single grand-total summary at the bottom.
          Base + Variable + Incentive + TA/DA = one rupee number the
          rep can read first thing. Owner directive 15 May 2026. */}
      <TotalPayableCard />
    </div>
  )
}
