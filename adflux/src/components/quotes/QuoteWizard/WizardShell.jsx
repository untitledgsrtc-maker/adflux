import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { Check, X, Copy, Loader2 } from 'lucide-react'
import { Step1Client } from './Step1Client'
import { Step2Campaign } from './Step2Campaign'
import { Step3Review } from './Step3Review'
import { Step4Send } from './Step4Send'
import { useQuotes } from '../../../hooks/useQuotes'
import { GST_RATE } from '../../../utils/constants'
import { useAuthStore } from '../../../store/authStore'
import { toastError, toastSuccess } from '../../v2/Toast'

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

export function WizardShell({ renewalOf = null, editOf = null, prefill = null }) {
  const navigate = useNavigate()
  const { createQuote, updateQuote } = useQuotes()

  const profile = useAuthStore((s) => s.profile)
  const [step, setStep] = useState(1)
  // Phase 34E — Copy-from-last quote button state. Only used in
  // create mode (not edit/renewal) on step 1.
  const [copying, setCopying] = useState(false)
  // Seed quoteData with the optional `prefill` payload. This lets the
  // Clients page open the wizard with Step1 already populated. We keep
  // it separate from renewalOf/editOf because those trigger an async
  // fetch — prefill is synchronous so the form renders populated on
  // first paint, no flicker.
  const [quoteData, setQuoteData] = useState(() => (
    prefill ? { ...EMPTY_QUOTE, ...prefill } : EMPTY_QUOTE
  ))
  const [selectedCities, setSelectedCities] = useState([]) // [{city, screens, duration_months, listed_rate, offered_rate}]
  // GST rate on this quote. 0.18 = 18%, 0 = No GST. Persists on the
  // quotes row so the same quote always taxes the same way no matter
  // who views it or when — changing the default later won't rewrite
  // history.
  const [gstRate, setGstRate] = useState(GST_RATE)
  const [saving, setSaving] = useState(false)
  const [savedQuote, setSavedQuote] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!!(renewalOf || editOf))
  // Track the original status when editing so "Save Changes" preserves it
  // rather than silently demoting a 'sent' quote back to 'draft'.
  const [originalStatus, setOriginalStatus] = useState(null)

  const isEdit = !!editOf

  useEffect(() => {
    if (!renewalOf && !editOf) return

    async function loadBaseQuote() {
      const id = editOf || renewalOf
      const { data: baseQuote, error: err } = await supabase
        .from('quotes')
        .select('*, quote_cities(*)')
        .eq('id', id)
        .single()

      if (!err && baseQuote) {
        if (editOf) {
          // Edit mode — pre-fill EVERYTHING including status so we can
          // preserve it on save. We don't carry quote_number into state
          // because the DB row is keyed on id; updates leave the number
          // alone.
          setQuoteData({
            client_name:    baseQuote.client_name || '',
            client_company: baseQuote.client_company || '',
            client_phone:   baseQuote.client_phone || '',
            client_email:   baseQuote.client_email || '',
            client_gst:     baseQuote.client_gst || '',
            client_address: baseQuote.client_address || '',
            client_notes:   baseQuote.client_notes || '',
            revenue_type:   baseQuote.revenue_type || 'new',
            status:         baseQuote.status || 'draft',
            // Preserve campaign dates if already set (won quotes)
            campaign_start_date: baseQuote.campaign_start_date || null,
            campaign_end_date:   baseQuote.campaign_end_date || null,
          })
          setOriginalStatus(baseQuote.status)
        } else {
          // Renewal — carry client + cities, reset status, mark as renewal
          setQuoteData(prev => ({
            ...prev,
            client_name:    baseQuote.client_name,
            client_company: baseQuote.client_company,
            client_phone:   baseQuote.client_phone,
            client_email:   baseQuote.client_email,
            client_gst:     baseQuote.client_gst,
            client_address: baseQuote.client_address,
            client_notes:   baseQuote.client_notes,
            revenue_type:   'renewal',
          }))
        }

        // Carry the original quote's GST choice into both edit and
        // renewal flows. Fall back to the 18% default if the column
        // is null (pre-migration rows).
        if (baseQuote.gst_rate !== null && baseQuote.gst_rate !== undefined) {
          setGstRate(Number(baseQuote.gst_rate))
        }

        // Pre-fill cities (both flows).
        // Fallbacks on slot_seconds / slots_per_day handle pre-migration
        // rows where the columns are NULL — we treat those as the old
        // implicit defaults (10s, 100 slots/day) rather than 0, so an
        // old quote loads with the same meaning it was written with.
        const cities = baseQuote.quote_cities?.map(qc => ({
          city: {
            id: qc.city_id,
            name: qc.city_name,
            grade: qc.grade,
            offer_rate: qc.offered_rate,
            monthly_rate: qc.listed_rate,
            screens: qc.screens,
          },
          screens: qc.screens,
          duration_months: qc.duration_months || 1,
          listed_rate: qc.listed_rate,
          offered_rate: qc.offered_rate,
          override_reason: qc.override_reason || '',
          slot_seconds: qc.slot_seconds ?? 10,
          slots_per_day: qc.slots_per_day ?? 100,
          slots_override_reason: qc.slots_override_reason || '',
          campaign_total: qc.campaign_total,
        })) || []
        setSelectedCities(cities)
      }
      setLoading(false)
    }

    loadBaseQuote()
  }, [renewalOf, editOf])

  // Computed totals — GST driven by per-quote gstRate, not the global
  // constant, so "No GST" (rate=0) actually produces gst_amount=0.
  const subtotal = selectedCities.reduce((sum, c) => sum + (c.campaign_total || 0), 0)
  const gst_amount = Math.round(subtotal * gstRate)
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

  // Unified save handler. `statusOverride` only applies to create or
  // explicit re-send; in edit mode we default to preserving the
  // original status unless the caller passes one in explicitly.
  async function handleSave(statusOverride = null) {
    setSaving(true)
    setError('')

    // Phase 32K — phone is required for every private LED quote.
    // Owner reported (10 May 2026) the system let a quote save with
    // empty phone, then WhatsApp / Call buttons on the quote detail
    // had nothing to dial. WizardShell handles Private LED quotes
    // only (govt quotes use their own wizards), so private rule
    // applies unconditionally here.
    if (!quoteData.client_phone || !String(quoteData.client_phone).trim()) {
      setSaving(false)
      setError('Client phone is required — WhatsApp and Call buttons need it to work.')
      return
    }

    const status = isEdit
      ? (statusOverride || originalStatus || 'draft')
      : (statusOverride || 'draft')

    const payload = {
      ...quoteData,
      status,
      duration_months,
      subtotal,
      gst_rate: gstRate,
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
      // Slot metadata. Never null — falling back to the pre-migration
      // defaults (10s, 100/day) keeps rows self-describing even if a
      // caller forgets to set them.
      slot_seconds: Number(c.slot_seconds) || 10,
      slots_per_day: Number(c.slots_per_day) || 100,
      slots_override_reason: c.slots_override_reason || null,
    }))

    if (isEdit) {
      // Update existing quote + replace its quote_cities rows.
      // Delete-then-insert is simpler than diffing rows and matches the
      // semantics of "the cities list now looks exactly like this".
      const { data, error: uErr } = await updateQuote(editOf, payload)
      if (uErr) {
        setSaving(false)
        setError(uErr.message || 'Failed to update quote.')
        return null
      }
      const { error: delErr } = await supabase
        .from('quote_cities')
        .delete()
        .eq('quote_id', editOf)
      if (delErr) {
        setSaving(false)
        setError(delErr.message || 'Failed to replace cities.')
        return null
      }
      if (cityRows.length) {
        const { error: insErr } = await supabase
          .from('quote_cities')
          .insert(cityRows.map(r => ({ ...r, quote_id: editOf })))
        if (insErr) {
          setSaving(false)
          setError(insErr.message || 'Failed to save cities.')
          return null
        }
      }
      setSaving(false)
      setSavedQuote(data)
      return data
    }

    // Create new
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
    // In edit mode, "Send" re-sends — promote draft to sent but leave
    // sent/negotiating/won alone (those already passed the client).
    const targetStatus = isEdit
      ? (originalStatus === 'draft' ? 'sent' : originalStatus)
      : 'sent'
    const quote = await handleSave(targetStatus)
    if (quote) {
      setStep(4)
    }
  }

  async function handleSaveDraft() {
    if (isEdit) {
      // Preserve current status
      const quote = await handleSave(null)
      if (quote) navigate(`/quotes/${editOf}`)
    } else {
      const quote = await handleSave('draft')
      if (quote) navigate('/quotes')
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
      {isEdit && (
        <div
          style={{
            padding: '8px 14px',
            marginBottom: 12,
            background: 'rgba(100,181,246,.08)',
            border: '1px solid rgba(100,181,246,.25)',
            borderRadius: 8,
            fontSize: '.82rem',
            color: '#64b5f6',
          }}
        >
          Editing existing quote — status <strong>{originalStatus}</strong> will be preserved unless you click “Send”.
        </div>
      )}

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
          <>
            {/* Phase 34E — Copy from last quote. Pulls rep's most
                recent non-Lost private LED quote and pre-fills client
                fields + city list, so reps don't retype 80% of
                identical content. Hidden in edit / renewal modes. */}
            {!isEdit && !renewalOf && profile?.id && (
              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  disabled={copying}
                  onClick={async () => {
                    setCopying(true)
                    try {
                      // Most recent quote of mine, not Lost, not Other Media
                      // (Other Media has its own wizard). Pull the quote +
                      // its city rows in one fetch.
                      const { data, error } = await supabase
                        .from('quotes')
                        .select('*, quote_cities(*)')
                        .eq('created_by', profile.id)
                        .neq('status', 'lost')
                        .or('media_type.is.null,media_type.eq.LED_OTHER')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle()
                      if (error) { toastError(error, 'Could not load last quote.'); setCopying(false); return }
                      if (!data) { toastError(null, 'No earlier quote to copy from.'); setCopying(false); return }
                      setQuoteData(prev => ({
                        ...prev,
                        client_name:    data.client_name    || prev.client_name,
                        client_company: data.client_company || prev.client_company,
                        client_phone:   data.client_phone   || prev.client_phone,
                        client_email:   data.client_email   || prev.client_email,
                        client_gst:     data.client_gst     || prev.client_gst,
                        client_address: data.client_address || prev.client_address,
                        client_notes:   data.client_notes   || prev.client_notes,
                      }))
                      const rows = data.quote_cities || []
                      if (rows.length) {
                        // Best-effort hydrate. Rep can still tweak per city.
                        setSelectedCities(rows.map(r => ({
                          city: { id: r.city_id, name: r.city_name, grade: r.grade },
                          screens:           r.screens,
                          duration_months:   r.duration_months,
                          listed_rate:       Number(r.listed_rate || 0),
                          offered_rate:      Number(r.offered_rate || r.listed_rate || 0),
                          override_reason:   r.override_reason || null,
                          campaign_total:    Number(r.campaign_total || 0),
                          slot_seconds:      Number(r.slot_seconds || 10),
                          slots_per_day:     Number(r.slots_per_day || 100),
                          slots_override_reason: r.slots_override_reason || null,
                        })))
                      }
                      if (data.gst_rate !== null && data.gst_rate !== undefined) {
                        setGstRate(Number(data.gst_rate))
                      }
                      toastSuccess('Copied client + ' + rows.length + ' cities from your last quote. Edit as needed.')
                    } catch (e) {
                      toastError(e, 'Could not copy last quote.')
                    } finally {
                      setCopying(false)
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: 'transparent',
                    border: '1px solid var(--border, #334155)',
                    color: 'var(--text, #f1f5f9)',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: copying ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {copying ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                  {copying ? 'Copying…' : 'Copy from your last quote'}
                </button>
              </div>
            )}
            <Step1Client
              data={quoteData}
              onChange={updateQuoteData}
              onNext={goNext}
            />
          </>
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
            gst_rate={gstRate}
            onGstRateChange={setGstRate}
            gst_amount={gst_amount}
            total_amount={total_amount}
            onBack={goBack}
            onSaveDraft={handleSaveDraft}
            onSend={handleSend}
            saving={saving}
            isEdit={isEdit}
            originalStatus={originalStatus}
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
