// =====================================================================
// Wizard step indicator. Click to jump between steps the user has
// already completed; can't skip ahead to unvisited steps.
// =====================================================================

import { Fragment } from 'react';
import { useWizardStore } from '@/store/wizardStore';

const STEPS = [
  { n: 1, label: 'Client + Media' },
  { n: 2, label: 'Subject + Dates' },
  { n: 3, label: 'Line items' },
  { n: 4, label: 'Pricing' },
  { n: 5, label: 'Signer' },
  { n: 6, label: 'Review' },
];

export default function Stepper() {
  const step = useWizardStore((s) => s.step);
  const goToStep = useWizardStore((s) => s.goToStep);

  return (
    <nav className="up-stepper" aria-label="Proposal wizard steps">
      {STEPS.map((s, i) => {
        const isActive = s.n === step;
        const isDone = s.n < step;
        // Allow jumping to any previously visited step. Forward
        // navigation goes through the validated Next button.
        const canJump = s.n <= step;
        return (
          <Fragment key={s.n}>
            <button
              type="button"
              className={[
                'up-stepper__item',
                isActive && 'up-stepper__item--active',
                isDone && 'up-stepper__item--done',
              ].filter(Boolean).join(' ')}
              onClick={() => canJump && goToStep(s.n)}
              disabled={!canJump}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="up-stepper__num">{isDone ? '✓' : s.n}</span>
              <span>{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="up-stepper__sep" aria-hidden="true" />}
          </Fragment>
        );
      })}
    </nav>
  );
}
