// src/components/v2/AdminPushModal.jsx
//
// Phase 103.E (2026-05-31) — admin compose-and-send push to one rep.
//
// Owner directive: "click push on [the pill] → popup with custom
// message for push notification for that person ... after push return
// with successful delivered, if push not [fired] return with failed."
//
// Where it opens: the admin TeamDashboardV2 rep card has a Push status
// pill. Clicking it opens this modal targeted at that rep. Admin types
// a title + message, hits Send, and gets an honest result:
//   • "Sent to N device(s)"  — FCM/web-push ACCEPTED the message for N
//     of the rep's registered devices.
//   • "Not sent — no registered device" — the rep has no push
//     subscription (never enabled push / token expired).
//   • "Failed" — the Edge call itself errored.
//
// HONESTY NOTE (told to owner): "Sent" means the push service accepted
// the message, NOT that the rep's phone displayed it. A phone killed by
// an OEM battery-saver can still report "sent" yet show nothing. A true
// read-receipt would need the device to ack back when the push lands —
// that requires the app to be alive, the same limit as live GPS. So the
// label is deliberately "Sent", never "Delivered/Seen".
//
// Plumbing reused (no new backend): the `notify-rep` Edge Function
// already takes { user_id, title, body, url, tag, require_interaction }
// and returns { sent, removed, errors } (or { sent:0, reason }). It is
// the exact path the admin "Send test push" button in PushDebugV2 uses,
// just with a custom message + targeted at any rep. No SQL, no Edge
// redeploy, no APK rebuild.
//
// Auth: this modal renders only inside TeamDashboardV2, which sits
// behind the admin/co_owner route guard (RequirePrivileged). The Edge
// gates on a valid session JWT. (Hardening the Edge to admin-ONLY is a
// separate, optional follow-up — flagged to owner, not bundled here.)

