// =====================================================================
// Payments / Receipts list. Cross-proposal view with date filter,
// payment-mode filter, and inline PDF + soft-delete actions.
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchReceipts, qkRcpt, downloadReceiptPdf } from '@/lib/receiptApi';
import { fmtInrPlain, fmtDateIn } from '@/lib/format';
import { useAuthStore } from '@/store/authStore';
import { PAYMENT_MODES } from '@/lib/receiptSchema';

import PickProposalModal from './payments/PickProposalModal';
import ReceiptForm from './payments/ReceiptForm';
import SoftDeleteModal from './payments/SoftDeleteModal';

const todayIso = () => new Date().toISOString().slice(0, 10);

function fyStartIso() {
  const d = new Date();
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-04-01`;
}

export default function Payments() {
  const isOwner = useAuthStore((s) => s.isOwner());
  const [from, setFrom] = useState(fyStartIso());
  const [to, setTo] = useState(todayIso());
  const [mode, setMode] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedProposal, setPickedProposal] = useState(null);
  const [deletingReceipt, setDeletingReceipt] = useState(null);
  const [downloadErr, setDownloadErr] = useState(null);

  const filters = { from, to, paymentMode: mode || null };
  const q = useQuery({
    queryKey: qkRcpt.receipts(filters),
    queryFn: () => fetchReceipts(filters),
  });

  const totalGross = (q.data ?? []).reduce((s, r) => s + Number(r.gross_amount || 0), 0);
  const totalTds   = (q.data ?? []).reduce((s, r) => s + Number(r.total_tds_amount || 0), 0);
  const totalNet   = (q.data ?? []).reduce((s, r) => s + Number(r.net_received_amount || 0), 0);

  async function handlePdf(receipt) {
    setDownloadErr(null);
    try { await downloadReceiptPdf(receipt.id); }
    catch (e) { setDownloadErr(e?.message || String(e)); }
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">Payments</h1>
          <div className="up-page__sub">Receipts · TDS · payment status. PDFs go via the rendering API.</div>
        </div>
        <button className="up-btn up-btn--primary" onClick={() => setPickerOpen(true)}>
          + New receipt
        </button>
      </header>

      <div className="up-card">
        <div className="up-grid-4">
          <div className="up-field">
            <label className="up-field__label">From</label>
            <input type="date" className="up-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="up-field">
            <label className="up-field__label">To</label>
            <input type="date" className="up-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Mode</label>
            <select className="up-select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">All modes</option>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="up-field" style={{ alignSelf: 'end' }}>
            <button className="up-btn" onClick={() => { setFrom(fyStartIso()); setTo(todayIso()); setMode(''); }}>
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="up-grid-3">
        <div className="up-card">
          <div className="up-field__hint">Gross received</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>₹ {fmtInrPlain(totalGross)}</div>
        </div>
        <div className="up-card">
          <div className="up-field__hint">TDS deducted</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>₹ {fmtInrPlain(totalTds)}</div>
        </div>
        <div className="up-card">
          <div className="up-field__hint">Net to bank</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>₹ {fmtInrPlain(totalNet)}</div>
        </div>
      </div>

      {downloadErr && (
        <div className="up-card" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
          <strong style={{ color: '#b91c1c' }}>PDF download failed:</strong>{' '}
          <span className="up-field__hint" style={{ color: '#b91c1c' }}>{downloadErr}</span>
        </div>
      )}

      <div className="up-card" style={{ overflowX: 'auto' }}>
        {q.isLoading && <div>Loading receipts…</div>}
        {q.error && <div className="up-field__error">Failed to load: {String(q.error.message)}</div>}
        {q.data && q.data.length === 0 && <div className="up-field__hint">No receipts in this range.</div>}
        {q.data && q.data.length > 0 && (
          <table className="up-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Receipt no.</th>
                <th>Type</th>
                <th>Client / Proposal</th>
                <th>Mode</th>
                <th style={{ textAlign: 'right' }}>Gross (₹)</th>
                <th style={{ textAlign: 'right' }}>TDS (₹)</th>
                <th style={{ textAlign: 'right' }}>Net (₹)</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateIn(r.receipt_date)}</td>
                  <td><strong>{r.receipt_no}</strong></td>
                  <td><span className="up-chip">{r.receipt_type.replace('_', ' ')}</span></td>
                  <td>
                    <div>{r.client_name_snapshot}</div>
                    <div className="up-field__hint">{r.proposal_ref_snapshot}</div>
                  </td>
                  <td>
                    {r.payment_mode}
                    {r.cheque_or_ref_no && <div className="up-field__hint">{r.cheque_or_ref_no}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(r.gross_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(r.total_tds_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInrPlain(r.net_received_amount)}</td>
                  <td>
                    <div className="up-row" style={{ gap: 4 }}>
                      <button className="up-btn up-btn--sm" onClick={() => handlePdf(r)} title="Download PDF">
                        PDF
                      </button>
                      {isOwner && (
                        <button className="up-btn up-btn--sm up-btn--danger"
                                onClick={() => setDeletingReceipt(r)} title="Soft-delete">
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

      {pickerOpen && (
        <PickProposalModal
          onClose={() => setPickerOpen(false)}
          onPicked={(p) => { setPickedProposal(p); setPickerOpen(false); }}
        />
      )}

      {pickedProposal && (
        <ReceiptForm
          proposal={pickedProposal}
          onClose={() => setPickedProposal(null)}
          onSaved={() => setPickedProposal(null)}
        />
      )}

      {deletingReceipt && (
        <SoftDeleteModal
          receipt={deletingReceipt}
          onClose={() => setDeletingReceipt(null)}
          onDeleted={() => setDeletingReceipt(null)}
        />
      )}
    </div>
  );
}
