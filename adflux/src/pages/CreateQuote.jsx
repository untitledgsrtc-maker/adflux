import { useSearchParams } from 'react-router-dom'
import { WizardShell } from '../components/quotes/QuoteWizard/WizardShell'

export default function CreateQuote() {
  const [searchParams] = useSearchParams()
  const renewalOf = searchParams.get('renewalOf')

  return (
    <div className="page page--wizard">
      <WizardShell renewalOf={renewalOf} />
    </div>
  )
}
