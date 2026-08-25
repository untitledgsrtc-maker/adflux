import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { V2AppShell } from './components/v2/V2AppShell'
const Login = lazyWithRetry(() => import('./pages/Login'))
// Public candidate-facing offer form — NO auth, NO shell.
const OfferForm = lazyWithRetry(() => import('./pages/OfferForm'))
// Quote detail was preserved as-is (837-line payment approval logic
// must not be refactored with the shell cut-over).
const QuoteDetail = lazyWithRetry(() => import('./pages/QuoteDetail'))
// v2 dashboard switcher (owns its own chrome; not under V2AppShell).
const DashboardV2 = lazyWithRetry(() => import('./pages/v2/DashboardV2'))
// v2 inner pages — all share V2AppShell via react-router Outlet.
const QuotesV2 = lazyWithRetry(() => import('./pages/v2/QuotesV2'))
const MyPerformanceV2 = lazyWithRetry(() => import('./pages/v2/MyPerformanceV2'))
const CheckInV2 = lazyWithRetry(() => import('./pages/v2/CheckInV2'))   // Phase 60
const PresentView = lazyWithRetry(() => import('./pages/v2/PresentView'))  // Phase 181 — in-app deck + timer
const QuotePrintDoc = lazyWithRetry(() => import('./pages/QuotePrintDoc'))  // AI real-PDF — login-less print page for the headless-Chromium render service
import CheckInGate        from './components/v2/CheckInGate'   // Phase 60
const ManagerDashboardV2 = lazyWithRetry(() => import('./pages/v2/ManagerDashboardV2')) // Phase 61
const TeamManagerAssignV2 = lazyWithRetry(() => import('./pages/v2/TeamManagerAssignV2')) // Phase 61
const MyOfferV2 = lazyWithRetry(() => import('./pages/v2/MyOfferV2'))
const CreateQuoteV2 = lazyWithRetry(() => import('./pages/v2/CreateQuoteV2'))
const CreateQuoteOtherMediaV2 = lazyWithRetry(() => import('./pages/v2/CreateQuoteOtherMediaV2'))
const CitiesV2 = lazyWithRetry(() => import('./pages/v2/CitiesV2'))
const TeamV2 = lazyWithRetry(() => import('./pages/v2/TeamV2'))
const IncentivesV2 = lazyWithRetry(() => import('./pages/v2/IncentivesV2'))
const RenewalToolsV2 = lazyWithRetry(() => import('./pages/v2/RenewalToolsV2'))
const PendingApprovalsV2 = lazyWithRetry(() => import('./pages/v2/PendingApprovalsV2'))
const HRV2 = lazyWithRetry(() => import('./pages/v2/HRV2'))
const HRHomeV2 = lazyWithRetry(() => import('./pages/v2/HRHomeV2'))
const HRCandidatesV2 = lazyWithRetry(() => import('./pages/v2/HRCandidatesV2'))
const HROnboardTemplatesV2 = lazyWithRetry(() => import('./pages/v2/HROnboardTemplatesV2'))
const HROnboardingV2 = lazyWithRetry(() => import('./pages/v2/HROnboardingV2'))
const MyOnboardingV2 = lazyWithRetry(() => import('./pages/v2/MyOnboardingV2'))
const HRNewUserV2 = lazyWithRetry(() => import('./pages/v2/HRNewUserV2'))
const HROfferLetterV2 = lazyWithRetry(() => import('./pages/v2/HROfferLetterV2'))
const CallLogsV2 = lazyWithRetry(() => import('./pages/v2/CallLogsV2'))
// Phase 33G.8 — admin Leaves page (item 82 real leaves table).
const LeavesAdminV2 = lazyWithRetry(() => import('./pages/v2/LeavesAdminV2'))
// Phase 36 — per-rep monthly salary breakdown.
const SalaryAdminV2 = lazyWithRetry(() => import('./pages/v2/SalaryAdminV2'))
// Phase 38 — People module (Team + Incentives + Salary + Leaves tabs).
const PeopleV2 = lazyWithRetry(() => import('./pages/v2/PeopleV2'))
// Finance module (CLAUDE.md §155) — P&L + Register + Import. admin+accounts+co_owner.
const FinanceV2 = lazyWithRetry(() => import('./pages/v2/FinanceV2'))
// Phase 90 (2026-05-23) — admin rep profile drill-down.
const RepProfileV2 = lazyWithRetry(() => import('./pages/v2/RepProfileV2'))
// Phase 33H — admin TA Payouts (GPS-driven travel allowance).
const TaPayoutsAdminV2 = lazyWithRetry(() => import('./pages/v2/TaPayoutsAdminV2'))
// Phase 101.A3 JSX — agency commission payout admin page.
const AgencyCommissionAdminV2 = lazyWithRetry(() => import('./pages/v2/AgencyCommissionAdminV2'))
const ClientsV2 = lazyWithRetry(() => import('./pages/v2/ClientsV2'))
// ── Phase 12 — M1 Sales/Lead module ─────────────────────────────────
const LeadsV2 = lazyWithRetry(() => import('./pages/v2/LeadsV2'))
const LeadDashboardV2 = lazyWithRetry(() => import('./pages/v2/LeadDashboardV2'))
const TeamDashboardV2 = lazyWithRetry(() => import('./pages/v2/TeamDashboardV2'))
const LeadDetailV2 = lazyWithRetry(() => import('./pages/v2/LeadDetailV2'))
const LeadFormV2 = lazyWithRetry(() => import('./pages/v2/LeadFormV2'))
const LeadUploadV2 = lazyWithRetry(() => import('./pages/v2/LeadUploadV2'))
const CampaignQrV2 = lazyWithRetry(() => import('./pages/v2/CampaignQrV2'))
const CampaignClientQrV2 = lazyWithRetry(() => import('./pages/v2/CampaignClientQrV2'))
const CampaignInboxV2 = lazyWithRetry(() => import('./pages/v2/CampaignInboxV2'))
const CampaignsV2 = lazyWithRetry(() => import('./pages/v2/CampaignsV2'))
const CampaignSegmentsV2 = lazyWithRetry(() => import('./pages/v2/CampaignSegmentsV2'))
const CampaignBroadcastV2 = lazyWithRetry(() => import('./pages/v2/CampaignBroadcastV2'))
const CampaignIntegrationsV2 = lazyWithRetry(() => import('./pages/v2/CampaignIntegrationsV2'))
const CampaignChatbotV2 = lazyWithRetry(() => import('./pages/v2/CampaignChatbotV2'))
const WorkV2 = lazyWithRetry(() => import('./pages/v2/WorkV2'))
// Phase 230 — Operations module (screen-maintenance field app + Head overview).
const OpsWorkV2 = lazyWithRetry(() => import('./pages/v2/OpsWorkV2'))
// Phase 230 (Phase 2) — Operation Head desk console.
const OpsHeadV2 = lazyWithRetry(() => import('./pages/v2/OpsHeadV2'))
const MessagesV2 = lazyWithRetry(() => import('./pages/v2/MessagesV2'))
const PushDebugV2 = lazyWithRetry(() => import('./pages/v2/PushDebugV2'))
const TelecallerV2 = lazyWithRetry(() => import('./pages/v2/TelecallerV2'))
import ErrorBoundary       from './components/v2/ErrorBoundary'
const VoiceLogV2 = lazyWithRetry(() => import('./pages/v2/VoiceLogV2'))
const FollowUpsV2 = lazyWithRetry(() => import('./pages/v2/FollowUpsV2'))
const EveningVoiceV2 = lazyWithRetry(() => import('./pages/v2/EveningVoiceV2'))
// Phase 12 rev3 — CockpitV2 retired; widgets folded into AdminDashboardDesktop.

