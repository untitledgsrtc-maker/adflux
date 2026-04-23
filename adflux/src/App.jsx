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
import CitiesV2           from './pages/v2/CitiesV2'
import TeamV2             from './pages/v2/TeamV2'
import IncentivesV2       from './pages/v2/IncentivesV2'
import RenewalToolsV2     from './pages/v2/RenewalToolsV2'
import PendingApprovalsV2 from './pages/v2/PendingApprovalsV2'
import HRV2               from './pages/v2/HRV2'

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

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  // Dashboard switcher decides admin vs sales render internally.
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

        {/* v2 dashboard — owns its own shell (sidebar + topbar) so it
            sits OUTSIDE V2AppShell. Both /dashboard and /v2/dashboard
            route to the same switcher so legacy bookmarks still work. */}
        <Route path="/dashboard"    element={<RequireAuth><DashboardV2 /></RequireAuth>} />
        <Route path="/v2/dashboard" element={<RequireAuth><DashboardV2 /></RequireAuth>} />
        <Route path="/" element={<RootRedirect />} />

        {/* ─── v2 inner pages (share V2AppShell chrome) ─── */}
        <Route element={<RequireAuth><V2AppShell /></RequireAuth>}>
          {/* Shared — admin + sales */}
          <Route path="/quotes"            element={<QuotesV2 />} />
          <Route path="/quotes/:id"        element={<QuoteDetail />} />
          <Route path="/quotes/new"        element={<CreateQuoteV2 />} />
          <Route path="/renewal-tools"     element={<RenewalToolsV2 />} />

          {/* Sales-only */}
          <Route path="/my-performance"    element={<MyPerformanceV2 />} />
          <Route path="/my-offer"          element={<MyOfferV2 />} />

          {/* Admin-only */}
          <Route path="/cities"            element={<RequireAdmin><CitiesV2 /></RequireAdmin>} />
          <Route path="/team"              element={<RequireAdmin><TeamV2 /></RequireAdmin>} />
          <Route path="/incentives"        element={<RequireAdmin><IncentivesV2 /></RequireAdmin>} />
          <Route path="/pending-approvals" element={<RequireAdmin><PendingApprovalsV2 /></RequireAdmin>} />
          <Route path="/hr"                element={<RequireAdmin><HRV2 /></RequireAdmin>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
