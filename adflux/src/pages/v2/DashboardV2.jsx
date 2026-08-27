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

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import SalesDashboardV2 from './SalesDashboard'
import SalesDashboardDesktop from './SalesDashboardDesktop'
import AdminDashboardDesktop from './AdminDashboardDesktop'
// Phase 101.B — agency Home dashboard. Commission-only partner
// gets KPI grid (Commission Earned / Won Base / Payable / Quotes
// Sent / Pending / Outstanding) + Active Campaigns + FAB BottomNav.
// Mirrors SalesDashboard mobile pattern with agency-specific data.
import AgencyHomeView from '../../components/agency/AgencyHomeView'

export default function DashboardV2() {
  // Privileged set (admin / owner / co_owner) all get the admin
  // dashboard. Sales reps get the sales dashboard. Agency gets
  // their own commission-focused Home (Phase 101.B).
  const { isPrivileged, isAgency, loading, profile } = useAuth()
  const isDesktop = useIsDesktop()

  if (loading) {
    return (
      <div className="v2d">
        <div className="v2d-loading"><div className="v2d-spinner" /></div>
      </div>
    )
  }

  // Ops users must never see the sales dashboard (leak fix, 2026-08-27).
  // Bounce them to their own home — mirrors RootRedirect's ops landing.
  if (profile?.role === 'operation_head')      return <Navigate to="/ops-down" replace />
  if (profile?.role === 'operation_executive') return <Navigate to="/ops-log" replace />

  if (isPrivileged) return <AdminDashboardDesktop />
  // Phase 101.B — agency branch. Same /dashboard URL, role-aware
  // switch matches the admin/sales pattern above.
  if (isAgency) return <AgencyHomeView />
  return isDesktop ? <SalesDashboardDesktop /> : <SalesDashboardV2 />
}
