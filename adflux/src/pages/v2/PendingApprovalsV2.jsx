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
  // Phase 11j — surface fetch errors to the UI instead of console-only.
  // The "you're all caught up" empty state was indistinguishable from
  // a silent RLS / network failure; this fixes that.
  const [fetchErr, setFetchErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setFetchErr('')
    const { data, error } = await fetchPendingApprovals()
    if (error) {
      console.error('[PendingApprovalsV2] fetch failed:', error)
      setFetchErr(`Could not load approvals: ${error.message}`)
    }
    // Phase 11j — verbose log so the user can see what came back.
    console.log('[PendingApprovalsV2] fetched', {
      role:  profile?.role,
      uid:   profile?.id,
      count: (data || []).length,
      data,
    })
    setRows(data || [])
    setLoading(false)
  }, [profile?.role, profile?.id])

  useEffect(() => {
    // Phase 11j — wait for the profile to be hydrated before firing
    // the query. Without this guard, the page mounts → fires SELECT
    // anonymously → RLS denies → empty → "all caught up" shows even
    // though there are pending payments. Reproduces especially after
    // a hard reload while the session is being restored.
    if (!profile?.id) return
    load()
    const ch = supabase
      .channel('pending-approvals-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load, profile?.id])

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

      {fetchErr && (
        <div style={{
          background: 'rgba(229,57,53,.1)',
          border: '1px solid rgba(229,57,53,.3)',
          borderRadius: 8,
          padding: '10px 14px',
          margin: '12px 0',
          fontSize: '.82rem',
          color: '#ef9a9a',
        }}>
          ⚠ {fetchErr}
        </div>
      )}

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
                      onClick={() => {
                        // Route based on segment — government quotes
                        // live at /proposal/:id, private at /quotes/:id.
                        // Without this branch, govt approvals 404.
                        const isGovt = row.quotes?.segment === 'GOVERNMENT'
                        navigate(isGovt ? `/proposal/${row.quote_id}` : `/quotes/${row.quote_id}`)
                      }}
                      title="Open quote"
                    >
                      {row.quotes?.quote_number || row.quotes?.ref_number || 'Quote'}
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
                  {/* Phase 24a — only render the note if it's a meaningful
                      string (skip stray single-character typos like ">").
                      The data wasn't validated on the sales-side payment
                      modal, so we filter on display. */}
                  {row.payment_notes && row.payment_notes.trim().length >= 2 && (
                    <div className="v2d-pa-note">"{row.payment_notes.trim()}"</div>
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
