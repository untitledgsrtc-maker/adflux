// src/pages/v2/CreateGovtAutoHoodV2.jsx
//
// Government — Auto Hood proposal wizard.
//
// 5 steps. Saves into the existing `quotes` table with the new govt
// columns (segment='GOVERNMENT', media_type='AUTO_HOOD', rate_type='DAVP',
// signer_user_id, auto_total_quantity, recipient_block) and
// per-district line items into `quote_cities` with ref_kind='DISTRICT'.

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { GovtWizardShell } from '../../components/govt/GovtWizardShell'
import { Step1Client, validateStep1 } from '../../components/govt/steps/Step1Client'
import { Step2DateSigner, validateStep2 } from '../../components/govt/steps/Step2DateSigner'
import { Step3Quantity, validateStep3 } from '../../components/govt/AutoHoodWizard/Step3Quantity'
import { Step4Districts, validateStep4 } from '../../components/govt/AutoHoodWizard/Step4Districts'
import { Step5Review } from '../../components/govt/AutoHoodWizard/Step5Review'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useAutoMasters } from '../../hooks/useGovtMasters'
import { distributeAutoHoodQuantity } from '../../utils/distributeQuantity'
import { syncClientFromQuote } from '../../utils/syncClient'

const STEPS = [
  { id: 1, label: 'Recipient' },
  { id: 2, label: 'Date & Signer' },
  { id: 3, label: 'Quantity' },
  { id: 4, label: 'Districts' },
  { id: 5, label: 'Review' },
]

const GST_PCT = 18

