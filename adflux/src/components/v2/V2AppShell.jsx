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

import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import CopilotModal from '../copilot/CopilotModal'
import GlobalSearchBar from './GlobalSearchBar'
import NotificationPanel from './NotificationPanel'
import ProposedIncentiveCard from '../incentives/ProposedIncentiveCard'
import { ToastViewport } from './Toast'
import { ConfirmDialogViewport } from './ConfirmDialog'
import IncentiveMiniPill from '../incentives/IncentiveMiniPill'
import { ensurePushOnLogin } from '../../utils/pushNotifications'
import {
  LayoutDashboard, FileText, CheckSquare, Users, Building2,
  Repeat, Gift, LogOut, Search, Bell, Plus, Menu, X,
  TrendingUp, UserCircle2, Contact2, MapPin, Tv, FileBox,
  Inbox, Sparkles, Phone, Sun, Mic, Clock as ClockIcon,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useQuoteStore } from '../../store/quoteStore'
import { initials } from '../../utils/formatters'
import '../../styles/v2.css'

/* ─── Nav definitions ─── */
// PRIVILEGED = admin / owner / co_owner — full access including the
// new Government master pages (Auto Districts + GSRTC Stations).
const ADMIN_NAV = [
  // Phase 12 rev3 — owner spec: ONE landing page, not two. Cockpit
  // widgets folded into AdminDashboardDesktop.
  { to: '/dashboard',         label: 'Dashboard',      icon: LayoutDashboard },
  // Phase 16 — lead pipeline overview + live team field view.
  { to: '/lead-dashboard',    label: 'Lead Pipeline',  icon: TrendingUp },
  { to: '/team-dashboard',    label: 'Team Live',      icon: Users },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/clients',           label: 'Clients',        icon: Contact2 },
  { to: '/pending-approvals', label: 'Approvals',      icon: CheckSquare },
  { to: '/cities',            label: 'Cities',         icon: Building2 },
  { to: '/auto-districts',    label: 'Auto Districts', icon: MapPin },
  { to: '/gsrtc-stations',    label: 'GSRTC Stations', icon: Tv },
  { to: '/master',            label: 'Master',         icon: FileBox },
  { to: '/team',              label: 'Team',           icon: Users },
  { to: '/hr',                label: 'HR',             icon: UserCircle2 },
  // Phase 33G.8 — admin Leaves (item 82). Sits next to HR since it's
  // the same operational neighbourhood.
  { to: '/admin/leaves',      label: 'Leaves',         icon: ClockIcon },
  // Phase 33H — TA (travel allowance) auto-computed from GPS pings.
  { to: '/admin/ta-payouts',  label: 'TA Payouts',     icon: TrendingUp },
  { to: '/renewal-tools',     label: 'Renewals',       icon: Repeat },
  { to: '/incentives',        label: 'Incentives',     icon: Gift },
]

