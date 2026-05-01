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
  const { districts, rate } = useAutoMasters()
  const { signers } = useSigners()

  useEffect(() => {
    let cancel = false
    supabase.from('proposal_templates')
      .select('*')
      .eq('segment',    'GOVERNMENT')
      .eq('media_type', 'AUTO_HOOD')
      .eq('language',   'gu')
      .eq('is_active',  true)
      .is('effective_to', null)
      .maybeSingle()
      .then(({ data: t }) => {
        if (!cancel) setTemplate(t)
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

  const allocated = useMemo(
    () => distributeAutoHoodQuantity(data.auto_total_quantity || 0, checkedDistricts),
    [data.auto_total_quantity, checkedDistricts],
  )

  const recipientBlock = [
    data.client_name,
    data.client_company,
    data.client_address,
  ].filter(Boolean).join('\n')

  const rendered = {
    recipient_block: recipientBlock,
    proposal_date:   data.proposal_date,
    auto_total_quantity: data.auto_total_quantity,
    unit_rate:       rate ? Number(rate.davp_per_rickshaw_rate) : 825,
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
      />

      <div className="govt-summary">
        <div className="govt-summary__row">
          <span>Districts selected</span>
          <strong>{checkedDistricts.length} of {districts.length}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Total rickshaws</span>
          <strong>{allocated.reduce((s, a) => s + (a.allocated_qty || 0), 0)}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Signed by</span>
          <strong>{signer ? `${signer.name} (${signer.signature_title})` : '—'}</strong>
        </div>
      </div>
    </div>
  )
}
