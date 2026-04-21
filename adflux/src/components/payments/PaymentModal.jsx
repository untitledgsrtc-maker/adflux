// src/components/payments/PaymentModal.jsx
import { useState, useEffect } from 'react'
import { X, CreditCard, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatCurrency } from '../../utils/formatters'
import { useAuthStore } from '../../store/authStore'
import { PAYMENT_MODES } from '../../utils/constants'

const today = () => new Date().toISOString().split('T')[0]

export function PaymentModal({ quote, totalPaid = 0, onClose, onSave, initialPayment = null }) {
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'
  const isEdit = !!initialPayment
  const balance = (quote?.total_amount || 0) - totalPaid
  const isFinalLocked = !isEdit && balance <= 0 // already fully paid

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

  // Auto-check final if amount fills the balance
  useEffect(() => {
    const entered = parseFloat(form.amount_received) || 0
    if (entered > 0 && Math.abs(entered - balance) < 1) {
      setForm(f => ({ ...f, is_final_payment: true }))
    }
  }, [form.amount_received, balance])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
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

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setGlobalError('')
    const { error } = await onSave({
      ...form,
      amount_received: parseFloat(form.amount_received),
    })
    setSaving(false)
    if (error) setGlobalError(error.message || 'Failed to save payment')
    else onClose()
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

        {!isFinalLocked && (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {globalError && (
                <div className="pm-alert pm-alert--error">
                  <AlertTriangle size={14} /> {globalError}
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
                {saving ? 'Saving…' : 'Save Payment'}
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
