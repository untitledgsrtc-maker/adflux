// src/components/govt/GsrtcLedWizard/Step3Stations.jsx
//
// Wizard Step 3 — pick GSRTC stations to include in the campaign.
// All 20 stations checked by default; uncheck to exclude.
// Per-station monthly cost = screens × 100 daily spots × 30 days × DAVP rate.

import { useMemo } from 'react'
import { useGsrtcStations } from '../../../hooks/useGovtMasters'
import { formatINREnglish } from '../../../utils/gujaratiNumber'

export function Step3Stations({ data, onChange }) {
  const { stations, loading } = useGsrtcStations()
  const selected = data.selected_station_ids || []

  if (!loading && data.selected_station_ids === undefined && stations.length) {
    onChange({ selected_station_ids: stations.map(s => s.id) })
  }

  const monthlySum = useMemo(() => {
    return stations
      .filter(s => selected.includes(s.id))
      .reduce((sum, s) => {
        const monthly = (Number(s.screens_count) || 0) * 100 * 30 * Number(s.davp_per_slot_rate || 0)
        return sum + monthly
      }, 0)
  }, [stations, selected])

  function toggle(id) {
    const has = selected.includes(id)
    onChange({
      selected_station_ids: has ? selected.filter(x => x !== id) : [...selected, id],
    })
  }
  function selectAll()  { onChange({ selected_station_ids: stations.map(s => s.id) }) }
  function selectNone() { onChange({ selected_station_ids: [] }) }

  if (loading) return <div className="govt-field__hint">Loading stations…</div>

  return (
    <div>
      <h2 className="govt-step__title">Select GSRTC Stations</h2>
      <p className="govt-step__sub">
        Pick which GSRTC bus stations to include. {selected.length} of {stations.length} selected.
        Combined monthly cost (1 month, before GST): <strong>₹{formatINREnglish(monthlySum)}</strong>.
      </p>

      <div className="govt-list">
        <div className="govt-list__bulk">
          <span style={{ marginRight: 'auto', color: 'var(--text-muted)' }}>Bulk:</span>
          <button type="button" onClick={selectAll}>Select all</button>
          <button type="button" onClick={selectNone}>Select none</button>
        </div>
        <div className="govt-list__row govt-list__row--head" style={{ gridTemplateColumns: '28px 1fr 60px 60px 110px' }}>
          <span></span>
          <span>Station</span>
          <span style={{ textAlign: 'center' }}>Cat</span>
          <span style={{ textAlign: 'right' }}>Screens</span>
          <span style={{ textAlign: 'right' }}>Monthly</span>
        </div>
        {stations.map(s => {
          const isChecked = selected.includes(s.id)
          const monthly = (Number(s.screens_count) || 0) * 100 * 30 * Number(s.davp_per_slot_rate || 0)
          return (
            <label key={s.id} className="govt-list__row" style={{ cursor: 'pointer', gridTemplateColumns: '28px 1fr 60px 60px 110px' }}>
              <span className="govt-list__check">
                <input type="checkbox" checked={isChecked} onChange={() => toggle(s.id)} />
              </span>
              <span className="govt-list__name">
                {s.station_name_en}
                <span className="govt-list__name-gu">{s.station_name_gu}</span>
              </span>
              <span style={{ textAlign: 'center' }}>
                <span className={`govt-pill govt-pill--${s.category}`}>{s.category}</span>
              </span>
              <span className="govt-list__pct">{s.screens_count}</span>
              <span className="govt-list__qty">
                {isChecked ? `₹${formatINREnglish(monthly)}` : '—'}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export function validateStep3Gsrtc(data) {
  if (!data.selected_station_ids?.length) return 'Pick at least one station.'
  return null
}
