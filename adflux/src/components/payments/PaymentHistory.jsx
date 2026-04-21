// src/components/payments/PaymentHistory.jsx
//
// Phase 3C: renders an approval_status pill (Pending / Approved /
// Rejected with reason tooltip) on every payment row. Edit/delete
// buttons are gated to the Phase-3C rules: admin can edit anything,
// sales can only edit/delete their own still-pending non-final rows.

import { Banknote, CheckCircle2, Clock, Edit2, Trash2, XCircle } from 'lucide-react'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { useAuthStore } from '../../store/authStore'

function StatusBadge({ status, rejectionReason }) {
  if (status === 'approved') {
    return (
      <span
        className="ph-status-badge"
        style={{
          background: 'var(--success-soft)', color: 'var(--success)',
          padding: '2px 8px', borderRadius: 10, fontSize: 10,
          fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        <CheckCircle2 size={10} /> Approved
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span
        className="ph-status-badge"
        title={rejectionReason ? `Reason: ${rejectionReason}` : 'Rejected'}
        style={{
          background: 'var(--danger-soft)', color: 'var(--danger)',
          padding: '2px 8px', borderRadius: 10, fontSize: 10,
          fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          cursor: rejectionReason ? 'help' : 'default',
        }}
      >
        <XCircle size={10} /> Rejected
      </span>
    )
  }
  // default: pending
  return (
    <span
      className="ph-status-badge"
      style={{
        background: 'var(--warning-soft)', color: 'var(--warning)',
        padding: '2px 8px', borderRadius: 10, fontSize: 10,
        fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}
    >
      <Clock size={10} /> Pending
    </span>
  )
}

export function PaymentHistory({ payments = [], loading, onEdit, onDelete }) {
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'
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
      {payments.map((p, i) => {
        // Edit/delete gating — matches RLS:
        //   admin: any row
        //   sales: own row that's pending AND non-final
        const isOwnRow = p.received_by === profile?.id
        const canEdit = isAdmin || (
          isOwnRow &&
          !p.is_final_payment &&
          p.approval_status === 'pending'
        )
        const isApproved = p.approval_status === 'approved'
        const isRejected = p.approval_status === 'rejected'

        return (
          <div
            key={p.id || i}
            className={`ph-row ${p.is_final_payment && isApproved ? 'ph-row--final' : ''}`}
            style={isRejected ? { opacity: 0.75 } : undefined}
          >
            <div className="ph-icon">
              {p.is_final_payment && isApproved
                ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />
                : <Clock size={15} style={{ color: 'var(--text-muted)' }} />
              }
            </div>

            <div className="ph-info">
              <div className="ph-amount" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={isRejected ? { textDecoration: 'line-through' } : undefined}>
                  {formatCurrency(p.amount_received)}
                </span>
                {p.is_final_payment && isApproved && (
                  <span className="ph-final-badge">Final</span>
                )}
                <StatusBadge status={p.approval_status} rejectionReason={p.rejection_reason} />
              </div>
              <div className="ph-meta">
                {p.payment_mode}
                {p.reference_number && <> · <span className="ph-ref">{p.reference_number}</span></>}
                {p.users?.name && <> · by {p.users.name}</>}
                {isApproved && p.approver?.name && <> · approved by {p.approver.name}</>}
              </div>
              {p.payment_notes && (
                <div className="ph-notes">{p.payment_notes}</div>
              )}
              {isRejected && p.rejection_reason && (
                <div className="ph-notes" style={{ color: 'var(--danger)', marginTop: 4 }}>
                  Rejection reason: {p.rejection_reason}
                </div>
              )}
            </div>

            <div className="ph-date">
              {formatDate(p.payment_date)}
            </div>

            {canEdit && (
              <div style={{ display: 'flex', gap: 8 }}>
                {onEdit && (
                  <button
                    onClick={() => onEdit(p)}
                    style={{ background: 'none', border: 'none', color: '#64b5f6', cursor: 'pointer', padding: 4 }}
                    title="Edit payment"
                  >
                    <Edit2 size={14} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => {
                      if (window.confirm('Delete this payment?')) onDelete(p.id)
                    }}
                    style={{ background: 'none', border: 'none', color: '#ef9a9a', cursor: 'pointer', padding: 4 }}
                    title="Delete payment"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
