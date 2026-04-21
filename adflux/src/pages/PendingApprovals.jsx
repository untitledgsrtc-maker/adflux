// src/pages/PendingApprovals.jsx
//
// Admin-only queue of sales-submitted payments awaiting approval.
// Live-updates via the Supabase realtime `payments` channel so the
// list (and the sidebar pill) stay current without a manual refresh.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, XCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate } from '../utils/formatters'
import { useAuthStore } from '../store/authStore'
import {
  fetchPendingApprovals,
} from '../hooks/usePayments'

export default function PendingApprovals() {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState(null) // id of row currently being acted on

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await fetchPendingApprovals()
    if (error) console.error('[PendingApprovals] fetch failed:', error)
    setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    // Realtime: when any payment row changes (new pending, approved,
    // rejected elsewhere) refresh the queue.
    const ch = supabase
      .channel('pending-approvals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function approve(row) {
    if (!window.confirm(
      `Approve payment of ${formatCurrency(row.amount_received)} for ${row.quotes?.client_name || 'this quote'}?` +
      (row.is_final_payment ? '\n\nThis is a FINAL payment — the quote will be marked Won and incentive credited.' : '')
    )) return

    setActingId(row.id)
    const { error: updateErr } = await supabase
      .from('payments')
      .update({
        approval_status:  'approved',
        approved_by:      profile.id,
        decided_at:       new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', row.id)

    if (!updateErr && row.is_final_payment) {
      await supabase.from('quotes').update({ status: 'won' }).eq('id', row.quote_id)
    }

    setActingId(null)
    if (updateErr) {
      alert('Approve failed: ' + updateErr.message)
      return
    }
    // Realtime handler will refresh the list.
  }

  async function reject(row) {
    const reason = window.prompt(
      `Reject payment of ${formatCurrency(row.amount_received)}?\n\nPlease enter a reason — the sales person will see this on their dashboard.`
    )
    if (reason === null) return // user cancelled
    if (!reason.trim()) {
      alert('A reason is required to reject.')
      return
    }

    setActingId(row.id)
    const { error: err } = await supabase
      .from('payments')
      .update({
        approval_status:   'rejected',
        approved_by:       profile.id,
        decided_at:        new Date().toISOString(),
        rejection_reason:  reason.trim(),
        sales_notified_at: null,
      })
      .eq('id', row.id)
    setActingId(null)

    if (err) alert('Reject failed: ' + err.message)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pending Approvals</h1>
          <p className="page-sub">Review and approve payments submitted by your sales team.</p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="db-loading" style={{ padding: 40, textAlign: 'center' }}>
            <div className="spinner" />
            <span>Loading pending payments…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="db-empty" style={{ padding: 60, textAlign: 'center' }}>
            <CheckCircle2 size={28} style={{ color: 'var(--success)', marginBottom: 8 }} />
            <p style={{ marginTop: 8 }}>No payments awaiting approval. You're all caught up.</p>
          </div>
        ) : (
          <div className="pa-list">
            {rows.map(row => {
              const busy = actingId === row.id
              return (
                <div
                  key={row.id}
                  className="pa-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 16,
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border)',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 16 }}>
                        {formatCurrency(row.amount_received)}
                      </span>
                      {row.is_final_payment && (
                        <span
                          style={{
                            background: 'var(--accent-soft)', color: 'var(--accent-fg)',
                            padding: '2px 8px', borderRadius: 10, fontSize: 10,
                            fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
                          }}
                        >
                          Final
                        </span>
                      )}
                      <button
                        className="btn btn-ghost"
                        onClick={() => navigate(`/quotes/${row.quote_id}`)}
                        style={{ padding: '2px 8px', fontSize: 12 }}
                        title="Open quote"
                      >
                        {row.quotes?.quote_number || 'Quote'} <ExternalLink size={11} />
                      </button>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                      {row.quotes?.client_name || '—'}
                      {row.quotes?.client_company && <> · {row.quotes.client_company}</>}
                      {' · '}
                      {row.payment_mode}
                      {row.reference_number && <> · Ref: {row.reference_number}</>}
                      {' · '}
                      {formatDate(row.payment_date)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Submitted by <strong>{row.users?.name || row.quotes?.sales_person_name || '—'}</strong>
                      {' · '}
                      {new Date(row.created_at).toLocaleString('en-IN')}
                    </div>
                    {row.payment_notes && (
                      <div style={{
                        fontSize: 12, color: 'var(--text)', marginTop: 6,
                        padding: '6px 10px', background: 'var(--surface-2)',
                        borderRadius: 6, fontStyle: 'italic',
                      }}>
                        "{row.payment_notes}"
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => reject(row)}
                      disabled={busy}
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    >
                      <XCircle size={14} /> Reject
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => approve(row)}
                      disabled={busy}
                    >
                      <CheckCircle2 size={14} /> {busy ? '…' : 'Approve'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
