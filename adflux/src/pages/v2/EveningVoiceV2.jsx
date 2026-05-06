// src/pages/v2/EveningVoiceV2.jsx
//
// Phase 22 Sprint C — Voice-First Evening Report.
//
// Matches the design at _design_reference/Leads/lead-voice.jsx
// (MEveningReport). Rep speaks a 20-30 second end-of-day summary;
// edge function (mode='evening') runs Whisper + Claude with a
// dedicated prompt that returns:
//
//   { transcript_en, highlights, blockers, tomorrow_focus,
//     quotes_sent, pipeline_added }
//
// We render the AI summary card (Highlights / Blockers / Tomorrow split)
// per design and let the rep tap "Submit report" to PATCH today's
// work_sessions.evening_summary row + flip
// evening_report_submitted_at.
//
// Route: /voice/evening. Reachable from /work B_ACTIVE state via a
// "Speak summary" CTA (added in a later commit).

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Mic, Square, Loader2, CheckCircle2,
  AlertTriangle, ChevronRight, RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { Pill } from '../../components/leads/LeadShared'

const MAX_SECONDS = 60
const FUNCTION_PATH = '/functions/v1/voice-process'
const TODAY = () => new Date().toISOString().slice(0, 10)

export default function EveningVoiceV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const [phase, setPhase] = useState('pick') // pick | listening | sending | confirm | done | error
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioMime, setAudioMime] = useState('audio/webm')
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const tickRef = useRef(null)
  const chunksRef = useRef([])

  const niceTime = new Date().toLocaleString('en-IN', {
    weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  })

  /* ─── Recorder ─── */
  async function startRecording() {
    setError('')
    setResult(null)
    setAudioBlob(null)
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Your browser does not support audio recording.')
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow it and try again.'
          : 'Could not open microphone: ' + (e?.message || e),
      )
      return
    }
    streamRef.current = stream

    let mr
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
    for (const t of candidates) {
      if (!t || (window.MediaRecorder && MediaRecorder.isTypeSupported(t))) {
        try { mr = new MediaRecorder(stream, t ? { mimeType: t } : undefined); break }
        catch { /* try next */ }
      }
    }
    if (!mr) {
      setError('No supported audio format in this browser.')
      stream.getTracks().forEach(t => t.stop())
      return
    }
    mediaRecorderRef.current = mr
    chunksRef.current = []
    setAudioMime(mr.mimeType || 'audio/webm')

    mr.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
      setAudioBlob(blob)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    mr.start()
    setPhase('listening')
    setSeconds(0)
    tickRef.current = setInterval(() => {
      setSeconds(s => {
        if (s + 1 >= MAX_SECONDS) {
          stopRecording()
          return MAX_SECONDS
        }
        return s + 1
      })
    }, 1000)
  }

  function stopRecording() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
  }

  // Auto-send once recording stops
  useEffect(() => {
    if (phase === 'listening' && audioBlob) {
      sendToProcess(audioBlob)
    }
    /* eslint-disable-next-line */
  }, [audioBlob])

  async function sendToProcess(blob) {
    if (!blob) return
    setError('')
    setPhase('sending')
    try {
      const base64 = await blobToBase64(blob)
      const { data: sess } = await supabase.auth.getSession()
      const accessToken = sess?.session?.access_token
      const fnUrl = (supabase.supabaseUrl || '') + FUNCTION_PATH
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'content-type':  'application/json',
          'authorization': `Bearer ${accessToken}`,
          'apikey':        supabase.supabaseKey || '',
        },
        body: JSON.stringify({
          mode:             'evening',
          audio_base64:     base64,
          mime_type:        audioMime,
          duration_seconds: seconds,
          language_hint:    'gu',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPhase('error')
        setError(json?.error || `Edge function failed (${res.status})`)
        return
      }
      setResult(json)
      setPhase('confirm')
    } catch (e) {
      setPhase('error')
      setError('Send failed: ' + (e?.message || e))
    }
  }

  /* ─── Submit report → write to work_sessions.evening_summary ─── */
  async function submitReport() {
    if (!result) return
    setSubmitting(true)
    setError('')
    const c = result.classified || {}
    const summary = {
      transcript_gu:   result.transcript || '',
      transcript_en:   c.transcript_en || '',
      highlights:      c.highlights || '',
      blockers:        c.blockers || '',
      tomorrow_focus:  c.tomorrow_focus || '',
      quotes_sent:     Number(c.quotes_sent) || 0,
      pipeline_added:  Number(c.pipeline_added) || 0,
      submitted_via:   'voice',
      voice_log_id:    result.voice_log_id || null,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        evening_report_submitted_at: new Date().toISOString(),
        evening_summary: summary,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setSubmitting(false)
    if (err) {
      setError('Could not save: ' + err.message)
      return
    }
    setPhase('done')
  }

  function reRecord() {
    setResult(null)
    setAudioBlob(null)
    setSeconds(0)
    setError('')
    setPhase('pick')
  }

  /* ─── Render ─── */
  return (
    <div className="lead-root">
      <div
        style={{
          maxWidth: 460, margin: '0 auto',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 24, padding: 4,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div className="m-screen" style={{ borderRadius: 20, padding: 18 }}>
          {/* Greeting bar — always visible */}
          <div className="m-greet">
            <div>
              <div className="hello">Evening report</div>
              <div className="date">{niceTime} · check-out</div>
            </div>
            <Pill tone="info">
              <Mic size={10} style={{ marginRight: 4 }} /> AI
            </Pill>
          </div>

          {phase === 'pick' && (
            <PickEvening onBack={() => navigate('/work')} onStart={startRecording} error={error} />
          )}
          {phase === 'listening' && (
            <ListeningEvening seconds={seconds} onStop={stopRecording} />
          )}
          {phase === 'sending' && <SendingEvening />}
          {phase === 'confirm' && result && (
            <ConfirmEvening
              result={result}
              seconds={seconds}
              submitting={submitting}
              onSubmit={submitReport}
              onReRecord={reRecord}
              error={error}
            />
          )}
          {phase === 'done' && (
            <DoneEvening onBack={() => navigate('/work')} />
          )}
          {phase === 'error' && (
            <ErrorEvening error={error} onRetry={reRecord} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Sub-screens ─── */

function PickEvening({ onBack, onStart, error }) {
  return (
    <>
      <button
        className="lead-btn lead-btn-sm"
        onClick={onBack}
        style={{ marginBottom: 14, padding: '4px 10px' }}
      >
        <ArrowLeft size={12} /> Back
      </button>

      <div className="voice-card" style={{ textAlign: 'center', padding: 24 }}>
        <span className="voice-pill">
          <span className="mic" /> Speak summary · 30s
        </span>
        <button
          type="button"
          className="voice-mic"
          style={{ width: 64, height: 64, margin: '14px auto', cursor: 'pointer', border: 0 }}
          onClick={onStart}
          aria-label="Start recording"
        >
          <Mic size={24} />
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Tap to start. Talk for 20–30 seconds about your day —
          what you closed, what's stuck, what's next tomorrow.
        </div>
      </div>

      {error && <ErrBanner text={error} />}
    </>
  )
}

function ListeningEvening({ seconds, onStop }) {
  return (
    <div className="voice-card" style={{ textAlign: 'center', padding: 24 }}>
      <span className="voice-pill">
        <span className="mic" /> Listening · Gujarati
      </span>
      <button
        type="button"
        className="voice-mic live"
        style={{ width: 64, height: 64, margin: '14px auto', cursor: 'pointer', border: 0 }}
        onClick={onStop}
        aria-label="Stop recording"
      >
        <Square size={24} />
      </button>
      <div className="wave-big">
        {Array.from({ length: 20 }).map((_, i) => <span key={i} />)}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--purple)' }}>
        {fmt(seconds)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4, letterSpacing: '.12em', textTransform: 'uppercase' }}>
        Tap to stop
      </div>
    </div>
  )
}

function SendingEvening() {
  return (
    <div className="voice-card" style={{ textAlign: 'center', padding: 36 }}>
      <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--purple)' }} />
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 14 }}>
        Summarising your day…
      </div>
    </div>
  )
}

function ConfirmEvening({ result, seconds, submitting, onSubmit, onReRecord, error }) {
  const c = result.classified || {}
  const transcriptGu = result.transcript || ''
  const transcriptEn = c.transcript_en || ''
  return (
    <>
      {/* Bilingual transcript card */}
      <div className="voice-card" style={{ marginBottom: 12 }}>
        <span className="voice-pill" style={{ marginBottom: 8 }}>
          <CheckCircle2 size={11} style={{ marginRight: 4 }} />
          Transcribed · {fmt(seconds)}
        </span>
        <div className="guj-quote">
          {transcriptGu}
          {transcriptEn && (
            <span className="en">EN · {transcriptEn}</span>
          )}
        </div>
      </div>

      {/* AI summary card with Highlights/Blockers/Tomorrow split */}
      <div className="m-card">
        <div className="m-card-title">
          <span>AI summary</span>
          <Pill tone="success">approved</Pill>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          {c.highlights && (
            <div style={{ marginBottom: 6 }}>
              <b style={{ color: 'var(--text)' }}>Highlights:</b> {c.highlights}
            </div>
          )}
          {c.blockers && (
            <div style={{ marginBottom: 6 }}>
              <b style={{ color: 'var(--text)' }}>Blockers:</b> {c.blockers}
            </div>
          )}
          {c.tomorrow_focus && (
            <div>
              <b style={{ color: 'var(--text)' }}>Tomorrow:</b> {c.tomorrow_focus}
            </div>
          )}
          {!c.highlights && !c.blockers && !c.tomorrow_focus && (
            <div style={{ color: 'var(--text-subtle)' }}>
              AI couldn't extract a clean summary. Try recording again with
              clearer mention of meetings, blockers, and tomorrow's plan.
            </div>
          )}
        </div>
      </div>

      <button
        className="m-cta"
        onClick={onSubmit}
        disabled={submitting}
        style={{ marginTop: 14 }}
      >
        {submitting
          ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} /> Saving…</>
          : <>Submit report</>}
      </button>
      <button
        className="m-cta m-cta-ghost"
        onClick={onReRecord}
        disabled={submitting}
        style={{ marginTop: 8 }}
      >
        Re-record
      </button>

      {error && <ErrBanner text={error} />}
    </>
  )
}

