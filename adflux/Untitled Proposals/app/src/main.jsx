import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useAuthStore } from '@/store/authStore';
import { RequireAuth, RequireRole } from '@/components/RouteGuards';
import AppShell from '@/components/AppShell';

import LoginPage           from '@/pages/Login';
import DashboardPage       from '@/pages/Dashboard';
import ProposalsListPage   from '@/pages/ProposalsList';
import ProposalNewPage     from '@/pages/ProposalNew';
import ProposalDetailPage  from '@/pages/ProposalDetail';
import PaymentsPage        from '@/pages/Payments';
import ClientsPage         from '@/pages/Clients';
import MastersPage         from '@/pages/Masters';
import PnLLandingPage      from '@/pages/PnLLanding';
import AdminPage           from '@/pages/Admin';
import NotFoundPage        from '@/pages/NotFound';

import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const init = useAuthStore((s) => s.init);
  useEffect(() => { init(); }, [init]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<DashboardPage />} />

        <Route path="/proposals">
          <Route index element={<ProposalsListPage />} />
          <Route path="new" element={
            <RequireRole roles={['owner', 'co_owner', 'admin']}>
              <ProposalNewPage />
            </RequireRole>
          } />
          <Route path=":id" element={<ProposalDetailPage />} />
        </Route>

        <Route path="/payments" element={
          <RequireRole roles={['owner', 'co_owner', 'admin']}>
            <PaymentsPage />
          </RequireRole>
        } />

        <Route path="/clients" element={<ClientsPage />} />

        <Route path="/masters" element={
          <RequireRole roles={['owner', 'co_owner', 'admin']}>
            <MastersPage />
          </RequireRole>
        } />

        <Route path="/pnl" element={
          <RequireRole roles={['owner', 'co_owner']}>
            <PnLLandingPage />
          </RequireRole>
        } />

        <Route path="/admin" element={
          <RequireRole roles={['owner']}>
            <AdminPage />
          </RequireRole>
        } />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
