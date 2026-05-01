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
  const subtotal  = qty * ratePer
  const gstAmount = Math.round(subtotal * GST_PCT / 100)
  const total     = subtotal + gstAmount

  return (
    <div>
      <h2 className="govt-step__title">Total Rickshaw Quantity</h2>
      <p className="govt-step__sub">
        Enter the total number of rickshaws across the campaign.
        The system distributes this across districts in Step 4
        based on each district's % share.
      </p>

      <div className="govt-qty">
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

      <div className="govt-summary">
        <div className="govt-summary__row">
          <span>DAVP rate per rickshaw</span>
          <strong>₹{loading ? '…' : formatINREnglish(ratePer)}</strong>
        </div>
        <div className="govt-summary__row">
          <span>Subtotal</span>
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
        Sample: <strong>12,000 rickshaws</strong> at ₹825 = ₹99,00,000 + 18% GST
        ₹17,82,000 = grand total <strong>₹1,16,82,000</strong>.
      </div>
    </div>
  )
}

export function validateStep3(data) {
  const q = Number(data.auto_total_quantity)
  if (!Number.isFinite(q) || q <= 0) return 'Enter a positive quantity.'
  if (q > 1_000_000) return 'Quantity above 10 lakh — double-check before continuing.'
  return null
}