const SALES_NAV = [
  // Phase 31K — Plan-A: /work is the sales home now. Order reflects
  // daily flow: plan day → see follow-ups → work leads → send quotes.
  // Dashboard moved further down (still reachable for incentive
  // numbers but not the daily landing).
  { to: '/work',              label: 'Today',          icon: Sun },
  { to: '/follow-ups',        label: 'Follow-ups',     icon: ClockIcon },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/clients',           label: 'Clients',        icon: Contact2 },
  // Phase 33N — owner directive: voice is no longer a standalone
  // surface. Voice input lives inside the Note activity modal
  // (LogActivityModal) where reps already record free-text notes.
  // The dedicated /voice page and 'Voice' tab were causing confusion
  // ('what do I do here?'). Note flow handles voice transcription
  // as a single tap inside an action they already understand.
  { to: '/dashboard',         label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/my-performance',    label: 'My Performance', icon: TrendingUp },
  { to: '/renewal-tools',     label: 'Renewals',       icon: Repeat },
  { to: '/my-offer',          label: 'My Offer',       icon: FileText },
]

// Phase 32F (10 May 2026) — agency role is an external commission
// partner per owner spec, NOT an employee. They don't get the daily
// plan flow, GPS, or attendance — they're here only to create govt
// quotes (and private later). Sidebar is tight: just the quote-
// creation + tracking + their own commission view.
//   • No /work (no morning plan / GPS)
//   • No /follow-ups, /leads, /clients (those are rep-owned workflows)
//   • No /voice (voice is for in-field reps logging activities)
//   • No /dashboard (their KPIs aren't ours)
// Kept: Quotes (where they spend most of their time), My Performance
// (so they can see their commission earnings), My Offer (their %
// scheme).
const AGENCY_NAV = [
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/my-performance',    label: 'My Earnings',    icon: TrendingUp },
  { to: '/my-offer',          label: 'My Offer',       icon: FileText },
]

// Telecaller-specific nav: queue-first, lighter than the full sales nav.
// Phase 28c — owner correction (7 May 2026): telecallers DO escalate
// leads to quotes and need to track their own clients (Rima reported
// not seeing Quotes / Clients tabs after she upgraded a lead). Added
// both with the same routes as sales — RLS scopes them to the
// telecaller's own rows. Order matches sales for muscle memory.
// Phase 31D — owner reported (9 May 2026) telecaller sidebar had no
// Dashboard entry. Added at the top so reps can see the same
// pipeline / KPI / leaderboard widgets the sales role gets.
const TELECALLER_NAV = [
  { to: '/dashboard',         label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/telecaller',        label: 'Call Queue',     icon: Phone },
  { to: '/work',              label: 'Today',          icon: Sun },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/clients',           label: 'Clients',        icon: Contact2 },
  // Phase 20 — telecallers benefit even more from voice logging.
  { to: '/voice',             label: 'Voice Log',      icon: Mic },
  { to: '/my-performance',    label: 'My Performance', icon: TrendingUp },
]

const MOBILE_NAV_ADMIN = [
  { to: '/dashboard',         label: 'Home',           icon: LayoutDashboard },
  { to: '/pending-approvals', label: 'Approve',        icon: CheckSquare },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
  { to: '/team',              label: 'Team',           icon: Users },
]

// Phase 35 PR 2 — locked to 4 tabs. /work now sticky-mounts the
// "Log meeting" CTA at the bottom of its scroll area (Task 6), so
// the dedicated "New" tab is redundant. CLAUDE.md §3 (modules not
// patches): nav count fluctuated 3 → 4 → 5 across Phase 33A /
// 33J / 34Z.2; this is the stable shape.
const MOBILE_NAV_SALES = [
  { to: '/work',              label: 'Today',          icon: Sun },
  { to: '/follow-ups',        label: 'Follow-ups',     icon: ClockIcon },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/quotes',            label: 'Quotes',         icon: FileText },
]

// Phase 31G — owner reported (9 May 2026) Dhara (telecaller) was
// getting MOBILE_NAV_SALES on her phone, which doesn't include Call
// Queue or Today — her two most-used screens. Telecaller now has a
// dedicated mobile bottom nav matching her sidebar's top entries
// (Today / Queue / Leads / Voice). Drops Quotes / Perf / Offer from
// the mobile thumb-zone — telecallers rarely create quotes from
// mobile and can still reach those via the sidebar drawer.
const MOBILE_NAV_TELECALLER = [
  { to: '/work',              label: 'Today',          icon: Sun },
  { to: '/telecaller',        label: 'Queue',          icon: Phone },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/voice',             label: 'Voice',          icon: Mic },
]

export function V2AppShell() {
  const { user, profile, isPrivileged, signOut } = useAuth()

  // Apply the rep's persisted theme preference on mount; CSS keys
  // off `<html data-theme="day">` in v2.css.
  useEffect(() => {
    try {
      const t = localStorage.getItem('theme') || 'night'
      document.documentElement.setAttribute('data-theme', t)
    } catch { /* localStorage blocked — leave attr empty, defaults to night */ }
  }, [])

  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Avatar-tap "More" drawer (overflow nav for sales).
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')

  // Track viewport size so the topbar can hide the IncentiveMiniPill
  // on mobile and the ToastViewport can clear the bottom nav.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(max-width: 860px)')
    const update = () => setIsMobile(mql.matches)
    update()
    if (mql.addEventListener) mql.addEventListener('change', update)
    else mql.addListener(update)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', update)
      else mql.removeListener(update)
    }
  }, [])
  // Phase 34Z.69 — fix #4: enroll push subscription on EVERY page
  // mount, not just /work. Reps who land directly on /leads/:id or
  // /follow-ups never used to get prompted; now they do. Returns a
  // status so the UI can decide whether to show the enrollment chip
  // (fix #15).
  const [pushStatus, setPushStatus] = useState('unknown')
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ensurePushOnLogin(profile.id).then((s) => {
      if (!cancelled) setPushStatus(s || 'unknown')
    }).catch(() => { if (!cancelled) setPushStatus('error') })
    return () => { cancelled = true }
  }, [profile?.id])

  // Phase 1.5 — AI Co-Pilot. Cmd+K (Mac) / Ctrl+K (Win/Linux) opens.
  const [copilotOpen, setCopilotOpen] = useState(false)
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCopilotOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Nav variants by role:
  //   admin / co_owner → ADMIN_NAV (full chrome including govt masters)
  //   telecaller       → TELECALLER_NAV (queue-first, minimal)
  //   agency           → AGENCY_NAV (Quotes + Earnings + Offer only)
  //   sales            → SALES_NAV (full daily flow)
  const isTelecaller = profile?.team_role === 'telecaller'
  const isAgency     = profile?.role === 'agency'
  const nav =
    isPrivileged   ? ADMIN_NAV :
    isTelecaller   ? TELECALLER_NAV :
    isAgency       ? AGENCY_NAV :
                     SALES_NAV
  // Mobile bottom nav — telecaller + agency get tighter nav rows.
  // Agency mobile mirrors the sidebar (3 items + a hidden 4th slot
  // for visual balance — empty slot kept since agency is desktop-
  // mostly anyway).
  const mobileNav =
    isPrivileged   ? MOBILE_NAV_ADMIN :
    isTelecaller   ? MOBILE_NAV_TELECALLER :
    isAgency       ? AGENCY_NAV :
                     MOBILE_NAV_SALES

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
            <div className="v2d-brand-t">Untitled OS</div>
            <div className="v2d-brand-s">{
              isPrivileged ? 'Admin'
              : isTelecaller ? 'Telecaller'
              : isAgency ? 'Agency'
              : 'Sales'
            }</div>
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
            <div className="v2d-side-me" title={user?.email || ''}>
              <div className="v2d-side-me-av">{initials(profile?.name || 'U')}</div>
              <div className="v2d-side-me-text">
                <div className="v2d-side-me-name">{profile?.name || 'User'}</div>
                <div className="v2d-side-me-mail">{user?.email || '—'}</div>
              </div>
            </div>
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
          <button
            className="v2d-hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          <div className="v2d-crumb">
            {(isPrivileged || isTelecaller) && (
              <div className="v2d-crumb-kicker">
                {isPrivileged ? 'Admin Console'
                  : isTelecaller ? 'Telecaller Console'
                  : 'Sales Console'}
              </div>
            )}
            {(isPrivileged || isTelecaller || location.pathname === '/work') && (
              <div className="v2d-crumb-t">
                {greetingFor(profile)}
              </div>
            )}
          </div>

          <div className="v2d-topbar-spacer" />

          <GlobalSearchBar />

          {/* Phase 1.5 — Co-Pilot trigger. Click or ⌘K opens the AI
              modal for NL queries ('how much did Sondarva close last
              month?'). The literal lookup lives in GlobalSearchBar
              just above. */}
          <button
            className="v2d-search"
            onClick={() => setCopilotOpen(true)}
            style={{ cursor: 'pointer', textAlign: 'left', minWidth: 180, maxWidth: 240 }}
            type="button"
          >
            <Sparkles size={14} style={{ color: '#c084fc' }} />
            <span style={{ flex: 1, color: 'var(--v2-ink-2)', fontSize: 13 }}>
              Ask AI…
            </span>
            <span style={{
              fontFamily: 'monospace', fontSize: 10,
              background: 'rgba(255,255,255,.06)',
              padding: '2px 6px', borderRadius: 4,
              color: 'var(--v2-ink-2)',
            }}>
              ⌘K
            </span>
          </button>

          {(isPrivileged
            || isTelecaller
            || location.pathname.startsWith('/quotes')
          ) && (
            <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
              <Plus size={15} />
              <span>New Quote</span>
            </button>
          )}

          {!isMobile && <IncentiveMiniPill />}

          {/* Phase 34Z.69 — fix #15: push-enrollment chip. Shown only
              when the rep hasn't granted permission yet AND the
              browser supports push. Tap → /push-debug to enable. */}
          {(pushStatus === 'no-permission' || pushStatus === 'no-subscription') && (
            <button
              type="button"
              onClick={() => navigate('/push-debug')}
              title="Enable push notifications on this device"
              style={{
                background: 'var(--warning-soft, rgba(245,158,11,0.16))',
                border: '1px solid var(--warning, #F59E0B)',
                color: 'var(--text)',
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 11, fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              Enable push
            </button>
          )}

          <NotificationPanel />

          <div
            className="v2d-me"
            onClick={() => setMoreOpen(true)}
            style={{ cursor: 'pointer' }}
            title="More options"
          >
            <div className="v2d-me-av">{initials(profile?.name || 'U')}</div>
            <div>
              <div className="v2d-me-name">{profile?.name || 'User'}</div>
              <div className="v2d-me-role">{
                isPrivileged ? 'Admin'
                : isTelecaller ? 'Telecaller'
                : isAgency ? 'Agency'
                : 'Sales'
              }</div>
            </div>
          </div>
        </header>

        {/* Avatar-tap "More" drawer — surfaces overflow nav items. */}
        {moreOpen && (
          <div className="more-drawer-back" onClick={() => setMoreOpen(false)}>
            <div className="more-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="more-drawer-handle" />
              <div className="more-drawer-head">More</div>
              <button className="more-drawer-link" onClick={() => { setMoreOpen(false); navigate('/follow-ups') }}>
                <ClockIcon size={18} /> <span>Follow-ups</span>
              </button>
              <button className="more-drawer-link" onClick={() => { setMoreOpen(false); navigate('/quotes') }}>
                <FileText size={18} /> <span>Quotes</span>
              </button>
              <button className="more-drawer-link" onClick={() => { setMoreOpen(false); navigate('/clients') }}>
                <Users size={18} /> <span>Clients</span>
              </button>
              <button className="more-drawer-link" onClick={() => { setMoreOpen(false); navigate('/my-performance') }}>
                <TrendingUp size={18} /> <span>Score</span>
              </button>
              <button className="more-drawer-link" onClick={() => { setMoreOpen(false); signOut(); navigate('/login') }}>
                <LogOut size={18} /> <span>Log out</span>
              </button>
            </div>
          </div>
        )}

        <div className="v2d-content">
          {/* ProposedIncentiveCard — sales / agency only.
              Phase 34Z.58 (15 May 2026) — owner directive: "proposed
              incentive card needed in every tab, fixed." Dropped the
              compact-pill / full-hero split — full card now renders on
              every rep-facing tab. Only /quotes/:id and /quotes/new
              still hide it because those pages mount their own per-
              quote IncentiveForecastCard right under the totals. */}
          {!isPrivileged && !isTelecaller
            && !location.pathname.startsWith('/quotes/')
            && location.pathname !== '/quotes/new' && (
            <div style={{ marginBottom: 12 }}>
              <ProposedIncentiveCard compact={false} />
            </div>
          )}
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
                  <div className="v2d-brand-t">Untitled OS</div>
                  <div className="v2d-brand-s">{
              isPrivileged ? 'Admin'
              : isTelecaller ? 'Telecaller'
              : isAgency ? 'Agency'
              : 'Sales'
            }</div>
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
                <div className="v2d-side-me" title={user?.email || ''}>
                  <div className="v2d-side-me-av">{initials(profile?.name || 'U')}</div>
                  <div className="v2d-side-me-text">
                    <div className="v2d-side-me-name">{profile?.name || 'User'}</div>
                    <div className="v2d-side-me-mail">{user?.email || '—'}</div>
                  </div>
                </div>
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

      {/* Phase 1.5 — Co-Pilot modal (Cmd+K) */}
      <CopilotModal open={copilotOpen} onClose={() => setCopilotOpen(false)} />

      {/* Global toast viewport — bottomGap clears the mobile bottom nav. */}
      <ToastViewport bottomGap={isMobile ? 76 : 16} />

      {/* Promise-based confirm dialog viewport. */}
      <ConfirmDialogViewport />
    </div>
  )
}

// Phase 34Z.1 (13 May 2026) — owner asked for an emoji with the
// greeting on mobile so the top of the page feels alive instead of
// flat-text-pretending-to-be-a-greeting. Picked weather-style icons
// (sun / partly-cloudy / moon) for the three time bands so the icon
// reinforces the time of day without being childish.
// Phase 34Z.1 — exported so WorkV2 (which renders its own greeting
// inside the page body, not via the topbar) uses the SAME emoji
// variant. Previously WorkV2 hardcoded 'Good morning, ' so the page
// greeting drifted from the topbar greeting.
export function greetingFor(profile) {
  const first = (profile?.name || '').split(' ')[0] || 'there'
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${first} ☀️`
  if (h < 17) return `Good afternoon, ${first} ⛅`
  return `Good evening, ${first} 🌙`
}
