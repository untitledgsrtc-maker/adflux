// =====================================================================
// One modal that handles every status transition. Switches its form
// fields by `target` so we don't have 4 near-identical components.
//
// Hits transition_proposal_status RPC (which itself raises on missing
// fields). Local Zod validation surfaces friendlier errors before the
// round trip.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { transitionStatus, SUBMISSION_MODES } from '@/lib/statusApi';
import { validateTransition } from '@/lib/statusSchema';
import { qk } from '@/lib/proposalApi';
import { fmtInrPlain } from '@/lib/format';

const COPY = {
  SENT: {
    title: 'Mark proposal as SENT',
    sub: 'Records the submission mode. Office-copy URL is required for PHYSICAL submissions (proof of acknowledgement).',
    cta: 'Mark sent',
  },
  WON: {
    title: 'Mark proposal as WON',
    sub: 'PO number, date, amount, and file URL are required. The DB will reject the transition without them.',
    cta: 'Mark won',
  },
  REJECTED: {
    title: 'Client rejected the proposal',
    sub: 'Reason is optional but useful for follow-up patterns later.',
    cta: 'Mark rejected',
  },
  CANCELLED: {
    title: 'Cancel proposal',
    sub: 'Cancellation requires a reason of at least 5 characters. The reason is logged in the audit trail.',
    cta: 'Cancel proposal',
    danger: true,
  },
};

export default function StatusTransitionModal({ proposal, target, onClose, onDone }) {
  const qc = useQueryClient();
  const copy = COPY[target] || { title: `Transition → ${target}`, sub: '', cta: 'Confirm' };

  // Per-target initial form state
  const [form, setForm] = useState(() => {
    if (target === 'SENT') return { submission_mode: 'EMAIL', office_copy_url: '' };
    if (target === 'WON')  return {
      po_number: '',
      po_date: new Date().toISOString().slice(0, 10),
      po_amount: proposal?.total_amount ?? '',  // sensible default = quoted total
      po_file_url: '',
    };
    if (target === 'REJECTED')  return { rejected_reason: '' };
    if (target === 'CANCELLED') return { cancelled_reason: '' };
    return {};
  });
  const [errors, setErrors] = useState({});

  const mut = useMutation({
    mutationFn: (payload) => transitionStatus(proposal.id, target, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.proposal(proposal.id) });
      qc.invalidateQueries({ queryKey: qk.proposals() });
      qc.invalidateQueries({ queryKey: ['proposals', proposal.id] });
      onDone?.();
      onClose?.();
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    const r = validateTransition(target, form);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    mut.mutate(r.value);
  }

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target?.value ?? e }));
  }

  return (
    <div className="up-modal__backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="up-modal up-stack-3" onSubmit={handleSubmit}>
        <h3 style={{ margin: 0 }}>{copy.title}</h3>
        <div className="up-field__hint">
          Proposal <strong>{proposal.ref_no}</strong> · current status <strong>{proposal.status}</strong>
        </div>
        <p style={{ margin: 0, color: 'var(--up-ink-muted)' }}>{copy.sub}</p>

        {target === 'SENT' && (
          <>
            <div className="up-field">
              <label className="up-field__label">Submission mode</label>
              <div className="up-row" style={{ gap: 8 }}>
                {SUBMISSION_MODES.map((m) => (
                  <button key={m} type="button"
                          className={`up-btn ${form.submission_mode === m ? 'up-btn--primary' : ''}`}
                          onClick={() => setForm((f) => ({ ...f, submission_mode: m }))}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="up-field">
              <label className="up-field__label">
                Office-copy Drive URL {form.submission_mode === 'PHYSICAL' && '(required)'}
              </label>
              <input className={`up-input ${errors.office_copy_url ? 'up-input--invalid' : ''}`}
                     placeholder="https://drive.google.com/…"
                     value={form.office_copy_url} onChange={set('office_copy_url')} />
              {errors.office_copy_url && <div className="up-field__error">{errors.office_copy_url}</div>}
            </div>
          </>
        )}

        {target === 'WON' && (
          <>
            <div className="up-grid-2">
              <div className="up-field">
                <label className="up-field__label">PO number</label>
                <input className={`up-input ${errors.po_number ? 'up-input--invalid' : ''}`}
                       value={form.po_number} onChange={set('po_number')} />
                {errors.po_number && <div className="up-field__error">{errors.po_number}</div>}
              </div>
              <div className="up-field">
                <label className="up-field__label">PO date</label>
                <input type="date" className={`up-input ${errors.po_date ? 'up-input--invalid' : ''}`}
                       value={form.po_date} onChange={set('po_date')} />
                {errors.po_date && <div className="up-field__error">{errors.po_date}</div>}
              </div>
            </div>
            <div className="up-field">
              <label className="up-field__label">PO amount (₹)</label>
              <input type="number" step="0.01" className={`up-input ${errors.po_amount ? 'up-input--invalid' : ''}`}
                     value={form.po_amount} onChange={set('po_amount')} />
              <div className="up-field__hint">
                Quoted total: ₹{fmtInrPlain(proposal.total_amount)}.
                Often differs from PO if the client negotiated.
              </div>
              {errors.po_amount && <div className="up-field__error">{errors.po_amount}</div>}
            </div>
            <div className="up-field">
              <label className="up-field__label">PO file URL (Drive link)</label>
              <input className={`up-input ${errors.po_file_url ? 'up-input--invalid' : ''}`}
                     placeholder="https://drive.google.com/…"
                     value={form.po_file_url} onChange={set('po_file_url')} />
              {errors.po_file_url && <div className="up-field__error">{errors.po_file_url}</div>}
            </div>
          </>
        )}

        {target === 'REJECTED' && (
          <div className="up-field">
            <label className="up-field__label">Reason (optional)</label>
            <textarea className="up-textarea" rows={3}
                      value={form.rejected_reason} onChange={set('rejected_reason')}
                      placeholder="e.g. Client picked another agency on price" />
          </div>
        )}

        {target === 'CANCELLED' && (
          <div className="up-field">
            <label className="up-field__label">Cancellation reason (required)</label>
            <textarea className={`up-textarea ${errors.cancelled_reason ? 'up-input--invalid' : ''}`}
                      rows={3}
                      value={form.cancelled_reason} onChange={set('cancelled_reason')}
                      placeholder="e.g. Campaign postponed indefinitely" />
            {errors.cancelled_reason && <div className="up-field__error">{errors.cancelled_reason}</div>}
          </div>
        )}

        {mut.error && (
          <div className="up-field__error" role="alert">
            {String(mut.error.message || mut.error)}
          </div>
        )}

        <div className="up-row up-row--end">
          <button type="button" className="up-btn up-btn--ghost"
                  onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button type="submit"
                  className={`up-btn ${copy.danger ? 'up-btn--danger' : 'up-btn--primary'}`}
                  disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : copy.cta}
          </button>
        </div>
      </form>
    </div>
  );
}
