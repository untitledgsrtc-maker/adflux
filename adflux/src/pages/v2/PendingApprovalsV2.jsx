// src/pages/v2/PendingApprovalsV2.jsx
//
// v2 "Pending Approvals" page (admin-only). Renders inside V2AppShell,
// so it only paints the body. Data flow mirrors the legacy page: subscribe
// to the `payments` realtime channel, keep rows in local state, and route
// approve/reject through Supabase directly.
//
// The design is a vertical card list — each pending payment gets one
// panel with amount, client, payment meta, submitter, notes, and a pair
// of approve/reject actions. Works at both desktop and mobile widths
// because the layout is flex-column with wrap at the action row.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, XCircle, ExternalLink, RefreshCw, Inbox,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { useAuthStore } from '../../store/authStore'
import { fetchPendingApprovals } from '../../hooks/usePayments'

export default function PendingApprovalsV2() {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await fetchPendingApprovals()
    if (error) console.error('[PendingApprovalsV2] fetch failed:', error)
    setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('pending-approvals-v2')
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
    if (updateErr) alert('Approve failed: ' + updateErr.message)
  }

  async function reject(row) {
    const reason = window.prompt(
      `Reject payment of ${formatCurrency(row.amount_received)}?\n\n` +
      `Please enter a reason — the sales person will see this on their dashboard.`
    )
    if (reason === null) return
    if (!reason.trim()) { alert('A reason is required to reject.'); return }

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
    <div className="v2d-pa">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Admin review queue</div>
          <h1 className="v2d-page-title">Pending Approvals</h1>
          <div className="v2d-page-sub">
            Review and approve payments submitted by your sales team.
          </div>
        </div>
        <button className="v2d-ghost v2d-ghost--btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {loading ? (
        <div className="v2d-loading"><div className="v2d-spinner" />Loading…</div>
      ) : rows.length === 0 ? (
        <div className="v2d-panel v2d-empty-card">
          <div className="v2d-empty-ic"><Inbox size={32} /></div>
          <div className="v2d-empty-t">You're all caught up</div>
          <div className="v2d-empty-s">No payments awaiting approval.</div>
        </div>
      ) : (
        <div className="v2d-pa-list">
          {rows.map(row => {
            const busy = actingId === row.id
            const submitter = row.users?.name || row.quotes?.sales_person_name || '—'
            return (
              <div key={row.id} className="v2d-panel v2d-pa-card">
                <div className="v2d-pa-card-top">
                  <div className="v2d-pa-amt-row">
                    <div className="v2d-pa-amt">{formatCurrency(row.amount_received)}</div>
                    {row.is_final_payment && <span className="v2d-pa-final">Final</span>}
                    <button
                      className="v2d-pa-qlink"
                      onClick={() => navigate(`/quotes/${row.quote_id}`)}
                      title="Open quote"
                    >
                      {row.quotes?.quote_number || 'Quote'}
                      <ExternalLink size={11} />
                    </button>
                  </div>
                  <div className="v2d-pa-meta">
                    <span>{row.quotes?.client_name || '—'}</span>
                    {row.quotes?.client_company && <span>· {row.quotes.client_company}</span>}
                    <span>· {row.payment_mode}</span>
                    {row.reference_number && <span>· Ref: {row.reference_number}</span>}
                    <span>· {formatDate(row.payment_date)}</span>
                  </div>
                  <div className="v2d-pa-sub">
                    Submitted by <strong>{submitter}</strong>
                    {' · '}{new Date(row.created_at).toLocaleString('en-IN')}
                  </div>
                  {row.payment_notes && (
                    <div className="v2d-pa-note">"{row.payment_notes}"</div>
                  )}
                </div>

                <div className="v2d-pa-actions">
                  <button
                    className="v2d-btn v2d-btn--danger"
                    onClick={() => reject(row)}
                    disabled={busy}
                  >
                    <XCircle size={14} /><span>Reject</span>
                  </button>
                  <button
                    className="v2d-btn v2d-btn--primary"
                    onClick={() => approve(row)}
                    disabled={busy}
                  >
                    <CheckCircle2 size={14} /><span>{busy ? '…' : 'Approve'}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
