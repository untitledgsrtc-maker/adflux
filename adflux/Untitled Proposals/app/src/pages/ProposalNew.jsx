// =====================================================================
// New Proposal — thin wrapper around the wizard root component. All
// state + step components live under src/pages/proposal-wizard/.
// =====================================================================

import ProposalWizard from './proposal-wizard';

export default function ProposalNew() {
  return <ProposalWizard />;
}
