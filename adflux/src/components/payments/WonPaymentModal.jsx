// src/components/payments/WonPaymentModal.jsx
//
// Extracted from QuoteDetail.jsx so both the private (LED_OTHER) and
// government (AUTO_HOOD / GSRTC_LED) detail pages can share the same
// "mark Won + record payment" flow without duplicating ~200 lines.
//
// `totalPaid` is the sum of all APPROVED payments already on this quote.
// When a quote has partial payment history, the modal pre-fills the
// remaining balance and lets the user confirm Won without recording a
// new payment (Won + Payment Pending is a valid state). Incentive
// crediting still gates on `is_final_payment=true` at the DB trigger,
// so flipping a quote to Won with an outstanding balance won't pay out
// incentive until that final tick happens.

import { useRef, useState } from 'react'
import { formatCurrency, todayISO } from '../../utils/formatters'

/**
 * Mark-Won pre-flight + payment-capture modal.
 *
 * Phase 11 — adds Work Order / PO copy requirement gate:
 *   • workOrderUploaded (bool)  : current state of the WO/PO attachment
 *   • onUploadWorkOrder(file)   : async — invoked when the user picks
 *                                 a file inline. Parent should run the
 *                                 same file-pick path used by the
 *                                 Attachments section so the upload
 *                                 lands at the right storage path.
 *   • uploadingWorkOrder (bool) : show a spinner while upload is in flight
 *
 * When the WO is missing, Confirm is disabled and a banner explains
 * why with an inline file picker. Mirrors the Mark-Sent OC-copy
 * flow so reps see one consistent pattern across both gates.
 *
 * Prop is OPTIONAL — if the parent doesn't pass it (private flow,
 * which has no WO requirement), the gate is skipped.
 */
