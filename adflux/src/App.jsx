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
import MyOfferV2          from './pages/v2/MyOfferV2'
import CreateQuoteV2      from './pages/v2/CreateQuoteV2'
import CreateQuoteOtherMediaV2 from './pages/v2/CreateQuoteOtherMediaV2'
import CitiesV2           from './pages/v2/CitiesV2'
import TeamV2             from './pages/v2/TeamV2'
import IncentivesV2       from './pages/v2/IncentivesV2'
import RenewalToolsV2     from './pages/v2/RenewalToolsV2'
import PendingApprovalsV2 from './pages/v2/PendingApprovalsV2'
import HRV2               from './pages/v2/HRV2'
// Phase 33G.8 — admin Leaves page (item 82 real leaves table).
import LeavesAdminV2     from './pages/v2/LeavesAdminV2'
// Phase 33H — admin TA Payouts (GPS-driven travel allowance).
import TaPayoutsAdminV2  from './pages/v2/TaPayoutsAdminV2'
import ClientsV2          from './pages/v2/ClientsV2'
// ── Phase 12 — M1 Sales/Lead module ─────────────────────────────────
import LeadsV2             from './pages/v2/LeadsV2'
import LeadDashboardV2     from './pages/v2/LeadDashboardV2'
import TeamDashboardV2     from './pages/v2/TeamDashboardV2'
import LeadDetailV2        from './pages/v2/LeadDetailV2'
import LeadFormV2          from './pages/v2/LeadFormV2'
import LeadUploadV2        from './pages/v2/LeadUploadV2'
import WorkV2              from './pages/v2/WorkV2'
import TelecallerV2        from './pages/v2/TelecallerV2'
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
  if (teamRole === 'telecaller')               return <Navigate to="/telecaller" replace />
  if (teamRole === 'sales' || role === 'sales')   return <Navigate to="/work" replace />
  if (teamRole === 'agency' || role === 'agency') return <Navigate to="/quotes" replace />
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

        {/* ─── v2 inner pages (share V2AppShell chrome) ───
            Phase 18 — /dashboard moved INSIDE V2AppShell so it shares
            the same sidebar (Lead Pipeline, Team Live, Leads, etc) as
            every other page. Previously it sat outside and rendered
            its own chrome which dropped the new nav links. */}
        <Route element={<RequireAuth><V2AppShell /></RequireAuth>}>
          <Route path="/dashboard"    element={<DashboardV2 />} />
          <Route path="/v2/dashboard" element={<DashboardV2 />} />
          {/* Shared — admin + sales */}
          <Route path="/quotes"                    element={<QuotesV2 />} />
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
          <Route path="/leads"                     element={<LeadsV2 />} />
          <Route path="/lead-dashboard"            element={<LeadDashboardV2 />} />
          <Route path="/team-dashboard"            element={<RequirePrivileged><TeamDashboardV2 /></RequirePrivileged>} />
          <Route path="/leads/upload"              element={<RequirePrivileged><LeadUploadV2 /></RequirePrivileged>} />
          <Route path="/leads/new"                 element={<LeadFormV2 />} />
          <Route path="/leads/:id"                 element={<LeadDetailV2 />} />
          <Route path="/work"                      element={<WorkV2 />} />
          <Route path="/telecaller"                element={<TelecallerV2 />} />
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

          {/* Admin / owner / co_owner master pages */}
          <Route path="/cities"                    element={<RequirePrivileged><CitiesV2 /></RequirePrivileged>} />
          <Route path="/auto-districts"            element={<RequirePrivileged><AutoDistrictsV2 /></RequirePrivileged>} />
          <Route path="/gsrtc-stations"            element={<RequirePrivileged><GsrtcStationsV2 /></RequirePrivileged>} />
          <Route path="/team"                      element={<RequirePrivileged><TeamV2 /></RequirePrivileged>} />
          <Route path="/incentives"                element={<RequirePrivileged><IncentivesV2 /></RequirePrivileged>} />
          <Route path="/pending-approvals"         element={<RequirePrivileged><PendingApprovalsV2 /></RequirePrivileged>} />
          <Route path="/hr"                        element={<RequirePrivileged><HRV2 /></RequirePrivileged>} />
          {/* Phase 33G.8 — admin Leaves CRUD. Excluded days for the
              monthly performance score now come from a real table
              instead of the work_sessions.is_off_day proxy. */}
          <Route path="/admin/leaves"              element={<RequirePrivileged><LeavesAdminV2 /></RequirePrivileged>} />
          {/* Phase 33H — TA (travel allowance) computed from GPS pings.
              Per-day DA + bike + hotel, approval workflow, CSV export
              for finance. */}
          <Route path="/admin/ta-payouts"          element={<RequirePrivileged><TaPayoutsAdminV2 /></RequirePrivileged>} />
          {/* Phase 8C — unified Master page (Attachments / Signers / Media / Documents) */}
          <Route path="/master"                    element={<RequirePrivileged><MasterV2 /></RequirePrivileged>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
