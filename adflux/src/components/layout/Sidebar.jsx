// src/components/layout/Sidebar.jsx
//
// Phase 3C: admin-only "Pending Approvals" nav entry with a live
// count pill. The pill stays in sync via the `payments` realtime
// channel, so admins see new submissions without a page refresh.

import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Building2,
  Users, TrendingUp, BarChart3, LogOut, RotateCcw, Inbox,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { fetchPendingCount } from '../../hooks/usePayments'

const ADMIN_NAV = [
  { to: '/dashboard',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/quotes',            icon: FileText,        label: 'Quotes' },
  { to: '/pending-approvals', icon: Inbox,           label: 'Pending Approvals', showPill: true },
  { to: '/renewal-tools',     icon: RotateCcw,       label: 'Renewal Tools' },
  { to: '/cities',            icon: Building2,       label: 'Cities' },
  { to: '/team',              icon: Users,           label: 'Team' },
  { to: '/incentives',        icon: TrendingUp,      label: 'Incentives' },
]

const SALES_NAV = [
  { to: '/dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/quotes',         icon: FileText,        label: 'Quotes' },
  { to: '/renewal-tools',  icon: RotateCcw,       label: 'Renewal Tools' },
  { to: '/my-performance', icon: BarChart3,       label: 'My Performance' },
]

export function Sidebar() {
  const { profile, signOut, isAdmin } = useAuth()
  const nav = isAdmin ? ADMIN_NAV : SALES_NAV
  const initial = profile?.name?.[0]?.toUpperCase() || 'U'

  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const load = async () => {
      const { count } = await fetchPendingCount()
      if (!cancelled) setPendingCount(count)
    }
    load()

    // Realtime: refetch count on any payment row change
    const ch = supabase
      .channel('sidebar-pending-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, load)
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [isAdmin])

  return (
    <aside className="sidebar">
      {/* Brand mark */}
      <div className="sidebar-logo">
        <div
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
            flexShrink: 0,
          }}
        >
          UA
        </div>
        <div>
          <div className="sidebar-logo-text">UNTITLED</div>
          <div style={{
            fontSize: 9, letterSpacing: '0.18em',
            color: 'var(--sidebar-muted)', marginTop: 2,
            textTransform: 'uppercase', fontWeight: 600,
          }}>
            Adflux
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="sidebar-nav">
        {nav.map(({ to, icon: Icon, label, showPill }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              'sidebar-link' + (isActive ? ' sidebar-link--active' : '')
            }
          >
            <Icon size={17} />
            <span style={{ flex: 1 }}>{label}</span>
            {showPill && pendingCount > 0 && (
              <span
                style={{
                  background: 'var(--danger)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 10,
                  minWidth: 20,
                  textAlign: 'center',
                  lineHeight: 1.4,
                }}
              >
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer user chip + logout */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initial}</div>
          <div className="sidebar-user-info">
            <p className="sidebar-user-name">{profile?.name || '—'}</p>
            <p className="sidebar-user-role">{profile?.role || 'user'}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="sidebar-logout"
          title="Sign out"
          type="button"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  )
}
