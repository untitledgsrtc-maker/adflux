// src/components/govt/AutoHoodWizard/Step5Review.jsx
//
// Wizard Step 5 — review the rendered Gujarati letter and save as
// DRAFT or mark as SENT. The letter is rendered via
// GovtProposalRenderer using the seeded proposal_templates row for
// (GOVERNMENT, AUTO_HOOD, gu).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { GovtProposalRenderer } from '../GovtProposalRenderer'
import { useAutoMasters, useSigners } from '../../../hooks/useGovtMasters'
import { distributeAutoHoodQuantity } from '../../../utils/distributeQuantity'

export function Step5Review({ data }) {
  const [template, setTemplate] = useState(null)
  // Phase 11d (rev9) — also fetch the GOVERNMENT companies row so the
  // wizard preview shows the same legal entity (Untitled Advertising)
  // that the saved/printed PDF will use. Without this, the preview
  // fell back to the renderer's hardcoded "અનટાઇટલ્ડ એડવર્ટાઇઝિંગ"
  // even when the row had different data — confusing two-state UX.
  const [company,  setCompany]  = useState(null)
  const { districts, rate } = useAutoMasters()
  const { signers } = useSigners()

  useEffect(() => {
    let cancel = false
    Promise.all([
      supabase.from('proposal_templates')
        .select('*')
        .eq('segment',    'GOVERNMENT')
        .eq('media_type', 'AUTO_HOOD')
        .eq('language',   'gu')
        .eq('is_active',  true)
        .is('effective_to', null)
        .maybeSingle(),
      supabase.from('companies')
        .select('*')
        .eq('segment', 'GOVERNMENT')
        .eq('is_active', true)
        .maybeSingle(),
    ]).then(([{ data: t }, { data: c }]) => {
      if (cancel) return
      setTemplate(t)
      setCompany(c)
    })
    return () => { cancel = true }
  }, [])

  const signer = useMemo(
    () => signers.find(s => s.id === data.signer_user_id) || null,
    [signers, data.signer_user_id],
  )

  const checkedDistricts = useMemo(
    () => districts.filter(d => (data.selected_district_ids || []).includes(d.id)),
    [districts, data.selected_district_ids],
  )

  // Phase 11j — same override-aware allocation as Step4 + save flow.
  // Without this, the review preview shows auto-distributed numbers
  // even when the rep typed manual qty overrides in Step 4.
  const allocated = useMemo(() => {
    const auto = distributeAutoHoodQuantity(data.auto_total_quantity || 0, checkedDistricts)
    const overrides = data.district_qty_overrides || {}
    return auto.map(a => {
      const ov = overrides[a.id]
      if (ov !== undefined && ov !== null && ov !== '') {
        return { ...a, allocated_qty: Math.max(0, Number(ov) || 0) }
      }
      return a
    })
  }, [data.auto_total_quantity, data.district_qty_overrides, checkedDistricts])

  const actualQty = allocated.reduce((s, a) => s + (a.allocated_qty || 0), 0)

  const recipientBlock = [
    data.client_name,
    data.client_company,
    data.client_address,
  ].filter(Boolean).join('\n')

  const rendered = {
    recipient_block: recipientBlock,
    proposal_date:   data.proposal_date,
    auto_total_quantity: actualQty,
    unit_rate:       rate ? Number(rate.davp_per_rickshaw_rate) : 825,
    // Phase 34H — campaign months drives the multiplier in the
    // Gujarati proposal table.
    auto_campaign_months: Number(data.auto_campaign_months) || 1,
    line_items:      allocated,                         // for districts_count placeholder
  }

  return (
    <div>
      <h2 className="govt-step__title">Review &amp; Save</h2>
      <p className="govt-step__sub">
        Final preview of the Gujarati letter. You can save as Draft or mark as
        Sent. Either way the proposal lands in the Quotes list.
      </p>

      <GovtProposalRenderer
        template={template}
        data={rendered}
        signer={signer}
        mediaType="AUTO_HOOD"
        company={company}
      />

      <div className="govt-summary">
        <div className="govt-summary__row">
          <span>Districts selected</span>
          <strong>{checkedDistricts.length} of {districts.length}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Total rickshaws</span>
          <strong>{actualQty}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Signed by</span>
          <strong>{signer ? `${signer.name} (${signer.signature_title})` : '—'}</strong>
        </div>
      </div>
    </div>
  )
}
