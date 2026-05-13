// src/components/govt/AutoHoodWizard/Step3Quantity.jsx
//
// Wizard Step 3 — total rickshaw quantity.
//
// Displays the locked DAVP rate (₹825 default, pulled from
// auto_rate_master) and computes a live preview of subtotal + GST +
// grand total. The actual per-district allocation happens in Step 4.

import { useAutoMasters } from '../../../hooks/useGovtMasters'
import { formatINREnglish } from '../../../utils/gujaratiNumber'

const GST_PCT = 18

export function Step3Quantity({ data, onChange }) {
  const { rate, loading } = useAutoMasters()
  const ratePer = rate ? Number(rate.davp_per_rickshaw_rate) : 825

  const qty       = Number(data.auto_total_quantity) || 0
  // Phase 34H — campaign duration in months. Default 1 (legacy
  // single-month behaviour). Owner spec (13 May 2026): proposal
  // multiplies rate × qty × months so a 3-month auto-hood proposal
  // shows the proper total instead of one-month price.
  const months    = Number(data.auto_campaign_months) || 1
  const subtotal  = qty * ratePer * months
  const gstAmount = Math.round(subtotal * GST_PCT / 100)
  const total     = subtotal + gstAmount

  return (
    <div>
      <h2 className="govt-step__title">Rickshaw quantity &amp; campaign length</h2>
      <p className="govt-step__sub">
        Enter the total number of rickshaws across the campaign.
        The system distributes this across districts in Step 4
        based on each district's % share. Months multiplies the
        monthly rate to get the full proposal value.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div className="govt-qty" style={{ flex: '1 1 220px' }}>
          <input
            type="number"
            inputMode="numeric"
            className="govt-qty__input"
            placeholder="0"
            min="0"
            value={data.auto_total_quantity ?? ''}
            onChange={e => onChange({ auto_total_quantity: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <span className="govt-qty__suffix">rickshaws</span>
        </div>

        <div className="govt-qty" style={{ flex: '1 1 180px' }}>
          <input
            type="number"
            inputMode="numeric"
            className="govt-qty__input"
            placeholder="1"
            min="1"
            max="36"
            value={data.auto_campaign_months ?? 1}
            onChange={e => {
              const n = e.target.value === '' ? 1 : Math.max(1, Number(e.target.value))
              onChange({ auto_campaign_months: n })
            }}
          />
          <span className="govt-qty__suffix">months</span>
        </div>
      </div>

      <div className="govt-summary">
        <div className="govt-summary__row">
          <span>DAVP rate per rickshaw / month</span>
          <strong>₹{loading ? '…' : formatINREnglish(ratePer)}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Months × rickshaws</span>
          <strong>{months} × {formatINREnglish(qty)} = {formatINREnglish(qty * months)} ad-months</strong>
        </div>
        <div className="govt-summary__row">
          <span>Subtotal ({qty} × ₹{formatINREnglish(ratePer)} × {months})</span>
          <strong>₹{formatINREnglish(subtotal)}</strong>
        </div>
        <div className="govt-summary__row">
          <span>GST @ {GST_PCT}%</span>
          <strong>₹{formatINREnglish(gstAmount)}</strong>
        </div>
        <div className="govt-summary__row govt-summary__total">
          <span>Grand total</span>
          <strong>₹{formatINREnglish(total)}</strong>
        </div>
      </div>

      <div className="govt-field__hint" style={{ fontSize: 13 }}>
        Sample: <strong>1,500 rickshaws</strong> × ₹825 × <strong>3 months</strong> =
        ₹37,12,500 + 18% GST ₹6,68,250 = grand total <strong>₹43,80,750</strong>.
      </div>
    </div>
  )
}

export function validateStep3(data) {
  const q = Number(data.auto_total_quantity)
  if (!Number.isFinite(q) || q <= 0) return 'Enter a positive quantity.'
  if (q > 1_000_000) return 'Quantity above 10 lakh — double-check before continuing.'
  const m = Number(data.auto_campaign_months ?? 1)
  if (!Number.isFinite(m) || m < 1) return 'Enter at least 1 month.'
  if (m > 36) return 'Months above 36 — double-check before continuing.'
  return null
}
