// src/components/v2/V2AppShell.jsx
//
// Shared v2 chrome for inner pages — Quotes, Quote detail,
// My Performance, My Offer, and future Batch C pages.
//
// Why this file exists:
//   SalesDashboardDesktop / AdminDashboardDesktop each render
//   their own inline sidebar because their topbar is custom
//   (streak pill, incentive hero, period switcher). The *other*
//   v2 pages share a uniform chrome — same left nav, same
//   search/bell/profile topbar, same mobile bottom-nav — so
//   we centralize it here instead of duplicating it per page.
//
// The wrapper root carries the `v2d` class so every descendant
// picks up the v2 tokens from v2.css — no component needs to
// repeat that class.
//
// Usage (see src/App.jsx):
//   <Route element={<RequireAuth><V2AppShell /></RequireAuth>}>
//     <Route path="/quotes" element={<QuotesV2 />} />
//     ...
//   </Route>
//
// Mobile (<860px): sidebar is replaced by a slide-in drawer
// (hamburger) + a fixed 4-item bottom nav. This mirrors the
// Dashboard pages so the two halves of the app feel consistent.

import { useState } from 'react'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import {
  LayoutDashboard, FileText, CheckSquare, Users, Building2,
  Repeat, Gift, LogOut, Search, Bell, Plus, Menu, X,
  TrendingUp, UserCircle2, Contact2, MapPin, Tv,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useQuoteStore } from '../../store/quoteStore'
import { initials } from '../../utils/formatters'
import '../../styles/v2.css'

