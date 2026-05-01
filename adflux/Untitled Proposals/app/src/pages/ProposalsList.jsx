// =====================================================================
// Proposals list — table with filters by status, media, FY, client.
// (Stub: real implementation lives in milestone #7 with the wizard.)
// =====================================================================

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fmtDateIn, fmtInr } from '@/lib/format';

const STATUS_CHIP = {
  DRAFT: 'up-chip--draft',
  SENT: 'up-chip--sent',
  WON: 'up-chip--won',
  PARTIAL_PAID: 'up-chip--partial',
  PAID: 'up-chip--paid',
  CANCELLED: 'up-chip--cancelled',
  REJECTED: 'up-chip--rejected',
  EXPIRED: 'up-chip--expired',
};

export default function ProposalsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['proposals', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposals')
        .select('id, ref_no, media_code, status, proposal_date, client_name_snapshot, total_amount, total_gross_received, payment_status')
        .order('proposal_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="up-page">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">Proposals</h1>
          <div className="up-page__sub">Latest 100 proposals across all media.</div>
        </div>
        <Link to="/proposals/new" className="up-btn up-btn--primary">+ New Proposal</Link>
      </header>

      <div className="up-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading && <div style={{ padding: 24 }}>Loading…</div>}
        {error && <div style={{ padding: 24, color: '#b91c1c' }}>{error.message}</div>}
        {data && (
          <table className="up-table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Date</th>
                <th>Media</th>
                <th>Client</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Received</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, color: 'var(--up-ink-soft)', textAlign: 'center' }}>
                  No proposals yet. <Link to="/proposals/new">Create the first one</Link>.
                </td></tr>
              )}
              {data.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/proposals/${p.id}`}>{p.ref_no || '(no ref yet)'}</Link></td>
                  <td>{fmtDateIn(p.proposal_date)}</td>
                  <td>{p.media_code}</td>
                  <td>{p.client_name_snapshot}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInr(p.total_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInr(p.total_gross_received)}</td>
                  <td><span className={`up-chip ${STATUS_CHIP[p.status] || ''}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
