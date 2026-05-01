// =====================================================================
// Per-proposal P&L editor.
// Left: list of WON proposals (with computed business_profit chip).
// Right: edit form with cost components + live business_profit preview.
// Owner-only writes; co_owner gets a read-only view.
// =====================================================================

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  fetchProposalPnLList, fetchProposalPnL,
  updateProposalPnL, finalizeProposalPnL,
  qkPnL, calcBusinessProfit, calcPartnerCommissionAmount,
} from '@/lib/pnlApi';
import { fmtInrPlain, fmtDateIn } from '@/lib/format';

export default function ProposalPnL() {
  const totpVerifiedAt = useAuthStore((s) => s.totpVerifiedAt);
  const isOwner = useAuthStore((s) => s.isOwner());

  const listQ = useQuery({
    queryKey: qkPnL.proposalPnlList(),
    queryFn: () => fetchProposalPnLList({ totpVerifiedAt }),
  });
  const [pickedId, setPickedId] = useState(null);

  // Auto-pick first row on load
  useEffect(() => {
    if (!pickedId && listQ.data?.length) setPickedId(listQ.data[0].proposal_id);
  }, [listQ.data, pickedId]);

  return (
    <div className="up-grid-2" style={{ gap: 16, alignItems: 'start' }}>
      <div className="up-card" style={{ minWidth: 0 }}>
        <h3 className="up-card__title">WON proposals</h3>
        {listQ.isLoading && <div>Loading…</div>}
        {listQ.error && <div className="up-field__error">Failed: {String(listQ.error.message)}</div>}
        {listQ.data && listQ.data.length === 0 && (
          <div className="up-field__hint">No WON proposals yet.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 600, overflow: 'auto' }}>
          {listQ.data?.map((row) => {
            const picked = pickedId === row.proposal_id;
            return (
              <button key={row.id} type="button"
                      className={`up-pickerbtn ${picked ? 'up-pickerbtn--added' : ''}`}
                      onClick={() => setPickedId(row.proposal_id)}>
                <div className="up-row up-row--between">
                  <strong>{row.proposals?.ref_no}</strong>
                  {row.is_finalized && <span className="up-chip">Finalized</span>}
                </div>
                <div className="up-pickerbtn__sub up-gu">{row.proposals?.client_name_gu_snapshot}</div>
                <div className="up-pickerbtn__sub">
                  Profit: ₹{fmtInrPlain(row.business_profit)} ·
                  Net rev: ₹{fmtInrPlain(row.net_revenue)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {pickedId
          ? <PnLEditor proposalId={pickedId} canEdit={isOwner} totpVerifiedAt={totpVerifiedAt} />
          : <div className="up-card up-field__hint">Pick a proposal on the left.</div>
        }
      </div>
    </div>
  );
}

function PnLEditor({ proposalId, canEdit, totpVerifiedAt }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qkPnL.proposalPnl(proposalId),
    queryFn: () => fetchProposalPnL(proposalId, { totpVerifiedAt }),
  });

  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  // Sync the form when the row loads/changes
  useEffect(() => {
    if (!q.data) return;
    setForm({
      media_owner_payout: q.data.media_owner_payout ?? 0,
      media_owner_notes: q.data.media_owner_notes ?? '',
      production_cost: q.data.production_cost ?? 0,
      production_notes: q.data.production_notes ?? '',
      partner_commission_percent: q.data.partner_commission_percent ?? 0,
      partner_name: q.data.partner_name ?? '',
      partner_invoice_ref: q.data.partner_invoice_ref ?? '',
      partner_payment_ref: q.data.partner_payment_ref ?? '',
      partner_tds_deducted: q.data.partner_tds_deducted ?? 0,
      other_direct_cost: q.data.other_direct_cost ?? 0,
      other_direct_cost_notes: q.data.other_direct_cost_notes ?? '',
      notes: q.data.notes ?? '',
    });
  }, [q.data?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: (patch) => updateProposalPnL(proposalId, patch, { totpVerifiedAt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkPnL.proposalPnl(proposalId) });
      qc.invalidateQueries({ queryKey: qkPnL.proposalPnlList() });
      qc.invalidateQueries({ queryKey: qkPnL.summaryFy() });
      setError(null);
    },
    onError: (err) => setError(err.message || String(err)),
  });

  const finalizeMut = useMutation({
    mutationFn: () => finalizeProposalPnL(proposalId, { totpVerifiedAt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkPnL.proposalPnl(proposalId) });
      qc.invalidateQueries({ queryKey: qkPnL.proposalPnlList() });
    },
  });

  if (q.isLoading || !form) return <div className="up-card">Loading…</div>;
  if (q.error) return <div className="up-card up-field__error">{String(q.error.message)}</div>;
  if (!q.data) return <div className="up-card up-field__hint">No P&amp;L row for this proposal yet (auto-created on WON).</div>;

  const data = q.data;
  const netRev = Number(data.net_revenue);
  const liveCommission = calcPartnerCommissionAmount(netRev, form.partner_commission_percent);
  const liveProfit = calcBusinessProfit({
    net_revenue: netRev,
    media_owner_payout: form.media_owner_payout,
    production_cost: form.production_cost,
    partner_commission_amount: liveCommission,
    other_direct_cost: form.other_direct_cost,
  });

  const locked = data.is_finalized;
  const numField = (k) => (e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) || 0 }));
  const txtField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function save(e) {
    e.preventDefault();
    saveMut.mutate(form);
  }

  return (
    <div className="up-stack-4">
      <div className="up-card up-stack-3">
        <div className="up-row up-row--between">
          <div>
            <h3 className="up-card__title" style={{ margin: 0 }}>{data.proposals?.ref_no}</h3>
            <div className="up-field__hint">{data.proposals?.client_name_snapshot}</div>
          </div>
          {locked && <span className="up-chip up-chip--paid">Finalized</span>}
        </div>
        <div className="up-grid-3">
          <div><span className="up-field__hint">Gross rev</span><br/>₹ {fmtInrPlain(data.gross_revenue)}</div>
          <div><span className="up-field__hint">TDS deducted</span><br/>₹ {fmtInrPlain(data.total_tds_deducted)}</div>
          <div><span className="up-field__hint">Net rev (cash in)</span><br/><strong>₹ {fmtInrPlain(data.net_revenue)}</strong></div>
        </div>
      </div>

      <form onSubmit={save} className="up-card up-stack-4">
        <h3 className="up-card__title" style={{ margin: 0 }}>Costs</h3>
        {!canEdit && <div className="up-field__hint">Read-only — owner-only edits.</div>}
        {locked && <div className="up-field__hint">Finalized rows can't be edited.</div>}

        <fieldset disabled={!canEdit || locked} style={{ border: 0, padding: 0, margin: 0 }} className="up-stack-4">
          <div className="up-grid-2">
            <div className="up-field">
              <label className="up-field__label">Media owner payout (₹)</label>
              <input type="number" step="0.01" className="up-input"
                     value={form.media_owner_payout} onChange={numField('media_owner_payout')} />
              <input className="up-input" placeholder="Notes (optional)"
                     value={form.media_owner_notes} onChange={txtField('media_owner_notes')}
                     style={{ marginTop: 4 }} />
            </div>
            <div className="up-field">
              <label className="up-field__label">Production cost (₹)</label>
              <input type="number" step="0.01" className="up-input"
                     value={form.production_cost} onChange={numField('production_cost')} />
              <input className="up-input" placeholder="Notes (optional)"
                     value={form.production_notes} onChange={txtField('production_notes')}
                     style={{ marginTop: 4 }} />
            </div>
          </div>

          <div className="up-card" style={{ background: 'var(--up-bg-tint)', padding: 12 }}>
            <strong>Partner commission</strong>
            <div className="up-field__hint" style={{ marginBottom: 8 }}>
              Legitimate partner/sales-channel commission with paper trail (invoice + bank transfer + 194C TDS).
              Stored as % of net revenue. Amount auto-resolves on save.
            </div>
            <div className="up-grid-3">
              <div className="up-field">
                <label className="up-field__label">Commission %</label>
                <input type="number" step="0.01" min={0} max={100} className="up-input"
                       value={form.partner_commission_percent} onChange={numField('partner_commission_percent')} />
                <div className="up-field__hint">= ₹{fmtInrPlain(liveCommission)} on net rev</div>
              </div>
              <div className="up-field">
                <label className="up-field__label">Partner name</label>
                <input className="up-input" value={form.partner_name} onChange={txtField('partner_name')} />
              </div>
              <div className="up-field">
                <label className="up-field__label">Partner TDS deducted (₹)</label>
                <input type="number" step="0.01" className="up-input"
                       value={form.partner_tds_deducted} onChange={numField('partner_tds_deducted')} />
              </div>
            </div>
            <div className="up-grid-2" style={{ marginTop: 8 }}>
              <div className="up-field">
                <label className="up-field__label">Partner invoice ref</label>
                <input className="up-input" value={form.partner_invoice_ref} onChange={txtField('partner_invoice_ref')} />
              </div>
              <div className="up-field">
                <label className="up-field__label">Our payment ref (UTR / cheque)</label>
                <input className="up-input" value={form.partner_payment_ref} onChange={txtField('partner_payment_ref')} />
              </div>
            </div>
          </div>

          <div className="up-field">
            <label className="up-field__label">Other direct cost (₹)</label>
            <input type="number" step="0.01" className="up-input"
                   value={form.other_direct_cost} onChange={numField('other_direct_cost')} />
            <input className="up-input" placeholder="Notes (optional)"
                   value={form.other_direct_cost_notes} onChange={txtField('other_direct_cost_notes')}
                   style={{ marginTop: 4 }} />
          </div>

          <div className="up-field">
            <label className="up-field__label">P&amp;L notes</label>
            <textarea className="up-textarea" rows={2}
                      value={form.notes} onChange={txtField('notes')} />
          </div>
        </fieldset>

        <div className="up-card" style={{ background: '#fffaf0', padding: 12 }}>
          <strong>Live business profit preview: ₹ {fmtInrPlain(liveProfit)}</strong>
          <div className="up-field__hint">
            Saved business profit (DB): ₹ {fmtInrPlain(data.business_profit)}.
            DB recomputes on save; deltas above are pre-save preview.
          </div>
        </div>

        {error && <div className="up-field__error">{error}</div>}

        <div className="up-row up-row--between">
          {canEdit && !locked && (
            <button type="button" className="up-btn up-btn--ghost"
                    onClick={() => {
                      if (confirm('Finalize this P&L row? It becomes read-only and stops auto-syncing with new receipts.')) {
                        finalizeMut.mutate();
                      }
                    }}
                    disabled={finalizeMut.isPending}>
              {finalizeMut.isPending ? 'Finalizing…' : 'Finalize'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          {canEdit && !locked && (
            <button type="submit" className="up-btn up-btn--primary" disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
