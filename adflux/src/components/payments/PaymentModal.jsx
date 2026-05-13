// src/components/payments/PaymentModal.jsx
//
// Phase 3C additions:
//   • Soft-warn (not block) on duplicate amount + date + quote.
//   • For sales users, surface an "awaiting admin approval" success
//     state instead of closing silently — so they know the payment
//     isn't live yet.
//   • Surface pending-amount context in the summary bar so a sales
//     user who already punched a payment isn't confused by a "Paid
//     So Far" that excludes their still-unapproved submission.

import { useState, useEffect, useMemo } from 'react'
import { X, CreditCard, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { formatCurrency, todayISO } from '../../utils/formatters'
import { useAuthStore } from '../../store/authStore'
import { PAYMENT_MODES } from '../../utils/constants'

const today = () => todayISO()

export function PaymentModal({
  quote,
  totalPaid = 0,
  existingPayments = [],
  onClose,
  onSave,
  initialPayment = null,
}) {
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'
  const isEdit = !!initialPayment
  const balance = (quote?.total_amount || 0) - totalPaid
  const isFinalLocked = !isEdit && balance <= 0 // already fully paid + approved

  // Pending amount the sales user might be staring at — helps explain
  // why "Paid So Far" hasn't moved.
  const pendingAmount = useMemo(
    () => existingPayments
      .filter(p => p.approval_status === 'pending')
      .reduce((s, p) => s + (p.amount_received || 0), 0),
    [existingPayments]
  )

  const [form, setForm] = useState(() => initialPayment ? {
    amount_received:   initialPayment.amount_received ?? '',
    payment_mode:      initialPayment.payment_mode    ?? 'NEFT',
    payment_date:      initialPayment.payment_date    ?? today(),
    reference_number:  initialPayment.reference_number ?? '',
    payment_notes:     initialPayment.payment_notes   ?? '',
    is_final_payment:  !!initialPayment.is_final_payment,
  } : {
    amount_received: '',
    payment_mode: 'NEFT',
    payment_date: today(),
    reference_number: '',
    payment_notes: '',
    is_final_payment: false,
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [dupConfirmed, setDupConfirmed] = useState(false) // has user acked the soft-warn?
  const [submittedPending, setSubmittedPending] = useState(false) // sales success state

  // Auto-check final if amount fills the balance.
  // Guard on `total > 0` — if `quote.total_amount` is ever 0, null, or
  // undefined (hydration race on a freshly-created quote for a new
  // user, stale store, bad read), `balance` collapses to `-totalPaid`
  // and the `Math.abs < 1` check can misfire for small entered values.
  // Pair of paranoia guards with the matching WonPaymentModal handler
  // where a `>=` comparison against `Number(... || 0)` was DEFINITELY
  // the spurious auto-tick vector.
  useEffect(() => {
    const entered = parseFloat(form.amount_received) || 0
    const total = Number(quote?.total_amount) || 0
    if (total > 0 && entered > 0 && Math.abs(entered - balance) < 1) {
      setForm(f => ({ ...f, is_final_payment: true }))
    }
  }, [form.amount_received, balance, quote?.total_amount])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
    // Any edit after a dup warning resets the ack so we re-check.
    if (dupConfirmed) setDupConfirmed(false)
  }

  function validate() {
    const errs = {}
    const amt = parseFloat(form.amount_received)
    if (!form.amount_received || isNaN(amt) || amt <= 0) {
      errs.amount_received = 'Enter a valid amount'
    }
    if (amt > balance + 0.5) {
      errs.amount_received = `Cannot exceed balance of ${formatCurrency(balance)}`
    }
    if (!form.payment_date) errs.payment_date = 'Date is required'
    return errs
  }

  // Duplicate detection — any other payment with same amount + date.
  const duplicate = useMemo(() => {
    const amt = parseFloat(form.amount_received)
    if (!amt || !form.payment_date) return null
    return existingPayments.find(p =>
      Math.abs((p.amount_received || 0) - amt) < 0.5 &&
      p.payment_date === form.payment_date
    ) || null
  }, [existingPayments, form.amount_received, form.payment_date])

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    // Soft-warn on duplicate — block the first submit only, let the
    // user proceed on the second with an ack.
    if (duplicate && !dupConfirmed) {
      setDupConfirmed(true)
      setGlobalError('') // clear any old error so the yellow banner shows instead
      return
    }

    setSaving(true)
    setGlobalError('')
    const { error } = await onSave({
      ...form,
      amount_received: parseFloat(form.amount_received),
    })
    setSaving(false)
    if (error) {
      setGlobalError(error.message || 'Failed to save payment')
      return
    }

    // Sales users see a success step so they know it's pending approval.
    // Admins close immediately — there's nothing for them to wait on.
    if (isAdmin) {
      onClose()
    } else {
      setSubmittedPending(true)
    }
  }

  const enteredAmt = parseFloat(form.amount_received) || 0
  const newBalance = balance - enteredAmt

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <CreditCard size={16} /> {isEdit ? 'Edit Payment' : 'Record Payment'}
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Balance summary */}
        <div className="pm-summary-bar">
          <div className="pm-summary-item">
            <span className="pm-summary-label">Quote Total</span>
            <span className="pm-summary-value">{formatCurrency(quote?.total_amount)}</span>
          </div>
          <div className="pm-summary-divider" />
          <div className="pm-summary-item">
            <span className="pm-summary-label">Paid So Far</span>
            <span className="pm-summary-value pm-summary-value--paid">{formatCurrency(totalPaid)}</span>
            {pendingAmount > 0 && (
              <span className="pm-summary-sub" style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
                +{formatCurrency(pendingAmount)} pending approval
              </span>
            )}
          </div>
          <div className="pm-summary-divider" />
          <div className="pm-summary-item">
            <span className="pm-summary-label">Balance</span>
            <span className={`pm-summary-value ${balance <= 0 ? 'pm-summary-value--zero' : 'pm-summary-value--balance'}`}>
              {formatCurrency(Math.max(0, balance))}
            </span>
          </div>
        </div>

        {isFinalLocked && (
          <div className="pm-alert pm-alert--success">
            <CheckCircle2 size={14} />
            This quote is fully paid. No further payments can be added.
          </div>
        )}

        {/* Sales "awaiting approval" success state */}
        {submittedPending && (
          <>
            <div className="modal-body">
              <div className="pm-alert pm-alert--warning" style={{ alignItems: 'flex-start' }}>
                <Clock size={16} style={{ marginTop: 2 }} />
                <div>
                  <strong>Payment submitted for admin approval.</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.9 }}>
                    It won't appear in revenue / outstanding balances until admin approves it.
                    You'll see a red banner on your dashboard if it's rejected.
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}

        {!isFinalLocked && !submittedPending && (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {globalError && (
                <div className="pm-alert pm-alert--error">
                  <AlertTriangle size={14} /> {globalError}
                </div>
              )}

              {/* Soft-warn: duplicate amount + date — shown as soon as
                  the match is detected so the changing button label
                  has context. */}
              {duplicate && (
                <div className="pm-alert pm-alert--warning">
                  <AlertTriangle size={14} />
                  <span>
                    A payment of <strong>{formatCurrency(duplicate.amount_received)}</strong> on{' '}
                    <strong>{duplicate.payment_date}</strong> already exists on this quote.
                    {dupConfirmed
                      ? <> Click <strong>Save Payment</strong> again to submit anyway.</>
                      : <> Click the button below to confirm before submitting.</>}
                  </span>
                </div>
              )}

              {/* Amount */}
              <div className="form-group">
                <label className="form-label">Amount Received (₹) *</label>
                <input
                  type="number"
                  className={`form-input${errors.amount_received ? ' input-error' : ''}`}
                  value={form.amount_received}
                  onChange={e => set('amount_received', e.target.value)}
                  placeholder={`Max: ${formatCurrency(balance)}`}
                  min="1"
                  step="1"
                  autoFocus
                />
                {errors.amount_received && (
                  <span className="field-error">{errors.amount_received}</span>
                )}
                {enteredAmt > 0 && newBalance >= 0 && (
                  <span className="pm-balance-preview">
                    Remaining balance after this: {formatCurrency(newBalance)}
                  </span>
                )}
              </div>

              {/* Mode + Date row */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Payment Mode *</label>
                  <select
                    className="form-input"
                    value={form.payment_mode}
                    onChange={e => set('payment_mode', e.target.value)}
                  >
                    {PAYMENT_MODES.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Payment Date *</label>
                  <input
                    type="date"
                    className={`form-input${errors.payment_date ? ' input-error' : ''}`}
                    value={form.payment_date}
                    onChange={e => set('payment_date', e.target.value)}
                  />
                  {errors.payment_date && (
                    <span className="field-error">{errors.payment_date}</span>
                  )}
                </div>
              </div>

              {/* Reference */}
              <div className="form-group">
                <label className="form-label">Reference / UTR Number</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.reference_number}
                  onChange={e => set('reference_number', e.target.value)}
                  placeholder="Transaction ID, cheque number…"
                />
              </div>

              {/* Notes */}
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={form.payment_notes}
                  onChange={e => set('payment_notes', e.target.value)}
                  placeholder="Optional payment notes…"
                  style={{ resize: 'vertical', minHeight: 60 }}
                />
              </div>

              {/* Final payment toggle — admin only */}
              {isAdmin && (
                <>
                  <div className="pm-final-row">
                    <label className="pm-final-label">
                      <input
                        type="checkbox"
                        className="pm-final-checkbox"
                        checked={form.is_final_payment}
                        onChange={e => set('is_final_payment', e.target.checked)}
                      />
                      <span>
                        <strong>Mark as Final Payment</strong>
                        <span className="pm-final-hint">
                          Confirms quote as fully settled. Triggers incentive calculation.
                        </span>
                      </span>
                    </label>
                  </div>

                  {form.is_final_payment && (
                    <div className="pm-alert pm-alert--warning">
                      <AlertTriangle size={14} />
                      Final payment will mark this quote as <strong>Won</strong> and credit the sale
                      to the sales person's monthly incentive for {form.payment_date.slice(0, 7)}.
                    </div>
                  )}
                </>
              )}

              {/* Sales context: explain approval flow */}
              {!isAdmin && !isEdit && (
                <div className="pm-alert pm-alert--info" style={{
                  background: 'var(--tint-blue, rgba(59,130,246,0.14))',
                  border: '1px solid var(--tint-blue-bd, rgba(59,130,246,0.40))',
                  color: 'var(--text)',
                  fontSize: 12,
                }}>
                  <Clock size={13} />
                  This payment will be sent to admin for approval before it counts toward revenue.
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving
                  ? 'Saving…'
                  : duplicate && !dupConfirmed
                    ? 'Check again & save'
                    : 'Save Payment'}
              </button>
            </div>
          </form>
        )}

        {isFinalLocked && (
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
