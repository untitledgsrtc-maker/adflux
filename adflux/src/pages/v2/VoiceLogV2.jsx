// src/pages/v2/VoiceLogV2.jsx
//
// Phase 20 — Voice-First V1 (real, not placeholder).
//
// Flow:
//   1. Pick a lead (preselect via location.state or query string)
//   2. Tap mic → MediaRecorder starts
//   3. Tap stop → audio captured, base64-encoded, posted to the
//      voice-process Edge Function
//   4. Function transcribes (Whisper) + classifies (Claude) +
//      inserts lead_activities row
//   5. Show transcript + classified result + link to lead
//
// Mobile-first. Browser audio support: Chrome desktop/Android works
// out of the box; iOS Safari supports MediaRecorder since iOS 14.5.
// Microphone permission must be granted by the user the first time.
//
// All work happens in a single sync request — typical 30s clip
// round-trips in 5–10 seconds. No background queueing in V1.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Mic, Square, Loader2, CheckCircle2,
  AlertTriangle, ChevronRight, RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { Pill } from '../../components/leads/LeadShared'

const MAX_SECONDS = 60
const FUNCTION_PATH = '/functions/v1/voice-process'

const LANG_HINTS = [
  { key: 'gu', label: 'Gujarati' },
  { key: 'hi', label: 'Hindi' },
  { key: 'en', label: 'English' },
]

