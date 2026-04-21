import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AppShell } from './components/layout/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Quotes from './pages/Quotes'
import QuoteDetail from './pages/QuoteDetail'
import CreateQuote from './pages/CreateQuote'
import Cities from './pages/Cities'
import Team from './pages/Team'
import Incentives from './pages/Incentives'
import MyPerformance from './pages/MyPerformance'
import RenewalTools from './pages/RenewalTools'
import PendingApprovals from './pages/PendingApprovals'

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
        <Route path="/" element={<RootRedirect />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/dashboard"      element={<Dashboard />} />
          <Route path="/cities"         element={<RequireAdmin><Cities /></RequireAdmin>} />
          <Route path="/team"           element={<RequireAdmin><Team /></RequireAdmin>} />
          <Route path="/incentives"     element={<RequireAdmin><Incentives /></RequireAdmin>} />
          <Route path="/renewal-tools"  element={<RequireAdmin><RenewalTools /></RequireAdmin>} />
          <Route path="/pending-approvals" element={<RequireAdmin><PendingApprovals /></RequireAdmin>} />
          <Route path="/quotes"         element={<Quotes />} />
          <Route path="/quotes/new"     element={<CreateQuote />} />
          <Route path="/quotes/:id"     element={<QuoteDetail />} />
          <Route path="/my-performance" element={<MyPerformance />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