// ── Government module (Phase 6) ─────────────────────────────────────
const CreateQuoteChooserV2 = lazyWithRetry(() => import('./pages/v2/CreateQuoteChooserV2'))
const CreateGovtAutoHoodV2 = lazyWithRetry(() => import('./pages/v2/CreateGovtAutoHoodV2'))
const CreateGovtGsrtcLedV2 = lazyWithRetry(() => import('./pages/v2/CreateGovtGsrtcLedV2'))
const AutoDistrictsV2 = lazyWithRetry(() => import('./pages/v2/AutoDistrictsV2'))
const GsrtcStationsV2 = lazyWithRetry(() => import('./pages/v2/GsrtcStationsV2'))
const GovtProposalDetailV2 = lazyWithRetry(() => import('./pages/v2/GovtProposalDetailV2'))
const GpsTrackV2 = lazyWithRetry(() => import('./pages/v2/GpsTrackV2'))
const MasterV2 = lazyWithRetry(() => import('./pages/v2/MasterV2'))
// Phase 35 PR 1 — admin-only primitives demo (sign-off gate before PR 2).
const PrimitivesDemoV2 = lazyWithRetry(() => import('./pages/v2/PrimitivesDemoV2'))
const SettingsV2 = lazyWithRetry(() => import('./pages/v2/SettingsV2'))