export default function VoiceLogV2() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const profile = useAuthStore(s => s.profile)

  const initialLeadId = params.get('lead') || null

  const [leads, setLeads]     = useState([])
  const [leadId, setLeadId]   = useState(initialLeadId)
  const [langHint, setLangHint] = useState('gu')

  // Recorder state
  const [phase, setPhase] = useState('idle') // idle|recording|recorded|sending|done|error
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioMime, setAudioMime] = useState('audio/webm')

  // Result
  const [result, setResult] = useState(null)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const tickRef = useRef(null)
  const chunksRef = useRef([])

  // Load leads the rep can target. RLS limits the list automatically.
  useEffect(() => {
    supabase.from('leads')
      .select('id, name, company, phone, stage, segment')
      .order('created_at', { ascending: false })
      .limit(80)
      .then(({ data, error: err }) => {
        if (err) {
          setError('Could not load your leads: ' + err.message)
          return
        }
        setLeads(data || [])
      })
  }, [])

  const lead = useMemo(
    () => leads.find(l => l.id === leadId) || null,
    [leads, leadId]
  )

  /* ─── Recorder controls ─── */
  async function startRecording() {
    setError('')
    setResult(null)
    setAudioBlob(null)
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Your browser does not support audio recording. Try Chrome on Android or Safari on iOS.')
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow it in your browser, then try again.'
          : 'Could not open the microphone: ' + (e?.message || e),
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
      setError('No supported audio format found in this browser.')
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
      setPhase(prev => (prev === 'recording' ? 'recorded' : prev))
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    mr.start()
    setPhase('recording')
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

  function resetAll() {
    setPhase('idle')
    setSeconds(0)
    setAudioBlob(null)
    setResult(null)
    setError('')
  }

  /* ─── Send to edge function ─── */
  async function sendToProcess() {
    if (!audioBlob) { setError('Record something first.'); return }
    setError('')
    setPhase('sending')
    try {
      const base64 = await blobToBase64(audioBlob)
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
          audio_base64:     base64,
          mime_type:        audioMime,
          lead_id:          leadId || null,
          duration_seconds: seconds,
          language_hint:    langHint || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPhase('error')
        setError(json?.error || `Edge function failed (${res.status})`)
        return
      }
      setResult(json)
      setPhase('done')
    } catch (e) {
      setPhase('error')
      setError('Send failed: ' + (e?.message || e))
    }
  }

  /* ─── Render ─── */
  return (
    <div className="lead-root">
      <button
        className="lead-btn lead-btn-sm"
        onClick={() => navigate(leadId ? `/leads/${leadId}` : '/leads')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={12} /> {leadId ? 'Back to lead' : 'Back to leads'}
      </button>

      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Voice-First · Gujarati / Hindi / English</div>
          <div className="lead-page-title">Voice Log</div>
          <div className="lead-page-sub">
            Speak naturally. We transcribe (Whisper) and classify (Claude) — you review and save.
          </div>
        </div>
      </div>

      {/* Lead picker */}
      <div className="lead-card lead-card-pad" style={{ marginBottom: 12 }}>
        <label className="lead-fld-label">Logging for which lead?</label>
        <select
          className="lead-inp"
          value={leadId || ''}
          onChange={e => setLeadId(e.target.value || null)}
          disabled={phase === 'recording' || phase === 'sending'}
        >
          <option value="">— pick a lead (or leave empty for an orphan note) —</option>
          {leads.map(l => (
            <option key={l.id} value={l.id}>
              {l.name}{l.company ? ` · ${l.company}` : ''}{l.stage ? ` · ${l.stage}` : ''}
            </option>
          ))}
        </select>

        <label className="lead-fld-label" style={{ marginTop: 12 }}>Language hint</label>
        <div className="lead-radio-grp">
          {LANG_HINTS.map(l => (
            <span
              key={l.key}
              className={`opt ${langHint === l.key ? 'on' : ''}`}
              onClick={() => phase === 'idle' && setLangHint(l.key)}
              style={{ cursor: phase === 'idle' ? 'pointer' : 'not-allowed' }}
            >
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Recorder card */}
      <div className="voice-card" style={{ textAlign: 'center', padding: 24 }}>
        {phase === 'idle' && (
          <>
            <span className="voice-pill"><span className="mic" /> Ready</span>
            <button
              type="button"
              className="voice-mic"
              style={{ width: 96, height: 96, margin: '20px auto 14px', cursor: 'pointer' }}
              onClick={startRecording}
              aria-label="Start recording"
            >
              <Mic size={36} />
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Tap to start. Up to {MAX_SECONDS}s.
            </div>
          </>
        )}

        {phase === 'recording' && (
          <>
            <span className="voice-pill"><span className="mic" /> Listening · {LANG_HINTS.find(l => l.key === langHint)?.label}</span>
            <button
              type="button"
              className="voice-mic live"
              style={{ width: 96, height: 96, margin: '20px auto 14px', cursor: 'pointer' }}
              onClick={stopRecording}
              aria-label="Stop recording"
            >
              <Square size={32} />
            </button>
            <div className="wave-big">
              {Array.from({ length: 20 }).map((_, i) => <span key={i} />)}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--purple)' }}>
              {fmt(seconds)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4, letterSpacing: '.12em', textTransform: 'uppercase' }}>
              Tap to stop
            </div>
          </>
        )}

        {phase === 'recorded' && (
          <>
            <span className="voice-pill"><CheckCircle2 size={11} style={{ marginRight: 4 }} /> Recorded · {fmt(seconds)}</span>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0' }}>
              Ready to send. We'll transcribe and classify.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="lead-btn" onClick={resetAll}>Re-record</button>
              <button className="lead-btn lead-btn-primary" onClick={sendToProcess}>
                Send <ChevronRight size={12} />
              </button>
            </div>
          </>
        )}

        {phase === 'sending' && (
          <>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--purple)' }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
              Transcribing and classifying… typically 5–10 seconds.
            </div>
          </>
        )}

        {phase === 'done' && result && (
          <ResultPanel
            result={result}
            leadId={leadId}
            onRecordAnother={resetAll}
            onView={() => leadId && navigate(`/leads/${leadId}`)}
          />
        )}

        {phase === 'error' && (
          <>
            <AlertTriangle size={28} style={{ color: 'var(--danger)' }} />
            <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8, lineHeight: 1.5 }}>
              {error}
            </div>
            <button className="lead-btn" onClick={resetAll} style={{ marginTop: 14 }}>
              <RefreshCw size={12} /> Try again
            </button>
          </>
        )}
      </div>

      {error && phase !== 'error' && (
        <div
          style={{
            marginTop: 12,
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

/* ─── Result panel ─── */
function ResultPanel({ result, leadId, onRecordAnother, onView }) {
  const c = result.classified || {}
  return (
    <div style={{ textAlign: 'left' }}>
      <div className="voice-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <CheckCircle2 size={11} /> Saved · language {result.language || 'unknown'}
      </div>

      <div className="m-card" style={{ marginTop: 14 }}>
        <div className="m-card-title">Transcript</div>
        <div className="guj-quote" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
          {result.transcript}
        </div>
      </div>

      <div className="m-card" style={{ marginTop: 12 }}>
        <div className="m-card-title">AI extracted</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <Row label="Type"     value={c.activity_type || '—'} />
          <Row label="Outcome"  value={
            <Pill tone={
              c.outcome === 'positive' ? 'success' :
              c.outcome === 'negative' ? 'danger' : 'info'
            }>{c.outcome || 'neutral'}</Pill>
          } />
          {c.notes && <Row label="Summary" value={c.notes} stack />}
          {c.next_action && <Row label="Next" value={c.next_action + (c.next_action_date ? ` · ${c.next_action_date}` : '')} />}
        </div>
      </div>

      {result.warning && (
        <div
          style={{
            marginTop: 12, background: 'var(--warning-soft)',
            border: '1px solid var(--warning)', color: 'var(--warning)',
            borderRadius: 10, padding: '10px 14px', fontSize: 12,
          }}
        >
          {result.warning}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="lead-btn" onClick={onRecordAnother}>
          <Mic size={12} /> Record another
        </button>
        {leadId && result.activity_id && (
          <button className="lead-btn lead-btn-primary" onClick={onView}>
            View lead <ChevronRight size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, stack }) {
  return (
    <div style={{
      display: stack ? 'block' : 'flex',
      alignItems: 'center', gap: 8,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.1em', minWidth: 70, display: 'inline-block' }}>
        {label}
      </span>
      <span>{value}</span>
    </div>
  )
}

/* ─── helpers ─── */
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
      // strip the data: prefix the function tolerates either way
      const idx = s.indexOf(',')
      resolve(idx >= 0 ? s.slice(idx + 1) : s)
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
