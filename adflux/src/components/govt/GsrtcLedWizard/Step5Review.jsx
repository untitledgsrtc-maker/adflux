// src/components/govt/GsrtcLedWizard/Step5Review.jsx
//
// Wizard Step 5 — review the rendered Gujarati GSRTC LED letter.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { GovtProposalRenderer } from '../GovtProposalRenderer'
import { useGsrtcStations, useSigners } from '../../../hooks/useGovtMasters'

export function Step5ReviewGsrtc({ data }) {
  const [template, setTemplate] = useState(null)
  const { stations } = useGsrtcStations()
  const { signers } = useSigners()

  useEffect(() => {
    let cancel = false
    supabase.from('proposal_templates')
      .select('*')
      .eq('segment',    'GOVERNMENT')
      .eq('media_type', 'GSRTC_LED')
      .eq('language',   'gu')
      .eq('is_active',  true)
      .is('effective_to', null)
      .maybeSingle()
      .then(({ data: t }) => { if (!cancel) setTemplate(t) })
    return () => { cancel = true }
  }, [])

  const signer = useMemo(
    () => signers.find(s => s.id === data.signer_user_id) || null,
    [signers, data.signer_user_id],
  )

  const selectedStations = useMemo(
    () => stations.filter(s => (data.selected_station_ids || []).includes(s.id)),
    [stations, data.selected_station_ids],
  )

  const overrides = data.station_overrides || {}
  const lineItems = selectedStations.map(s => {
    const ov = overrides[s.id] || {}
    const daily    = ov.daily_spots_override ?? 100
    const days     = ov.days_override ?? 30
    const duration = ov.spot_duration_sec_override ?? 10
    const screens  = Number(s.screens_count) || 0
    const rate     = Number(s.davp_per_slot_rate || 0)
    const monthly  = screens * daily * days * rate
    return {
      id: s.id,
      description: s.station_name_en,
      description_gu: s.station_name_gu,
      category: s.category,
      screens,
      daily_spots: daily,
      days,
      spot_duration_sec: duration,
      monthly_spots: screens * daily * days,   // shown in rate sheet
      unit_rate: rate,
      monthly_total: monthly,
    }
  })

  const recipientBlock = [
    data.client_name,
    data.client_company,
    data.client_address,
  ].filter(Boolean).join('\n')

  const rendered = {
    recipient_block:        recipientBlock,
    proposal_date:          data.proposal_date,
    gsrtc_campaign_months:  data.gsrtc_campaign_months || 1,
    line_items:             lineItems,
  }

  return (
    <div>
      <h2 className="govt-step__title">Review &amp; Save</h2>
      <p className="govt-step__sub">
        Final preview of the GSRTC LED proposal letter.
      </p>

      <GovtProposalRenderer
        template={template}
        data={rendered}
        signer={signer}
        mediaType="GSRTC_LED"
      />

      <div className="govt-summary">
        <div className="govt-summary__row">
          <span>Stations selected</span>
          <strong>{selectedStations.length} of {stations.length}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Campaign duration</span>
          <strong>{data.gsrtc_campaign_months || 1} month(s)</strong>
        </div>
        <div className="govt-summary__row">
          <span>Signed by</span>
          <strong>{signer ? `${signer.name} (${signer.signature_title})` : '—'}</strong>
        </div>
      </div>
    </div>
  )
}
