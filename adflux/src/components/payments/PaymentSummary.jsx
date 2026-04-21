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

      {/* Hint: revenue only counts after Final Payment is ticked */}
      {!hasFinalPayment && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.45,
        }}>
          <strong style={{ color: 'var(--text)' }}>Heads up:</strong> this quote will only
          show up in <em>Revenue</em> and <em>Incentive</em> dashboards once a payment is
          ticked as <strong>Final Payment</strong> (admin only).
        </div>
      )}
    </div>
  )
}
