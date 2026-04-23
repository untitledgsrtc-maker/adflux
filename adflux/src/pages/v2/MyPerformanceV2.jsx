// src/pages/v2/MyPerformanceV2.jsx
//
// v2 "My Performance" page. The actual data-fetch + chart component
// lives in components/incentives/MyPerformance — we just give it a
// v2-styled header and shell wrapper. The page is rendered inside
// V2AppShell so the sidebar/topbar/mobile-nav are already on screen.
//
// Why this file is deliberately thin:
// - The MyPerformance component already handles threshold/target/rate
//   maths, month switcher, and history table.
// - Rewriting that logic would risk diverging from what the incentive
//   calc utility produces for the dashboard (single source of truth).

import { MyPerformance as MyPerformanceView } from '../../components/incentives/MyPerformance'
import '../../styles/incentives.css'

export default function MyPerformanceV2() {
  return (
    <div className="v2d-perf">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Your numbers</div>
          <h1 className="v2d-page-title">My Performance</h1>
          <div className="v2d-page-sub">
            Track your monthly revenue, incentive slab progress and history.
          </div>
        </div>
      </div>

      <div className="v2d-perf-body">
        <MyPerformanceView />
      </div>
    </div>
  )
}
