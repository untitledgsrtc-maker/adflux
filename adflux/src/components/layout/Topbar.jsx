// src/components/layout/Topbar.jsx
//
// Sticky page header. Shows:
//   - Page title (derived from route)
//   - Context actions (e.g. "New Quote" on /quotes)
//   - User avatar chip on the right
//
// The route-to-title map lives here so we don't need per-page boilerplate.

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, LogOut } from 'lucide-react'
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
  const { profile, signOut } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const title =
    TITLES[pathname] ??
    (pathname.startsWith('/quotes/') ? 'Quote Detail' : 'Untitled Adflux')

  const initial = profile?.name?.[0]?.toUpperCase() || 'U'

  // Avatar menu (contains Sign Out). Needed because on mobile the
  // sidebar is hidden — sales + admin users had no way to log out
  // from a phone. Desktop users can still use the sidebar button;
  // this just duplicates access from the top-right.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

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

        <div className="topbar-avatar-wrap" ref={menuRef}>
          <button
            type="button"
            className="topbar-avatar"
            title={profile?.name || ''}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          >
            {initial}
          </button>
          {menuOpen && (
            <div className="topbar-avatar-menu" role="menu">
              <div className="topbar-avatar-menu-header">
                <div className="topbar-avatar-menu-name">{profile?.name || '—'}</div>
                <div className="topbar-avatar-menu-role">{profile?.role || 'user'}</div>
              </div>
              <button
                type="button"
                className="topbar-avatar-menu-item"
                onClick={() => { setMenuOpen(false); signOut() }}
                role="menuitem"
              >
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
