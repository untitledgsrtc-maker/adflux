// src/pages/MyPerformance.jsx
// This page is an alias — the MyPerformance component lives in components/incentives/
// and is also embedded inside Incentives.jsx for sales users.
// This standalone route handles /my-performance directly.
import { MyPerformance as MyPerformanceView } from '../components/incentives/MyPerformance'
import '../styles/incentives.css'

export default function MyPerformancePage() {
  return (
    <div className="page">
      <div className="inc-header">
        <div className="inc-header-left">
          <h1>My Performance</h1>
          <p>Track your monthly revenue, incentive slab progress and history</p>
        </div>
      </div>
      <MyPerformanceView />
    </div>
  )
}
