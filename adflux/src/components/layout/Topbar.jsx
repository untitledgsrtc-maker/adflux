// src/components/layout/Topbar.jsx
//
// Sticky page header. Shows:
//   - Page title (derived from route)
//   - Context actions (e.g. "New Quote" on /quotes)
//   - User avatar chip on the right
//
// The route-to-title map lives here so we don't need per-page boilerplate.

import { useLocation, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

const TITLES = {
  '/dashboard':      'Dashboard',
  '/quotes':         'Quotes',
  '/quotes/new':     'New Quote',
  '/cities':         'Cities',
  '/team':           'Team',
  '/incentives':     'Incentives',
  '/my-performance': 'My Performance',
}

export function Topbar() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const title =
    TITLES[pathname] ??
    (pathname.startsWith('/quotes/') ? 'Quote Detail' : 'Untitled Adflux')

  const initial = profile?.name?.[0]?.toUpperCase() || 'U'

  return (
    <header className="topbar">
      <h1 className="topbar-title">{title}</h1>

      <div className="topbar-actions">
        {pathname === '/quotes' && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/quotes/new')}
          >
            <Plus size={15} />
            <span>New Quote</span>
          </button>
        )}

        <div className="topbar-avatar" title={profile?.name || ''}>
          {initial}
        </div>
      </div>
    </header>
  )
}
