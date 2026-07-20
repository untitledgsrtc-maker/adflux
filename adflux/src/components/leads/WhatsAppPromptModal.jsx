// src/components/leads/WhatsAppPromptModal.jsx
//
// Phase 33D.5 (11 May 2026) — post-action WhatsApp prompt.
//
// Pops after meeting save / call log / stage change with the right
// templated message. Rep reviews the body, then taps Send to open
// WhatsApp (wa.me) pre-filled, or Skip to dismiss.
//
// Props:
//   open        — visibility toggle
//   stage       — message_templates.stage key:
//                 'post_meeting' | 'post_call' | 'New' | 'Working' |
//                 'QuoteSent' | 'Nurture' | 'Won' | 'Lost'
//   lead        — { name, company, phone, segment, city }
//   profile     — { name } (rep)
//   onClose     — close callback
//
// Phone normalization, OCR placeholder fill, and segment→media
// mapping all happen here so callers stay simple.

import { useEffect, useRef, useState } from 'react'
import { X, MessageCircle, MessageSquare, Loader2, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { openExternalUrl } from '../../utils/openExternal'
import { phoneToWaJidOrNull as cleanPhone } from '../../utils/phone'

function mediaFor(segment) {
  // Locked at app level — Govt uses Auto Hood + GSRTC LED; Private
  // uses LED screens + other outdoor media.
  return segment === 'GOVERNMENT' ? 'outdoor hoardings' : 'LED screens'
}

export default function WhatsAppPromptModal({ open, stage, lead, profile, onClose }) {
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [optedOut, setOptedOut] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentOk, setSentOk] = useState(false)
  // SEPARATE from `error` on purpose: `error` gates the template textarea and
  // disables the WhatsApp/SMS buttons. A failed company-send must NOT take the
  // deep-link fallback away — that fallback is the whole point.
  const [sendError, setSendError] = useState('')
  const sendingRef = useRef(false)

  // Company-number sending is telecaller-first during the pilot; the server
  // enforces the same gate, this only avoids showing a button that would 403.
  const canSendFromCompany =
    !!lead?.id && ['telecaller', 'admin', 'co_owner'].includes(profile?.role)

  useEffect(() => {
    if (!open || !stage) return
    let cancelled = false
    setLoading(true); setError(''); setOptedOut(false)
    ;(async () => {
      // Opt-out is read from the DB, NEVER from the passed `lead` prop.
      // TelecallerV2 selects wa_opt_out, but WorkV2 / FollowUpsV2 /
      // LeadDetailV2 pass lead objects that don't carry the flag — a
      // prop-based guard (`!lead?.wa_opt_out`) reads undefined there and
      // is a SILENT NO-OP that looks like a working fix. Hence this read.
      //
      // lead.id is not always a lead: FollowUpsV2 quote-chase rows pass a
      // QUOTE uuid (lead_id is null on those). maybeSingle() then returns
      // no row — we proceed, because there is no lead to have opted out.
      // Fail-closed on a positive flag, fail-open on "not a lead".
      if (lead?.id) {
        const { data: l } = await supabase
          .from('leads')
          .select('wa_opt_out')
          .eq('id', lead.id)
          .maybeSingle()
        if (cancelled) return
        if (l?.wa_opt_out) {
          setLoading(false)
          setOptedOut(true)
          return
        }
      }
      const { data, error: tErr } = await supabase
        .from('message_templates')
        .select('body')
        .eq('stage', stage)
        .eq('is_active', true)
        .order('display_order')
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setLoading(false)
      if (tErr || !data) {
        setError(`No template found for "${stage}". Admin can add one in Master → Message Templates.`)
        return
      }
      const filled = (data.body || '')
        .replace(/\{name\}/g,    lead?.name    || 'Sir/Madam')
        .replace(/\{company\}/g, lead?.company || lead?.name || 'your business')
        .replace(/\{rep\}/g,     profile?.name || 'Sales Team')
        .replace(/\{city\}/g,    lead?.city    || 'your city')
        .replace(/\{media\}/g,   mediaFor(lead?.segment))
      setBody(filled)
    })()
    return () => { cancelled = true }
  }, [open, stage, lead, profile])

  if (!open) return null

  function send() {
    if (optedOut) return
    const phone = cleanPhone(lead?.phone)
    if (!phone) {
      setError('No phone number on file for this lead.')
      return
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`
    // Phase 95.2 — openExternalUrl routes via Capacitor App.openUrl
    // on native (manifest <queries> in Phase 95.1 lets the OS resolve
    // wa.me HTTPS to the WhatsApp app), falls back to window.open on
    // web.
    openExternalUrl(url)
    onClose?.()
  }

  // Send from the COMPANY number instead of deep-linking into the rep's own
  // WhatsApp. The reply then lands in the app inbox assigned to this rep, and
  // the AI is paused on that thread so it doesn't answer before they do.
  //
  // Server decides everything that matters — it takes only the lead id and
  // derives the phone, the outcome and the template itself. Tapping this button
  // IS the consent record: the rep just spoke to the person and is asserting
  // they agreed to receive it, which is why the label says so.
  async function sendFromCompany() {
    if (optedOut || sendingRef.current || !lead?.id) return
    sendingRef.current = true            // §47 synchronous latch — a WebView
    setSending(true); setSendError('')   // ghost-click must not double-send
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/wa/send-template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ lead_id: lead.id }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || !out?.ok) {
        setSendError(out?.detail || out?.error || `Could not send (HTTP ${res.status}).`)
        return
      }
      if (out.warning) { setSendError(out.detail || out.warning); return }
      setSentOk(true)
      setTimeout(() => onClose?.(), 1200)
    } catch (e) {
      setSendError(String(e?.message || e))
    } finally {
      setSending(false)
      sendingRef.current = false
    }
  }

  function sendSms() {
    if (optedOut) return
    const phone = cleanPhone(lead?.phone)
    if (!phone) {
      setError('No phone number on file for this lead.')
      return
    }
    // sms: deep-link — opens the device Messages app with the number +
    // this reviewed text pre-filled; the rep just taps Send. Free (rep's
    // own SIM), same simple pattern as the WhatsApp button. Android reads
    // ?body=; some iOS / OEM messaging apps ignore the prefill, so the rep
    // may have to type it. On the native APK, openExternalUrl fires
    // ACTION_VIEW — the OS resolves it only if the sms VIEW intent is in
    // AndroidManifest <queries> (added same phase, mirrors the Phase 155
    // mailto fix), else the button silently no-ops. Web/PWA needs no
    // manifest.
    const url = `sms:+${phone}?body=${encodeURIComponent(body)}`
    openExternalUrl(url)
    onClose?.()
  }

  return (
    <div className="lead-modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="lead-modal" style={{ width: 'min(520px, calc(100% - 32px))' }}>
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <MessageCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Send follow-up to {lead?.name || 'lead'}?
            </div>
            <div className="lead-card-sub">
              Review the message — edit it here, then send by WhatsApp or SMS.
            </div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 13 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading template…
            </div>
          ) : optedOut ? (
            <div style={{
              background: 'var(--warning-soft)', border: '1px solid var(--warning)',
              color: 'var(--warning)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13,
            }}>
              This lead asked not to receive WhatsApp messages. Sending is blocked.
            </div>
          ) : error ? (
            <div style={{
              background: 'var(--danger-soft)', border: '1px solid var(--danger)',
              color: 'var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 13,
            }}>
              {error}
            </div>
          ) : (
            <textarea
              className="lead-inp"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
            />
          )}
        </div>

        {sendError && (
          <div style={{
            margin: '0 16px 10px', background: 'var(--danger-soft)',
            border: '1px solid var(--danger)', color: 'var(--danger)',
            borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 12.5,
          }}>
            {sendError} — you can still send it yourself with the buttons below.
          </div>
        )}

        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onClose}>{optedOut ? 'Close' : 'Skip'}</button>
          {canSendFromCompany && (
            <button
              className="lead-btn"
              onClick={sendFromCompany}
              disabled={loading || optedOut || sending || sentOk}
              title="Sends from the company WhatsApp number — only use this if they agreed on the call. Their reply comes back to your inbox."
            >
              {sending
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
                : <><Building2 size={13} /> {sentOk ? 'Sent' : 'Send from company number'}</>}
            </button>
          )}
          <button
            className="lead-btn"
            onClick={sendSms}
            disabled={loading || optedOut || sending || !body || !!error}
          >
            <MessageSquare size={13} /> Send SMS
          </button>
          <button
            className="lead-btn lead-btn-primary"
            onClick={send}
            disabled={loading || optedOut || sending || !body || !!error}
          >
            <MessageCircle size={13} /> Send WhatsApp
          </button>
        </div>
      </div>
    </div>
  )
}
