// src/components/govt/GsrtcLedWizard/Step4Months.jsx
//
// Wizard Step 4 — campaign duration in months.
// Quick chips (1 / 2 / 3) plus a "Custom" numeric input.
// Uses station_overrides from Step 3 when computing the monthly cost
// (so a station with overridden Daily/Days reflects in the totals).

import { useGsrtcStations } from '../../../hooks/useGovtMasters'
import { formatINREnglish } from '../../../utils/gujaratiNumber'

const PRESET_MONTHS = [1, 2, 3]
const GST_PCT = 18
const DEFAULT_DAILY = 100
const DEFAULT_DAYS = 30

function effectiveMonthly(s, override) {
  const daily   = (override?.daily_spots_override ?? null) || DEFAULT_DAILY
  const days    = (override?.days_override        ?? null) || DEFAULT_DAYS
  const screens = Number(s.screens_count) || 0
  const rate    = Number(s.davp_per_slot_rate) || 0
  return screens * daily * days * rate
}

export function Step4Months({ data, onChange }) {
  const { stations } = useGsrtcStations()
  const selectedIds = data.selected_station_ids || []
  const overrides   = data.station_overrides || {}
  const months      = Number(data.gsrtc_campaign_months) || 1

  const monthlySum = stations
    .filter(s => selectedIds.includes(s.id))
    .reduce((sum, s) => sum + effectiveMonthly(s, overrides[s.id]), 0)

  const subtotal = monthlySum * months
  const gst      = Math.round(subtotal * GST_PCT / 100)
  const total    = subtotal + gst

  function set(value) {
    onChange({ gsrtc_campaign_months: Number(value) || 1 })
  }

  return (
    <div>
      <h2 className="govt-step__title">Campaign Duration</h2>
      <p className="govt-step__sub">
        Pick how many months the campaign runs. Total cost = monthly cost × months.
        Per-station overrides from Step 3 are already factored in.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {PRESET_MONTHS.map(m => (
          <button
            key={m}
            type="button"
            onClick={() => set(m)}
            className={
              'govt-wiz__btn' +
              (months === m ? ' govt-wiz__btn--primary' : '')
            }
            style={{ minWidth: 90 }}
          >
            {m} month{m > 1 ? 's' : ''}
          </button>
        ))}
        <div className="govt-field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label className="govt-field__label">Or custom</label>
          <input
            type="number"
            min="1"
            max="36"
            className="govt-field__input"
            value={data.gsrtc_campaign_months ?? ''}
            onChange={e => set(e.target.value)}
            placeholder="e.g. 6"
          />
        </div>
      </div>

      <div className="govt-summary">
        <div className="govt-summary__row">
          <span>Monthly cost (selected stations + overrides)</span>
          <strong>₹{formatINREnglish(monthlySum)}</strong>
        </div>
        <div className="govt-summary__row">
          <span>× campaign months</span>
          <strong>{months}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Subtotal</span>
          <strong>₹{formatINREnglish(subtotal)}</strong>
        </div>
        <div className="govt-summary__row">
          <span>GST @ {GST_PCT}%</span>
          <strong>₹{formatINREnglish(gst)}</strong>
        </div>
        <div className="govt-summary__row govt-summary__total">
          <span>Grand total</span>
          <strong>₹{formatINREnglish(total)}</strong>
        </div>
      </div>
    </div>
  )
}

export function validateStep4Gsrtc(data) {
  const m = Number(data.gsrtc_campaign_months)
  if (!Number.isFinite(m) || m < 1) return 'Pick a valid campaign duration (≥ 1 month).'
  if (m > 36) return 'Campaign over 36 months — double-check.'
  return null
}
