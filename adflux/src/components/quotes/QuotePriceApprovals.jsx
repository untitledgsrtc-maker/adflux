// src/components/quotes/QuotePriceApprovals.jsx
//
// Phase 360 (2026-10-13) — the approver's queue for private-LED quotes priced
// below Rs 600 per screen. Mounted on /pending-approvals (admin) and on
// /quote-approvals (Sales Head). One component, one definition (section 71).
//
// What an approver sees: one card per pending request — the quote, who raised
// it, the lowest price, every city line (low ones marked) — and Approve /
// Reject. A Sales Head cannot decide a request she raised or a quote she
// created (the database refuses it too, qpa_sales_head_decide); the buttons say
// so instead of failing.
//
// Reads: quote_price_approvals (RLS-scoped), then quotes / quote_cities / users
// by id in separate queries (no FK embeds - section 36.6).
// Writes: ONE update on quote_price_approvals; the database stamps decided_by /
// decided_at from the caller and requires a note on a reject.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, XCircle, ExternalLink, RefreshCw, Inbox, AlertTriangle, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../utils/formatters'
import { useAuthStore } from '../../store/authStore'
import { confirmDialog } from '../v2/ConfirmDialog'
import { toastError, toastSuccess } from '../v2/Toast'
import { PRICE_FLOOR } from '../../utils/quotePriceGate'
import { durationShort } from '../../utils/quoteDuration'

