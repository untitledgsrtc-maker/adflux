// src/pages/v2/MyPerformanceV2.jsx
//
// v2 "My Performance" page.
//
// Phase 33G (I5) — old MyPerformanceView slab card removed. It was
// the legacy revenue/incentive-slab block that duplicated the salary
// signal now shown by PerformanceScoreCard (70/30 base + variable,
// 50% threshold). Two cards talking about the same number confused
// reps — the new score card is the single source of truth.
//
// Sidebar / topbar / mobile-nav come from V2AppShell.

import PerformanceScoreCard from '../../components/incentives/PerformanceScoreCard'
import '../../styles/incentives.css'

export default function MyPerformanceV2() {
  return (
    <div className="v2d-perf">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Your numbers</div>
          <h1 className="v2d-page-title">My Performance</h1>
          <div className="v2d-page-sub">
            Your monthly score, base + variable salary projection, and
            the targets you need to hit.
          </div>
        </div>
      </div>

      {/* Phase 33E — task-completion score + variable salary projection.
          Phase 33G — now the only salary card on this page. */}
      <PerformanceScoreCard />
    </div>
  )
}