import { useEffect, useRef, useState } from 'react'
import { X, Send, BellRing, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const TITLE_MAX = 60
const BODY_MAX  = 160

export default function AdminPushModal({ target, onClose }) {
  const [title, setTitle]     = useState('')
  const [body, setBody]       = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState(null) // { ok: boolean, msg: string }
  const titleRef = useRef(null)

  // Reset the form each time a new rep is targeted; focus the title.
  useEffect(() => {
    if (!target) return
    setTitle('')
    setBody('')
    setResult(null)
    setSending(false)
    const t = setTimeout(() => titleRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [target?.id])

  // Esc closes (unless mid-send).
  useEffect(() => {
    if (!target) return
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, sending, onClose])

  if (!target) return null

  const canSend = title.trim().length > 0 && !sending

  async function send() {
    if (!canSend) return
    setSending(true)
    setResult(null)
    try {
      // Unique tag per send so multiple admin messages stack in the
      // tray instead of replacing each other (Phase 97.5 / A400 lesson:
      // a constant tag collapses to one entry).
      const tag = `admin-msg-${Date.now()}`
      const { data, error } = await supabase.functions.invoke('notify-rep', {
        body: {
          user_id: target.id,
          title: title.trim(),
          body: body.trim(),
          url: '/work',
          tag,
          require_interaction: true,
        },
      })

      if (error) {
        setResult({ ok: false, msg: `Failed to send. ${error.message || 'Edge function error.'}` })
        return
      }
      if (data?.error) {
        setResult({ ok: false, msg: `Failed to send. ${data.error}` })
        return
      }

      const sent    = Number(data?.sent || 0)
      const failed  = Array.isArray(data?.errors) ? data.errors.length : 0

      if (sent > 0) {
        let msg = `Sent to ${sent} device${sent === 1 ? '' : 's'}.`
        if (failed > 0) msg += ` ${failed} device${failed === 1 ? '' : 's'} could not be reached.`
        setResult({ ok: true, msg })
      } else {
        const reason = data?.reason === 'no subscriptions'
          ? `${target.name || 'This rep'} has no registered device. They need to open the app and turn on notifications.`
          : (failed > 0
              ? `Push service rejected all ${failed} device${failed === 1 ? '' : 's'} (token expired or invalid).`
              : 'No device received it.')
        setResult({ ok: false, msg: `Not sent — ${reason}` })
      }
    } catch (e) {
      setResult({ ok: false, msg: `Failed to send. ${e?.message || e}` })
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      onClick={() => { if (!sending) onClose?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(2,6,18,0.66)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: 'var(--v2-bg-1, #1e293b)',
          border: '1px solid var(--v2-line, #334155)',
          borderRadius: 'var(--v2-r, 14px)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 18px',
          borderBottom: '1px solid var(--v2-line, #334155)',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, borderRadius: 10,
            background: 'var(--accent-soft, rgba(255,230,0,0.14))',
            color: 'var(--v2-yellow, #FFE600)',
          }}>
            <BellRing size={18} strokeWidth={1.6} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--v2-ink-0, #f1f5f9)' }}>
              Send notification
            </div>
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              to {target.name || 'this rep'}
            </div>
          </div>
          <button
            onClick={() => { if (!sending) onClose?.() }}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: sending ? 'default' : 'pointer',
              color: 'var(--v2-ink-2, #94a3b8)', padding: 4, display: 'inline-flex',
            }}
          >
            <X size={20} strokeWidth={1.6} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>
              Title
              <span style={counterStyle}>{title.length}/{TITLE_MAX}</span>
            </span>
            <input
              ref={titleRef}
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Call the new lead"
              disabled={sending}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>
              Message
              <span style={counterStyle}>{body.length}/{BODY_MAX}</span>
            </span>
            <textarea
              value={body}
              maxLength={BODY_MAX}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What should they know? (optional)"
              rows={3}
              disabled={sending}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
            />
          </label>

          {result && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 12px',
              borderRadius: 10,
              fontSize: 13, lineHeight: 1.45,
              border: `1px solid ${result.ok ? 'var(--success, #10B981)' : 'var(--danger, #EF4444)'}`,
              background: result.ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: result.ok ? 'var(--success, #10B981)' : 'var(--danger, #EF4444)',
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>
                {result.ok
                  ? <CheckCircle2 size={16} strokeWidth={1.6} />
                  : <AlertCircle size={16} strokeWidth={1.6} />}
              </span>
              <span>{result.msg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 18px',
          borderTop: '1px solid var(--v2-line, #334155)',
        }}>
          <button
            onClick={() => { if (!sending) onClose?.() }}
            disabled={sending}
            style={{
              padding: '9px 16px', borderRadius: 10,
              border: '1px solid var(--v2-line, #334155)',
              background: 'transparent',
              color: 'var(--v2-ink-1, #cbd5e1)',
              fontSize: 13, fontWeight: 600,
              cursor: sending ? 'default' : 'pointer',
            }}
          >
            {result?.ok ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={send}
            disabled={!canSend}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 10,
              border: 'none',
              background: canSend ? 'var(--v2-yellow, #FFE600)' : 'var(--surface-3, #475569)',
              color: canSend ? 'var(--accent-fg, #0f172a)' : 'var(--v2-ink-2, #94a3b8)',
              fontSize: 13, fontWeight: 700,
              cursor: canSend ? 'pointer' : 'default',
            }}
          >
            {sending
              ? <><Loader2 size={15} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
              : <><Send size={15} strokeWidth={1.6} /> Send</>}
          </button>
        </div>
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
  color: 'var(--v2-ink-2, #94a3b8)',
}

const counterStyle = {
  fontSize: 10, fontWeight: 600, letterSpacing: 0, textTransform: 'none',
  color: 'var(--v2-ink-2, #64748b)',
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--v2-line, #334155)',
  background: 'var(--v2-bg-0, #0f172a)',
  color: 'var(--v2-ink-0, #f1f5f9)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}
