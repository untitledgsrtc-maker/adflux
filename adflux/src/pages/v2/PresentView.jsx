// Phase 181 — in-app GSRTC presentation (full-screen, outside the app shell).
// Opens the bundled offline deck (/deck/led-deck-final.html) in a same-origin
// iframe (NO new Chrome tab) + a stopwatch bar. "End Presentation" writes the
// elapsed time to presentation_sessions, shown on the lead timeline + the rep's
// My Performance log. Additive; touches no frozen sales contract (§45).
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Square, Loader2, Radio } from 'lucide-react'
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
  const endingRef = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setElapsed(elapsedSeconds(getActive())), 1000)
    return () => clearInterval(t)
  }, [])

  // End the presentation: log the time (unless it was an accidental <3s open),
  // then go to the lead. Both the "End" button and the "Back" arrow call this,
  // so a rep can't lose the timing by exiting the "wrong" way.
  const end = useCallback(async () => {
    if (endingRef.current) return
    endingRef.current = true
    setEnding(true)
    const active = getActive()
    const dur = Math.min(elapsedSeconds(active), CAP_SECONDS)
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
        toastSuccess(`Presentation logged · ${fmtClock(dur)}`)
      }
      clearPresentation()
    } catch (e) {
      toastError(e, 'Could not log the presentation time.')
      endingRef.current = false
      setEnding(false)
      return
    }
    navigate(leadId ? `/leads/${leadId}` : '/work')
  }, [leadId, profile, navigate])

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
          onClick={end}
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
          onClick={end}
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
    </div>
  )
}
