// =====================================================================
// Route guards — wrap a route element to enforce auth + role + step-up.
// All guards bail to a redirect or a friendly "Access denied" panel.
// They do NOT prevent the underlying RLS layer from doing its own check;
// they're just there to keep the UI honest.
// =====================================================================

import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

export function RequireAuth({ children }) {
  const { loading, session } = useAuthStore();
  const location = useLocation();

  if (loading) return <SplashLoader />;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export function RequireRole({ roles, children }) {
  const { loading, profile } = useAuthStore();
  if (loading) return <SplashLoader />;
  if (!profile) return <Navigate to="/login" replace />;
  if (!roles.includes(profile.role)) {
    return (
      <div className="up-card" style={{ maxWidth: 480, margin: '64px auto' }}>
        <h2 className="up-card__title">Access denied</h2>
        <p>
          You don't have permission to view this page. Required role: <strong>{roles.join(' or ')}</strong>.
          Your role: <strong>{profile.role}</strong>.
        </p>
        <p style={{ color: 'var(--up-ink-soft)', fontSize: 'var(--up-text-sm)' }}>
          If you think this is wrong, ask the owner to check your account.
        </p>
      </div>
    );
  }
  return children;
}

/**
 * Step-up MFA guard for sensitive surfaces (P&L, admin expenses).
 * The user must have passed TOTP within the last `maxAgeMinutes`.
 * If not, render the step-up screen instead of children.
 */
export function RequireFreshTotp({ children, maxAgeMinutes = 15 }) {
  const totpVerifiedAt = useAuthStore((s) => s.totpVerifiedAt);
  if (!totpVerifiedAt) return <TotpStepUpPanel reason="initial" />;
  const ageMs = Date.now() - new Date(totpVerifiedAt).getTime();
  if (ageMs > maxAgeMinutes * 60 * 1000) return <TotpStepUpPanel reason="expired" />;
  return children;
}

function SplashLoader() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--up-ink-soft)',
    }}>
      Loading…
    </div>
  );
}

function TotpStepUpPanel({ reason }) {
  // Real TOTP step-up flow lives in pages/PnLLanding.jsx — this is the
  // fallback when someone deep-links to a P&L route without verifying.
  return (
    <div className="up-card" style={{ maxWidth: 520, margin: '64px auto' }}>
      <h2 className="up-card__title">Two-factor required</h2>
      <p>
        {reason === 'expired'
          ? 'Your TOTP verification expired. Please verify again to continue.'
          : 'This area is protected. Verify with your authenticator app to continue.'}
      </p>
      <p style={{ marginTop: 16 }}>
        <a href="/pnl" className="up-btn up-btn--primary">Go to P&amp;L verification</a>
      </p>
    </div>
  );
}
