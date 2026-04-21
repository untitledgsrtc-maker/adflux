import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react'
import { Step1Client } from './Step1Client'
import { Step2Campaign } from './Step2Campaign'
import { Step3Review } from './Step3Review'
import { Step4Send } from './Step4Send'
import { useQuotes } from '../../../hooks/useQuotes'
import { GST_RATE } from '../../../utils/constants'

const STEPS = [
  { id: 1, label: 'Client' },
  { id: 2, label: 'Campaign' },
  { id: 3, label: 'Review' },
  { id: 4, label: 'Send' },
]

const EMPTY_QUOTE = {
  client_name: '',
  client_company: '',
  client_phone: '',
  client_email: '',
  client_gst: '',
  client_address: '',
  client_notes: '',
  revenue_type: 'new',
  status: 'draft',
}

export function WizardShell({ renewalOf = null }) {
  const navigate = useNavigate()
  const { createQuote } = useQuotes()

  const [step, setStep] = useState(1)
  const [quoteData, setQuoteData] = useState(EMPTY_QUOTE)
  const [selectedCities, setSelectedCities] = useState([]) // [{city, screens, duration_months, listed_rate, offered_rate}]
  const [saving, setSaving] = useState(false)
  const [savedQuote, setSavedQuote] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!!renewalOf)

  useEffect(() => {
    if (!renewalOf) return

    // Load renewal quote and pre-fill
    async function loadRenewal() {
      const { data: baseQuote, error: err } = await supabase
        .from('quotes')
        .select('*, quote_cities(*)')
        .eq('id', renewalOf)
        .single()

      if (!err && baseQuote) {
        // Pre-fill client details
        setQuoteData(prev => ({
          ...prev,
          client_name: baseQuote.client_name,
          client_company: baseQuote.client_company,
          client_phone: baseQuote.client_phone,
          client_email: baseQuote.client_email,
          client_gst: baseQuote.client_gst,
          client_address: baseQuote.client_address,
          client_notes: baseQuote.client_notes,
          revenue_type: 'renewal',
        }))

        // Pre-fill cities with same rates
        const cities = baseQuote.quote_cities?.map(qc => ({
          city: { id: qc.city_id, name: qc.city_name, grade: qc.grade, offer_rate: qc.offered_rate, monthly_rate: qc.listed_rate, screens: 1 },
          screens: qc.screens,
          duration_months: 1,
          listed_rate: qc.listed_rate,
          offered_rate: qc.offered_rate,
          override_reason: '',
          campaign_total: qc.campaign_total,
        })) || []
        setSelectedCities(cities)
      }
      setLoading(false)
    }

    loadRenewal()
  }, [renewalOf])

  // Computed totals
  const subtotal = selectedCities.reduce((sum, c) => sum + (c.campaign_total || 0), 0)
  const gst_amount = Math.round(subtotal * GST_RATE)
  const total_amount = subtotal + gst_amount
  const duration_months = selectedCities[0]?.duration_months || 1

  function updateQuoteData(updates) {
    setQuoteData(prev => ({ ...prev, ...updates }))
  }

  function goNext() {
    setStep(s => Math.min(s + 1, 4))
    setError('')
  }

  function goBack() {
    setStep(s => Math.max(s - 1, 1))
    setError('')
  }

  async function handleSave(status = 'draft') {
    setSaving(true)
    setError('')

    const payload = {
      ...quoteData,
      status,
      duration_months,
      subtotal,
      gst_amount,
      total_amount,
    }

    const cityRows = selectedCities.map(c => ({
      city_id: c.city.id,
      city_name: c.city.name,
      screens: c.screens,
      grade: c.city.grade,
      listed_rate: c.listed_rate,
      offered_rate: c.offered_rate,
      override_reason: c.override_reason || null,
      campaign_total: c.campaign_total,
      duration_months: c.duration_months,
    }))

    const { data, error: err } = await createQuote(payload, cityRows)
    setSaving(false)

    if (err) {
      setError(err.message || 'Failed to save quote.')
      return null
    }

    setSavedQuote(data)
    return data
  }

  async function handleSend() {
    const quote = await handleSave('sent')
    if (quote) {
      setStep(4)
    }
  }

  if (loading) {
    return (
      <div className="loading-screen" style={{ minHeight: 400 }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="wizard-shell">
      {/* Steps indicator */}
      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s.id} className="wizard-step-item">
            <div
              className={`wizard-step-circle ${
                step > s.id
                  ? 'wizard-step-circle--done'
                  : step === s.id
                  ? 'wizard-step-circle--active'
                  : ''
              }`}
            >
              {step > s.id ? <Check size={13} /> : s.id}
            </div>
            <span
              className={`wizard-step-label ${
                step === s.id ? 'wizard-step-label--active' : ''
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`wizard-step-line ${step > s.id ? 'wizard-step-line--done' : ''}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="wizard-body">
        {error && (
          <div className="wizard-error">
            <X size={14} />
            {error}
          </div>
        )}

        {step === 1 && (
          <Step1Client
            data={quoteData}
            onChange={updateQuoteData}
            onNext={goNext}
          />
        )}
        {step === 2 && (
          <Step2Campaign
            selectedCities={selectedCities}
            onChange={setSelectedCities}
            onBack={goBack}
            onNext={goNext}
          />
        )}
        {step === 3 && (
          <Step3Review
            quoteData={quoteData}
            selectedCities={selectedCities}
            subtotal={subtotal}
            gst_amount={gst_amount}
            total_amount={total_amount}
            onBack={goBack}
            onSaveDraft={() => handleSave('draft').then(q => q && navigate('/quotes'))}
            onSend={handleSend}
            saving={saving}
          />
        )}
        {step === 4 && savedQuote && (
          <Step4Send
            quote={savedQuote}
            cities={selectedCities}
            subtotal={subtotal}
            gst_amount={gst_amount}
            total_amount={total_amount}
            onDone={() => navigate('/quotes')}
            onViewQuote={() => navigate(`/quotes/${savedQuote.id}`)}
          />
        )}
      </div>
    </div>
  )
}