function DoneEvening({ onBack }) {
  return (
    <>
      <div className="voice-card" style={{ textAlign: 'center', padding: 28 }}>
        <CheckCircle2 size={36} style={{ color: 'var(--success)' }} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, marginTop: 10 }}>
          Report submitted
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Saved to your work session. Check out when you're ready.
        </div>
      </div>
      <button className="m-cta" onClick={onBack} style={{ marginTop: 14 }}>
        Back to today <ChevronRight size={14} />
      </button>
    </>
  )
}

function ErrorEvening({ error, onRetry }) {
  return (
    <div className="voice-card" style={{ textAlign: 'center', padding: 28 }}>
      <AlertTriangle size={32} style={{ color: 'var(--danger)' }} />
      <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10, lineHeight: 1.5 }}>
        {error}
      </div>
      <button className="lead-btn" onClick={onRetry} style={{ marginTop: 14 }}>
        <RefreshCw size={12} /> Try again
      </button>
    </div>
  )
}

function ErrBanner({ text }) {
  return (
    <div
      style={{
        marginTop: 12,
        background: 'var(--danger-soft)',
        border: '1px solid var(--danger)',
        color: 'var(--danger)',
        borderRadius: 10, padding: '10px 14px', fontSize: 13,
      }}
    >
      {text}
    </div>
  )
}

function fmt(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => {
      const s = String(r.result || '')
      const idx = s.indexOf(',')
      resolve(idx >= 0 ? s.slice(idx + 1) : s)
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
