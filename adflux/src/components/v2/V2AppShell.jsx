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
  // Phase 20 — Voice-First. Reachable from this drawer plus the
  // "Voice" button on each lead detail page.
  { to: '/voice',             label: 'Voice Log',      icon: Mic },
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

// Phase 31K — owner directive (10 May 2026): sales reps land on
// /work now (Plan-A flow). Mobile bottom nav reorders accordingly:
//   Today  → /work     (the new home — plan, check in, do the day)
//   Quotes → /quotes
//   Score  → /my-performance (was 'Perf' pre-31H; reps say "score")
//   Follow → /follow-ups     (NEW — Phase 31K's dedicated screen)
// "Reward" / /my-offer dropped from the thumb-zone — reps check that
// weekly, not daily. Still reachable via the sidebar drawer.
// Dashboard stays accessible via sidebar — it's the "view my numbers"
// page, not the daily-action surface anymore.
// Phase 33A — owner directive (11 May 2026): cut bottom nav to 3 items.
// The persistent IncentiveCard strip (Phase 33A redesign) now carries
// the motivational role that "Score" used to fill in the nav. Follow-ups
// merge into the Today screen's task card. Mobile thumb-zone shows
// only the three actions a rep touches every minute.
const MOBILE_NAV_SALES = [
  { to: '/work',              label: 'Today',          icon: Sun },
  { to: '/leads',             label: 'Leads',          icon: Inbox },
  { to: '/voice',             label: 'Voice',          icon: Mic },
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
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Phase 33B.4 — More drawer for sales reps. Avatar tap opens it.
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
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

  // Phase 12 — nav variants by role.
  // Phase 32F — agency split out into its own variant (external
  // commission partner, not an employee — minimal sidebar without
  // /work, /follow-ups, GPS, or attendance flows).
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
            {/* Phase 31D — owner reported (9 May 2026) the sidebar foot
                only had a "Log out" button. Reps couldn't tell which
                account was active when supporting each other. Added a
                compact identity strip showing name + email above
                Log out so the answer is always one glance away. */}
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
          {/* Phase 33G.4 — hamburger restored for ALL roles on mobile.
              Phase 33F (A5) hid it for sales/agency on the theory that
              the bottom nav + avatar More drawer was enough. Owner
              reported reps couldn't find the avatar (and the More
              drawer behind it), so the long-tail screens (Quotes,
              Clients, My Performance, Follow-ups) were effectively
              orphaned. Bringing the hamburger back gives every role
              one obvious nav surface. The bottom nav still covers the
              hot paths (Today/Leads/Voice for sales). */}
          <button
            className="v2d-hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          {/* Phase 33G (A1, A2) — "SALES CONSOLE" eyebrow killed for
              sales/agency. Greeting "Good evening, {name}" shown
              only on /work for sales reps — repeating it on every
              page navigation was wasteful chrome. Admin / telecaller
              still see both since their workspace is more multi-
              context and the label helps orientation. */}
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

          {/* Phase 31A.3 — global cross-entity literal search. Fast
              path for "find this lead/client/quote by name or number".
              Co-Pilot below is for natural-language pipeline queries. */}
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

          {/* Phase 33G (A4) — "New Quote" button hidden for sales/agency
              except on /quotes routes. Reps create quotes from a
              specific lead via "Convert to quote", not from a global
              header button. Admin keeps the global shortcut. */}
          {(isPrivileged
            || isTelecaller
            || location.pathname.startsWith('/quotes')
          ) && (
            <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
              <Plus size={15} />
              <span>New Quote</span>
            </button>
          )}

          {/* Phase 31A.4 — real notification panel. Aggregates pending
              approvals + due follow-ups + SLA breaches + due actions
              from existing tables; no new schema. */}
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

        {/* Phase 33B.4 — More drawer. Owner audit (11 May 2026)
            flagged: cutting nav to 3 items without giving the dropped
            items a new home was a regression. This sheet opens on
            avatar tap and surfaces Follow-ups, Quotes, Clients, Voice,
            Score, Logout. Sales-only — admin keeps full sidebar. */}
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
          {/* Phase 31O — owner directive (10 May 2026): the Proposed
              Incentive card must be visible on every sales screen so
              reps stay motivated by what they're earning while they
              work. Mounted in the shell so it persists across route
              changes (one fetch on app load, no extra round-trips per
              page nav). Gated to non-privileged + non-telecaller —
              admin/co_owner have their own incentive views, telecaller
              doesn't earn the same incentives. Sales + agency see it. */}
          {/* Phase 33G (C1) — owner audit (11 May): the big purple
              hero on /leads / /follow-ups / lead detail was pushing
              the actual content below the fold. Compact strip is now
              the default everywhere; only /my-performance gets the
              full hero (rep's deep view of their numbers). */}
          {!isPrivileged && !isTelecaller && (
            <div style={{ marginBottom: 12 }}>
              <ProposedIncentiveCard compact={location.pathname !== '/my-performance'} />
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
                {/* Phase 31D — same identity strip as desktop sidebar. */}
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
