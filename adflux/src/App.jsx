import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { V2AppShell } from './components/v2/V2AppShell'
import Login from './pages/Login'
// Public candidate-facing offer form — NO auth, NO shell.
import OfferForm from './pages/OfferForm'
// Quote detail was preserved as-is (837-line payment approval logic
// must not be refactored with the shell cut-over).
import QuoteDetail from './pages/QuoteDetail'
// v2 dashboard switcher (owns its own chrome; not under V2AppShell).
import DashboardV2 from './pages/v2/DashboardV2'
// v2 inner pages — all share V2AppShell via react-router Outlet.
import QuotesV2           from './pages/v2/QuotesV2'
import MyPerformanceV2    from './pages/v2/MyPerformanceV2'
import CheckInV2          from './pages/v2/CheckInV2'   // Phase 60
import CheckInGate        from './components/v2/CheckInGate'   // Phase 60
import ManagerDashboardV2 from './pages/v2/ManagerDashboardV2' // Phase 61
import TeamManagerAssignV2 from './pages/v2/TeamManagerAssignV2' // Phase 61
import MyOfferV2          from './pages/v2/MyOfferV2'
import CreateQuoteV2      from './pages/v2/CreateQuoteV2'
import CreateQuoteOtherMediaV2 from './pages/v2/CreateQuoteOtherMediaV2'
import CitiesV2           from './pages/v2/CitiesV2'
import TeamV2             from './pages/v2/TeamV2'
import IncentivesV2       from './pages/v2/IncentivesV2'
import RenewalToolsV2     from './pages/v2/RenewalToolsV2'
import PendingApprovalsV2 from './pages/v2/PendingApprovalsV2'
import HRV2               from './pages/v2/HRV2'
import HRNewUserV2        from './pages/v2/HRNewUserV2'
import HROfferLetterV2    from './pages/v2/HROfferLetterV2'
import CallLogsV2         from './pages/v2/CallLogsV2'
// Phase 33G.8 — admin Leaves page (item 82 real leaves table).
import LeavesAdminV2     from './pages/v2/LeavesAdminV2'
// Phase 36 — per-rep monthly salary breakdown.
import SalaryAdminV2     from './pages/v2/SalaryAdminV2'
// Phase 38 — People module (Team + Incentives + Salary + Leaves tabs).
import PeopleV2          from './pages/v2/PeopleV2'
// Phase 90 (2026-05-23) — admin rep profile drill-down.
import RepProfileV2      from './pages/v2/RepProfileV2'
// Phase 33H — admin TA Payouts (GPS-driven travel allowance).
import TaPayoutsAdminV2  from './pages/v2/TaPayoutsAdminV2'
// Phase 101.A3 JSX — agency commission payout admin page.
import AgencyCommissionAdminV2 from './pages/v2/AgencyCommissionAdminV2'
import ClientsV2          from './pages/v2/ClientsV2'
// ── Phase 12 — M1 Sales/Lead module ─────────────────────────────────
import LeadsV2             from './pages/v2/LeadsV2'
import LeadDashboardV2     from './pages/v2/LeadDashboardV2'
import TeamDashboardV2     from './pages/v2/TeamDashboardV2'
import LeadDetailV2        from './pages/v2/LeadDetailV2'
import LeadFormV2          from './pages/v2/LeadFormV2'
import LeadUploadV2        from './pages/v2/LeadUploadV2'
import WorkV2              from './pages/v2/WorkV2'
import MessagesV2          from './pages/v2/MessagesV2'
import PushDebugV2         from './pages/v2/PushDebugV2'
import TelecallerV2        from './pages/v2/TelecallerV2'
import ErrorBoundary       from './components/v2/ErrorBoundary'
import VoiceLogV2          from './pages/v2/VoiceLogV2'
import FollowUpsV2         from './pages/v2/FollowUpsV2'
import EveningVoiceV2      from './pages/v2/EveningVoiceV2'
// Phase 12 rev3 — CockpitV2 retired; widgets folded into AdminDashboardDesktop.

