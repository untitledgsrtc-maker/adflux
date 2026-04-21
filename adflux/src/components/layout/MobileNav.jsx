// src/components/layout/MobileNav.jsx
//
// Bottom tab bar — visible only on mobile (< 900px, toggled in globals.css).
// Admin and sales see different tabs.
//
// Phase 3C: the admin tab bar includes a "Pending" entry with a
// live count pill so admins can triage from their phone.

import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Building2,
  Users, TrendingUp, BarChart3, Inbox,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { fetchPendingCount } from '../../hooks/usePayments'

const ADMIN_NAV = [
  { to: '/dashboard',         icon: LayoutDashboard, label: 'Home' },
  { to: '/quotes',            icon: FileText,        label: 'Quotes' },
  { to: '/pending-approvals', icon: Inbox,           label: 'Pending', showPill: true },
  { to: '/team',              icon: Users,           label: 'Team' },
  { to: '/incentives',        icon: TrendingUp,      label: 'Incentives' },
]

const SALES_NAV = [
  { to: '/quotes',         icon: FileText,  label: 'Quotes' },
  { to: '/my-performance', icon: BarChart3, label: 'Performance' },
]

export function MobileNav() {
  const { isAdmin } = useAuth()
  const nav = isAdmin ? ADMIN_NAV : SALES_NAV

  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const load = async () => {
      const { count } = await fetchPendingCount()
      if (!cancelled) setPendingCount(count)
    }
    load()
    const ch = supabase
      .channel('mobile-pending-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [isAdmin])

  return (
    <nav className="mobile-nav">
      {nav.map(({ to, icon: Icon, label, showPill }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            'mobile-nav-item' + (isActive ? ' mobile-nav-item--active' : '')
          }
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={20} />
            {showPill && pendingCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -8,
                  background: 'var(--danger)',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 8,
                  minWidth: 16,
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </div>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
