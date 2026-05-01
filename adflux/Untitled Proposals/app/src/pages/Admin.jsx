// =====================================================================
// Owner-only admin page. Currently exposes:
//   - "Run expire-stale-proposals now" (manual trigger of the daily cron)
// User management, MFA enrollment, recovery codes, master rate edits
// arrive in later milestones once the Supabase project is wired up.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callRpc } from '@/lib/supabase';
import { qk } from '@/lib/proposalApi';

export default function Admin() {
  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">Admin</h1>
          <div className="up-page__sub">Owner-only. Users, MFA, master rates, scheduled jobs.</div>
        </div>
      </header>

      <ExpireStaleProposalsCard />

      <div className="up-card">
        <h3 className="up-card__title">Coming soon</h3>
        <ul style={{ margin: '4px 0 0 18px', color: 'var(--up-ink-muted)' }}>
          <li>User management (invite, role change, deactivate)</li>
          <li>MFA enrollment + recovery codes (owner + co_owner)</li>
          <li>Master rate edits (DAVP / Agency, with effective_from versioning)</li>
          <li>Audit log viewer</li>
        </ul>
      </div>
    </div>
  );
}

function ExpireStaleProposalsCard() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState(null);

  const mut = useMutation({
    mutationFn: () => callRpc('expire_stale_proposals'),
    onSuccess: (count) => {
      setLastResult({ ok: true, count: Number(count ?? 0), at: new Date().toISOString() });
      qc.invalidateQueries({ queryKey: qk.proposals() });
    },
    onError: (err) => setLastResult({ ok: false, error: err.message || String(err) }),
  });

  return (
    <div className="up-card up-stack-3">
      <h3 className="up-card__title" style={{ margin: 0 }}>Auto-expiry job</h3>
      <p style={{ margin: 0, color: 'var(--up-ink-muted)' }}>
        Daily Vercel cron at <strong>02:00 IST</strong> calls{' '}
        <code>public.expire_stale_proposals()</code>. SENT proposals with no activity for{' '}
        <code>expire_after_days</code> (default 120) flip to <strong>EXPIRED</strong>.
      </p>
      <div className="up-row" style={{ gap: 8 }}>
        <button className="up-btn" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Running…' : 'Run now'}
        </button>
        {lastResult?.ok && (
          <span className="up-field__hint">
            ✓ Last run expired <strong>{lastResult.count}</strong> proposal{lastResult.count === 1 ? '' : 's'}.
          </span>
        )}
        {lastResult && !lastResult.ok && (
          <span className="up-field__error">Failed: {lastResult.error}</span>
        )}
      </div>
    </div>
  );
}
