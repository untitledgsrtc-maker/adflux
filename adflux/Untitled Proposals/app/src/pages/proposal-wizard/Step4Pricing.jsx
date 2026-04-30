// =====================================================================
// Step 4 — GST + discount. Live-recomputes totals via store.
//
// Discount rules (mirrors calc.js + Zod schema):
//   - Percent OR flat, never both.
//   - If any discount > 0, reason is required (>= 3 chars).
// =====================================================================

import { useWizardStore } from '@/store/wizardStore';
import { fmtInrPlain } from '@/lib/format';
import Stepper from './Stepper';
import WizardNav from './WizardNav';

export default function Step4Pricing() {
  const form = useWizardStore((s) => s.form);
  const totals = useWizardStore((s) => s.totals);
  const patch = useWizardStore((s) => s.patch);

  return (
    <div className="up-page up-stack-4">
      <header className="up-page__header">
        <div>
          <h1 className="up-page__title">New Proposal</h1>
          <div className="up-page__sub">Step 4 of 6 — Pricing</div>
        </div>
      </header>

      <Stepper />

      <div className="up-card up-stack-4">
        <h3 className="up-card__title" style={{ margin: 0 }}>GST + discount</h3>

        <div className="up-grid-3">
          <div className="up-field">
            <label className="up-field__label">GST %</label>
            <input type="number" step="0.01" className="up-input"
                   value={form.gst_percent}
                   onChange={(e) => patch({ gst_percent: Number(e.target.value) })} />
            <div className="up-field__hint">Default 18 for advertising services (HSN 998361).</div>
          </div>
          <div className="up-field">
            <label className="up-field__label">Discount %</label>
            <input type="number" step="0.01" className="up-input"
                   value={form.discount_percent}
                   onChange={(e) => patch({ discount_percent: Number(e.target.value), discount_amount: 0 })}
                   disabled={Number(form.discount_amount) > 0} />
          </div>
          <div className="up-field">
            <label className="up-field__label">Or discount ₹ (flat)</label>
            <input type="number" step="0.01" className="up-input"
                   value={form.discount_amount}
                   onChange={(e) => patch({ discount_amount: Number(e.target.value), discount_percent: 0 })}
                   disabled={Number(form.discount_percent) > 0} />
          </div>
        </div>

        {(Number(form.discount_percent) > 0 || Number(form.discount_amount) > 0) && (
          <div className="up-field">
            <label className="up-field__label">Discount reason (required when discount applied)</label>
            <input className="up-input"
                   value={form.discount_reason}
                   onChange={(e) => patch({ discount_reason: e.target.value })}
                   placeholder="e.g. Bulk volume — 20+ districts; long-running govt account" />
          </div>
        )}
      </div>

      <div className="up-card">
        <h3 className="up-card__title">Totals preview</h3>
        <table className="up-table">
          <tbody>
            <tr><td>Subtotal</td><td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(totals.subtotal)}</td></tr>
            {totals.discountAmount > 0 && (
              <tr><td>Discount</td><td style={{ textAlign: 'right' }}>− ₹ {fmtInrPlain(totals.discountAmount)}</td></tr>
            )}
            <tr><td>Taxable</td><td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(totals.taxable)}</td></tr>
            <tr><td>GST @ {form.gst_percent}%</td><td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(totals.gstAmount)}</td></tr>
            <tr style={{ fontWeight: 700, background: 'var(--up-bg-tint)' }}>
              <td>Total</td>
              <td style={{ textAlign: 'right' }}>₹ {fmtInrPlain(totals.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
        <div className="up-field__hint" style={{ marginTop: 8 }}>
          Live preview — DB triggers will recompute on save and must match.
        </div>
      </div>

      <WizardNav />
    </div>
  );
}
