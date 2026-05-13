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
import { CheckCircle2, Paperclip, Upload } from 'lucide-react'
import { formatCurrency, todayISO } from '../../utils/formatters'
import V2Hero from '../v2/V2Hero'

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
            <div style={{ fontSize: '.75rem', color: 'var(--text-muted, #94a3b8)', marginTop: 3 }}>
              Record payment if collected — or leave blank to mark Won with payment pending
            </div>
          </div>
          <button className="md-x" onClick={onClose}>✕</button>
        </div>
        <div className="md-b">
          {/* Phase 34R+ — V2Hero strip replacing the previous yellow
              quote-summary card. Same data (quote ref + invoice total)
              presented in the teal-gradient hero that now anchors
              every page in the app. Emotional moment — deal closes —
              gets the brand pop. */}
          <V2Hero
            eyebrow="Mark this Won"
            value={formatCurrency(quote.total_amount)}
            label={quote.quote_number || quote.ref_number || 'Invoice total'}
            chip={quote.client_company || quote.client_name || null}
            accent={true}
          />

          {/* Phase 11 — Work Order / PO copy gate.
              Phase 11d (rev4) — visually identical to Mark Sent's OC
              banner: amber background + paperclip icon when missing,
              green + check when uploaded. Same color tokens, same
              icon family (lucide), same upload-button styling. Owner
              spec (4 May 2026): "WO popup should look just like OC
              popup". When uploaded, shows the filename so the rep
              has visual confirmation it's THIS quote's WO, not a
              stale state from another proposal. */}
          {workOrderRequired && (
            <div
              style={{
                background: workOrderUploaded
                  ? 'var(--tint-success, rgba(16,185,129,0.14))'
                  : 'var(--tint-warning, rgba(245,158,11,0.14))',
                border: workOrderUploaded
                  ? '1.5px solid var(--tint-success-bd, rgba(16,185,129,0.40))'
                  : '1.5px solid var(--tint-warning-bd, rgba(245,158,11,0.40))',
                borderRadius: 'var(--radius, 10px)',
                padding: '14px 16px',
                marginBottom: 12,
                fontSize: '.84rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: workOrderUploaded ? 0 : 12 }}>
                {workOrderUploaded
                  ? <CheckCircle2 size={18} style={{ color: 'var(--success, #10B981)', flexShrink: 0 }} />
                  : <Paperclip   size={18} style={{ color: 'var(--warning, #F59E0B)', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>
                    Work Order / PO copy {workOrderUploaded ? '✓ uploaded' : '— required'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {workOrderUploaded
                      ? 'Agency-issued Work Order for this proposal — saved with this quote\'s attachments.'
                      : 'The agency-issued Work Order or Purchase Order is the proof of award for THIS proposal. Each quote needs its own WO.'}
                  </div>
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
                  <label
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 12px',
                      background: 'var(--tint-warning, rgba(245,158,11,0.14))',
                      border: '1px dashed var(--tint-warning-bd, rgba(245,158,11,0.40))',
                      borderRadius: 'var(--radius-sm, 6px)',
                      color: 'var(--warning, #F59E0B)',
                      fontSize: 12, fontWeight: 600,
                      cursor: uploadingWorkOrder ? 'wait' : 'pointer',
                      marginTop: 4,
                    }}
                    onClick={() => !uploadingWorkOrder && woFileInput.current?.click()}
                  >
                    {uploadingWorkOrder
                      ? <>Uploading…</>
                      : <><Upload size={13} /> Upload WO copy</>}
                  </label>
                </>
              )}
              {/* Phase 11i — team feedback (Adflux Mistake.pptx slide 5):
                  once the WO was uploaded inside this modal, no way to
                  replace it. Add a Replace control parallel to the
                  initial Upload control so a wrong file can be swapped
                  without reopening the modal. */}
              {workOrderUploaded && onUploadWorkOrder && (
                <>
                  <input
                    ref={woFileInput}
                    type="file"
                    accept="application/pdf,image/*"
                    style={{ display: 'none' }}
                    onChange={handleWoFilePicked}
                  />
                  <label
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 10px', marginTop: 10,
                      background: 'transparent',
                      border: '1px solid var(--tint-warning-bd, rgba(245,158,11,0.40))',
                      borderRadius: 'var(--radius-sm, 6px)',
                      color: 'var(--warning, #F59E0B)',
                      fontSize: 12, fontWeight: 600,
                      cursor: uploadingWorkOrder ? 'wait' : 'pointer',
                      opacity: uploadingWorkOrder ? 0.6 : 1,
                    }}
                    onClick={() => !uploadingWorkOrder && woFileInput.current?.click()}
                    title="Replace the uploaded Work Order with a new file"
                  >
                    {uploadingWorkOrder
                      ? <>Replacing…</>
                      : <><Upload size={12} /> Replace</>}
                  </label>
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
                border: '1px dashed var(--border, #334155)',
                color: 'var(--text-muted, #94a3b8)',
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
                <div style={{ background: 'var(--tint-success, rgba(16,185,129,0.14))', border: '1px solid var(--tint-success-bd, rgba(16,185,129,0.40))', borderRadius: 'var(--radius, 10px)', padding: '10px 14px', marginBottom: 14, fontSize: '.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--success, #10B981)', fontWeight: 600 }}>Already Received</span>
                    <span style={{ color: 'var(--success, #10B981)', fontWeight: 700 }}>{formatCurrency(totalPaid)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted, #94a3b8)' }}>Remaining Balance</span>
                    <span style={{ color: remainingBalance > 0 ? 'var(--danger, #EF4444)' : 'var(--success, #10B981)', fontWeight: 700 }}>{formatCurrency(remainingBalance)}</span>
                  </div>
                  {remainingBalance > 0 && (
                    <div style={{ fontSize: '.72rem', color: 'var(--text-muted, #94a3b8)', marginTop: 8, lineHeight: 1.4 }}>
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

          <div style={{ borderTop: '1px solid var(--border, #334155)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontSize: '.78rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, fontWeight: 600 }}>Campaign Dates *</div>
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
              <div style={{ fontSize: '.78rem', color: 'var(--danger, #EF4444)', marginTop: 6 }}>Both dates required to mark Won</div>
            )}
          </div>

          {newAmount > 0 && balance > 0 && (
            <div style={{ background: 'var(--tint-danger, rgba(239,68,68,0.14))', border: '1px solid var(--tint-danger-bd, rgba(239,68,68,0.40))', borderRadius: 'var(--radius, 10px)', padding: '10px 14px', marginBottom: 12, fontSize: '.82rem', marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--danger, #EF4444)', fontWeight: 700 }}>Balance Due After This Payment</span>
                <span style={{ color: 'var(--danger, #EF4444)', fontWeight: 800 }}>{formatCurrency(balance)}</span>
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
