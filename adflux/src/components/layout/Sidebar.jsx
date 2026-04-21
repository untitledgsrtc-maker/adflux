// src/components/layout/Sidebar.jsx
//
// Updated to match new globals.css classes and show the full
// UNTITLED / ADFLUX branding in the sidebar.

import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Building2,
  Users, TrendingUp, BarChart3, LogOut, RotateCcw
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

const ADMIN_NAV = [
  { to: '/dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/quotes',         icon: FileText,        label: 'Quotes' },
  { to: '/renewal-tools',  icon: RotateCcw,       label: 'Renewal Tools' },
  { to: '/cities',         icon: Building2,       label: 'Cities' },
  { to: '/team',           icon: Users,           label: 'Team' },
  { to: '/incentives',     icon: TrendingUp,      label: 'Incentives' },
]

const SALES_NAV = [
  { to: '/dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/quotes',         icon: FileText,        label: 'Quotes' },
  { to: '/my-performance', icon: BarChart3,       label: 'My Performance' },
]

export function Sidebar() {
  const { profile, signOut, isAdmin } = useAuth()
  const nav = isAdmin ? ADMIN_NAV : SALES_NAV
  const initial = profile?.name?.[0]?.toUpperCase() || 'U'

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
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              'sidebar-link' + (isActive ? ' sidebar-link--active' : '')
            }
          >
            <Icon size={17} />
            <span>{label}</span>
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
