// src/components/payments/PaymentHistory.jsx
import { Banknote, CheckCircle2, Clock } from 'lucide-react'
import { formatCurrency, formatDate } from '../../utils/formatters'

export function PaymentHistory({ payments = [], loading }) {
  if (loading) {
    return (
      <div className="ph-loading">
        <div className="spinner" />
        <span>Loading payments…</span>
      </div>
    )
  }

  if (payments.length === 0) {
    return (
      <div className="ph-empty">
        <Banknote size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
        <p>No payments recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="ph-list">
      {payments.map((p, i) => (
        <div key={p.id || i} className={`ph-row ${p.is_final_payment ? 'ph-row--final' : ''}`}>
          <div className="ph-icon">
            {p.is_final_payment
              ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />
              : <Clock size={15} style={{ color: 'var(--text-muted)' }} />
            }
          </div>

          <div className="ph-info">
            <div className="ph-amount">
              {formatCurrency(p.amount_received)}
              {p.is_final_payment && (
                <span className="ph-final-badge">Final</span>
              )}
            </div>
            <div className="ph-meta">
              {p.payment_mode}
              {p.reference_number && <> · <span className="ph-ref">{p.reference_number}</span></>}
              {p.users?.name && <> · by {p.users.name}</>}
            </div>
            {p.payment_notes && (
              <div className="ph-notes">{p.payment_notes}</div>
            )}
          </div>

          <div className="ph-date">
            {formatDate(p.payment_date)}
          </div>
        </div>
      ))}
    </div>
  )
}
