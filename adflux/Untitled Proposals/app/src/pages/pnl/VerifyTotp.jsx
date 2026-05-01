// =====================================================================
// Step-up TOTP screen for users who are already enrolled.
//
// On success: markTotpVerified() in the auth store + log_pnl_access.
// =====================================================================

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { getVerifiedTotpFactor, challengeAndVerify } from '@/lib/mfaApi';
import { callRpc } from '@/lib/supabase';

export default function VerifyTotp({ reason = 'initial', onVerified }) {
  const profile = useAuthStore((s) => s.profile);
  const markTotpVerified = useAuthStore((s) => s.markTotpVerified);

  const [factor, setFactor] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const f = await getVerifiedTotpFactor();
        if (!cancelled) {
          setFactor(f);
          if (!f) setError('No verified TOTP factor on this account. Re-enroll from the previous step.');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (!factor) return;
    setError(null);
    setVerifying(true);
    try {
      if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code');
      await challengeAndVerify(factor.id, code);
      markTotpVerified();
      // Open the audit trail with a "session start" entry
      try {
        await callRpc('log_pnl_access', {
          p_access_type: 'VIEW_SUMMARY',
          p_totp_verified_at: new Date().toISOString(),
          p_user_agent: navigator.userAgent,
        });
      } catch { /* non-fatal */ }
      onVerified?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="up-page">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">P&amp;L — Two-factor required</h1>
          <div className="up-page__sub">
            {reason === 'expired'
              ? 'Your 15-minute verification window expired. Verify again to continue.'
              : 'Sensitive financial data. Verify with your authenticator app.'}
          </div>
        </div>
      </header>

      <form onSubmit={onSubmit} className="up-card up-stack-4" style={{ maxWidth: 420 }}>
        {loading && <div>Loading factor…</div>}
        {error && <div className="up-field__error">{error}</div>}
        {factor && (
          <>
            <div className="up-field">
              <label className="up-field__label" htmlFor="code">6-digit code</label>
              <input
                id="code"
                inputMode="numeric"
                maxLength={6}
                pattern="\d{6}"
                className="up-input"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                style={{ fontSize: 22, letterSpacing: '0.3em', textAlign: 'center' }}
                autoFocus
              />
            </div>
            <button type="submit" className="up-btn up-btn--primary"
                    disabled={verifying || code.length !== 6}>
              {verifying ? 'Verifying…' : 'Verify'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--up-ink-soft)', margin: 0 }}>
              Signed in as <strong>{profile?.full_name}</strong> · {profile?.role}.
              Verification stays valid for 15 minutes.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
