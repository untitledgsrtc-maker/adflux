// =====================================================================
// Step 6 — Review + submit. Renders a printable summary, then calls
// the create_proposal_with_lines RPC. On success: clears the wizard
// state and navigates to the new proposal's detail page.
// =====================================================================

import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useWizardStore } from '@/store/wizardStore';
import { saveProposal, qk } from '@/lib/proposalApi';
import { fmtInrPlain, fmtDateIn } from '@/lib/format';
import Stepper from './Stepper';
import WizardNav from './WizardNav';

export default function Step6Review() {
  const form = useWizardStore((s) => s.form);
  const totals = useWizardStore((s) => s.totals);
  const patch = useWizardStore((s) => s.patch);
  const reset = useWizardStore((s) => s.reset);
  const setSubmitting = useWizardStore((s) => s.setSubmitting);
  const setSubmitError = useWizardStore((s) => s.setSubmitError);
  const submitting = useWizardStore((s) => s.submitting);
  const submitError = useWizardStore((s) => s.submitError);

  const navigate = useNavigate();
  const qc = useQueryClient();

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const inserted = await saveProposal(form, totals);
      qc.invalidateQueries({ queryKey: qk.proposals() });
      const newId = inserted?.id;
      reset();
      if (newId) navigate(`/proposals/${newId}`);
      else navigate('/proposals');
    } catch (err) {
      setSubmitError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">New Proposal</h1>
          <div className="up-page__sub">Step 6 of 6 — Review + Save</div>
        </div>
      </header>

      <Stepper />

      <div className="up-card up-stack-3">
        <h3 className="up-card__title" style={{ margin: 0 }}>Client</h3>
        <div className="up-gu" style={{ fontWeight: 600 }}>{form.client_snapshot?.name_gu}</div>
        <div>{form.client_snapshot?.name_en}</div>
        {form.client_snapshot?.gst_number && (
          <div className="up-field__hint">GSTIN: {form.client_snapshot.gst_number}</div>
        )}
        {form.contact_snapshot && (
          <div className="up-field__hint">
            Attn: {form.contact_snapshot.name_en} ({form.contact_snapshot.designation_en || '—'})
          </div>
        )}
      </div>

      <div className="up-card up-stack-3">
        <h3 className="up-card__title" style={{ margin: 0 }}>Proposal</h3>
        <div className="up-grid-3">
          <div><span className="up-field__hint">Media</span><br />{form.media_code} · {form.rate_type}</div>
          <div><span className="up-field__hint">Date</span><br />{fmtDateIn(form.proposal_date)}</div>
          <div><span className="up-field__hint">Auto-expire</span><br />{form.expire_after_days} days</div>
        </div>
        <div><strong>Subject (EN):</strong> {form.subject_en}</div>
        <div className="up-gu"><strong>વિષય:</strong> {form.subject_gu}</div>
      </div>

      <div className="up-card">
        <h3 className="up-card__title">Line items ({form.line_items.length})</h3>
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
            {form.line_items.map((li, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
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
        </table>
      </div>

      <div className="up-card">
        <h3 className="up-card__title">Totals</h3>
        <table className="up-table">
          <tbody>
            <tr><td>Subtotal</td><td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(totals.subtotal)}</td></tr>
            {totals.discountAmount > 0 && (
              <tr><td>Discount {form.discount_reason ? `(${form.discount_reason})` : ''}</td>
                  <td style={{ textAlign: 'right' }}>− ₹ {fmtInrPlain(totals.discountAmount)}</td></tr>
            )}
            <tr><td>GST @ {form.gst_percent}%</td><td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(totals.gstAmount)}</td></tr>
            <tr style={{ fontWeight: 700, background: 'var(--up-bg-tint)' }}>
              <td>Total</td><td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(totals.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="up-card up-stack-3">
        <h3 className="up-card__title" style={{ margin: 0 }}>Signer</h3>
        <div>{form.signer_snapshot?.name_en}</div>
        <div className="up-gu">{form.signer_snapshot?.name_gu}</div>
        <div className="up-field__hint">{form.signer_snapshot?.designation_en}</div>
      </div>

      <div className="up-card up-stack-3">
        <h3 className="up-card__title" style={{ margin: 0 }}>Notes (optional)</h3>
        <div className="up-field">
          <label className="up-field__label">Internal notes (not on PDF)</label>
          <textarea className="up-textarea" rows={2}
                    value={form.notes_internal}
                    onChange={(e) => patch({ notes_internal: e.target.value })} />
        </div>
        <div className="up-field">
          <label className="up-field__label">Notes for client (visible to client)</label>
          <textarea className="up-textarea" rows={2}
                    value={form.notes_client}
                    onChange={(e) => patch({ notes_client: e.target.value })} />
        </div>
      </div>

      {submitError && (
        <div className="up-card" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
          <strong style={{ color: '#b91c1c' }}>Save failed</strong>
          <div className="up-field__hint" style={{ color: '#b91c1c' }}>{submitError}</div>
        </div>
      )}

      <div className="up-row up-row--between">
        <div className="up-field__hint">
          Saving creates the proposal as DRAFT. Ref number is issued atomically by the DB.
        </div>
        <div className="up-row" style={{ gap: 8 }}>
          <button type="button" className="up-btn up-btn--ghost"
                  onClick={() => { if (confirm('Discard this draft?')) reset(); }}
                  disabled={submitting}>
            Discard draft
          </button>
        </div>
      </div>

      <WizardNav onSubmit={handleSubmit} submitLabel="Save as DRAFT" isLast />
    </div>
  );
}