function timeAgo(iso) {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function QuotePriceApprovals({ title = 'Quote price approvals', hideWhenEmpty = false }) {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState('')
  const [actingId, setActingId] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState('')

  const load = useCallback(async () => {
    setFetchErr('')
    const { data: reqs, error } = await supabase
      .from('quote_price_approvals')
      .select('id, quote_id, requested_by, min_rate, floor_rate, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) {
      console.error('[QuotePriceApprovals] load failed:', error)
      setFetchErr(`Could not load price requests: ${error.message}`)
      setRows([])
      setLoading(false)
      return
    }
    const list = reqs || []
    if (!list.length) { setRows([]); setLoading(false); return }

    const quoteIds = [...new Set(list.map(r => r.quote_id))]
    const userIds = [...new Set(list.map(r => r.requested_by).filter(Boolean))]
    const [qRes, cRes, uRes] = await Promise.all([
      // cap-ok: quoteIds <= 200 (the request list above is .limit(200))
      supabase.from('quotes')
        .select('id, quote_number, client_name, client_company, total_amount, sales_person_name, created_by, status')
        .in('id', quoteIds)
        .limit(200),
      // pending requests are a handful at a time; 1000 is the PostgREST ceiling anyway
      supabase.from('quote_cities')
        .select('quote_id, city_name, screens, offered_rate, duration_months, duration_days')
        .in('quote_id', quoteIds)
        .limit(1000),
      userIds.length
        ? supabase.from('users').select('id, name').in('id', userIds)
        : Promise.resolve({ data: [] }),
    ])
    const qMap = new Map((qRes.data || []).map(q => [q.id, q]))
    const uMap = new Map((uRes.data || []).map(u => [u.id, u.name]))
    const cMap = new Map()
    for (const c of cRes.data || []) {
      if (!cMap.has(c.quote_id)) cMap.set(c.quote_id, [])
      cMap.get(c.quote_id).push(c)
    }
    setRows(list.map(r => ({
      ...r,
      quote: qMap.get(r.quote_id) || null,
      cities: cMap.get(r.quote_id) || [],
      requesterName: uMap.get(r.requested_by) || null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!profile?.id) return undefined
    load()
    let ch = null
    try {
      ch = supabase
        .channel(`qpa-queue-${Math.random().toString(36).slice(2, 9)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_price_approvals' }, () => load())
        .subscribe()
    } catch { /* realtime unavailable - Refresh + the 30 s page reload still work */ }
    return () => { if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } } }
  }, [load, profile?.id])

  // A Sales Head never decides her own work (the database enforces it too).
  const ownWork = useCallback((row) => {
    if (isAdmin) return false
    return row.requested_by === profile?.id || row.quote?.created_by === profile?.id
  }, [isAdmin, profile?.id])

  // inModal: the reject dialog is open (z 10000, above the toast layer 9999), so a
  // failure has to be shown INSIDE it or the approver never sees why nothing happened.
  async function decide(row, status, note, inModal = false) {
    setActingId(row.id)
    const patch = { status }
    if (note) patch.decision_note = note
    // Pin on the price the approver was looking at: if the rep changed it while
    // the card was open the row no longer matches and nothing is decided.
    const { data, error } = await supabase
      .from('quote_price_approvals')
      .update(patch)
      .eq('id', row.id)
      .eq('status', 'pending')
      .eq('min_rate', row.min_rate)
      .select('id')
    if (error) {
      setActingId(null)
      const msg = `${status === 'approved' ? 'Approve' : 'Reject'} failed: ${error.message}`
      if (inModal) setReasonErr(msg); else toastError(error, msg)
      return false
    }
    if (!data || data.length === 0) {
      const msg = 'This request changed or was already decided. The list has been refreshed - check the price and try again.'
      if (inModal) { setReasonErr(msg); closeRejectSoon() } else toastError(null, msg)
      try { await load() } finally { setActingId(null) }
      return false
    }
    toastSuccess(status === 'approved' ? 'Price approved. The rep can send the quote now.' : 'Price rejected.')
    // the card must leave the list now, not on the next realtime event; keep the
    // buttons disabled until it has, so a second tap cannot hit a decided row
    try { await load() } finally { setActingId(null) }
    return true
  }

  async function approve(row) {
    const label = row.quote?.client_company || row.quote?.client_name || 'this quote'
    const ok = await confirmDialog({
      title: 'Approve this price?',
      message: `Approve ${label} at ${formatCurrency(row.min_rate)} per screen (the minimum is ${formatCurrency(PRICE_FLOOR)}). The rep will be able to send the quote.`,
      confirmLabel: 'Approve',
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    await decide(row, 'approved', null)
  }

  function openReject(row) {
    setRejecting(row)
    setReason('')
    setReasonErr('')
  }
  function closeReject() {
    setRejecting(null)
    setReason('')
    setReasonErr('')
  }
  // the request changed under the dialog: the refreshed list no longer holds it,
  // so leave the message up for a moment, then close.
  function closeRejectSoon() {
    setTimeout(() => closeReject(), 2200)
  }
  async function submitReject() {
    if (!rejecting) return
    const text = reason.trim()
    if (!text) { setReasonErr('A reason is required to reject.'); return }
    const ok = await decide(rejecting, 'rejected', text, true)
    if (ok) closeReject()
  }

  const count = rows.length
  const sorted = useMemo(() => rows, [rows])

  // On the admin page the queue should be invisible until there is something to
  // decide (the payments queue is the page's main subject).
  if (hideWhenEmpty && !fetchErr && count === 0) return null

  return (
    <div className="v2d-pa-qpa">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '4px 0 10px', flexWrap: 'wrap' }}>
        <div>
          <div className="v2d-page-kicker">Price below Rs {PRICE_FLOOR} per screen</div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)', fontFamily: 'var(--v2-display, var(--font-display))' }}>
            {title}{count > 0 ? ` · ${count}` : ''}
          </h2>
        </div>
        <button className="v2d-ghost v2d-ghost--btn" onClick={() => { setLoading(true); load() }} disabled={loading}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {fetchErr && (
        <div style={{
          background: 'var(--danger-soft, rgba(239,68,68,0.12))', border: '1px solid var(--danger, #EF4444)',
          borderRadius: 10, padding: '10px 14px', margin: '8px 0', fontSize: '.82rem', color: 'var(--danger, #EF4444)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={14} strokeWidth={1.8} />
          <span>{fetchErr}</span>
        </div>
      )}

      {loading ? (
        <div className="v2d-loading"><div className="v2d-spinner" />Loading…</div>
      ) : count === 0 ? (
        <div className="v2d-panel v2d-empty-card">
          <div className="v2d-empty-ic"><Inbox size={32} /></div>
          <div className="v2d-empty-t">No price requests waiting</div>
          <div className="v2d-empty-s">Every quote is at or above Rs {PRICE_FLOOR} per screen, or already approved.</div>
        </div>
      ) : (
        <div className="v2d-pa-list">
          {sorted.map(row => {
            const busy = actingId === row.id
            const own = ownWork(row)
            const q = row.quote
            const who = row.requesterName || q?.sales_person_name || '—'
            return (
              <div key={row.id} className="v2d-panel v2d-pa-card">
                <div className="v2d-pa-card-top">
                  <div className="v2d-pa-amt-row">
                    <div className="v2d-pa-amt">{formatCurrency(row.min_rate)}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--v2-ink-2, #94a3b8)' }}> / screen</span></div>
                    <span className="v2d-pa-final" style={{ background: 'var(--warning-soft, rgba(245,158,11,0.12))', color: 'var(--warning, #F59E0B)' }}>
                      Below {formatCurrency(row.floor_rate || PRICE_FLOOR)}
                    </span>
                    {q && (
                      <button
                        className="v2d-pa-qlink"
                        onClick={() => navigate(`/quotes/${q.id}`)}
                        title="Open quote"
                      >
                        {q.quote_number || 'Quote'}
                        <ExternalLink size={11} />
                      </button>
                    )}
                  </div>
                  <div className="v2d-pa-meta">
                    <span>{q?.client_name || '—'}</span>
                    {q?.client_company && <span>· {q.client_company}</span>}
                    {q && <span>· Quote total {formatCurrency(q.total_amount)}</span>}
                  </div>
                  <div className="v2d-pa-sub">
                    Raised by <strong>{who}</strong> · {timeAgo(row.created_at)}
                  </div>

                  {row.cities.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {row.cities.map((c, i) => {
                        const low = Number(c.offered_rate) < PRICE_FLOOR
                        return (
                          <div
                            key={`${c.city_name}-${i}`}
                            className="tabular-nums"
                            style={{
                              display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5,
                              color: low ? 'var(--warning, #F59E0B)' : 'var(--v2-ink-1, #a9b3c7)',
                              fontWeight: low ? 700 : 400,
                            }}
                          >
                            <span>{c.city_name}</span>
                            <span>
                              {c.screens} screens x {formatCurrency(c.offered_rate)} x {durationShort(c)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {own && (
                    <div className="v2d-pa-note" style={{ marginTop: 8 }}>
                      This is your own work, so admin has to approve it.
                    </div>
                  )}
                </div>

                <div className="v2d-pa-actions">
                  <button
                    className="v2d-btn v2d-btn--danger"
                    onClick={() => openReject(row)}
                    disabled={busy || own}
                  >
                    <XCircle size={14} /><span>Reject</span>
                  </button>
                  <button
                    className="v2d-btn v2d-btn--primary"
                    onClick={() => approve(row)}
                    disabled={busy || own}
                  >
                    <CheckCircle2 size={14} /><span>{busy ? '…' : 'Approve'}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {rejecting && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget && actingId !== rejecting.id) closeReject() }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(5, 8, 16, 0.62)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div style={{
            width: 'min(440px, 100%)', background: 'var(--v2-bg-1, #111a2e)',
            borderRadius: 'var(--v2-r, 14px)', border: '1px solid var(--v2-line, #1f2b47)',
            overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--v2-line, #1f2b47)' }}>
              <div style={{ color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 15, fontWeight: 600 }}>Reject this price</div>
              <button
                type="button" onClick={closeReject} disabled={actingId === rejecting.id} aria-label="Cancel"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--v2-ink-1, #a9b3c7)', padding: 10, margin: -6, display: 'flex' }}
              >
                <X size={16} strokeWidth={1.6} />
              </button>
            </div>
            <div style={{ padding: '14px 16px 4px', color: 'var(--v2-ink-1, #a9b3c7)', fontSize: 13, lineHeight: 1.5 }}>
              Reject {formatCurrency(rejecting.min_rate)} per screen for{' '}
              <strong style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>
                {rejecting.quote?.client_company || rejecting.quote?.client_name || 'this quote'}
              </strong>?
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>
                Tell the rep what price you can accept. They will see this on the quote.
              </div>
            </div>
            <div style={{ padding: '8px 16px 4px' }}>
              <textarea
                value={reason}
                onChange={(e) => { setReason(e.target.value); if (reasonErr) setReasonErr('') }}
                disabled={actingId === rejecting.id}
                autoFocus
                rows={3}
                placeholder="e.g. Minimum for Ahmedabad is Rs 650 per screen"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 'var(--radius, 10px)',
                  border: reasonErr ? '1px solid var(--danger)' : '1px solid var(--v2-line, #334155)',
                  background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-0, #f5f7fb)',
                  fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, resize: 'vertical', outline: 'none',
                }}
              />
              {reasonErr && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>{reasonErr}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 16px' }}>
              <button type="button" onClick={closeReject} disabled={actingId === rejecting.id} className="v2d-btn">Cancel</button>
              <button
                type="button" onClick={submitReject}
                disabled={actingId === rejecting.id || !reason.trim()}
                className="v2d-btn v2d-btn--danger"
              >
                {actingId === rejecting.id ? '…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
