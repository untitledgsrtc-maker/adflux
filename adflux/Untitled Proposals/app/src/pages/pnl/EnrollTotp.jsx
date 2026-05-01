// =====================================================================
// First-time TOTP enrollment.
//
// Steps:
//   1. enrollTotp() — Supabase returns SVG QR + base32 secret
//   2. User scans the QR (Google Authenticator / 1Password / Aegis)
//   3. User enters the first 6-digit code → challengeAndVerify()
//   4. On success: markUserTotpEnrolled(true) + markTotpVerified()
//
// We deliberately don't show "skip" or "remind me later" — P&L is
// blocked until enrolled. Recovery code generation is a separate
// feature (deferred).
// =====================================================================

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  enrollTotp, challengeAndVerify, markUserTotpEnrolled, listFactors, unenrollFactor,
} from '@/lib/mfaApi';

export default function EnrollTotp({ onEnrolled }) {
  const profile = useAuthStore((s) => s.profile);
  const markTotpVerified = useAuthStore((s) => s.markTotpVerified);

  const [enroll, setEnroll] = useState(null);   // { factorId, qrCode, secret, uri }
  const [code, setCode] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  // Bootstrap: clean any half-enrolled (status='unverified') factor and start fresh
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const factors = await listFactors();
        const stale = (factors?.totp ?? []).filter((f) => f.status === 'unverified');
        for (const f of stale) await unenrollFactor(f.id);

        const res = await enrollTotp(`${profile?.full_name || 'Untitled'} — P&L`);
        if (!cancelled) setEnroll(res);
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.full_name]);

  async function onVerify(e) {
    e.preventDefault();
    if (!enroll) return;
    setError(null);
    setVerifying(true);
    try {
      if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code from your authenticator');
      await challengeAndVerify(enroll.factorId, code);
      await markUserTotpEnrolled(true);
      markTotpVerified();
      onEnrolled?.();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">Set up two-factor authentication</h1>
          <div className="up-page__sub">Required to access P&amp;L · {profile?.full_name} ({profile?.role})</div>
        </div>
      </header>

      <div className="up-card up-stack-4" style={{ maxWidth: 540 }}>
        {loading && <div>Generating enrollment code…</div>}
        {error && <div className="up-field__error">{error}</div>}
        {enroll && (
          <>
            <ol style={{ paddingLeft: 20, margin: 0, color: 'var(--up-ink-muted)' }}>
              <li>Open your authenticator app (Google Authenticator, 1Password, Aegis, etc.).</li>
              <li>Scan the QR below — or enter the secret manually if scanning fails.</li>
              <li>Type the 6-digit code that appears in the app.</li>
            </ol>

            <div style={{
              background: '#fff', padding: 16, borderRadius: 8,
              display: 'flex', justifyContent: 'center', border: '1px solid var(--up-line-soft)',
            }}>
              {/* Supabase returns ready-to-render SVG markup */}
              <div dangerouslySetInnerHTML={{ __html: enroll.qrCode }}
                   style={{ width: 200, height: 200 }}
                   aria-label="TOTP enrollment QR code" />
            </div>

            <div className="up-field">
              <button type="button" className="up-btn up-btn--ghost up-btn--sm"
                      onClick={() => setShowSecret((s) => !s)}>
                {showSecret ? 'Hide' : "Can't scan? Show secret"}
              </button>
              {showSecret && (
                <div style={{
                  fontFamily: 'monospace', fontSize: 13,
                  background: 'var(--up-bg-tint)', padding: '8px 10px',
                  borderRadius: 6, marginTop: 8,
                  wordBreak: 'break-all',
                }}>
                  {enroll.secret}
                </div>
              )}
            </div>

            <form onSubmit={onVerify} className="up-stack-3">
              <div className="up-field">
                <label className="up-field__label">6-digit code</label>
                <input
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
                {verifying ? 'Verifying…' : 'Confirm + activate'}
              </button>
            </form>

            <p className="up-field__hint" style={{ margin: 0 }}>
              Save the secret in your password manager as a backup. If you lose access to your
              authenticator, the owner can re-enroll you from the Admin page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
