// =====================================================================
// Dashboard — at-a-glance counters + recent activity.
// Counters live in the v_pnl_summary_fy view + a small client-side
// proposal-status query. P&L numbers are role-gated on render.
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { fmtInr, currentFy } from '@/lib/format';

function useStatusCounts() {
  return useQuery({
    queryKey: ['dashboard', 'status-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposals')
        .select('status', { count: 'exact', head: false });
      if (error) throw error;
      const counts = data.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      return counts;
    },
  });
}

function useFySummary(enabled) {
  return useQuery({
    enabled,
    queryKey: ['dashboard', 'fy', currentFy()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_pnl_summary_fy')
        .select('*')
        .eq('fy_label', currentFy())
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export default function Dashboard() {
  const { profile, isOwnerOrCo } = useAuthStore();
  const showPnl = isOwnerOrCo();
  const counts = useStatusCounts();
  const fy     = useFySummary(showPnl);

  return (
    <div className="up-page">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">Welcome, {profile?.full_name?.split(' ')[0]}</h1>
          <div className="up-page__sub">FY {currentFy()} · here's where things stand.</div>
        </div>
        <div className="up-row">
          <Link to="/proposals/new" className="up-btn up-btn--primary">+ New Proposal</Link>
        </div>
      </header>

      <section className="up-grid-4">
        <Stat label="Drafts"        value={counts.data?.DRAFT       ?? '—'} to="/proposals?status=DRAFT" />
        <Stat label="Sent"          value={counts.data?.SENT        ?? '—'} to="/proposals?status=SENT" />
        <Stat label="Won"           value={counts.data?.WON         ?? '—'} to="/proposals?status=WON" />
        <Stat label="Partial / Paid" value={
          ((counts.data?.PARTIAL_PAID || 0) + (counts.data?.PAID || 0)) || '—'
        } to="/proposals?status=PAID" />
      </section>

      {showPnl && (
        <section className="up-card">
          <h3 className="up-card__title">FY {currentFy()} — P&amp;L snapshot</h3>
          {fy.isLoading ? (
            <div style={{ color: 'var(--up-ink-soft)' }}>Loading…</div>
          ) : fy.error ? (
            <div style={{ color: '#b91c1c' }}>{fy.error.message}</div>
          ) : !fy.data ? (
            <div style={{ color: 'var(--up-ink-soft)' }}>No data yet.</div>
          ) : (
            <div className="up-grid-3">
              <KV label="Gross revenue"          value={fmtInr(fy.data.gross_revenue)} />
              <KV label="Business profit"        value={fmtInr(fy.data.total_business_profit)} />
              <KV label="Admin expenses"         value={fmtInr(fy.data.total_admin_expenses)} />
              <KV label="Net profit (final)"     value={fmtInr(fy.data.final_profit)} emphasis />
              <KV label="Won proposals"          value={fy.data.won_proposals_count ?? 0} />
              <KV label="Outstanding (calc)"     value={fmtInr(
                Number(fy.data.gross_revenue || 0) - Number(fy.data.net_revenue || 0)
              )} hint="TDS deducted at source" />
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Link to="/pnl" className="up-btn up-btn--sm">Open P&amp;L →</Link>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, to }) {
  const inner = (
    <div className="up-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, color: 'var(--up-ink-soft)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontFamily: 'var(--up-font-display)', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
  return to ? <Link to={to} style={{ color: 'inherit' }}>{inner}</Link> : inner;
}

function KV({ label, value, emphasis, hint }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--up-ink-soft)' }}>{label}</div>
      <div style={{
        fontSize: emphasis ? 22 : 16,
        fontWeight: emphasis ? 600 : 500,
        fontFamily: 'var(--up-font-display)',
        color: emphasis ? 'var(--up-accent-deep)' : 'var(--up-ink)',
      }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--up-ink-soft)' }}>{hint}</div>}
    </div>
  );
}
