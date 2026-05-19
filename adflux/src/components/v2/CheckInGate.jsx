// src/components/v2/CheckInGate.jsx
//
// Phase 60 (19 May 2026) — wrap V2AppShell. If the current rep is a
// sales / telecaller AND today is a workday AND they haven't checked
// in yet, redirect to /check-in. Otherwise render children.
//
// Why a gate component, not a route guard:
//   - Phase 60 attendance covers ONLY sales + telecaller roles.
//     Admin / co_owner / agency don't see the gate.
//   - V2AppShell wraps every authenticated page; placing the gate
//     inside it means the redirect happens regardless of the
//     destination route (/work, /leads, /quotes, etc.).
//   - The check is server-side via is_checked_in_today() RPC, so
//     IST clock is authoritative.
//
// Behaviour matrix:
//   role admin/co_owner    -> render children (no gate)
//   role agency            -> render children (commission-only)
//   role sales/telecaller, not workday (Sun/holiday/leave) -> render children
//   role sales/telecaller, checked in today -> render children
//   role sales/telecaller, NOT checked in, workday -> redirect /check-in
//
// Loading state: while the RPC is in flight on first mount, show a
// thin top-of-page loader strip rather than blocking the whole UI.
// The gate falls open after the RPC resolves.

import React from 'react'
import { useLocation, Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useCheckinStatus } from '../../hooks/useCheckinStatus'

// Roles that must check-in. Mirror of the SQL §7a role filter.
const GATED_ROLES = new Set(['sales', 'telecaller'])

export default function CheckInGate({ children }) {
  const profile = useAuthStore((s) => s.profile)
  const location = useLocation()
  const { loading, checkedIn, isWorkday, error } = useCheckinStatus(profile?.id)

  // No profile yet → bootstrap is still loading; render children
  // and let auth flow do its thing.
  if (!profile) return children

  // Role outside scope → never gated.
  if (!GATED_ROLES.has(profile.role)) return children

  // RPC errored — fail open so the rep isn't locked out by a
  // server-side hiccup. Logged inside the hook.
  if (error) return children

  // Loading first response — render children without redirect so the
  // app doesn't bounce. The hook will refetch on focus and flip the
  // redirect on the next mount if needed.
  if (loading) return children

  // Not a workday (Sunday / holiday / approved leave) → no gate.
  if (!isWorkday) return children

  // Checked in already → no gate.
  if (checkedIn) return children

  // Already ON /check-in — don't loop redirect.
  if (location.pathname === '/check-in') return children

  // Redirect with current location so post-check-in can bounce back.
  return <Navigate to="/check-in" state={{ from: location }} replace />
}
