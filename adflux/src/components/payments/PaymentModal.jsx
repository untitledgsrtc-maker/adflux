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

  // Phase 34Z.44 — effective outstanding subtracts both approved AND
  // pending. Owner reported reps forget the 1st partial sitting in
  // admin's pending queue and re-enter the full quote total on the
  // 2nd touch. Treat pending as "already claimed" for the rep's
  // perspective and pre-fill / validate against that figure.
  const effectiveOutstanding = Math.max(0, balance - pendingAmount)

  // Money Truth — TDS breakdown shows only on GOVERNMENT quotes. Govt
  // clients deduct TDS, so the GROSS milestone amount goes in Amount
  // Received (closes the deal at quote total) and the withheld part is
  // recorded here. Private flow renders byte-identical (field hidden).
  const isGovt = quote?.segment === 'GOVERNMENT'

  const [form, setForm] = useState(() => initialPayment ? {
    amount_received:   initialPayment.amount_received ?? '',
    payment_mode:      initialPayment.payment_mode    ?? 'NEFT',
    payment_date:      initialPayment.payment_date    ?? today(),
    reference_number:  initialPayment.reference_number ?? '',
    payment_notes:     initialPayment.payment_notes   ?? '',
    is_final_payment:  !!initialPayment.is_final_payment,
    tds_amount:        initialPayment.tds_amount ?? '',
    commission_pct:    initialPayment.commission_pct ?? '',
  } : {
    // Phase 34Z.44 — pre-fill amount with effective outstanding so
    // the rep sees what's actually owed before they type. Forces
    // them to consciously change it if they want partial.
    amount_received: effectiveOutstanding > 0 ? String(effectiveOutstanding) : '',
    payment_mode: 'NEFT',
    payment_date: today(),
    reference_number: '',
    payment_notes: '',
    is_final_payment: false,
    tds_amount: '',
    commission_pct: '',
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [dupConfirmed, setDupConfirmed] = useState(false) // has user acked the soft-warn?
  const [submittedPending, setSubmittedPending] = useState(false) // sales success state

  // ── Phase 274 · government TDS entry UX ────────────────────────────────
  // Govt clients withhold TDS, so the NATURAL entry is the NET cash + a rate.
  // The rep enters cash + picks 4% / 3% (or custom); the app DERIVES the stored
  // amount_received = net + tds (the GROSS that closes the deal at the quote
  // total). So amount_received, the balance formula, is_final, reporting — all
  // stay the gross exactly as §271 designed; only the INPUT changes. Private
  // renders byte-identical (this whole block is inert when !isGovt).
  const govtBaseRatio = (Number(quote?.subtotal) || 0) > 0 && (Number(quote?.total_amount) || 0) > 0
    ? Number(quote.subtotal) / Number(quote.total_amount) : 1   // ex-GST base share (TDS is on the base)
  const govtBaseRemaining = isEdit ? balance : effectiveOutstanding
  const [govtNet, setGovtNet] = useState(() => {
    if (!isGovt) return ''
    if (isEdit) {
      const g = Number(initialPayment?.amount_received) || 0
      const t = Number(initialPayment?.tds_amount) || 0
      return g > 0 ? String(Math.max(0, g - t)) : ''
    }
    return effectiveOutstanding > 0 ? String(effectiveOutstanding) : ''
  })
  const [tdsRate, setTdsRate] = useState('')
  // Keep amount_received (the GROSS) = net + tds on govt.
  useEffect(() => {
    if (!isGovt) return
    const net = parseFloat(govtNet) || 0
    const tds = parseFloat(form.tds_amount) || 0
    const gross = net + tds
    const next = gross > 0 ? String(gross) : ''
    setForm(f => (f.amount_received === next ? f : { ...f, amount_received: next }))
  }, [isGovt, govtNet, form.tds_amount])
  function applyTdsRate(rate) {
    setTdsRate(String(rate))
    const tds = Math.round((rate / 100) * govtBaseRemaining * govtBaseRatio)  // rate% of the ex-GST base
    set('tds_amount', String(tds))
    setGovtNet(String(Math.max(0, govtBaseRemaining - tds)))                    // net = what actually hits the bank
  }

  // Auto-check final if amount fills the balance.
  // Guard on `total > 0` — if `quote.total_amount` is ever 0, null, or
  // undefined (hydration race on a freshly-created quote for a new
  // user, stale store, bad read), `balance` collapses to `-totalPaid`
  // and the `Math.abs < 1` check can misfire for small entered values.
  // Pair of paranoia guards with the matching WonPaymentModal handler
  // where a `>=` comparison against `Number(... || 0)` was DEFINITELY
  // the spurious auto-tick vector.
  // Phase 95.11 (27 May 2026) — auto-tick is_final_payment is now
  // a TWO-WAY toggle, mirroring Phase 95.9 in WonPaymentModal.
  // Original logic only set is_final=true when entered matched
  // balance; never UN-set when amount changed. Owner reported a
  // partial payment row landed in admin queue with FINAL badge —
  // likely a stale form state where amount=balance fired the tick,
  // then user reduced the amount but is_final stayed true.
  useEffect(() => {
    const entered = parseFloat(form.amount_received) || 0
    const total = Number(quote?.total_amount) || 0
    const covers = total > 0 && entered > 0 && Math.abs(entered - balance) < 1
    setForm(f => (f.is_final_payment === covers ? f : { ...f, is_final_payment: covers }))
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
    // Phase 34Z.44 — soft-block when amount > effective outstanding
    // (= balance minus already-pending). Lets rep know the gap before
    // admin has to reject. Hard block reserved for total-exceed above.
    if (!isEdit && pendingAmount > 0 && amt > effectiveOutstanding + 0.5) {
      errs.amount_received =
        `${formatCurrency(pendingAmount)} is already submitted (pending admin approval). ` +
        `Only ${formatCurrency(effectiveOutstanding)} is left to collect — adjust this amount or wait for admin to approve/reject the pending one.`
    }
    if (!form.payment_date) errs.payment_date = 'Date is required'
    // Money Truth — TDS is part of the gross, never more than it.
    const tds = parseFloat(form.tds_amount)
    if (form.tds_amount !== '' && (isNaN(tds) || tds < 0)) {
      errs.tds_amount = 'Enter a valid TDS amount'
    } else if (!isNaN(tds) && !isNaN(amt) && tds > amt) {
      errs.tds_amount = 'TDS cannot exceed the amount received'
    }
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
    // Phase 273 — govt-team commission entered AT PAYMENT time: type a %, we
    // store the ₹ on THIS payment (% of the amount received). finance P&L SUMs
    // payments.commission_amount. Govt only; blank = no commission on this row.
    // Drop commission_pct from the spread + only ADD the commission columns when
    // there's a real commission — so a plain (private / no-commission) payment
    // never writes the new columns. Deploy-window blast radius = only a
    // govt-payment-with-commission (the new path), never existing payments.
    const _amt  = parseFloat(form.amount_received)
    const _cpct = parseFloat(form.commission_pct) || 0
    const _sub  = Number(quote?.subtotal) || 0
    const _tot  = Number(quote?.total_amount) || 0
    const _ratio = _sub > 0 && _tot > 0 ? _sub / _tot : 1   // ex-GST share of the payment
    const _camt = isGovt && _cpct > 0 && _amt > 0 ? Math.round(_amt * _ratio * _cpct / 100) : null
    const { commission_pct: _dropCpct, ...formRest } = form
    const commFields = _camt != null ? { commission_pct: _cpct, commission_amount: _camt } : {}
    const { error } = await onSave({
      ...formRest,
      amount_received: _amt,
      // gross stays in amount_received; TDS is the withheld breakdown
      tds_amount: form.tds_amount === '' ? null : parseFloat(form.tds_amount),
      ...commFields,
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
  // Phase 273 — commission on THIS payment = its ex-GST share of the quote
  // base × % (owner: "quote base amount × %"). commBaseRatio = subtotal /
  // total = the pre-GST portion of a gross payment; on full collection the
  // sum equals subtotal × %. Falls back to 1 (gross) if no subtotal on file.
  const commPct = parseFloat(form.commission_pct) || 0
  const commBaseRatio = (Number(quote?.subtotal) || 0) > 0 && (Number(quote?.total_amount) || 0) > 0
    ? (Number(quote.subtotal) / Number(quote.total_amount)) : 1
  const commAmount = isGovt && commPct > 0 && enteredAmt > 0
    ? Math.round(enteredAmt * commBaseRatio * commPct / 100) : 0

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

              {/* Phase 34Z.44 — pending hint above the amount so the rep can't
                  miss it. Owner: "team might forget a partial was received." */}
              {!isEdit && pendingAmount > 0 && (
                <div style={{
                  fontSize: 11.5,
                  color: 'var(--warning)',
                  background: 'rgba(245,158,11,0.10)',
                  border: '1px solid rgba(245,158,11,0.35)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  marginBottom: 8,
                  lineHeight: 1.5,
                }}>
                  <strong>{formatCurrency(pendingAmount)}</strong> already submitted (pending admin approval).
                  Only <strong>{formatCurrency(effectiveOutstanding)}</strong> left to collect on this quote. Pre-filled below.
                </div>
              )}

              {/* Amount — PRIVATE: gross received directly. */}
              {!isGovt && (
                <div className="form-group">
                  <label className="form-label">Amount Received (₹) *</label>
                  <input
                    type="number"
                    className={`form-input${errors.amount_received ? ' input-error' : ''}`}
                    value={form.amount_received}
                    onChange={e => set('amount_received', e.target.value)}
                    placeholder={`Max: ${formatCurrency(isEdit ? balance : effectiveOutstanding)}`}
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
              )}

              {/* Phase 274 — GOVT: enter NET cash + a TDS rate. The government
                  withholds TDS (4% = 2% income + 2% GST, sometimes 3%) on the
                  pre-GST base and deposits it to your PAN — so it still counts as
                  paid. Pick a rate → TDS + net auto-fill; the app records the gross
                  (net + TDS) so the deal closes to Fully Paid. Both editable. */}
              {isGovt && (
                <>
                  <div className="form-group">
                    <label className="form-label">TDS the government deducted (₹)</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {[4, 3].map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => applyTdsRate(r)}
                          style={{
                            flex: '1 1 0', minWidth: 90,
                            background: tdsRate === String(r) ? 'var(--accent, #FFE600)' : 'var(--accent-soft, rgba(255,230,0,0.14))',
                            color: tdsRate === String(r) ? 'var(--accent-fg, #0f172a)' : 'var(--text)',
                            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)',
                            padding: '8px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          {r}% = {formatCurrency(Math.round((r / 100) * govtBaseRemaining * govtBaseRatio))}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      className={`form-input${errors.tds_amount ? ' input-error' : ''}`}
                      value={form.tds_amount}
                      onChange={e => { setTdsRate(''); set('tds_amount', e.target.value) }}
                      placeholder="TDS amount (₹) — or tap a rate above"
                      min="0"
                      step="1"
                    />
                    {errors.tds_amount && (
                      <span className="field-error">{errors.tds_amount}</span>
                    )}
                    <span className="pm-balance-preview">
                      Govt TDS = 4% (2% income + 2% GST), sometimes 3%, of the pre-GST base. The government keeps it (deposited to your PAN) — it still counts as paid.
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Cash received — net of TDS (₹) *</label>
                    <input
                      type="number"
                      className={`form-input${errors.amount_received ? ' input-error' : ''}`}
                      value={govtNet}
                      onChange={e => { setTdsRate(''); setGovtNet(e.target.value); setErrors(er => ({ ...er, amount_received: '' })) }}
                      placeholder={`Cash banked · closes at ${formatCurrency(govtBaseRemaining)}`}
                      min="0"
                      step="1"
                      autoFocus
                    />
                    {errors.amount_received && (
                      <span className="field-error">{errors.amount_received}</span>
                    )}
                    <span className="pm-balance-preview">
                      Invoice applied: <strong>{formatCurrency(enteredAmt)}</strong> (cash {formatCurrency(parseFloat(govtNet) || 0)} + TDS {formatCurrency(parseFloat(form.tds_amount) || 0)})
                      {enteredAmt > 0 && newBalance >= 0 && <> · remaining {formatCurrency(newBalance)}</>}
                    </span>
                  </div>
                </>
              )}

              {/* Commission (Govt quotes only) — Phase 273. Our cost on a
                  govt deal: type the % we pay as commission on THIS payment,
                  it computes the ₹ booked. finance P&L sums these. Leave blank
                  if there's no commission. Agency-created deals ride agency
                  commission — the P&L already excludes them, so a value here
                  won't double-count. */}
              {isGovt && (
                <div className="form-group">
                  <label className="form-label">Commission % — our cost, on the quote base (optional)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={form.commission_pct}
                    onChange={e => set('commission_pct', e.target.value)}
                    placeholder="e.g. 10"
                    min="0"
                    max="100"
                    step="0.01"
                  />
                  <span className="pm-balance-preview">
                    % of the quote base (pre-GST) — books this payment's share of it. Leave blank if none.
                    {commAmount > 0 && <> Commission booked: {formatCurrency(commAmount)}</>}
                  </span>
                </div>
              )}

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