/* ─── Nav definitions ─── */
// PRIVILEGED = admin / owner / co_owner — full access including the
// new Government master pages (Auto Districts + GSRTC Stations).
const ADMIN_NAV = [
  { to: '/dashboard',         label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/clients',           label: 'Clients',        icon: Contact2 },
  { to: '/pending-approvals', label: 'Approvals',      icon: CheckSquare },
  { to: '/cities',            label: 'Cities',         icon: Building2 },
  { to: '/auto-districts',    label: 'Auto Districts', icon: MapPin },
  { to: '/gsrtc-stations',    label: 'GSRTC Stations', icon: Tv },
  { to: '/team',              label: 'Team',           icon: Users },
  { to: '/hr',                label: 'HR',             icon: UserCircle2 },
  { to: '/renewal-tools',     label: 'Renewals',       icon: Repeat },
  { to: '/incentives',        label: 'Incentives',     icon: Gift },
]

const SALES_NAV = [
  { to: '/dashboard',         label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/clients',           label: 'Clients',        icon: Contact2 },
  { to: '/my-performance',    label: 'My Performance', icon: TrendingUp },
  { to: '/renewal-tools',     label: 'Renewals',       icon: Repeat },
  { to: '/my-offer',          label: 'My Offer',       icon: FileText },
]

const MOBILE_NAV_ADMIN = [
  { to: '/dashboard',         label: 'Home',           icon: LayoutDashboard },
  { to: '/pending-approvals', label: 'Approve',        icon: CheckSquare },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/team',              label: 'Team',           icon: Users },
]

const MOBILE_NAV_SALES = [
  { to: '/dashboard',         label: 'Home',           icon: LayoutDashboard },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/my-performance',    label: 'Perf',           icon: TrendingUp },
  { to: '/my-offer',          label: 'Offer',          icon: FileText },
]

export function V2AppShell() {
  const { profile, isPrivileged, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')

  // PRIVILEGED set (admin / owner / co_owner) gets the full admin
  // sidebar incl. the new Auto Districts + GSRTC Stations.
  const nav       = isPrivileged ? ADMIN_NAV        : SALES_NAV
  const mobileNav = isPrivileged ? MOBILE_NAV_ADMIN : MOBILE_NAV_SALES

  // Topbar search — commits to the shared quote-filter store and
  // jumps to /quotes. Keeps the field as a global quick-search so
  // users can lookup a client from anywhere in the app.
  function runTopbarSearch(e) {
    if (e && e.preventDefault) e.preventDefault()
    const q = searchDraft.trim()
    if (!q) return
    useQuoteStore.getState().setFilters({ search: q, status: '' })
    setSearchDraft('')
    navigate('/quotes')
  }

  function isActive(to) {
    // Quote detail paths (/quotes/123) should also mark /quotes active.
    if (to === '/quotes') {
      return location.pathname === '/quotes' || location.pathname.startsWith('/quotes/')
    }
    return location.pathname === to
  }

  async function handleLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="v2d v2d-app">
      {/* ─── Sidebar (desktop) ─────────────────────────── */}
      <aside className="v2d-side">
        <div className="v2d-brand">
          <span className="v2d-brand-mark">UA</span>
          <div>
            <div className="v2d-brand-t">Adflux</div>
            <div className="v2d-brand-s">{isAdmin ? 'Admin' : 'Sales'}</div>
          </div>
        </div>

        <nav className="v2d-nav">
          {nav.map(item => {
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className={isActive(item.to) ? 'is-active' : ''}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </Link>
            )
          })}
          <div className="v2d-nav-spacer" />
          <div className="v2d-nav-foot">
            <button onClick={handleLogout}>
              <LogOut size={16} />
              <span>Log out</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* ─── Main ─────────────────────────────────────── */}
      <main className="v2d-main">
        <header className="v2d-topbar">
          {/* Mobile hamburger — opens drawer */}
          <button
            className="v2d-hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          <div className="v2d-crumb">
            <div className="v2d-crumb-kicker">
              {isAdmin ? 'Admin Console' : 'Sales Console'}
            </div>
            <div className="v2d-crumb-t">
              {greetingFor(profile)}
            </div>
          </div>

          <div className="v2d-topbar-spacer" />

          <form className="v2d-search" onSubmit={runTopbarSearch}>
            <Search size={15} />
            <input
              placeholder="Search quotes, clients…"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') runTopbarSearch(e)
                if (e.key === 'Escape') setSearchDraft('')
              }}
            />
          </form>

          <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
            <Plus size={15} />
            <span>New Quote</span>
          </button>

          <button
            className="v2d-bell"
            aria-label="Notifications"
            title="Notifications — coming soon"
            onClick={() => alert('Notifications are coming in the next release.')}
          >
            <Bell size={17} />
          </button>

          <div className="v2d-me">
            <div className="v2d-me-av">{initials(profile?.name || 'U')}</div>
            <div>
              <div className="v2d-me-name">{profile?.name || 'User'}</div>
              <div className="v2d-me-role">{isAdmin ? 'Admin' : 'Sales'}</div>
            </div>
          </div>
        </header>

        <div className="v2d-content">
          <Outlet />
        </div>
      </main>

      {/* ─── Mobile drawer (sidebar replacement <860px) ─ */}
      {drawerOpen && (
        <div className="v2d-mdrawer" onClick={() => setDrawerOpen(false)}>
          <aside
            className="v2d-mdrawer-inner"
            onClick={e => e.stopPropagation()}
          >
            <div className="v2d-mdrawer-head">
              <div className="v2d-brand">
                <span className="v2d-brand-mark">UA</span>
                <div>
                  <div className="v2d-brand-t">Adflux</div>
                  <div className="v2d-brand-s">{isAdmin ? 'Admin' : 'Sales'}</div>
                </div>
              </div>
              <button
                className="v2d-mdrawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="v2d-nav">
              {nav.map(item => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={isActive(item.to) ? 'is-active' : ''}
                    onClick={() => setDrawerOpen(false)}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
              <div className="v2d-nav-spacer" />
              <div className="v2d-nav-foot">
                <button onClick={handleLogout}>
                  <LogOut size={16} />
                  <span>Log out</span>
                </button>
              </div>
            </nav>
          </aside>
        </div>
      )}

      {/* ─── Mobile bottom nav ─ */}
      <nav className="v2d-mnav">
        <div
          className="v2d-mnav-items"
          style={{ '--cols': mobileNav.length }}
        >
          {mobileNav.map(item => {
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`v2d-mnav-item${isActive(item.to) ? ' v2d-mnav-item--active' : ''}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

function greetingFor(profile) {
  const first = (profile?.name || '').split(' ')[0] || 'there'
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${first}`
  if (h < 17) return `Good afternoon, ${first}`
  return `Good evening, ${first}`
}
