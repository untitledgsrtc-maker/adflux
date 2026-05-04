// src/pages/v2/CreateGovtGsrtcLedV2.jsx
//
// Government — GSRTC LED proposal wizard.
//
// 5 steps: recipient → date+signer → station picker → months → review.
// Saves to existing `quotes` table with segment='GOVERNMENT',
// media_type='GSRTC_LED', rate_type='DAVP', signer_user_id,
// gsrtc_campaign_months. Per-station line items go to quote_cities
// with ref_kind='STATION'.

import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { GovtWizardShell } from '../../components/govt/GovtWizardShell'
import { Step1Client, validateStep1 }       from '../../components/govt/steps/Step1Client'
import { Step2DateSigner, validateStep2 }   from '../../components/govt/steps/Step2DateSigner'
import { Step3Stations, validateStep3Gsrtc }from '../../components/govt/GsrtcLedWizard/Step3Stations'
import { Step4Months, validateStep4Gsrtc }  from '../../components/govt/GsrtcLedWizard/Step4Months'
import { Step5ReviewGsrtc }                 from '../../components/govt/GsrtcLedWizard/Step5Review'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useGsrtcStations } from '../../hooks/useGovtMasters'
import { syncClientFromQuote } from '../../utils/syncClient'

const STEPS = [
  { id: 1, label: 'Recipient' },
  { id: 2, label: 'Date & Signer' },
  { id: 3, label: 'Stations' },
  { id: 4, label: 'Months' },
  { id: 5, label: 'Review' },
]

const GST_PCT = 18

export default function CreateGovtGsrtcLedV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile  = useAuthStore(s => s.profile)
  const { stations } = useGsrtcStations()

  // Phase 11d (rev9) — read prefill from location.state. See same
  // comment in CreateGovtAutoHoodV2 — fixes "create quote via client"
  // for govt wizards.
  const prefill = location.state?.prefill || {}

  const [step, setStep] = useState(1)
  const [data, setData] = useState({
    client_name:    prefill.client_name    || '',
    client_company: prefill.client_company || '',
    client_address: prefill.client_address || '',
    client_phone:   prefill.client_phone   || '',
    client_email:   prefill.client_email   || '',
    proposal_date: new Date().toISOString().slice(0, 10),
    signer_user_id: null,
    selected_station_ids: undefined,    // step seeds with all 20
    gsrtc_campaign_months: 1,
  })
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)

  function update(patch) {
    setData(prev => ({ ...prev, ...patch }))
    if (error) setError('')
  }

  function goNext() {
    const validators = [validateStep1, validateStep2, validateStep3Gsrtc, validateStep4Gsrtc]
    const v = validators[step - 1]
    if (v) {
      const err = v(data)
      if (err) { setError(err); return }
    }
    setStep(s => Math.min(s + 1, STEPS.length))
    setError('')
  }
  function goBack() {
    setStep(s => Math.max(s - 1, 1))
    setError('')
  }

  async function handleSave(targetStatus = 'draft') {
    setSaving(true)
    setError('')

    const recipientBlock = [
      data.client_name, data.client_company, data.client_address,
    ].filter(Boolean).join('\n')

    const months = Number(data.gsrtc_campaign_months) || 1
    const selectedStations = stations.filter(s => (data.selected_station_ids || []).includes(s.id))
    const overrides = data.station_overrides || {}
    const monthlySum = selectedStations.reduce((sum, s) => {
      const ov = overrides[s.id] || {}
      const daily = ov.daily_spots_override ?? 100
      const days  = ov.days_override        ?? 30
      const monthly = (Number(s.screens_count) || 0) * daily * days * Number(s.davp_per_slot_rate || 0)
      return sum + monthly
    }, 0)
    const subtotal = monthlySum * months
    const gstAmount = Math.round(subtotal * GST_PCT / 100)
    const total = subtotal + gstAmount

    const quotePayload = {
      client_name:    data.client_name || '',
      client_company: data.client_company || null,
      client_phone:   data.client_phone || null,
      client_email:   data.client_email || null,
      client_address: data.client_address || null,
      revenue_type:   'new',
      status:         targetStatus,
      subtotal,
      gst_rate:       GST_PCT / 100,
      gst_amount:     gstAmount,
      total_amount:   total,
      duration_months: months,
      segment:        'GOVERNMENT',
      media_type:     'GSRTC_LED',
      rate_type:      'DAVP',
      signer_user_id: data.signer_user_id,
      gsrtc_campaign_months: months,
      recipient_block: recipientBlock,
      proposal_date:  data.proposal_date,
      created_by:     profile?.id,
      sales_person_name: profile?.name,
    }

    const { data: quote, error: qErr } = await supabase
      .from('quotes')
      .insert([quotePayload])
      .select()
      .single()

    if (qErr) {
      setSaving(false)
      setError(qErr.message || 'Failed to save proposal.')
      return
    }

    // Per-station line items — including per-row overrides (Phase 7).
    const lineItems = selectedStations.map(s => {
      const ov       = overrides[s.id] || {}
      const daily    = ov.daily_spots_override ?? 100
      const days     = ov.days_override ?? 30
      const duration = ov.spot_duration_sec_override ?? 10
      const monthly  = (Number(s.screens_count) || 0) * daily * days * Number(s.davp_per_slot_rate || 0)
      const lineTotal = monthly * months
      return {
        quote_id:     quote.id,
        ref_kind:     'STATION',
        ref_id:       s.id,
        city_id:      null,
        city_name:    s.station_name_en,
        description:  s.station_name_en,
        qty:          months,
        unit_rate:    Number(s.davp_per_slot_rate || 0),
        amount:       lineTotal,
        screens:      s.screens_count || 0,
        grade:        s.category,
        listed_rate:  Number(s.davp_per_slot_rate || 0),
        offered_rate: Number(s.davp_per_slot_rate || 0),
        campaign_total: lineTotal,
        duration_months: months,
        // Phase 7 — per-row overrides (NULL means "use default")
        daily_spots_override:       ov.daily_spots_override ?? null,
        days_override:              ov.days_override ?? null,
        spot_duration_sec_override: ov.spot_duration_sec_override ?? null,
        // Legacy slot fields kept for the existing AdFlux columns
        slot_seconds: duration,
        slots_per_day: daily,
      }
    })

    if (lineItems.length) {
      const { error: liErr } = await supabase
        .from('quote_cities')
        .insert(lineItems)
      if (liErr) {
        setSaving(false)
        setError('Quote saved but line items failed: ' + liErr.message)
        return
      }
    }

    // Auto-save the client into the CRM clients table. Non-fatal — quote
    // is already saved, so failures here just mean no clients-list row.
    syncClientFromQuote(quote, 'create')

    setSaving(false)
    navigate(`/proposal/${quote.id}`)
  }

  const stepLabels = useMemo(() => STEPS, [])

  return (
    <GovtWizardShell
      kicker="Government — GSRTC LED"
      title="New DAVP GSRTC LED Proposal"
      steps={stepLabels}
      step={step}
      goBack={goBack}
      goNext={goNext}
      saving={saving}
      isLastStep={step === STEPS.length}
      primaryLabel="Save as Draft"
      onPrimary={() => handleSave('draft')}
    >
      {error && (
        <div className="govt-master__warn" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      {step === 1 && <Step1Client     data={data} onChange={update} />}
      {step === 2 && <Step2DateSigner data={data} onChange={update} />}
      {step === 3 && <Step3Stations   data={data} onChange={update} />}
      {step === 4 && <Step4Months     data={data} onChange={update} />}
      {step === 5 && <Step5ReviewGsrtc data={data} />}
    </GovtWizardShell>
  )
}
