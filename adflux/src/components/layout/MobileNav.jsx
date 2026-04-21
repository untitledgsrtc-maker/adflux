// src/components/layout/MobileNav.jsx
//
// Bottom tab bar — visible only on mobile (< 900px, toggled in globals.css).
// Admin and sales see different tabs.

import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Building2,
  Users, TrendingUp, BarChart3,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

const ADMIN_NAV = [
  { to: '/dashboard',      icon: LayoutDashboard, label: 'Home' },
  { to: '/quotes',         icon: FileText,        label: 'Quotes' },
  { to: '/cities',         icon: Building2,       label: 'Cities' },
  { to: '/team',           icon: Users,           label: 'Team' },
  { to: '/incentives',     icon: TrendingUp,      label: 'Incentives' },
]

const SALES_NAV = [
  { to: '/quotes',         icon: FileText,  label: 'Quotes' },
  { to: '/my-performance', icon: BarChart3, label: 'Performance' },
]

export function MobileNav() {
  const { isAdmin } = useAuth()
  const nav = isAdmin ? ADMIN_NAV : SALES_NAV

  return (
    <nav className="mobile-nav">
      {nav.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            'mobile-nav-item' + (isActive ? ' mobile-nav-item--active' : '')
          }
        >
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
