// src/components/dashboard/PendingApprovalsBanner.jsx
//
// Shown on the sales dashboard when the sales user has payment
// submissions that are still waiting for an admin approval decision.
// It's read-only (no dismiss) — the banner clears automatically once
// admin approves or rejects each row. Rejections then move into
// RejectionBanner, approvals simply disappear.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { fetchMyPendingPayments } from '../../hooks/usePayments'

export function PendingApprovalsBanner() {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const [rows, setRows] = useState([])

  const load = useCallback(async () => {
    if (!profile?.id) return
    const { data, error } = await fetchMyPendingPayments(profile.id)
    if (!error) setRows(data || [])
  }, [profile?.id])

  useEffect(() => {
    load()
    // Realtime — refresh when any payment row changes (approval /
    // rejection / new punch). Cheap filter: the query itself is
    // user-scoped, so we just re-run it on any change.
    const ch = supabase
      .channel('pending-approvals-banner')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  if (!rows.length) return null

  return (
    <div className="db-card" style={{
      borderLeft: '4px solid var(--warning, #ffb74d)',
      background: 'var(--warning-soft, rgba(255,183,77,0.12))',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Clock size={18} style={{ color: 'var(--warning, #ffb74d)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <h3 className="db-card-title" style={{ color: 'var(--warning, #ffb74d)', margin: 0 }}>
            {rows.length === 1
              ? '1 payment awaiting admin approval'
              : `${rows.length} payments awaiting admin approval`}
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
                    Submitted {r.payment_date ? formatDate(r.payment_date) : ''}
                    {r.is_final_payment && <> · Final payment</>}
                  </div>
                </div>
                <span
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--warning, #ffb74d)',
                    border: '1px solid var(--warning, #ffb74d)',
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                >
                  PENDING
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
