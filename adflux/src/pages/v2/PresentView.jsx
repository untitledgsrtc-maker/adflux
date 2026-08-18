// Phase 181 — in-app GSRTC presentation (full-screen, outside the app shell).
// Opens the bundled offline deck (/deck/led-deck-final.html) in a same-origin
// iframe (NO new Chrome tab) + a stopwatch bar. "End Presentation" writes the
// elapsed time to presentation_sessions, shown on the lead timeline + the rep's
// My Performance log. Additive; touches no frozen sales contract (§45).
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Square, Loader2, Radio, MessageCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import {
  startPresentation,
  getActive,
  elapsedSeconds,
  clearPresentation,
  CAP_SECONDS,
} from '../../utils/presentationTimer'

const fmtClock = (s) => {
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}:${String(ss).padStart(2, '0')}`
}

export default function PresentView() {
  const { leadId } = useParams()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  // Start (or resume) the session on mount.
  const [session] = useState(() => startPresentation(leadId))
  const [elapsed, setElapsed] = useState(() => elapsedSeconds(session))
  const [ending, setEnding] = useState(false)
  const [thanksOpen, setThanksOpen] = useState(false)   // Phase 322 — thank-you prompt
  const [sending, setSending] = useState(false)
  const endingRef = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setElapsed(elapsedSeconds(getActive())), 1000)
    return () => clearInterval(t)
  }, [])

  const exit = useCallback(
    () => navigate(leadId ? `/leads/${leadId}` : '/work'),
    [leadId, navigate],
  )

  // End the presentation: log the time (unless it was an accidental <3s open).
  // Both the "End" button and the "Back" arrow call this, so a rep can't lose
  // the timing by exiting the "wrong" way. Phase 322 — only the explicit "End
  // Presentation" button (offerThanks=true) then offers to WhatsApp the customer
  // a thank-you + brochure; the Back arrow just logs and leaves.
  const end = useCallback(async (offerThanks = false) => {
    if (endingRef.current) return
    endingRef.current = true
    setEnding(true)
    const active = getActive()
    const dur = Math.min(elapsedSeconds(active), CAP_SECONDS)
    let logged = false
    try {
      if (active && dur >= 3) {
        const { error } = await supabase.from('presentation_sessions').insert({
          user_id: profile?.id,
          lead_id: leadId || null,
          started_at: new Date(active.startedAt).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: dur,
          source: 'meeting',
        })
        if (error) throw error
        logged = true
        toastSuccess(`Presentation logged · ${fmtClock(dur)}`)
      }
      clearPresentation()
    } catch (e) {
      toastError(e, 'Could not log the presentation time.')
      endingRef.current = false
      setEnding(false)
      return
    }
    // The session is already logged + cleared. Offer the thank-you before
    // leaving (only from the End button, only when there's a real lead).
    if (offerThanks && logged && leadId) {
      setThanksOpen(true)
      setEnding(false)
      return
    }
    exit()
  }, [leadId, profile, exit])

  // Phase 322 — send the "thank you for meeting today" WhatsApp + brochure from
  // the company number. The server (send-template.js, pickKey='meeting_done')
  // resolves phone / template / opt-out, so the client sends only the lead id.
  const sendThanks = useCallback(async () => {
    if (sending) return
    setSending(true)
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const res = await fetch('/api/wa/send-template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s?.access_token || ''}`,
        },
        body: JSON.stringify({ lead_id: leadId, template_key: 'meeting_done' }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok !== false) toastSuccess('Thank-you sent to the customer.')
      else toastError(null, j.detail || j.error || 'Could not send the thank-you.')
    } catch (e) {
      toastError(e, 'Could not send the thank-you.')
    }
    exit()   // the toast shows on the lead page (ToastViewport lives in the shell)
  }, [leadId, sending, exit])

  // Safety net: if the rep leaves via hardware/browser back (no button tap),
  // still log the elapsed time on unmount (fire-and-forget — the view is gone).
  useEffect(() => {
    return () => {
      if (endingRef.current) return
      const active = getActive()
      if (!active) return
      const dur = Math.min(elapsedSeconds(active), CAP_SECONDS)
      clearPresentation()
      if (dur < 3 || !profile?.id) return
      supabase.from('presentation_sessions').insert({
        user_id: profile.id,
        lead_id: leadId || null,
        started_at: new Date(active.startedAt).toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: dur,
        source: 'meeting',
      }).then(() => {}, () => {})
    }
  }, [leadId, profile])

  const capped = elapsed >= CAP_SECONDS

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--bg, #0f172a)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <iframe
        title="GSRTC presentation"
        src="/deck/led-deck-final.html"
        allow="autoplay; fullscreen"
        style={{ flex: 1, width: '100%', border: 0, background: '#0a0a0c' }}
      />
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
          background: 'var(--surface, #1e293b)',
          borderTop: '1px solid var(--border, #334155)',
        }}
      >
        <button
          onClick={() => end(false)}
          aria-label="Back to lead"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 38,
            height: 38,
            borderRadius: 10,
            border: '1px solid var(--border, #334155)',
            background: 'transparent',
            color: 'var(--text, #f1f5f9)',
            cursor: 'pointer',
            flex: '0 0 auto',
          }}
        >
          <ArrowLeft size={18} />
        </button>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontFamily: 'var(--font-sans, system-ui)',
            fontSize: 13,
            fontWeight: 600,
            color: capped ? 'var(--warning, #F59E0B)' : 'var(--success, #10B981)',
          }}
        >
          <Radio size={15} />
          {capped ? 'Max time reached' : 'Presenting'}
        </span>

        <span
          style={{
            fontFamily: 'var(--font-display, Space Grotesk, system-ui)',
            fontSize: 22,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text, #f1f5f9)',
            minWidth: 64,
          }}
        >
          {fmtClock(elapsed)}
        </span>

        <button
          onClick={() => end(true)}
          disabled={ending}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent, #FFE600)',
            color: 'var(--accent-fg, #0f172a)',
            fontFamily: 'var(--font-sans, system-ui)',
            fontSize: 14,
            fontWeight: 700,
            cursor: ending ? 'default' : 'pointer',
            opacity: ending ? 0.7 : 1,
          }}
        >
          {ending ? (
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Square size={15} />
          )}
          End Presentation
        </button>
      </div>

      {/* Phase 322 — after "End Presentation", offer to WhatsApp the customer a
          thank-you + the GSRTC LED brochure from the company number. Inline
          (ConfirmDialogViewport lives in V2AppShell, which /present is outside of). */}
      {thanksOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9100,
            background: 'rgba(2,6,23,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              maxWidth: 420, width: '100%',
              background: 'var(--surface, #1e293b)',
              border: '1px solid var(--border, #334155)',
              borderRadius: 14,
              padding: 20,
              fontFamily: 'var(--font-sans, system-ui)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <MessageCircle size={22} style={{ color: 'var(--success, #10B981)' }} />
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
                Send a thank-you?
              </h3>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted, #94a3b8)' }}>
              Send the customer a WhatsApp thank-you for meeting today, with the GSRTC
              LED brochure — from the company number.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={exit}
                disabled={sending}
                style={{
                  flex: 1, padding: '11px 14px', borderRadius: 10,
                  border: '1px solid var(--border, #334155)', background: 'transparent',
                  color: 'var(--text, #f1f5f9)', fontSize: 14, fontWeight: 600,
                  cursor: sending ? 'default' : 'pointer',
                }}
              >
                Skip
              </button>
              <button
                onClick={sendThanks}
                disabled={sending}
                style={{
                  flex: 1.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '11px 14px', borderRadius: 10, border: 'none',
                  background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
                  fontSize: 14, fontWeight: 700, cursor: sending ? 'default' : 'pointer',
                  opacity: sending ? 0.7 : 1,
                }}
              >
                {sending ? (
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <MessageCircle size={16} />
                )}
                Send thank-you
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
