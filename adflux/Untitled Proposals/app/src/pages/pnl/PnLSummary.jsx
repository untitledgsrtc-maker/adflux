// =====================================================================
// FY-by-FY P&L summary, sourced from public.v_pnl_summary_fy.
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { fetchPnLSummaryFy, qkPnL } from '@/lib/pnlApi';
import { fmtInrPlain } from '@/lib/format';

export default function PnLSummary() {
  const totpVerifiedAt = useAuthStore((s) => s.totpVerifiedAt);
  const q = useQuery({
    queryKey: qkPnL.summaryFy(),
    queryFn: () => fetchPnLSummaryFy({ totpVerifiedAt }),
  });

  return (
    <div className="up-stack-4">
      <div className="up-card">
        <h3 className="up-card__title">Consolidated P&amp;L by FY</h3>
        <div className="up-field__hint">
          Math: <code>final_profit = sum(business_profit on each WON proposal) − sum(monthly_admin_expenses)</code>.
          No revenue-ratio split.
        </div>
      </div>

      {q.isLoading && <div className="up-card">Loading…</div>}
      {q.error && <div className="up-card up-field__error">Failed: {String(q.error.message)}</div>}
      {q.data && q.data.length === 0 && (
        <div className="up-card up-field__hint">No P&amp;L data yet — no WON proposals or admin expenses on file.</div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="up-card" style={{ overflowX: 'auto' }}>
          <table className="up-table">
            <thead>
              <tr>
                <th>FY</th>
                <th style={{ textAlign: 'right' }}>Won</th>
                <th style={{ textAlign: 'right' }}>Gross rev (₹)</th>
                <th style={{ textAlign: 'right' }}>Net rev (₹)</th>
                <th style={{ textAlign: 'right' }}>Media payout (₹)</th>
                <th style={{ textAlign: 'right' }}>Production (₹)</th>
                <th style={{ textAlign: 'right' }}>Commission (₹)</th>
                <th style={{ textAlign: 'right' }}>Other (₹)</th>
                <th style={{ textAlign: 'right' }}>Business profit (₹)</th>
                <th style={{ textAlign: 'right' }}>Admin exp (₹)</th>
                <th style={{ textAlign: 'right', background: 'var(--up-bg-tint)' }}>Final profit (₹)</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((row) => (
                <tr key={row.fy_label}>
                  <td><strong>{row.fy_label}</strong></td>
                  <td style={{ textAlign: 'right' }}>{row.won_proposals_count}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.gross_revenue)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.net_revenue)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.media_owner_payout_total)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.production_cost_total)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.partner_commission_total)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.other_direct_cost_total)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.total_business_profit)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(row.total_admin_expenses)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, background: 'var(--up-bg-tint)',
                                color: row.final_profit < 0 ? '#b91c1c' : '#15803d' }}>
                    {fmtInrPlain(row.final_profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