export function WonPaymentModal({
  quote,
  totalPaid = 0,
  onConfirm,
  onClose,
  // Phase 11 props — all optional for callers that don't gate on WO.
  workOrderRequired   = false,
  workOrderUploaded   = false,
  onUploadWorkOrder   = null,
  uploadingWorkOrder  = false,
}) {
  const today = todayISO()
  const woFileInput = useRef(null)
  const remainingBalance = Math.max(0, Number(quote.total_amount || 0) - Number(totalPaid || 0))
  const hasExistingPayment = Number(totalPaid) > 0
  const fullyPaid = hasExistingPayment && remainingBalance <= 0
  // Phase 11d (rev) — payment fields collapsed by default so the Mark
  // Won modal matches the simplicity of Mark Sent's OC popup. If a
  // partial payment already exists, expand by default since the rep is
  // likely here to record the balance. Otherwise collapsed and hidden
  // behind a "+ Record payment" toggle.
  const [showPaymentFields, setShowPaymentFields] = useState(hasExistingPayment)

  // Compute an initial end date when start is known but end is blank.
  // Uses the same duration-source priority as the on-change handler
  // below: duration_months → gsrtc_campaign_months → 1 month default.
  const initialStart = quote.campaign_start_date || today
  function computeEndFromStart(startISO) {
    const months =
      Number(quote.duration_months) ||
      Number(quote.gsrtc_campaign_months) ||
      1
    const d = new Date(startISO)
    d.setMonth(d.getMonth() + months)
    return d.toISOString().split('T')[0]
  }
  const initialEnd = quote.campaign_end_date || computeEndFromStart(initialStart)

  const [form, setForm] = useState({
    // Pre-fill with balance when there's already a partial payment — this
    // is the bug the user hit: modal showed empty field so they'd enter
    // the FULL amount again, creating a double payment.
    amount_received: hasExistingPayment && remainingBalance > 0 ? String(remainingBalance) : '',
    payment_mode: 'NEFT',
    payment_date: today,
    payment_notes: '',
    // If this IS the balancing payment (fully paid after recording it),
    // pre-tick Final so incentive credits automatically on approval.
    is_final: hasExistingPayment && remainingBalance > 0,
    // If campaign dates were already set on a prior partial payment, carry
    // them over instead of resetting to today — no point making the user
    // re-enter dates they already confirmed.
    campaign_start_date: initialStart,
    campaign_end_date:   initialEnd,
  })

  function set(k, v) {
    const updated = { ...form, [k]: v }
    // Auto-calculate end date when start changes. Picks the duration
    // hint from whichever field this quote actually has:
    //   • duration_months         — private LED quotes
    //   • gsrtc_campaign_months   — govt GSRTC LED quotes
    //   • else                    — govt Auto Hood (default 1 month;
    //                               owner can edit before submit)
    // Without this, the rep had to type the end date manually for
    // every govt quote — which was Owner's blocker on Mark Won
    // (4 May 2026: "End date not auto-filling, can't mark Won").
    if (k === 'campaign_start_date' && v) {
      const months =
        Number(quote.duration_months) ||
        Number(quote.gsrtc_campaign_months) ||
        1
      const start = new Date(v)
      const end = new Date(start)
      end.setMonth(end.getMonth() + months)
      updated.campaign_end_date = end.toISOString().split('T')[0]
    }
    // Auto-tick "final payment" when the cumulative received covers the
    // full quote. CRITICAL guard: require total > 0 to avoid the
    // "0 + amt >= 0" false positive on stale-store hydration races.
    if (k === 'amount_received') {
      const amt = Number(v) || 0
      const total = Number(quote.total_amount) || 0
      if (total > 0 && amt + Number(totalPaid || 0) >= total) {
        updated.is_final = true
      }
    }
    setForm(updated)
  }

  // Balance = total - (already paid) - (new payment being entered now)
  const balance = Number(quote.total_amount || 0) - Number(totalPaid || 0) - (Number(form.amount_received) || 0)
  const campaignDatesValid = form.campaign_start_date && form.campaign_end_date
  const newAmount = Number(form.amount_received) || 0
  // Won is allowed with no payment at all — a "client said yes,
  // money still pending" state. Campaign dates remain mandatory
  // because they're what schedules the spot.
  //
  // Phase 11 — also gate on Work Order / PO copy upload when the
  // parent says it's required (govt segment). This catches reps who
  // try to mark Won without the formal award document — the agency's
  // proof of contract closure.
  const woGatePassed = !workOrderRequired || workOrderUploaded
  const canConfirm   = campaignDatesValid && woGatePassed && !uploadingWorkOrder

  function handleWoFilePicked(e) {
    const file = e.target.files?.[0]
    if (!file || !onUploadWorkOrder) return
    onUploadWorkOrder(file)
    // Reset so picking the same file again still triggers onChange.
    e.target.value = ''
  }

  return (
    <div className="mo">
      <div className="md">
        <div className="md-h">
          <div>
            <div className="md-t">💰 Mark as Won</div>
            <div style={{ fontSize: '.75rem', color: 'var(--gray)', marginTop: 3 }}>
              Record payment if collected — or leave blank to mark Won with payment pending
            </div>
          </div>
          <button className="md-x" onClick={onClose}>✕</button>
        </div>
        <div className="md-b">
          {/* Quote summary */}
          <div style={{ background: 'rgba(255,230,0,.08)', border: '1.5px solid rgba(255,230,0,.2)', borderRadius: 9, padding: '13px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '.72rem', color: 'var(--gray)' }}>Quote</div>
                <div style={{ fontWeight: 700, color: 'var(--y)' }}>{quote.quote_number || quote.ref_number}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--gray)' }}>Invoice Total</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--y)' }}>
                  {formatCurrency(quote.total_amount)}
                </div>
              </div>
            </div>
          </div>

          {/* Phase 11 — Work Order / PO copy gate.
              Shown only when the parent says workOrderRequired (govt
              segment). Mirrors the Mark-Sent OC-copy banner: red when
              missing (with inline upload), green when present. Confirm
              button is disabled below until this clears. */}
          {workOrderRequired && (
            <div
              style={{
                background: workOrderUploaded
                  ? 'rgba(76,175,80,.12)'
                  : 'rgba(229,57,53,.12)',
                border: workOrderUploaded
                  ? '1px solid rgba(76,175,80,.4)'
                  : '1px solid rgba(229,57,53,.4)',
                borderRadius: 9,
                padding: '12px 14px',
                marginBottom: 14,
                fontSize: '.84rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: workOrderUploaded ? 0 : 8 }}>
                <span style={{ fontSize: 18 }}>{workOrderUploaded ? '✅' : '⚠️'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: 700,
                    color: workOrderUploaded ? '#81c784' : '#ef9a9a',
                  }}>
                    {workOrderUploaded
                      ? 'Work Order / PO copy uploaded'
                      : 'Work Order / PO copy required'}
                  </div>
                  {!workOrderUploaded && (
                    <div style={{ color: 'var(--gray)', fontSize: '.78rem', marginTop: 3, lineHeight: 1.45 }}>
                      The agency-issued Work Order or Purchase Order is the proof
                      of award. Without it, this proposal can't be marked Won.
                    </div>
                  )}
                </div>
              </div>
              {!workOrderUploaded && onUploadWorkOrder && (
                <>
                  <input
                    ref={woFileInput}
                    type="file"
                    accept="application/pdf,image/*"
                    style={{ display: 'none' }}
                    onChange={handleWoFilePicked}
                  />
                  <button
                    type="button"
                    className="btn btn-y"
                    style={{ width: '100%', marginTop: 4 }}
                    disabled={uploadingWorkOrder}
                    onClick={() => woFileInput.current?.click()}
                  >
                    {uploadingWorkOrder
                      ? 'Uploading…'
                      : '📎 Upload Work Order / PO copy'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Payment section — collapsed by default to mirror OC popup
              simplicity. Auto-expanded when a partial payment already
              exists (rep is here to settle balance). Toggle "+ Record
              payment" reveals the fields when needed. */}
          {!showPaymentFields && !hasExistingPayment && (
            <button
              type="button"
              onClick={() => setShowPaymentFields(true)}
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px dashed rgba(255,255,255,.2)',
                color: 'var(--gray)',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 14,
                fontSize: '.82rem',
                cursor: 'pointer',
              }}
            >
              + Record payment now (optional)
            </button>
          )}

          {showPaymentFields && (
            <>
              {hasExistingPayment && (
                <div style={{ background: 'rgba(129,199,132,.1)', border: '1px solid rgba(129,199,132,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#81c784', fontWeight: 600 }}>Already Received</span>
                    <span style={{ color: '#81c784', fontWeight: 700 }}>{formatCurrency(totalPaid)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--gray)' }}>Remaining Balance</span>
                    <span style={{ color: remainingBalance > 0 ? '#ef9a9a' : '#81c784', fontWeight: 700 }}>{formatCurrency(remainingBalance)}</span>
                  </div>
                  {remainingBalance > 0 && (
                    <div style={{ fontSize: '.72rem', color: 'var(--gray)', marginTop: 8, lineHeight: 1.4 }}>
                      Leave the amount blank to mark <strong>Won with Payment Pending</strong>, or enter the balance to record the final payment now. Incentive only credits once 100% is received.
                    </div>
                  )}
                </div>
              )}

              <div className="grid2">
                <div className="fg">
                  <label>
                    {hasExistingPayment ? 'Additional Payment (₹) — optional' : 'Amount Received (₹) — optional'}
                  </label>
                  <input
                    type="number"
                    value={form.amount_received}
                    onChange={e => set('amount_received', e.target.value)}
                    placeholder="Leave blank to mark Won only"
                  />
                </div>
                <div className="fg">
                  <label>Payment Mode</label>
                  <select value={form.payment_mode} onChange={e => set('payment_mode', e.target.value)}>
                    {['NEFT','RTGS','UPI','Cheque','Cash'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div className="fg">
                <label>Payment Date</label>
                <input type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
              </div>

              <div className="fg">
                <label>Notes (cheque no., UTR, etc.)</label>
                <textarea value={form.payment_notes} onChange={e => set('payment_notes', e.target.value)} placeholder="Optional" style={{ minHeight: 60 }} />
              </div>
            </>
          )}

          <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontSize: '.78rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, fontWeight: 600 }}>Campaign Dates *</div>
            <div className="grid2">
              <div className="fg">
                <label>Start Date</label>
                <input type="date" value={form.campaign_start_date} onChange={e => set('campaign_start_date', e.target.value)} />
              </div>
              <div className="fg">
                <label>End Date</label>
                <input type="date" value={form.campaign_end_date} onChange={e => set('campaign_end_date', e.target.value)} />
              </div>
            </div>
            {!campaignDatesValid && (
              <div style={{ fontSize: '.78rem', color: '#ef9a9a', marginTop: 6 }}>Both dates required to mark Won</div>
            )}
          </div>

          {newAmount > 0 && balance > 0 && (
            <div style={{ background: 'rgba(229,57,53,.1)', border: '1px solid rgba(229,57,53,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: '.82rem', marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#ef9a9a', fontWeight: 700 }}>Balance Due After This Payment</span>
                <span style={{ color: '#ef9a9a', fontWeight: 800 }}>{formatCurrency(balance)}</span>
              </div>
            </div>
          )}

          {newAmount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input type="checkbox" id="isFinal" checked={form.is_final} onChange={e => set('is_final', e.target.checked)} />
              <label htmlFor="isFinal" style={{ fontSize: '.82rem', cursor: 'pointer' }}>
                This is the final / full payment {fullyPaid ? '(quote will be fully paid)' : ''}
              </label>
            </div>
          )}
        </div>
        <div className="md-f">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-y"
            onClick={() => onConfirm(form)}
            disabled={!canConfirm}
            title={
              !campaignDatesValid
                ? 'Campaign dates are required to mark Won'
                : (workOrderRequired && !workOrderUploaded)
                  ? 'Upload Work Order / PO copy first'
                  : uploadingWorkOrder
                    ? 'Wait for upload to finish'
                    : ''
            }
          >
            ✓ Confirm & Mark Won
          </button>
        </div>
      </div>
    </div>
  )
}
