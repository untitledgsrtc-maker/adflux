// =====================================================================
// Wizard root — switches between step components based on store.step.
// State + persistence live in src/store/wizardStore.js.
// =====================================================================

import { useWizardStore } from '@/store/wizardStore';

import Step1ClientMedia from './Step1ClientMedia';
import Step2Subject     from './Step2Subject';
import Step3LineItems   from './Step3LineItems';
import Step4Pricing     from './Step4Pricing';
import Step5Signer      from './Step5Signer';
import Step6Review      from './Step6Review';

const STEP_COMPONENTS = {
  1: Step1ClientMedia,
  2: Step2Subject,
  3: Step3LineItems,
  4: Step4Pricing,
  5: Step5Signer,
  6: Step6Review,
};

export default function ProposalWizard() {
  const step = useWizardStore((s) => s.step);
  const Step = STEP_COMPONENTS[step] ?? Step1ClientMedia;
  return <Step />;
}
