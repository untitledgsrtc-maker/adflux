// src/components/payments/PaymentSummary.jsx
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { formatCurrency } from '../../utils/formatters'

export function PaymentSummary({ totalAmount = 0, totalPaid = 0, hasFinalPayment = false }) {
  const balance = Math.max(0, totalAmount - totalPaid)
  const pct = totalAmount > 0 ? Math.min((totalPaid / totalAmount) * 100, 100) : 0
  const isFullyPaid = hasFinalPayment || balance <= 0

  return (
    <div className="ps-card">
      <div className="ps-header">
        <span className="ps-title">Payment Status</span>
        {isFullyPaid ? (
          <span className="ps-badge ps-badge--paid">
            <CheckCircle2 size={11} /> Fully Paid
          </span>
        ) : totalPaid > 0 ? (
          <span className="ps-badge ps-badge--partial">
            <AlertCircle size={11} /> Partial
          </span>
        ) : (
          <span className="ps-badge ps-badge--unpaid">Unpaid</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="ps-bar-track">
        <div
          className={`ps-bar-fill ${isFullyPaid ? 'ps-bar-fill--done' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="ps-pct">{pct.toFixed(0)}% collected</div>

      {/* Figures */}
      <div className="ps-figures">
        <div className="ps-figure">
          <span className="ps-figure-label">Quote Total</span>
          <span className="ps-figure-value">{formatCurrency(totalAmount)}</span>
        </div>
        <div className="ps-figure">
          <span className="ps-figure-label">Received</span>
          <span className="ps-figure-value ps-figure-value--paid">{formatCurrency(totalPaid)}</span>
        </div>
        <div className="ps-figure">
          <span className="ps-figure-label">Balance</span>
          <span className={`ps-figure-value ${balance > 0 ? 'ps-figure-value--balance' : 'ps-figure-value--zero'}`}>
            {formatCurrency(balance)}
          </span>
        </div>
      </div>
    </div>
  )
}