export default function CreateGovtAutoHoodV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile  = useAuthStore(s => s.profile)
  const { districts, rate } = useAutoMasters()

  // Phase 11d (rev9) — read prefill from location.state. Set by
  // ClientsV2's "+" button → forwarded by CreateQuoteChooserV2. Owner
  // reported "create quote via client not working": chooser was passing
  // state but wizards were ignoring it, so Step 1 always loaded blank.
  const prefill = location.state?.prefill || {}

  // Phase 29b — owner spec: every quote should be editable. Detail
  // page Edit on an Auto Hood draft routes here with editingId set;
  // useEffect below loads the quote + district line items into state
  // and handleSave switches to UPDATE-in-place.
  const editingId = location.state?.editingId || null

  const [step,    setStep]    = useState(1)
  const [data,    setData]    = useState({
    // recipient
    client_name:    prefill.client_name    || '',
    client_company: prefill.client_company || '',
    client_address: prefill.client_address || '',
    client_phone:   prefill.client_phone   || '',
    client_email:   prefill.client_email   || '',
    // date + signer
    proposal_date: new Date().toISOString().slice(0, 10),
    signer_user_id: null,
    // quantity
    auto_total_quantity: null,
    // Phase 34H — campaign duration in months. Multiplied into the
    // rate-table subtotal so a 3-month proposal shows 3× the monthly
    // value rather than the legacy single-month total.
    auto_campaign_months: 1,
    // districts
    selected_district_ids: null,    // null = uninitialized; the step seeds with all 33
  })
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [editLoading, setEditLoading] = useState(!!editingId)

  // Phase 29b — load existing quote + district items for edit mode.
  useEffect(() => {
    if (!editingId) return
    let cancelled = false
    ;(async () => {
      const { data: q, error: qErr } = await supabase
        .from('quotes').select('*').eq('id', editingId).single()
      if (cancelled) return
      if (qErr || !q) {
        setError('Could not load this draft for editing — ' + (qErr?.message || 'not found'))
        setEditLoading(false)
        return
      }
      if (q.status !== 'draft') {
        setError(`This proposal is "${q.status}" — only drafts can be edited.`)
        setEditLoading(false)
        return
      }
      const { data: cities } = await supabase
        .from('quote_cities').select('*').eq('quote_id', editingId)
      if (cancelled) return

      const districtIds = (cities || []).map(c => c.ref_id).filter(Boolean)
      const qtyOverrides = {}
      ;(cities || []).forEach(c => {
        if (c.ref_id != null && c.qty != null) qtyOverrides[c.ref_id] = c.qty
      })

      setData(prev => ({
        ...prev,
        client_name:    q.client_name || '',
        client_company: q.client_company || '',
        client_address: q.client_address || '',
        client_phone:   q.client_phone || '',
        client_email:   q.client_email || '',
        proposal_date:  q.proposal_date
                          ? String(q.proposal_date).slice(0, 10)
                          : prev.proposal_date,
        signer_user_id: q.signer_user_id || null,
        auto_total_quantity:    Number(q.auto_total_quantity || 0) || null,
        // Phase 34H — restore the saved months so an edit session
        // keeps the multiplier.
        auto_campaign_months:   Math.max(1, Number(q.duration_months || 1)),
        selected_district_ids:  districtIds,
        district_qty_overrides: qtyOverrides,
      }))
      setEditLoading(false)
    })()
    return () => { cancelled = true }
  }, [editingId])

  function update(patch) {
    setData(prev => ({ ...prev, ...patch }))
    if (error) setError('')
  }

  function goNext() {
    const validators = [validateStep1, validateStep2, validateStep3, validateStep4]
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

    // Build recipient_block snapshot
    const recipientBlock = [
      data.client_name,
      data.client_company,
      data.client_address,
    ].filter(Boolean).join('\n')

    // Allocate per-district quantities — auto by share_pct, then
    // overlay any manual overrides the rep set in Step 4.
    // Phase 11j — manual qty per district.
    const checkedDistricts = districts.filter(d =>
      (data.selected_district_ids || []).includes(d.id),
    )
    const autoAllocated = distributeAutoHoodQuantity(
      data.auto_total_quantity || 0,
      checkedDistricts,
    )
    const overrides = data.district_qty_overrides || {}
    const allocated = autoAllocated.map(a => {
      const ov = overrides[a.id]
      if (ov !== undefined && ov !== null && ov !== '') {
        return { ...a, allocated_qty: Math.max(0, Number(ov) || 0) }
      }
      return a
    })

    // Phase 11j — invoice total reflects ACTUAL allocated qty (sum of
    // overrides) rather than the wizard's target qty. Otherwise a rep
    // who trims a district leaves the invoice misaligned with what's
    // saved to quote_cities.
    const actualQty = allocated.reduce((s, a) => s + (a.allocated_qty || 0), 0)
    const ratePer = rate ? Number(rate.davp_per_rickshaw_rate) : 825
    // Phase 34H — multiply by campaign months. Falls back to 1 for
    // legacy quotes that never had this field.
    const months = Math.max(1, Number(data.auto_campaign_months) || 1)
    const subtotal = actualQty * ratePer * months
    const gstAmount = Math.round(subtotal * GST_PCT / 100)
    const total = subtotal + gstAmount

    const quotePayload = {
      // legacy AdFlux columns we still need to populate
      client_name:    data.client_name || '',
      client_company: data.client_company || null,
      client_phone:   data.client_phone || null,
      client_email:   data.client_email || null,
      client_address: data.client_address || null,
      revenue_type:   'new',
      // status enum lives at lowercase in AdFlux schema
      status:         targetStatus,
      // financial fields
      subtotal,
      gst_rate:       GST_PCT / 100,
      gst_amount:     gstAmount,
      total_amount:   total,
      // Phase 34H — duration_months reused as the auto-hood campaign
      // length. The Gujarati proposal table multiplies by this.
      duration_months: months,
      // new govt fields
      segment:        'GOVERNMENT',
      media_type:     'AUTO_HOOD',
      rate_type:      'DAVP',
      signer_user_id: data.signer_user_id,
      // Phase 11j — store the ACTUAL allocated total (sum of overrides
      // if any), not the wizard target. The user-facing letter pulls
      // this number, so it must match what's persisted in quote_cities.
      auto_total_quantity: actualQty || (Number(data.auto_total_quantity) || 0),
      recipient_block: recipientBlock,
      proposal_date:  data.proposal_date,
      // ref_number is auto-generated by the BEFORE INSERT trigger
      // (phase4d) using quote_number_seq_auto for AUTO_HOOD, returning
      // 'UA/AUTO/2026-27/NNNN'.
      // Phase 29b — only stamp creator + lead_id on INSERT; UPDATE
      // leaves them alone so RLS still matches and the lead funnel
      // doesn't double-advance on edit.
      ...(editingId ? {} : {
        created_by:        profile?.id,
        sales_person_name: profile?.name,
        lead_id:           prefill.lead_id || null,
      }),
    }

    let quote
    if (editingId) {
      // Phase 29b — UPDATE in-place. Quote number stays UA/AUTO/...,
      // lead_id linkage preserved.
      const { data: updated, error: uErr } = await supabase
        .from('quotes').update(quotePayload).eq('id', editingId).select().single()
      if (uErr) {
        setSaving(false)
        setError(uErr.message || 'Failed to update proposal.')
        return
      }
      quote = updated

      // Wipe old district items and re-insert below.
      const { error: dErr } = await supabase
        .from('quote_cities').delete().eq('quote_id', editingId)
      if (dErr) {
        setSaving(false)
        setError('Updated quote but could not clear old districts: ' + dErr.message)
        return
      }
    } else {
      const { data: inserted, error: qErr } = await supabase
        .from('quotes').insert([quotePayload]).select().single()
      if (qErr) {
        setSaving(false)
        setError(qErr.message || 'Failed to save proposal.')
        return
      }
      quote = inserted

      // Phase 14 — advance the originating lead's stage to QuoteSent.
      // Only on INSERT.
      if (prefill.lead_id) {
        await supabase
          .from('leads')
          .update({ stage: 'QuoteSent', quote_id: quote.id })
          .eq('id', prefill.lead_id)
      }
    }

    // Save per-district line items
    const lineItems = allocated.map(d => ({
      quote_id:     quote.id,
      ref_kind:     'DISTRICT',
      ref_id:       d.id,
      city_id:      null,
      city_name:    d.district_name_en,
      description:  d.district_name_en,
      qty:          d.allocated_qty,
      unit_rate:    ratePer,
      // Phase 34H — amount + campaign_total include months multiplier
      // so quote_cities row totals add up to quotes.total_amount.
      amount:       d.allocated_qty * ratePer * months,
      // these legacy columns are required NOT NULL on the table
      screens:      0,
      grade:        null,
      listed_rate:  ratePer,
      offered_rate: ratePer,
      campaign_total: d.allocated_qty * ratePer * months,
      duration_months: months,
      slot_seconds: 10,
      slots_per_day: 100,
    }))

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
    syncClientFromQuote(quote, editingId ? 'update' : 'create')

    setSaving(false)
    navigate(`/proposal/${quote.id}`)
  }

  const stepLabels = useMemo(() => STEPS, [])

  if (editLoading) {
    return (
      <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading draft for editing…
      </div>
    )
  }

  return (
    <GovtWizardShell
      kicker="Government — Auto Hood"
      title={editingId ? 'Edit Auto Hood Proposal' : 'New DAVP Auto Hood Proposal'}
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
      {step === 1 && <Step1Client       data={data} onChange={update} />}
      {step === 2 && <Step2DateSigner   data={data} onChange={update} />}
      {step === 3 && <Step3Quantity     data={data} onChange={update} />}
      {step === 4 && <Step4Districts    data={data} onChange={update} />}
      {step === 5 && <Step5Review       data={data} />}
    </GovtWizardShell>
  )
}
