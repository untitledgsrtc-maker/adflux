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
  AlertTriangle, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { useAuthStore } from '../../store/authStore'
import { fetchPendingApprovals } from '../../hooks/usePayments'
// Phase 97.10 (2026-05-28, F-300 + F-301) — swap browser
// confirm/prompt/alert dialogs for in-app primitives + Lucide icon.
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { toastError } from '../../components/v2/Toast'

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
  // Phase 97.10 (F-300) — reject reason modal state (replaces native prompt).
  const [rejectingRow, setRejectingRow] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectErr, setRejectErr]       = useState('')

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
    // Phase 97.10 (F-300) — confirmDialog replaces window.confirm.
    // Final-payment warning preserved as a single message line (dialog
    // body is plain text, so the \n\n separator from the old prompt
    // becomes a sentence break instead of a paragraph break).
    const clientLabel = row.quotes?.client_name || 'this quote'
    const finalNote = row.is_final_payment
      ? ' This is a FINAL payment — the quote will be marked Won and incentive credited.'
      : ''
    const ok = await confirmDialog({
      title: 'Approve payment?',
      message: `Approve ${formatCurrency(row.amount_received)} for ${clientLabel}.${finalNote}`,
      confirmLabel: 'Approve',
      cancelLabel: 'Cancel',
    })
    if (!ok) return

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
    // Phase 97.10 (F-300) — toast replaces alert().
    if (updateErr) toastError(updateErr, 'Approve failed: ' + updateErr.message)
  }

  // Phase 97.10 (F-300) — reject is now a 2-step flow: row click opens
  // the in-app reason modal; modal Submit calls submitReject() which
  // does the actual DB write. Replaces window.prompt + alert pair.
  function openReject(row) {
    setRejectingRow(row)
    setRejectReason('')
    setRejectErr('')
  }

  function closeReject() {
    setRejectingRow(null)
    setRejectReason('')
    setRejectErr('')
  }

  async function submitReject() {
    if (!rejectingRow) return
    const reason = rejectReason.trim()
    if (!reason) {
      setRejectErr('A reason is required to reject.')
      return
    }
    setActingId(rejectingRow.id)
    const { error: err } = await supabase
      .from('payments')
      .update({
        approval_status:   'rejected',
        approved_by:       profile.id,
        decided_at:        new Date().toISOString(),
        rejection_reason:  reason,
        sales_notified_at: null,
      })
      .eq('id', rejectingRow.id)
    setActingId(null)
    if (err) {
      toastError(err, 'Reject failed: ' + err.message)
      return
    }
    closeReject()
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
          color: 'var(--danger)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          {/* Phase 97.10 (F-301) — Lucide icon replaces ⚠. */}
          <AlertTriangle size={14} strokeWidth={1.8} />
          <span>{fetchErr}</span>
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
                    onClick={() => openReject(row)}
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

      {/* Phase 97.10 (F-300) — Reject reason modal. Replaces
          window.prompt(). z-index 10000 matches ConfirmDialog tier
          (CLAUDE.md §29). Submit disabled when busy or reason empty;
          inline error shown under textarea instead of an alert(). */}
      {rejectingRow && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget && actingId !== rejectingRow.id) closeReject() }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(5, 8, 16, 0.62)',
            backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
            fontFamily: 'var(--v2-sans, "DM Sans", system-ui, sans-serif)',
          }}
        >
          <div
            style={{
              width: 'min(440px, 100%)',
              background: 'var(--v2-bg-1, #111a2e)',
              borderRadius: 'var(--v2-r, 14px)',
              border: '1px solid var(--v2-line, #1f2b47)',
              boxShadow: 'var(--v2-shadow-pop, 0 10px 30px rgba(0,0,0,.45))',
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid var(--v2-line, #1f2b47)',
            }}>
              <div style={{
                color: 'var(--v2-ink-0, #f5f7fb)',
                fontSize: 15, fontWeight: 600,
              }}>
                Reject payment
              </div>
              <button
                type="button"
                onClick={closeReject}
                disabled={actingId === rejectingRow.id}
                aria-label="Cancel"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--v2-ink-1, #a9b3c7)', padding: 4, display: 'flex',
                }}
              >
                <X size={16} strokeWidth={1.6} />
              </button>
            </div>

            <div style={{
              padding: '14px 16px 4px',
              color: 'var(--v2-ink-1, #a9b3c7)',
              fontSize: 13, lineHeight: 1.5,
            }}>
              Reject {formatCurrency(rejectingRow.amount_received)} for{' '}
              <strong style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>
                {rejectingRow.quotes?.client_name || 'this quote'}
              </strong>?
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>
                Enter a reason — the sales person will see this on their dashboard.
              </div>
            </div>

            <div style={{ padding: '8px 16px 4px' }}>
              <textarea
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value)
                  if (rejectErr) setRejectErr('')
                }}
                disabled={actingId === rejectingRow.id}
                autoFocus
                rows={3}
                placeholder="e.g. Reference number doesn't match the bank statement"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius, 10px)',
                  border: rejectErr
                    ? '1px solid var(--danger)'
                    : '1px solid var(--v2-line, #334155)',
                  background: 'var(--v2-bg-2, #0f172a)',
                  color: 'var(--v2-ink-0, #f5f7fb)',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  lineHeight: 1.5,
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
              {rejectErr && (
                <div style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: 'var(--danger)',
                }}>
                  {rejectErr}
                </div>
              )}
            </div>

            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8,
              padding: '14px 16px',
            }}>
              <button
                type="button"
                onClick={closeReject}
                disabled={actingId === rejectingRow.id}
                className="v2d-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitReject}
                disabled={actingId === rejectingRow.id || !rejectReason.trim()}
                className="v2d-btn v2d-btn--danger"
              >
                {actingId === rejectingRow.id ? '…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
