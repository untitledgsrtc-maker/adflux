// src/pages/v2/DashboardV2.jsx
//
// Switcher for the v2 dashboard. Picks the right variant based on
// role × viewport:
//
//   role=admin  → AdminDashboardDesktop  (responsive — sidebar collapses
//                 at ≤860px, mobile bottom-nav takes over via CSS)
//   role=sales + desktop (≥860px) → SalesDashboardDesktop
//   role=sales + mobile  (<860px) → SalesDashboardV2 (the existing
//                 mobile-first sales component at src/pages/v2/SalesDashboard.jsx)
//
// Why split sales into two components but keep admin unified:
// - Sales mobile is a fundamentally different IA (FAB-driven, single
//   hero tile, tiny KPIs). The desktop version has a real sidebar and
//   tabular data — not a layout you can reflow with media queries.
// - Admin desktop collapses cleanly to a stacked 1-col layout on
//   mobile. The IA is the same (cards, queues, tables), just narrower.
//
// This file owns ZERO data fetching. It's a router, not a page.

import { useAuth } from '../../hooks/useAuth'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import SalesDashboardV2 from './SalesDashboard'
import SalesDashboardDesktop from './SalesDashboardDesktop'
import AdminDashboardDesktop from './AdminDashboardDesktop'

export default function DashboardV2() {
  // Privileged set (admin / owner / co_owner) all get the admin
  // dashboard. Sales reps get the sales dashboard.
  const { isPrivileged, loading } = useAuth()
  const isDesktop = useIsDesktop()

  if (loading) {
    return (
      <div className="v2d">
        <div className="v2d-loading"><div className="v2d-spinner" /></div>
      </div>
    )
  }

  if (isPrivileged) return <AdminDashboardDesktop />
  return isDesktop ? <SalesDashboardDesktop /> : <SalesDashboardV2 />
}
