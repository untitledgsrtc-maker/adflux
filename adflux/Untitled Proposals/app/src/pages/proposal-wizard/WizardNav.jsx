// =====================================================================
// Back / Next / Submit footer. Validates current step via Zod before
// advancing; surfaces validation errors at the top of the step card.
// =====================================================================

import { useState } from 'react';
import { useWizardStore } from '@/store/wizardStore';
import { validateStep } from '@/lib/proposalSchema';

export default function WizardNav({ onSubmit, submitLabel = 'Save proposal', isLast = false }) {
  const step = useWizardStore((s) => s.step);
  const form = useWizardStore((s) => s.form);
  const nextStep = useWizardStore((s) => s.nextStep);
  const prevStep = useWizardStore((s) => s.prevStep);
  const submitting = useWizardStore((s) => s.submitting);
  const [errors, setErrors] = useState({});

  function handleNext() {
    const r = validateStep(step, form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    nextStep();
    // Reset scroll on step advance
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  function handleSubmit() {
    // Final validation: run every step's schema
    for (let s = 1; s <= 6; s++) {
      const r = validateStep(s, form);
      if (!r.ok) {
        setErrors({ _root: `Step ${s} has unresolved errors. Go back and fix.` });
        return;
      }
    }
    setErrors({});
    onSubmit?.();
  }

  return (
    <>
      {Object.keys(errors).length > 0 && (
        <div className="up-card" style={{ background: '#fef2f2', borderColor: '#fecaca', padding: '12px 16px' }}>
          <strong style={{ color: '#b91c1c' }}>Fix the following before continuing:</strong>
          <ul style={{ margin: '6px 0 0 18px', color: '#b91c1c' }}>
            {Object.entries(errors).map(([k, v]) => (
              <li key={k}><code>{k}</code>: {v}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="up-wizard__nav">
        <button
          type="button"
          className="up-btn up-btn--ghost"
          onClick={prevStep}
          disabled={step === 1 || submitting}
        >
          ← Back
        </button>

        {isLast ? (
          <button
            type="button"
            className="up-btn up-btn--primary up-btn--lg"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : submitLabel}
          </button>
        ) : (
          <button
            type="button"
            className="up-btn up-btn--primary"
            onClick={handleNext}
            disabled={submitting}
          >
            Next →
          </button>
        )}
      </div>
    </>
  );
}
