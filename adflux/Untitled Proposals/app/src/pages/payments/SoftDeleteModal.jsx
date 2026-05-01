// =====================================================================
// Owner-only soft-delete modal. Captures a >=5-character reason and
// calls soft_delete_receipt RPC. The RPC enforces the role check too,
// so even if the UI is bypassed the DB rejects.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { softDeleteReceipt, qkRcpt } from '@/lib/receiptApi';
import { qk } from '@/lib/proposalApi';
import { useAuthStore } from '@/store/authStore';

export default function SoftDeleteModal({ receipt, onClose, onDeleted }) {
  const isOwner = useAuthStore((s) => s.isOwner());
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const mut = useMutation({
    mutationFn: () => softDeleteReceipt(receipt.id, reason.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkRcpt.receiptsByProposal(receipt.proposal_id) });
      qc.invalidateQueries({ queryKey: qkRcpt.receipts() });
      qc.invalidateQueries({ queryKey: qk.proposal(receipt.proposal_id) });
      onDeleted?.();
      onClose?.();
    },
    onError: (e) => setError(e?.message || String(e)),
  });

  if (!isOwner) {
    return (
      <div className="up-modal__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
        <div className="up-modal up-stack-3">
          <h3 style={{ margin: 0 }}>Receipt delete is owner-only</h3>
          <p>Only Brijesh can soft-delete receipts. The DB rejects the call from any other role.</p>
          <div className="up-row up-row--end">
            <button className="up-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="up-modal__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="up-modal up-stack-3" onSubmit={(e) => { e.preventDefault(); setError(null); mut.mutate(); }}>
        <h3 style={{ margin: 0 }}>Soft-delete receipt {receipt.receipt_no}</h3>
        <p className="up-field__hint">
          The receipt is marked deleted (soft) and removed from rollups; the row stays for audit.
          A reason of at least 5 characters is required and is stored in the immutable audit log.
        </p>
        <div className="up-field">
          <label className="up-field__label">Reason</label>
          <textarea className="up-textarea" rows={3} value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Cheque bounced — replaced by NEFT receipt 0027" />
        </div>
        {error && <div className="up-field__error">{error}</div>}
        <div className="up-row up-row--end">
          <button type="button" className="up-btn up-btn--ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button type="submit" className="up-btn up-btn--danger"
                  disabled={mut.isPending || reason.trim().length < 5}>
            {mut.isPending ? 'Deleting…' : 'Soft-delete'}
          </button>
        </div>
      </form>
    </div>
  );
}
