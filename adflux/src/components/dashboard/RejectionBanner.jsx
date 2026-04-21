// src/components/dashboard/RejectionBanner.jsx
//
// Shown on the sales dashboard when an admin has rejected one or
// more of the user's payment submissions and the sales user hasn't
// yet dismissed the notification. Dismiss calls the
// `dismiss_payment_notification` RPC (SECURITY DEFINER) so the
// sales_notified_at timestamp can be written even though the row
// is in 'rejected' state and the normal UPDATE policy blocks it.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency } from '../../utils/formatters'
import { fetchMyRejectedPayments } from '../../hooks/usePayments'

export function RejectionBanner() {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const [rows, setRows] = useState([])

  const load = useCallback(async () => {
    if (!profile?.id) return
    const { data, error } = await fetchMyRejectedPayments(profile.id)
    if (!error) setRows(data || [])
  }, [profile?.id])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('rejection-banner')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function dismiss(paymentId) {
    // Optimistic remove
    setRows(prev => prev.filter(r => r.id !== paymentId))
    const { error: err } = await supabase.rpc('dismiss_payment_notification', {
      p_payment_id: paymentId,
    })
    if (err) {
      // Revert on failure
      load()
    }
  }

  if (!rows.length) return null

  return (
    <div className="db-card" style={{
      borderLeft: '4px solid var(--danger)',
      background: 'var(--danger-soft)',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <AlertTriangle size={18} style={{ color: 'var(--danger)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <h3 className="db-card-title" style={{ color: 'var(--danger)', margin: 0 }}>
            {rows.length === 1
              ? 'A payment you submitted was rejected'
              : `${rows.length} payments you submitted were rejected`}
          </h3>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(r => (
              <div
                key={r.id}
                style={{
                  padding: '8px 12px',
                  background: 'var(--surface)',
                  borderRadius: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>
                    {formatCurrency(r.amount_received)}
                    {' · '}
                    <span
                      style={{ color: 'var(--accent-fg)', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => navigate(`/quotes/${r.quote_id}`)}
                    >
                      {r.quotes?.quote_number || 'Quote'} — {r.quotes?.client_name || '—'}
                    </span>
                  </div>
                  <div style={{ marginTop: 2, color: 'var(--text-muted)', fontSize: 12 }}>
                    Reason: {r.rejection_reason || '(no reason given)'}
                    {r.approver?.name && <> · by {r.approver.name}</>}
                  </div>
                </div>
                <button
                  onClick={() => dismiss(r.id)}
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', fontSize: 12, flexShrink: 0 }}
                  title="Dismiss"
                >
                  <X size={13} /> Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
