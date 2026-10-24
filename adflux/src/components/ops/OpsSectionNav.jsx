// src/components/ops/OpsSectionNav.jsx
//
// One tab strip across the operations pages for the owner / head, so the six pages read as
// ONE section (before this only /ops-admin was in the sidebar and the rest hid behind buttons).
// Renders nothing for technicians and every other role. Tokens only, Lucide stroke 1.6.

import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Gauge, Tv, MapPin, Activity, UserPlus } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const ITEMS = [
  { to: '/ops-admin',     label: 'Owner view',    icon: LayoutDashboard, adminOnly: true },
  { to: '/ops-command',   label: 'Command center', icon: Gauge },
  { to: '/ops-dashboard', label: 'Live console',  icon: Tv },
  { to: '/ops-station',   label: 'Station board', icon: MapPin },
  { to: '/ops-down',      label: 'Down now',      icon: Activity },
  { to: '/ops-assign',    label: 'Give work',     icon: UserPlus },
]

export default function OpsSectionNav() {
  const role = useAuthStore(s => s.profile?.role)
  const isAdmin = role === 'admin' || role === 'co_owner'
  if (!isAdmin && role !== 'operation_head') return null
  return (
    <nav aria-label="Operations" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      {ITEMS.filter(i => !i.adminOnly || isAdmin).map(i => (
        <NavLink key={i.to} to={i.to} style={({ isActive }) => ({
          display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 14px', borderRadius: 999,
          fontSize: 13, fontWeight: isActive ? 700 : 500, textDecoration: 'none', whiteSpace: 'nowrap',
          background: isActive ? 'var(--surface-3)' : 'transparent',
          color: isActive ? 'var(--text)' : 'var(--text-muted)',
          border: `1px solid ${isActive ? 'var(--border-strong)' : 'var(--border)'}`,
        })}>
          <i.icon size={14} strokeWidth={1.6} />{i.label}
        </NavLink>
      ))}
    </nav>
  )
}
