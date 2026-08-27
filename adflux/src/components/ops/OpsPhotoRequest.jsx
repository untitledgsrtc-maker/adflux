// src/components/ops/OpsPhotoRequest.jsx
//
// Operations module Phase 3 (§230) — the sales → field-team bridge.
//
//   <OpsPhotoRequestButton quote profile /> — on a WON private-LED quote,
//     a rep asks the field team for a live photo of the ad running on the
//     GSRTC LED screens. Inserts an ops_tickets photo_request row (Phase 0
//     ops_tickets_sales_request RLS pins type/requested_by/created_by). The
//     Operation Head routes it to a field tech (Phase 2 ticket board); the
//     tech photographs it (Phase 1 queue) and uploads to the ops-photos bucket.
//
//   <OpsLivePhotos quote profile /> — the rep reads their requests back
//     (ops_tickets_sales_read = requested_by self) and views the returned
//     photo via the gated signed-URL endpoint (api/ops/photo-url.js — the
//     bucket RLS blocks a sales rep from signing it client-side).
//
// Global-token styling (QuoteDetail is a global-CSS page, not v2). Additive,
// self-contained — QuoteDetail only mounts these two.

import { useEffect, useState } from 'react'
import { Camera, Loader2, X, CheckCircle2, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'

// Private LED (LED_OTHER) runs on the physical GSRTC LED screens the ops
// team maintains → the only QuoteDetail media that has a "live on screen"
// photo. (Govt GSRTC_LED lives on GovtProposalDetailV2 — a later mount.)
function isScreenCampaign(quote) {
  return quote?.status === 'won' && quote?.media_type === 'LED_OTHER'
}

async function fetchPhotoUrl(ticketId) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch('/api/ops/photo-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ ticket_id: ticketId }),
    })
    if (!r.ok) return null
    const d = await r.json()
    return d?.url || null
  } catch { return null }
}

/* ─── the request button + modal ───────────────────────────────────── */

export function OpsPhotoRequestButton({ quote, profile, onRequested }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Only roles that actually have an ops_tickets INSERT path may see the button
  // (else the tap 42501s): sales/agency/telecaller via ops_tickets_sales_request,
  // admin/co_owner/operation_head via ops_tickets_manage. accounts/hr/office_staff/
  // staff have neither. Check role OR team_role — a sales rep can carry either.
  const r = profile?.role, tr = profile?.team_role
  const canRequestPhoto =
    ['sales', 'agency', 'telecaller', 'admin', 'co_owner', 'operation_head'].includes(r) ||
    ['sales', 'agency', 'telecaller'].includes(tr)
  if (!isScreenCampaign(quote) || !profile?.id || !canRequestPhoto) return null

  async function send() {
    if (saving) return
    setSaving(true)
    try {
      const label = [quote.client_name, quote.quote_number].filter(Boolean).join(' · ')
      const { error } = await supabase.from('ops_tickets').insert([{
        type: 'photo_request',
        status: 'open',
        source: 'sales_request',
        priority: 'normal',
        quote_id: quote.id,
        requested_by: profile.id,
        created_by: profile.id,
        notes: `Live photo · ${label}${note.trim() ? ` — ${note.trim()}` : ''}`,
      }])
      if (error) throw error
      toastSuccess('Photo request sent to the field team')
      setOpen(false); setNote('')
      onRequested && onRequested()
    } catch (e) {
      toastError(e, 'Could not send the request')
    } finally { setSaving(false) }
  }

  return (
    <>
      <button className="btn btn-sec btn-sm" onClick={() => setOpen(true)}>
        <Camera size={14} /> Request live photo
      </button>
      {open && (
        <div onClick={() => !saving && setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 14px)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>Request a live photo</div>
              <button onClick={() => !saving && setOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
              Our field team will photograph <b style={{ color: 'var(--text)' }}>{quote.client_name || 'this campaign'}</b>'s
              ad running live on the GSRTC LED screens and send it back to you.
            </p>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Any instructions? (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. the Anand station screen, or by evening"
              style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border-strong, var(--border))', borderRadius: 'var(--radius, 10px)', padding: '10px 12px', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
            <button className="btn btn-primary" onClick={send} disabled={saving} style={{ width: '100%', marginTop: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Camera size={16} />} Send request
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/* ─── the readback (rep sees status + the returned photo) ───────────── */

export function OpsLivePhotos({ quote, profile, refreshKey }) {
  const [tickets, setTickets] = useState([])
  const [urls, setUrls] = useState({})   // ticket_id → signed url
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!quote?.id || !profile?.id) { setLoading(false); return }
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.from('ops_tickets')
          .select('id, status, photo_path, notes, opened_at, resolved_at')
          .eq('quote_id', quote.id).eq('requested_by', profile.id)
          .order('opened_at', { ascending: false })
        if (!alive) return
        const rows = data || []
        setTickets(rows)
        // sign the ones that have a photo
        const withPhoto = rows.filter(r => r.photo_path)
        const signed = {}
        await Promise.all(withPhoto.map(async r => { const u = await fetchPhotoUrl(r.id); if (u) signed[r.id] = u }))
        if (alive) setUrls(signed)
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [quote?.id, profile?.id, refreshKey])

  if (loading || tickets.length === 0) return null

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Camera size={16} /> Live photos
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {tickets.map(tk => {
          const url = urls[tk.id]
          return (
            <div key={tk.id} style={{ background: 'var(--surface-2, var(--surface))', border: '1px solid var(--border)', borderRadius: 'var(--radius, 10px)', overflow: 'hidden' }}>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <img src={url} alt="Live screen" style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block' }} />
                </a>
              ) : (
                <div style={{ height: 130, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-subtle, var(--text-muted))' }}>
                  <Clock size={20} />
                  <span style={{ fontSize: 12 }}>Field team on it…</span>
                </div>
              )}
              <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                {tk.status === 'resolved'
                  ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                  : <Clock size={14} style={{ color: 'var(--text-muted)' }} />}
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {tk.status === 'resolved' ? 'Delivered' : tk.status === 'in_progress' ? 'In progress' : 'Requested'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