// ── Government module (Phase 6) ─────────────────────────────────────
import CreateQuoteChooserV2  from './pages/v2/CreateQuoteChooserV2'
import CreateGovtAutoHoodV2  from './pages/v2/CreateGovtAutoHoodV2'
import CreateGovtGsrtcLedV2  from './pages/v2/CreateGovtGsrtcLedV2'
import AutoDistrictsV2       from './pages/v2/AutoDistrictsV2'
import GsrtcStationsV2       from './pages/v2/GsrtcStationsV2'
import GovtProposalDetailV2  from './pages/v2/GovtProposalDetailV2'
import GpsTrackV2            from './pages/v2/GpsTrackV2'
import MasterV2              from './pages/v2/MasterV2'
// Phase 35 PR 1 — admin-only primitives demo (sign-off gate before PR 2).
import PrimitivesDemoV2      from './pages/v2/PrimitivesDemoV2'
import SettingsV2            from './pages/v2/SettingsV2'

function LoadingScreen() {
  return <div className="loading-screen"><div className="spinner" /></div>
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequireAdmin({ children }) {
  const { isAdmin, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!isAdmin) return <Navigate to="/quotes" replace />
  return children
}

/* Privileged set = admin / owner / co_owner. Used to gate master
   pages and admin-only pieces of the new govt module. */
function RequirePrivileged({ children }) {
  const { isPrivileged, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!isPrivileged) return <Navigate to="/quotes" replace />
  return children
}

/* Phase 87.5b (2026-05-28) — narrow guard for the HR sign-off
   surface on /people/:userId. Admin / co_owner / hr only. HR
   was previously bounced from RepProfileV2 because the route was
   RequirePrivileged (admin + co_owner). This guard widens by ONE
   role (hr) for this route ONLY — global RequirePrivileged stays
   admin + co_owner. */
function RequireHROrPrivileged({ children }) {
  const { isPrivileged, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  const isHR = profile?.role === 'hr'
  if (!isPrivileged && !isHR) return <Navigate to="/quotes" replace />
  return children
}

/* Phase 61 (19 May 2026) — Manager guard. Gates `/manager` route to
   team leads (team_role='sales_manager') and admins. Non-managers
   bounce to their role's home via RootRedirect. */
function RequireManager({ children }) {
  const { isPrivileged, isManager, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!isPrivileged && !isManager) return <Navigate to="/" replace />
  return children
}

/* Govt-segment guard. Used by the Government wizard so a Private-only
   sales rep can't reach it via direct URL. ALL or GOVERNMENT is OK. */
function RequireGovtAccess({ children }) {
  const { segmentAccess, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (segmentAccess !== 'ALL' && segmentAccess !== 'GOVERNMENT') {
    return <Navigate to="/quotes" replace />
  }
  return children
}

/* Phase 100.D (2026-05-29) — agency exclusion from lead surface.
   Owner directive: agency role is external commission partner per
   Phase 11g + 101.A/B/C — they create quotes, see their commission
   ledger, sign their own govt proposals. They do NOT participate in
   the rep-facing lead workflow (LeadsV2 / LeadFormV2 / LeadDetailV2).
   Pre-Phase 100.D the lead routes were only RequireAuth-gated, so
   agency could deep-link them. Phase 100.B widened the reassign
   picker fetch which made the lead surface visually more functional
   for agency than intended (F-R200 from Phase 100.B audit).
   Redirects to /dashboard → DashboardV2 switcher → AgencyHomeView
   (Phase 101.B). */
function RequireNonAgency({ children }) {
  const { isAgency, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (isAgency) return <Navigate to="/dashboard" replace />
  return children
}

function RootRedirect() {
  const { user, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  // Phase 32F (10 May 2026) — agency role landing changed.
  // Owner spec: 'agency is not employee of our company so we don't
  // need any track from them, they just create quotes for govt
  // (and in future private), we share them % from their sales.'
  // Agency users now land on /quotes (their workspace). They get NO
  // /work flow, no GPS, no morning plan, no attendance counters.
  //
  // Routing:
  //   admin / co_owner → /dashboard (full admin console)
  //   telecaller       → /telecaller (their queue is their workspace)
  //   sales            → /work       (Plan-A morning plan flow)
  //   agency           → /quotes     (govt quote creation only)
  //   anything else    → /dashboard
  // Phase 33B.3 (11 May 2026) — owner reported login lands on
  // /dashboard for sales reps not /work. Root cause: the previous
  // logic only checked `profile.role`, but per the established
  // pattern (LeadFormV2, LogActivityModal, ChangeStageModal), sales/
  // agency/telecaller distinctions live on `team_role`, while
  // `role` is reserved for admin/co_owner gating. A sales user
  // commonly has `role='user'` or null with `team_role='sales'` —
  // the old check fell through to /dashboard. Fix: check team_role
  // first, then fall back to role for admin/co_owner.
  const role     = profile?.role
  const teamRole = profile?.team_role
  // Phase 61 (19 May 2026) — sales_manager (Jubin + Renuka) lands
  // on /manager (their team-lead dashboard). Branch BEFORE the base
  // role checks so a sales-flavored manager doesn't fall through
  // to /work and a TC-flavored manager doesn't fall through to
  // /telecaller. They can still reach /work or /telecaller from
  // their sidebar — the landing just defaults to the team view.
  if (teamRole === 'sales_manager')               return <Navigate to="/manager" replace />
  if (teamRole === 'telecaller')                  return <Navigate to="/telecaller" replace />
  if (teamRole === 'sales' || role === 'sales')   return <Navigate to="/work" replace />
  // Phase 101.B — agency now lands on /dashboard (DashboardV2
  // switcher routes them to AgencyHomeView). Was /quotes per
  // Phase 32F; the Home dashboard gives them KPI overview +
  // commission summary in one place. Phase 101.A2 work
  // (AgencyEarningsView ledger + AgencyOfferView) reachable via
  // bottom-nav Earnings + Offer tabs.
  if (teamRole === 'agency' || role === 'agency') return <Navigate to="/dashboard" replace />
  return <Navigate to="/dashboard" replace />
}

export default function App() {
  useAuth()
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Public candidate-facing offer form — NO AppShell, NO auth. */}
        <Route path="/offer/:token" element={<OfferForm />} />

        <Route path="/" element={<RootRedirect />} />

        {/* Phase 60 — attendance check-in landing. Authenticated but
            outside V2AppShell (no sidebar / topbar). CheckInGate
            inside V2AppShell redirects sales + telecaller reps here
            on app open until they've checked in today. */}
        <Route path="/check-in" element={<RequireAuth><CheckInV2 /></RequireAuth>} />

        {/* ─── v2 inner pages (share V2AppShell chrome) ───
            Phase 18 — /dashboard moved INSIDE V2AppShell so it shares
            the same sidebar (Lead Pipeline, Team Live, Leads, etc) as
            every other page. Previously it sat outside and rendered
            its own chrome which dropped the new nav links.
            Phase 60 — V2AppShell wrapped in CheckInGate so the gate
            runs on every authenticated page mount; the gate only
            applies to sales + telecaller roles. */}
        <Route element={<RequireAuth><CheckInGate><V2AppShell /></CheckInGate></RequireAuth>}>
          <Route path="/dashboard"    element={<DashboardV2 />} />
          <Route path="/v2/dashboard" element={<DashboardV2 />} />
          {/* Shared — admin + sales */}
          <Route path="/quotes"                    element={<QuotesV2 />} />
          {/* Phase 94 (26 May 2026) — path-param edit / renew routes.
              MUST be registered BEFORE /quotes/:id so React Router
              matches the more-specific path first. */}
          <Route path="/quotes/edit/:id"              element={<CreateQuoteV2 />} />
          <Route path="/quotes/edit/:id/other-media"  element={<CreateQuoteOtherMediaV2 />} />
          <Route path="/quotes/renew/:id"             element={<CreateQuoteV2 />} />
          <Route path="/quotes/:id"                element={<QuoteDetail />} />
          {/* Quote chooser — Step 0 of new-quote flow. Sales reps
              with a single segment scope skip directly to the right
              wizard, but the chooser handles that case too. */}
          <Route path="/quotes/new"                element={<CreateQuoteChooserV2 />} />
          {/* Private LED quote (existing wizard) */}
          <Route path="/quotes/new/private"                  element={<CreateQuoteV2 />} />
          {/* Phase 12 rev2 — owner spec: private rep needs LED OR Other Media */}
          <Route path="/quotes/new/private/other-media"      element={<CreateQuoteOtherMediaV2 />} />
          {/* Government module — Auto Hood + GSRTC LED */}
          <Route path="/quotes/new/government"     element={<RequireGovtAccess><CreateQuoteChooserV2 /></RequireGovtAccess>} />
          <Route path="/quotes/new/government/auto-hood" element={<RequireGovtAccess><CreateGovtAutoHoodV2 /></RequireGovtAccess>} />
          <Route path="/quotes/new/government/gsrtc-led" element={<RequireGovtAccess><CreateGovtGsrtcLedV2 /></RequireGovtAccess>} />
          {/* Govt proposal renderer (HTML preview, browser-printable) */}
          {/* Phase 32J — wrap in RequireGovtAccess. Was unguarded;
              private-only sales reps could open a govt proposal URL
              directly. RLS would filter the row but the route guard
              was missing per CLAUDE.md §10. */}
          <Route path="/proposal/:id"              element={<RequireGovtAccess><GovtProposalDetailV2 /></RequireGovtAccess>} />

          <Route path="/renewal-tools"             element={<RenewalToolsV2 />} />
          {/* Clients is visible to both roles; RLS on the clients table
              scopes rows so sales sees own, admin sees all. */}
          <Route path="/clients"                   element={<ClientsV2 />} />

          {/* Phase 12 — M1 Sales/Lead module. RLS handles per-role
              visibility; the page itself shows admin-vs-sales chrome.
              ROUTE ORDER MATTERS — /leads/new must register BEFORE
              /leads/:id, otherwise React Router matches /:id with
              id="new" and the lead-detail loader sends "new" to a
              uuid column ("invalid input syntax for type uuid: new"). */}
          <Route path="/leads"                     element={<RequireNonAgency><LeadsV2 /></RequireNonAgency>} />
          <Route path="/lead-dashboard"            element={<LeadDashboardV2 />} />
          <Route path="/team-dashboard"            element={<RequirePrivileged><TeamDashboardV2 /></RequirePrivileged>} />
          <Route path="/leads/upload"              element={<RequirePrivileged><LeadUploadV2 /></RequirePrivileged>} />
          <Route path="/leads/new"                 element={<RequireNonAgency><LeadFormV2 /></RequireNonAgency>} />
          <Route path="/leads/:id"                 element={<RequireNonAgency><LeadDetailV2 /></RequireNonAgency>} />
          <Route path="/work"                      element={<WorkV2 />} />
          {/* Phase 61 — Manager dashboard. Shows the team-lead's
              direct reports + today's metrics. Sales head + TC head
              land here on app open via RootRedirect. */}
          <Route path="/manager"                   element={<RequireManager><ManagerDashboardV2 /></RequireManager>} />
          {/* Phase 61 — Admin reassigns reps to managers. */}
          <Route path="/admin/team-assign"         element={<RequirePrivileged><TeamManagerAssignV2 /></RequirePrivileged>} />
          {/* Phase 56m — per-rep call log (own + admin view of any rep). */}
          <Route path="/calls"                     element={<CallLogsV2 />} />
          <Route path="/admin/calls/:userId"       element={<RequirePrivileged><CallLogsV2 /></RequirePrivileged>} />
          {/* Phase 34Z.55 — push notification diagnostics + test send.
              Surfaces all six gates (Notification API, Push API, VAPID,
              SW, permission, subscription) so owner can diagnose why
              push isn't arriving without reading the console.
              Phase 97.7 (2026-05-28, F-003) — route stays open so reps
              can self-enroll via the V2AppShell push-enrollment chip
              and the NotificationPanel diagnostic link. Privileged
              tooling (Send test push, registered devices list) is
              gated inside PushDebugV2 itself. */}
          <Route path="/push-debug"                element={<PushDebugV2 />} />
          <Route path="/telecaller"                element={<ErrorBoundary label="Telecaller Today"><TelecallerV2 /></ErrorBoundary>} />
          <Route path="/voice"                     element={<VoiceLogV2 />} />
          <Route path="/voice/evening"             element={<EveningVoiceV2 />} />
          {/* Phase 31K — dedicated follow-ups list. Sales sees their own;
              admin/co_owner sees all (component handles the toggle). */}
          <Route path="/follow-ups"                element={<FollowUpsV2 />} />
          {/* Phase 30F — admin map view of a rep's day track. Date is
              optional (defaults to today). Specific BEFORE the
              two-segment fallback so it never gets shadowed. */}
          <Route path="/admin/gps/:userId/:date"   element={<RequirePrivileged><GpsTrackV2 /></RequirePrivileged>} />
          <Route path="/admin/gps/:userId"         element={<RequirePrivileged><GpsTrackV2 /></RequirePrivileged>} />
          {/* Phase 12 rev3 — /cockpit retired. Folded into /dashboard. */}

          {/* Sales-only */}
          <Route path="/my-performance"            element={<MyPerformanceV2 />} />
          <Route path="/my-offer"                  element={<MyOfferV2 />} />
          {/* Phase 103.F — rep's saved admin messages (push tap target) */}
          <Route path="/messages"                  element={<MessagesV2 />} />

          {/* Admin / owner / co_owner master pages */}
          <Route path="/cities"                    element={<RequirePrivileged><CitiesV2 /></RequirePrivileged>} />
          <Route path="/auto-districts"            element={<RequirePrivileged><AutoDistrictsV2 /></RequirePrivileged>} />
          <Route path="/gsrtc-stations"            element={<RequirePrivileged><GsrtcStationsV2 /></RequirePrivileged>} />
          <Route path="/team"                      element={<RequirePrivileged><TeamV2 /></RequirePrivileged>} />
          <Route path="/incentives"                element={<RequirePrivileged><IncentivesV2 /></RequirePrivileged>} />
          <Route path="/pending-approvals"         element={<RequirePrivileged><PendingApprovalsV2 /></RequirePrivileged>} />
          <Route path="/hr"                        element={<RequirePrivileged><HRV2 /></RequirePrivileged>} />
          <Route path="/hr/new-user"               element={<RequirePrivileged><HRNewUserV2 /></RequirePrivileged>} />
          <Route path="/hr/offer/:userId"          element={<RequirePrivileged><HROfferLetterV2 /></RequirePrivileged>} />
          {/* Phase 33G.8 — admin Leaves CRUD. Excluded days for the
              monthly performance score now come from a real table
              instead of the work_sessions.is_off_day proxy. */}
          <Route path="/admin/leaves"              element={<RequirePrivileged><LeavesAdminV2 /></RequirePrivileged>} />
          {/* Phase 33H — TA (travel allowance) computed from GPS pings.
              Per-day DA + bike + hotel, approval workflow, CSV export
              for finance. */}
          <Route path="/admin/ta-payouts"          element={<RequirePrivileged><TaPayoutsAdminV2 /></RequirePrivileged>} />
          {/* Phase 36 — Salary Sheet. Per-rep monthly breakdown with
              auto leave deduction. Admin / co_owner only. */}
          <Route path="/admin/salary"              element={<RequirePrivileged><SalaryAdminV2 /></RequirePrivileged>} />
          {/* Phase 101.A3 JSX — agency commission payout admin
              surface. Backed by Phase 101.A3 SQL agency_commission_
              payouts table. admin+co_owner per acp_admin_all RLS. */}
          <Route path="/admin/agency-commission"   element={<RequirePrivileged><AgencyCommissionAdminV2 /></RequirePrivileged>} />
          {/* Phase 38 — People (consolidated). Old routes above stay
              as deep-links; sidebar uses /people. */}
          <Route path="/people"                    element={<RequirePrivileged><PeopleV2 /></RequirePrivileged>} />
          {/* Phase 90 (2026-05-23) — rep profile drill-down. Specific
              before parameterized would matter only if /people/new
              existed; it doesn't, so /people/:userId catches all
              non-empty subpaths. Admin / co_owner only. */}
          <Route path="/people/:userId"            element={<RequireHROrPrivileged><RepProfileV2 /></RequireHROrPrivileged>} />
          {/* Phase 8C — unified Master page (Attachments / Signers / Media / Documents) */}
          <Route path="/master"                    element={<RequirePrivileged><MasterV2 /></RequirePrivileged>} />
          {/* Phase 35 PR 1 — primitives demo.
              Phase 97 C1 (2026-05-28, F-208) — moved internal page
              role banner to route-level RequirePrivileged guard.
              Cheaper than mounting the page for non-admins. */}
          <Route path="/primitives-demo"           element={<RequirePrivileged><PrimitivesDemoV2 /></RequirePrivileged>} />
          <Route path="/settings"                  element={<SettingsV2 />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
