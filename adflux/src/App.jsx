import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AppShell } from './components/layout/AppShell'
import Login from './pages/Login'
// Legacy Dashboard kept for rollback. If the v2 cutover needs to be reverted:
//   1. Delete the /dashboard element = <DashboardV2 /> route
//   2. Put `<Route path="/dashboard" element={<Dashboard />} />` back inside
//      the AppShell block
// import Dashboard from './pages/Dashboard'
import Quotes from './pages/Quotes'
import QuoteDetail from './pages/QuoteDetail'
import CreateQuote from './pages/CreateQuote'
import Cities from './pages/Cities'
import Team from './pages/Team'
import Incentives from './pages/Incentives'
import MyPerformance from './pages/MyPerformance'
import RenewalTools from './pages/RenewalTools'
import PendingApprovals from './pages/PendingApprovals'
import HR from './pages/HR'
import MyOffer from './pages/MyOffer'
import OfferForm from './pages/OfferForm'
import DashboardV2 from './pages/v2/DashboardV2'

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
  // Both admin and sales land on /dashboard — Dashboard.jsx renders
  // SalesDashboard or AdminDashboard based on role.
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
        {/* v2 dashboard — owns its own shell (sidebar + topbar), so it sits
            OUTSIDE AppShell. Both /dashboard and /v2/dashboard resolve to
            the same switcher so legacy bookmarks of either path still work. */}
        <Route path="/dashboard"    element={<RequireAuth><DashboardV2 /></RequireAuth>} />
        <Route path="/v2/dashboard" element={<RequireAuth><DashboardV2 /></RequireAuth>} />
        <Route path="/" element={<RootRedirect />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/cities"         element={<RequireAdmin><Cities /></RequireAdmin>} />
          <Route path="/team"           element={<RequireAdmin><Team /></RequireAdmin>} />
          <Route path="/incentives"     element={<RequireAdmin><Incentives /></RequireAdmin>} />
          <Route path="/renewal-tools"  element={<RenewalTools />} />
          <Route path="/pending-approvals" element={<RequireAdmin><PendingApprovals /></RequireAdmin>} />
          <Route path="/hr"             element={<RequireAdmin><HR /></RequireAdmin>} />
          <Route path="/quotes"         element={<Quotes />} />
          <Route path="/quotes/new"     element={<CreateQuote />} />
          <Route path="/quotes/:id"     element={<QuoteDetail />} />
          <Route path="/my-performance" element={<MyPerformance />} />
          <Route path="/my-offer"       element={<MyOffer />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
