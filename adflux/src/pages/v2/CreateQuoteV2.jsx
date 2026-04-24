// src/pages/v2/CreateQuoteV2.jsx
//
// v2 shell around the existing WizardShell. The wizard itself is a
// complex multi-step state machine (store, draft persistence, rate-table
// calculator, GST toggle, cross-step validation). Rebuilding it would
// be a separate Phase-3 project — for now we just give it a v2 page
// wrapper so it sits cleanly inside V2AppShell.
//
// renewalOf / editOf query params are preserved — the "Create Renewal"
// button on RenewalTools and the "Edit" action on QuoteDetail both
// rely on them.

import { useSearchParams, useLocation } from 'react-router-dom'
import { WizardShell } from '../../components/quotes/QuoteWizard/WizardShell'

export default function CreateQuoteV2() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const renewalOf = searchParams.get('renewalOf')
  const editOf    = searchParams.get('editOf')
  // ClientsV2's "New quote" button hands us a prefill payload via
  // router state. We pass it through to the wizard so Step1Client
  // starts with the client fields already populated.
  const prefill   = location.state?.prefill || null

  return (
    <div className="v2d-wiz">
      <WizardShell renewalOf={renewalOf} editOf={editOf} prefill={prefill} />
    </div>
  )
}