// Route code-splitting (Phase 317) — each page loads on demand instead of
// shipping the whole app in one chunk on every cold open. lazyWithRetry reloads
// ONCE on a dynamic-import failure: a rep whose browser cached an old index.html
// gets 404s on the old chunk URLs after a deploy — a single reload pulls the fresh
// build instead of a white screen. The 10s window stops a reload loop on a
// genuinely-broken chunk (it then surfaces the error).
function lazyWithRetry(factory) {
  return lazy(() => factory().catch((err) => {
    const last = Number(sessionStorage.getItem('chunkReloadAt')) || 0
    if (Date.now() - last > 10000) {
      sessionStorage.setItem('chunkReloadAt', String(Date.now()))
      window.location.reload()
      return new Promise(() => {})   // hold render until the reload takes over
    }
    throw err
  }))
}

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

/* Phase 182 (2026-07-01) — Accounts login. The payroll / finance surface
   (People shell + salary / TA-DA / incentives / leaves) admits role='accounts'
   alongside admin + co_owner. Accounts can view + edit amounts + pay salary /
   TA / incentives + approve TA claims. It does NOT reach sales ops, quote
   writes, campaigns, HR sign-off, user minting, or P&L (guarded elsewhere). */
function RequireAccountsOrPrivileged({ children }) {
  const { isPrivileged, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  const isAccounts = profile?.role === 'accounts'
  if (!isPrivileged && !isAccounts) return <Navigate to="/quotes" replace />
  return children
}

/* Back-office guard (2026-08-03) — admin / co_owner / accounts / hr. Used ONLY on
   the shared people-ops surfaces HR is now allowed into: Leaves, TA/DA claims,
   Team roster. Kept SEPARATE from RequireAccountsOrPrivileged so HR does NOT reach
   the salary sheet / incentives / P&L those still gate. Sales + money stay blocked
   by RLS (HR has no leads/quotes/payments/salary policy). */
function RequireBackOffice({ children }) {
  const { isPrivileged, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  const ok = isPrivileged || ['accounts', 'hr'].includes(profile?.role)
  if (!ok) return <Navigate to="/quotes" replace />
  return children
}

/* Sales Head (manager P3) — approvals-only guard for /admin/leaves +
   /admin/ta-payouts. A DEDICATED guard (not a RequireBackOffice widen) so a
   Sales Head does NOT also reach /team (TeamV2 shows incentive profiles = the
   §8 salary/HR boundary she must not cross). Adds is_sales_head alongside the
   back-office roles, never replacing them. */
function RequireApprovals({ children }) {
  const { isPrivileged, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  const ok = isPrivileged || ['accounts', 'hr'].includes(profile?.role) || profile?.is_sales_head === true
  if (!ok) return <Navigate to="/quotes" replace />
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

/* Phase 193 (3 Jul 2026) — gate for /team-dashboard. Admits admin/co_owner/
   sales_manager (isPrivileged) OR a per-user viewer with the
   can_view_team_dashboard flag (owner grants it to one telecaller). The viewer
   sees the SAME dashboard, but her team data is fetched inside TeamDashboardV2
   via ONE gated SECURITY DEFINER RPC (team_dashboard_bundle,
   supabase_phase193_team_dashboard_gated.sql) — NOT broad table grants — so she
   stays own-only on /leads, /work, etc. (Supersedes the Phase 192 13-policy
   approach that leaked all-rep data app-wide; those policies were dropped.) */
function RequireTeamView({ children }) {
  const { isPrivileged, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  // 2026-08-03: HR admitted for attendance/GPS (view only). HR has RLS on
  // gps_pings/work_sessions/users but NOT leads/quotes/payments, so the sales
  // cards on the dashboard return empty for HR — attendance shows, money doesn't.
  const ok = isPrivileged || profile?.role === 'hr' || profile?.can_view_team_dashboard
  if (!ok) return <Navigate to="/" replace />
  return children
}

/* Govt-segment guard. Used by the Government wizard so a Private-only
   sales rep can't reach it via direct URL. ALL or GOVERNMENT is OK. */
function RequireGovtAccess({ children }) {
  const { segmentAccess, profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingScreen />
  // Sales Head (manager P1c) may reach the govt quote wizards to EDIT any rep's
  // govt proposal, even though her base segment_access is PRIVATE — but ONLY to
  // EDIT (state.editingId set, §94 govt edit is state-based), never to CREATE a
  // new govt quote (the same route serves both; the quotes INSERT policy is
  // segment-blind, so an unscoped bypass would let a PRIVATE-segment head
  // originate a GOVERNMENT quote — a §8 segment-boundary breach). Added alongside
  // the segment gate, never replacing it.
  const salesHeadEditing = !!profile?.is_sales_head && !!location.state?.editingId
  if (segmentAccess !== 'ALL' && segmentAccess !== 'GOVERNMENT' && !salesHeadEditing) {
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

// Phase 230 — Operations module route guard. Only the two ops roles
// (plus admin/co_owner for oversight) may reach /ops; everyone else
// bounces to their own dashboard. Additive — no existing guard changed.
function RequireOps({ children }) {
  const { profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  const role = profile?.role
  if (role === 'operation_head' || role === 'operation_executive'
      || role === 'admin' || role === 'co_owner') return children
  return <Navigate to="/dashboard" replace />
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
  // Phase 109 — HR lands on the HR home (offer roster + add member).
  // Without this, hr falls through to /dashboard → an empty sales view
  // it can't use.
  if (role === 'hr')                              return <Navigate to="/hr" replace />
  // Phase 182 — Accounts login lands on the payroll shell.
  if (role === 'accounts')                        return <Navigate to="/people" replace />
  // Phase 230 — Operations module. operation_executive → the mobile field
  // app (/ops); operation_head → the desk console (/ops-dashboard, Phase 2).
  // Keyed on `role` (not team_role — ops isn't a sales flavor).
  if (role === 'operation_head')       return <Navigate to="/ops-dashboard" replace />
  if (role === 'operation_executive')  return <Navigate to="/ops" replace />
  return <Navigate to="/dashboard" replace />
}

export default function App() {
  useAuth()
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen />}>
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

        {/* Phase 181 — in-app GSRTC presentation (full-screen, outside the
            shell). Opens the offline deck + a stopwatch; logs the time.
            Specific before parameterized (§10). */}
        <Route path="/present" element={<RequireAuth><PresentView /></RequireAuth>} />
        <Route path="/present/:leadId" element={<RequireAuth><PresentView /></RequireAuth>} />

        {/* AI real-PDF — login-less print page rendered by the headless-Chromium
            render service (a 2nd Vercel project). NOT wrapped in RequireAuth: it
            is data-driven + gated by the ?t=RENDER_SECRET secret at the
            /api/quote-render-data endpoint, and is only ever loaded by the
            server-side headless browser. Specific literal, no shadow (§10). */}
        <Route path="/quote-print/:ref" element={<QuotePrintDoc />} />

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
          {/* Phase 193 — the REAL team dashboard, admin OR a per-user
              can_view_team_dashboard viewer. The viewer's team data comes from
              the gated team_dashboard_bundle RPC (no broad RLS); she stays
              own-only everywhere else. */}
          <Route path="/team-dashboard"            element={<RequireTeamView><TeamDashboardV2 /></RequireTeamView>} />
          <Route path="/leads/upload"              element={<RequirePrivileged><LeadUploadV2 /></RequirePrivileged>} />
          {/* Campaign module (admin, token-free). Specific /campaigns/* before /campaigns. */}
          <Route path="/campaigns/qr"              element={<RequirePrivileged><CampaignQrV2 /></RequirePrivileged>} />
          <Route path="/campaigns/clients"         element={<RequirePrivileged><CampaignClientQrV2 /></RequirePrivileged>} />
          {/* Phase 205 — reps reach the inbox too (scoped to their assigned chats
              by RLS + an in-page role gate). Admin still sees all + reassigns. */}
          <Route path="/campaigns/inbox"           element={<CampaignInboxV2 />} />
          <Route path="/campaigns/segments"        element={<RequirePrivileged><CampaignSegmentsV2 /></RequirePrivileged>} />
          <Route path="/campaigns/broadcast"       element={<RequirePrivileged><CampaignBroadcastV2 /></RequirePrivileged>} />
          <Route path="/campaigns/integrations"    element={<RequirePrivileged><CampaignIntegrationsV2 /></RequirePrivileged>} />
          <Route path="/campaigns/chatbot"         element={<RequirePrivileged><CampaignChatbotV2 /></RequirePrivileged>} />
          <Route path="/campaigns"                 element={<RequirePrivileged><CampaignsV2 /></RequirePrivileged>} />
          <Route path="/leads/new"                 element={<RequireNonAgency><LeadFormV2 /></RequireNonAgency>} />
          <Route path="/leads/:id"                 element={<RequireNonAgency><LeadDetailV2 /></RequireNonAgency>} />
          <Route path="/work"                      element={<WorkV2 />} />
          {/* Phase 230 — Operations field app (exec) + Head desk console. */}
          <Route path="/ops"                       element={<RequireOps><OpsWorkV2 /></RequireOps>} />
          <Route path="/ops-dashboard"             element={<RequireOps><OpsHeadV2 /></RequireOps>} />
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
          {/* Phase 194 — RequireTeamView so a can_view_team_dashboard viewer can
              open a rep's route activity from the dashboard drill-down. Her data
              comes from the gated team_rep_daytrack RPC (own-only RLS otherwise). */}
          <Route path="/admin/gps/:userId/:date"   element={<RequireTeamView><GpsTrackV2 /></RequireTeamView>} />
          <Route path="/admin/gps/:userId"         element={<RequireTeamView><GpsTrackV2 /></RequireTeamView>} />
          {/* Phase 12 rev3 — /cockpit retired. Folded into /dashboard. */}

          {/* Sales-only */}
          <Route path="/my-performance"            element={<MyPerformanceV2 />} />
          <Route path="/my-offer"                  element={<MyOfferV2 />} />
          {/* Phase 282 — every role's own onboarding (empty state if none assigned). */}
          <Route path="/my-onboarding"             element={<MyOnboardingV2 />} />
          {/* Phase 103.F — rep's saved admin messages (push tap target) */}
          <Route path="/messages"                  element={<MessagesV2 />} />

          {/* Admin / owner / co_owner master pages */}
          <Route path="/cities"                    element={<RequirePrivileged><CitiesV2 /></RequirePrivileged>} />
          <Route path="/auto-districts"            element={<RequirePrivileged><AutoDistrictsV2 /></RequirePrivileged>} />
          <Route path="/gsrtc-stations"            element={<RequirePrivileged><GsrtcStationsV2 /></RequirePrivileged>} />
          <Route path="/team"                      element={<RequireBackOffice><TeamV2 /></RequireBackOffice>} />
          <Route path="/incentives"                element={<RequireAccountsOrPrivileged><IncentivesV2 /></RequireAccountsOrPrivileged>} />
          <Route path="/pending-approvals"         element={<RequirePrivileged><PendingApprovalsV2 /></RequirePrivileged>} />
          {/* Phase 109 — HR login. These 3 routes admit role='hr' as well
              as admin/co_owner via RequireHROrPrivileged. Every OTHER
              admin route stays RequirePrivileged (admin+co_owner only). */}
          {/* Phase 280 — /hr is now the HR Home cockpit (HRHomeV2).
              The offer/invite list moved to /hr/offers. */}
          <Route path="/hr"                        element={<RequireHROrPrivileged><HRHomeV2 /></RequireHROrPrivileged>} />
          <Route path="/hr/candidates"             element={<RequireHROrPrivileged><HRCandidatesV2 /></RequireHROrPrivileged>} />
          {/* Phase 282 — HR Onboard & train. /hr/onboarding/templates BEFORE
              /hr/onboarding (specific-before-less-specific, §10). /my-onboarding
              is a bare child (all roles) further below. */}
          <Route path="/hr/onboarding/templates"   element={<RequireHROrPrivileged><HROnboardTemplatesV2 /></RequireHROrPrivileged>} />
          <Route path="/hr/onboarding"             element={<RequireHROrPrivileged><HROnboardingV2 /></RequireHROrPrivileged>} />
          <Route path="/hr/offers"                 element={<RequireHROrPrivileged><HRV2 /></RequireHROrPrivileged>} />
          <Route path="/hr/new-user"               element={<RequireHROrPrivileged><HRNewUserV2 /></RequireHROrPrivileged>} />
          <Route path="/hr/offer/:userId"          element={<RequireHROrPrivileged><HROfferLetterV2 /></RequireHROrPrivileged>} />
          {/* Phase 33G.8 — admin Leaves CRUD. Excluded days for the
              monthly performance score now come from a real table
              instead of the work_sessions.is_off_day proxy. */}
          <Route path="/admin/leaves"              element={<RequireApprovals><LeavesAdminV2 /></RequireApprovals>} />
          {/* Phase 33H — TA (travel allowance) computed from GPS pings.
              Per-day DA + bike + hotel, approval workflow, CSV export
              for finance. */}
          <Route path="/admin/ta-payouts"          element={<RequireApprovals><TaPayoutsAdminV2 /></RequireApprovals>} />
          {/* Phase 36 — Salary Sheet. Per-rep monthly breakdown with
              auto leave deduction. Admin / co_owner only. */}
          <Route path="/admin/salary"              element={<RequireAccountsOrPrivileged><SalaryAdminV2 /></RequireAccountsOrPrivileged>} />
          {/* Phase 101.A3 JSX — agency commission payout admin
              surface. Backed by Phase 101.A3 SQL agency_commission_
              payouts table. admin+co_owner per acp_admin_all RLS. */}
          <Route path="/admin/agency-commission"   element={<RequirePrivileged><AgencyCommissionAdminV2 /></RequirePrivileged>} />
          {/* Phase 38 — People (consolidated). Old routes above stay
              as deep-links; sidebar uses /people. */}
          <Route path="/people"                    element={<RequireAccountsOrPrivileged><PeopleV2 /></RequireAccountsOrPrivileged>} />
          <Route path="/finance"                   element={<RequireAccountsOrPrivileged><FinanceV2 /></RequireAccountsOrPrivileged>} />
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
      </Suspense>
    </BrowserRouter>
  )
}
