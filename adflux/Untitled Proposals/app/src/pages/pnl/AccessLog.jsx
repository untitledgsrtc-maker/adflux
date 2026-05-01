// =====================================================================
// pnl_access_log viewer. Read-only — the table is append-only at the
// DB layer (no UPDATE/DELETE policies). Filter by access_type and
// date range.
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAccessLog, qkPnL } from '@/lib/pnlApi';

const ACCESS_TYPES = [
  'VIEW_SUMMARY', 'VIEW_PROPOSAL_PNL', 'VIEW_ADMIN_EXPENSES',
  'EXPORT_PDF', 'EXPORT_CSV',
  'EDIT_PROPOSAL_PNL', 'EDIT_ADMIN_EXPENSE',
  'FINALIZE_PNL',
];

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function AccessLog() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [accessType, setAccessType] = useState('');

  const filters = {
    from: `${from}T00:00:00`,
    to: `${to}T23:59:59`,
    accessType: accessType || null,
  };
  const q = useQuery({
    queryKey: qkPnL.accessLog(filters),
    queryFn: () => fetchAccessLog(filters),
  });

  return (
    <div className="up-stack-4">
      <div className="up-card">
        <h3 className="up-card__title">P&amp;L access log</h3>
        <div className="up-field__hint">
          Append-only audit trail. Every view, edit, and export goes here. The DB has no UPDATE/DELETE policies on this table.
        </div>
      </div>

      <div className="up-card">
        <div className="up-grid-3">
          <div className="up-field">
            <label className="up-field__label">From</label>
            <input type="date" className="up-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="up-field">
            <label className="up-field__label">To</label>
            <input type="date" className="up-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Type</label>
            <select className="up-select" value={accessType} onChange={(e) => setAccessType(e.target.value)}>
              <option value="">All</option>
              {ACCESS_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="up-card" style={{ overflowX: 'auto' }}>
        {q.isLoading && <div>Loading…</div>}
        {q.error && <div className="up-field__error">{String(q.error.message)}</div>}
        {q.data && q.data.length === 0 && <div className="up-field__hint">No log entries in this range.</div>}
        {q.data && q.data.length > 0 && (
          <table className="up-table">
            <thead>
              <tr>
                <th>When (IST)</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Target</th>
                <th>FY</th>
                <th>TOTP at</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td>{fmtTs(r.accessed_at)}</td>
                  <td>{r.user_email}</td>
                  <td><span className="up-chip">{r.user_role}</span></td>
                  <td><span className="up-chip">{r.access_type.replace(/_/g, ' ')}</span></td>
                  <td>
                    {r.proposal_id && <div className="up-field__hint">prop: {String(r.proposal_id).slice(0, 8)}…</div>}
                    {r.admin_expense_id && <div className="up-field__hint">exp: {String(r.admin_expense_id).slice(0, 8)}…</div>}
                  </td>
                  <td>{r.fy_label || '—'}</td>
                  <td>{fmtTs(r.totp_verified_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
