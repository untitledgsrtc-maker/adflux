import { ChevronLeft, Send, Save, Monitor, ShieldAlert } from 'lucide-react'
import { formatCurrency } from '../../../utils/formatters'
import { GST_RATE } from '../../../utils/constants'
import { PRICE_FLOOR } from '../../../utils/quotePriceGate'
import { durationWords } from '../../../utils/quoteDuration'

export function Step3Review({
  quoteData,
  selectedCities,
  subtotal,
  gst_rate = GST_RATE,
  onGstRateChange,
  gst_amount,
  total_amount,
  onBack,
  onSaveDraft,
  onSend,
  saving,
  isEdit = false,
  originalStatus = null,
  // Phase 360 — a price below Rs 600/screen that is not yet approved: the quote
  // can be saved, but not sent until admin approves it.
  priceHeld = false,
}) {
  const gstApplicable = Number(gst_rate) > 0
  const gstPct = Math.round(Number(gst_rate) * 100)
  // In edit mode, "Save Draft" really means "Save Changes (preserve
  // current status)" and "Send to Client" means "Save & re-send" —
  // relabel so sales doesn't accidentally demote a won quote.
  const saveLabel = isEdit
    ? (saving ? 'Saving…' : 'Save Changes')
    : (saving ? 'Saving…' : 'Save Draft')
  const sendLabel = priceHeld
    ? (saving ? 'Submitting…' : 'Submit for approval')
    : isEdit
      ? (saving ? 'Sending…' : (originalStatus === 'draft' ? 'Save & Send' : 'Save & Re-send'))
      : (saving ? 'Sending…' : 'Send to Client')
  return (
    <div className="wizard-step">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Review Quote</h2>
        <p className="wizard-step-sub">Confirm everything before sending</p>
      </div>

      <div className="review-sections">
        {/* Client info */}
        <div className="review-section">
          <p className="review-section-title">Client</p>
          <div className="review-grid">
            <ReviewField label="Name" value={quoteData.client_name} />
            <ReviewField label="Company" value={quoteData.client_company} />
            <ReviewField label="Phone" value={quoteData.client_phone} />
            <ReviewField label="Email" value={quoteData.client_email} />
            {quoteData.client_gst && <ReviewField label="GST" value={quoteData.client_gst} />}
            {quoteData.client_address && <ReviewField label="Address" value={quoteData.client_address} span />}
            {quoteData.client_notes && <ReviewField label="Notes" value={quoteData.client_notes} span />}
          </div>
          <div className="review-tag">
            <span className={`badge ${quoteData.revenue_type === 'new' ? 'badge-sent' : 'badge-negotiating'}`}>
              {quoteData.revenue_type === 'new' ? 'New Client' : 'Renewal'}
            </span>
          </div>
        </div>

        {/* Campaign locations */}
        <div className="review-section">
          <p className="review-section-title">Campaign Locations</p>
          <div className="review-cities">
            {selectedCities.map(sc => {
              // Slot fields are metadata — shown here so the rep and
              // admin can both see what was promised, but they never
              // affect campaign_total (see Step2Campaign.calcTotal).
              const slotSec = sc.slot_seconds ?? 10
              const slotsDay = sc.slots_per_day ?? 100
              return (
                <div key={sc.city.id} className="review-city-row">
                  <div className="review-city-info">
                    <Monitor size={13} />
                    <div>
                      <p className="review-city-name">{sc.city.name}</p>
                      <p className="review-city-meta">
                        {sc.screens} screen{sc.screens !== 1 ? 's' : ''} · {durationWords(sc)} · {slotSec}s · {slotsDay} slots/day
                      </p>
                    </div>
                  </div>
                  <div className="review-city-rates">
                    <p className="review-listed">
                      Listed: {formatCurrency(sc.listed_rate)}/mo
                    </p>
                    <p className="review-offered">
                      Offered: {formatCurrency(sc.offered_rate)}/mo
                    </p>
                    <p className="review-total">{formatCurrency(sc.campaign_total)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Totals */}
        <div className="review-section review-section--totals">
          <div className="totals-row">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>

          {/* GST toggle — checking/unchecking re-runs totals live.
              Changing the rate after the quote is saved (via edit flow)
              rewrites gst_amount + total_amount on next save. */}
          <div className="totals-row" style={{ alignItems: 'center' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: onGstRateChange ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={gstApplicable}
                onChange={e => onGstRateChange?.(e.target.checked ? GST_RATE : 0)}
                style={{ cursor: onGstRateChange ? 'pointer' : 'default' }}
              />
              <span>{gstApplicable ? `GST (${gstPct}%)` : 'No GST'}</span>
            </label>
            <span>{gstApplicable ? formatCurrency(gst_amount) : '—'}</span>
          </div>

          <div className="totals-row totals-row--grand">
            <span>Total</span>
            <span>{formatCurrency(total_amount)}</span>
          </div>
        </div>
      </div>

      {priceHeld && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            margin: '14px 0 0', padding: '12px 14px', borderRadius: 10,
            background: 'var(--warning-soft, rgba(245,158,11,0.12))',
            border: '1px solid var(--warning, #F59E0B)',
            color: 'var(--text, #f1f5f9)', fontSize: 13, lineHeight: 1.5,
          }}
        >
          <span style={{ flex: '0 0 auto', marginTop: 1, color: 'var(--warning, #F59E0B)', display: 'inline-flex' }}>
            <ShieldAlert size={18} strokeWidth={1.6} />
          </span>
          <span>
            <strong>Needs admin approval.</strong> One or more cities are priced below
            {' '}Rs {PRICE_FLOOR} per screen. You can save it now, but you can send it only after
            admin approves the price.
          </span>
        </div>
      )}

      <div className="wizard-footer">
        <button className="btn btn-ghost" onClick={onBack} disabled={saving}>
          <ChevronLeft size={15} />
          Back
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={onSaveDraft} disabled={saving}>
            <Save size={14} />
            {saveLabel}
          </button>
          <button className="btn btn-primary" onClick={onSend} disabled={saving}>
            <Send size={14} />
            {sendLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReviewField({ label, value, span }) {
  if (!value) return null
  return (
    <div className={`review-field${span ? ' review-field--span' : ''}`}>
      <p className="review-field-label">{label}</p>
      <p className="review-field-value">{value}</p>
    </div>
  )
}
