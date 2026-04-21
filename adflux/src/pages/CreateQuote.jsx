import { useSearchParams } from 'react-router-dom'
import { WizardShell } from '../components/quotes/QuoteWizard/WizardShell'

export default function CreateQuote() {
  const [searchParams] = useSearchParams()
  const renewalOf = searchParams.get('renewalOf')
  const editOf    = searchParams.get('editOf')

  return (
    <div className="page page--wizard">
      <WizardShell renewalOf={renewalOf} editOf={editOf} />
    </div>
  )
}
