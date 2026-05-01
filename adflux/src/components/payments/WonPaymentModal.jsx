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

import { useState } from 'react'
import { formatCurrency, todayISO } from '../../utils/formatters'

export function WonPaymentModal({ quote, totalPaid = 0, onConfirm, onClose }) {
  const today = todayISO()
  const remainingBalance = Math.max(0, Number(quote.total_amount || 0) - Number(totalPaid || 0))
  const hasExistingPayment = Number(totalPaid) > 0
  const fullyPaid = hasExistingPayment && remainingBalance <= 0

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
    campaign_start_date: quote.campaign_start_date || today,
    campaign_end_date: quote.campaign_end_date || '',
  })

  function set(k, v) {
    const updated = { ...form, [k]: v }
    // Auto-calculate end date if start changes and duration exists
    if (k === 'campaign_start_date' && quote.duration_months) {
      const start = new Date(v)
      const end = new Date(start)
      end.setMonth(end.getMonth() + quote.duration_months)
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
  const canConfirm = campaignDatesValid

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
            title={!campaignDatesValid ? 'Campaign dates are required to mark Won' : ''}
          >
            ✓ Confirm & Mark Won
          </button>
        </div>
      </div>
    </div>
  )
}
