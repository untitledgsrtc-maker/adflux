// =====================================================================
// Proposal detail — shows line items, receipts, payment status, and
// the PDF download buttons (proposal PDF, receipt PDFs, settlement).
// Add-receipt button is gated on status WON / PARTIAL_PAID / PAID.
// =====================================================================

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fmtDateIn, fmtInrPlain } from '@/lib/format';
import {
  fetchReceiptsByProposal, qkRcpt,
  downloadProposalPdf, downloadReceiptPdf, downloadSettlementPdf,
} from '@/lib/receiptApi';
import { useAuthStore } from '@/store/authStore';

import ReceiptForm from './payments/ReceiptForm';
import SoftDeleteModal from './payments/SoftDeleteModal';
import StatusTransitionModal from './proposal-status/StatusTransitionModal';
import { allowedTransitions } from '@/lib/statusApi';

export default function ProposalDetail() {
  const { id } = useParams();
  const isOwner = useAuthStore((s) => s.isOwner());

  const propQ = useQuery({
    queryKey: ['proposals', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposals').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const linesQ = useQuery({
    queryKey: ['proposal-lines', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposal_line_items').select('*').eq('proposal_id', id).order('line_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const receiptsQ = useQuery({
    queryKey: qkRcpt.receiptsByProposal(id),
    queryFn: () => fetchReceiptsByProposal(id),
  });

  const [showAddReceipt, setShowAddReceipt] = useState(false);
  const [deletingReceipt, setDeletingReceipt] = useState(null);
  const [downloadErr, setDownloadErr] = useState(null);
  const [transitionTarget, setTransitionTarget] = useState(null);

  if (propQ.isLoading) return <div className="up-page"><p>Loading…</p></div>;
  if (propQ.error)     return <div className="up-page"><p style={{ color: '#b91c1c' }}>{propQ.error.message}</p></div>;
  const data = propQ.data;
  if (!data) return <div className="up-page"><p>Not found. <Link to="/proposals">Back to list</Link></p></div>;

  const canAddReceipt = ['WON', 'PARTIAL_PAID', 'PAID'].includes(data.status);
  const expected = Number(data.po_amount || data.total_amount || 0);
  const got = Number(data.total_gross_received || 0);
  const remaining = expected - got;

  async function pdfWrapper(fn) {
    setDownloadErr(null);
    try { await fn(); } catch (e) { setDownloadErr(e?.message || String(e)); }
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">{data.ref_no || 'Proposal'}</h1>
          <div className="up-page__sub">
            {fmtDateIn(data.proposal_date)} · {data.media_code} · {data.rate_type} · {data.client_name_snapshot}
          </div>
        </div>
        <div className="up-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className={`up-chip up-chip--${(data.status || 'draft').toLowerCase()}`}>{data.status}</span>
          <button className="up-btn up-btn--sm" onClick={() => pdfWrapper(() => downloadProposalPdf(data.id))}>
            Proposal PDF
          </button>
          <button className="up-btn up-btn--sm" onClick={() => pdfWrapper(() => downloadSettlementPdf(data.id))}>
            Settlement PDF
          </button>
          {allowedTransitions(data.status).map((t) => (
            <button key={t.target}
                    className={`up-btn up-btn--sm ${
                      t.kind === 'primary' ? 'up-btn--primary'
                      : t.kind === 'danger' ? 'up-btn--danger'
                      : 'up-btn--ghost'
                    }`}
                    onClick={() => setTransitionTarget(t.target)}>
              {t.label}
            </button>
          ))}
          {canAddReceipt && (
            <button className="up-btn up-btn--sm up-btn--primary" onClick={() => setShowAddReceipt(true)}>
              + Receipt
            </button>
          )}
        </div>
      </header>

      {downloadErr && (
        <div className="up-card" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
          <strong style={{ color: '#b91c1c' }}>PDF download failed:</strong>{' '}
          <span className="up-field__hint" style={{ color: '#b91c1c' }}>{downloadErr}</span>
        </div>
      )}

      <div className="up-grid-4">
        <div className="up-card">
          <div className="up-field__hint">Quoted</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>₹ {fmtInrPlain(data.total_amount)}</div>
        </div>
        <div className="up-card">
          <div className="up-field__hint">PO value</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{data.po_amount ? `₹ ${fmtInrPlain(data.po_amount)}` : '—'}</div>
          {data.po_number && <div className="up-field__hint">PO {data.po_number}</div>}
        </div>
        <div className="up-card">
          <div className="up-field__hint">Received gross</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>₹ {fmtInrPlain(got)}</div>
          <div className="up-field__hint">{data.payment_status}</div>
        </div>
        <div className="up-card">
          <div className="up-field__hint">Outstanding</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: remaining > 0 ? '#b45309' : '#15803d' }}>
            ₹ {fmtInrPlain(remaining)}
          </div>
        </div>
      </div>

      <div className="up-card">
        <h3 className="up-card__title">Subject</h3>
        {data.subject_en && <div>{data.subject_en}</div>}
        {data.subject_gu && <div className="up-gu" style={{ marginTop: 4 }}>{data.subject_gu}</div>}
      </div>

      {(data.submission_mode || data.po_number || data.cancelled_reason || data.rejected_reason) && (
        <div className="up-card up-stack-3">
          <h3 className="up-card__title" style={{ margin: 0 }}>Status details</h3>
          {data.submission_mode && (
            <div>
              <span className="up-field__hint">Submitted via:</span>{' '}
              <strong>{data.submission_mode}</strong>
              {data.sent_at && <span className="up-field__hint"> · on {fmtDateIn(data.sent_at)}</span>}
              {data.office_copy_url && (
                <div className="up-field__hint">
                  Office copy:{' '}
                  <a href={data.office_copy_url} target="_blank" rel="noopener noreferrer">
                    {data.office_copy_url}
                  </a>
                </div>
              )}
            </div>
          )}
          {data.po_number && (
            <div>
              <span className="up-field__hint">PO:</span>{' '}
              <strong>{data.po_number}</strong>
              {data.po_date && <span className="up-field__hint"> · dated {fmtDateIn(data.po_date)}</span>}
              {data.po_amount && <span className="up-field__hint"> · ₹{fmtInrPlain(data.po_amount)}</span>}
              {data.po_file_url && (
                <div className="up-field__hint">
                  File:{' '}
                  <a href={data.po_file_url} target="_blank" rel="noopener noreferrer">
                    {data.po_file_url}
                  </a>
                </div>
              )}
            </div>
          )}
          {data.cancelled_reason && (
            <div>
              <span className="up-field__hint">Cancelled:</span>{' '}
              {data.cancelled_at && <span className="up-field__hint">{fmtDateIn(data.cancelled_at)} — </span>}
              <em>{data.cancelled_reason}</em>
            </div>
          )}
          {data.rejected_reason && (
            <div>
              <span className="up-field__hint">Rejected:</span>{' '}
              {data.rejected_at && <span className="up-field__hint">{fmtDateIn(data.rejected_at)} — </span>}
              <em>{data.rejected_reason}</em>
            </div>
          )}
          {data.expired_at && (
            <div>
              <span className="up-field__hint">Auto-expired:</span> {fmtDateIn(data.expired_at)}
            </div>
          )}
        </div>
      )}

      <div className="up-card" style={{ overflowX: 'auto' }}>
        <h3 className="up-card__title">Line items</h3>
        {linesQ.isLoading && <div>Loading…</div>}
        {linesQ.data && (
          <table className="up-table">
            <thead>
              <tr>
                <th>#</th><th>Location</th>
                <th style={{ textAlign: 'right' }}>Units</th>
                <th style={{ textAlign: 'right' }}>Days</th>
                <th style={{ textAlign: 'right' }}>Rate (₹)</th>
                <th style={{ textAlign: 'right' }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {linesQ.data.map((li) => (
                <tr key={li.id}>
                  <td>{li.line_order}</td>
                  <td>
                    {li.location_name_snapshot}
                    <div className="up-gu" style={{ fontSize: 12, color: 'var(--up-ink-soft)' }}>
                      {li.location_name_gu_snapshot}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>{li.units}</td>
                  <td style={{ textAlign: 'right' }}>{li.duration_days}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(li.unit_rate_snapshot)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(li.line_subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, background: 'var(--up-bg-tint)' }}>
                <td colSpan={5} style={{ textAlign: 'right' }}>Subtotal</td>
                <td style={{ textAlign: 'right' }}>{fmtInrPlain(data.subtotal)}</td>
              </tr>
              {Number(data.discount_amount || 0) > 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right' }}>
                    Discount {data.discount_reason ? `(${data.discount_reason})` : ''}
                  </td>
                  <td style={{ textAlign: 'right' }}>− {fmtInrPlain(data.discount_amount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={5} style={{ textAlign: 'right' }}>GST @ {data.gst_percent}%</td>
                <td style={{ textAlign: 'right' }}>{fmtInrPlain(data.gst_amount)}</td>
              </tr>
              <tr style={{ fontWeight: 700, background: 'var(--up-bg-tint)' }}>
                <td colSpan={5} style={{ textAlign: 'right' }}>Total</td>
                <td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(data.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="up-card" style={{ overflowX: 'auto' }}>
        <div className="up-row up-row--between">
          <h3 className="up-card__title" style={{ margin: 0 }}>Receipts ({receiptsQ.data?.length ?? 0})</h3>
          {!canAddReceipt && (
            <span className="up-field__hint">
              Receipts allowed only after status reaches WON.
            </span>
          )}
        </div>
        {receiptsQ.isLoading && <div>Loading…</div>}
        {receiptsQ.data && receiptsQ.data.length === 0 && (
          <div className="up-field__hint" style={{ marginTop: 8 }}>No receipts yet.</div>
        )}
        {receiptsQ.data && receiptsQ.data.length > 0 && (
          <table className="up-table">
            <thead>
              <tr>
                <th>Date</th><th>Receipt no.</th><th>Type</th><th>Mode</th>
                <th style={{ textAlign: 'right' }}>Gross (₹)</th>
                <th style={{ textAlign: 'right' }}>TDS (₹)</th>
                <th style={{ textAlign: 'right' }}>Net (₹)</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {receiptsQ.data.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateIn(r.receipt_date)}</td>
                  <td><strong>{r.receipt_no}</strong></td>
                  <td><span className="up-chip">{r.receipt_type.replace('_', ' ')}</span></td>
                  <td>
                    {r.payment_mode}
                    {r.cheque_or_ref_no && <div className="up-field__hint">{r.cheque_or_ref_no}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(r.gross_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(r.total_tds_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(r.net_received_amount)}</td>
                  <td>
                    <div className="up-row" style={{ gap: 4 }}>
                      <button className="up-btn up-btn--sm" onClick={() => pdfWrapper(() => downloadReceiptPdf(r.id))}>
                        PDF
                      </button>
                      {isOwner && (
                        <button className="up-btn up-btn--sm up-btn--danger"
                                onClick={() => setDeletingReceipt(r)}>
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddReceipt && (
        <ReceiptForm proposal={data}
                     onClose={() => setShowAddReceipt(false)}
                     onSaved={() => setShowAddReceipt(false)} />
      )}
      {deletingReceipt && (
        <SoftDeleteModal receipt={deletingReceipt}
                         onClose={() => setDeletingReceipt(null)}
                         onDeleted={() => setDeletingReceipt(null)} />
      )}
      {transitionTarget && (
        <StatusTransitionModal proposal={data}
                               target={transitionTarget}
                               onClose={() => setTransitionTarget(null)}
                               onDone={() => setTransitionTarget(null)} />
      )}
    </div>
  );
}
