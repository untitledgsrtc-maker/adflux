// src/components/voice/VoiceInput.jsx
//
// Phase 33C (11 May 2026) — reusable mic-enabled input. Wraps any
// <input> or <textarea> and adds a microphone button next to it. Tap
// mic → MediaRecorder records up to 60s → posts to voice-process Edge
// Function with mode='transcribe_only' → shows transcript for 3s with
// a Re-record button (transcript confirm) → appends to the field on
// confirm.
//
// Props:
//   value, onChange       — controlled input contract
//   multiline             — render textarea (default: input)
//   placeholder, type, rows
//   languageHint          — 'gu' / 'hi' / 'en' (default 'gu' for OOH
//                           Surat field reps); enables Claude script
//                           correction in voice-process when 'gu'.

import { useRef, useState, useEffect } from 'react'
import { Mic, Square, Loader2, RefreshCw, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const RECORDING_MAX_MS = 60_000  // 60s cap

export default function VoiceInput({
  value, onChange,
  multiline = false,
  placeholder = '',
  type = 'text',
  rows = 3,
  languageHint = 'gu',
  disabled = false,
}) {
  const [state, setState] = useState('idle')   // idle | recording | sending | confirm | error
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const [confirmMs, setConfirmMs] = useState(3000)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const stopTimerRef = useRef(null)
  const confirmTimerRef = useRef(null)

  // Cleanup on unmount.
  useEffect(() => () => {
    try { mediaRef.current?.stop() } catch {}
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    if (confirmTimerRef.current) clearInterval(confirmTimerRef.current)
  }, [])

  async function startRecording() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        sendForTranscription(blob, mr.mimeType || 'audio/webm')
      }
      mr.start()
      mediaRef.current = mr
      setState('recording')
      stopTimerRef.current = setTimeout(() => {
        try { mr.state === 'recording' && mr.stop() } catch {}
      }, RECORDING_MAX_MS)
    } catch (e) {
      setError('Mic permission denied. Allow microphone in browser settings.')
      setState('error')
    }
  }

  function stopRecording() {
    try {
      const mr = mediaRef.current
      if (mr && mr.state === 'recording') mr.stop()
    } catch {}
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null }
  }

  async function sendForTranscription(blob, mime) {
    setState('sending')
    try {
      // Convert to base64.
      const reader = new FileReader()
      const b64 = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(String(reader.result || '').split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const { data: { session } } = await supabase.auth.getSession()
      const url = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/voice-process`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          audio_base64:  b64,
          mime_type:     mime,
          mode:          'transcribe_only',
          language_hint: languageHint,
        }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error('Transcribe failed: ' + txt.slice(0, 200))
      }
      const j = await res.json()
      const text = (j.transcript || '').trim()
      if (!text) throw new Error('No speech detected. Try again.')
      setTranscript(text)
      setState('confirm')
      setConfirmMs(3000)
      confirmTimerRef.current = setInterval(() => {
        setConfirmMs(m => {
          if (m <= 100) { acceptTranscript(text); return 0 }
          return m - 100
        })
      }, 100)
    } catch (e) {
      setError(e.message || 'Transcribe error')
      setState('error')
    }
  }

  function acceptTranscript(textOverride) {
    if (confirmTimerRef.current) { clearInterval(confirmTimerRef.current); confirmTimerRef.current = null }
    const text = textOverride || transcript
    const merged = (value || '').trim()
      ? (value || '').trim() + ' ' + text
      : text
    onChange?.(merged)
    setTranscript('')
    setState('idle')
  }

  function redoTranscript() {
    if (confirmTimerRef.current) { clearInterval(confirmTimerRef.current); confirmTimerRef.current = null }
    setTranscript('')
    setState('idle')
    setTimeout(startRecording, 50)  // small delay so the state propagates
  }

  function cancelConfirm() {
    if (confirmTimerRef.current) { clearInterval(confirmTimerRef.current); confirmTimerRef.current = null }
    setTranscript('')
    setState('idle')
  }

  const InputComp = multiline ? 'textarea' : 'input'
  const inputProps = multiline
    ? { rows }
    : { type }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <InputComp
          {...inputProps}
          className="lead-inp"
          value={value || ''}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || state === 'recording' || state === 'sending'}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={state === 'recording' ? stopRecording : startRecording}
          disabled={disabled || state === 'sending' || state === 'confirm'}
          title={state === 'recording' ? 'Stop recording' : 'Speak'}
          style={{
            width: 44,
            background: state === 'recording'
              ? 'var(--danger, #EF4444)'
              : 'var(--accent, #FFE600)',
            color: state === 'recording'
              ? '#fff'
              : 'var(--accent-fg, #0f172a)',
            border: 0, borderRadius: 8,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            alignSelf: multiline ? 'flex-start' : 'stretch',
          }}
        >
          {state === 'sending'
            ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            : state === 'recording'
              ? <Square size={14} />
              : <Mic size={16} />}
        </button>
      </div>

      {/* Phase 33C — transcript confirm strip. Shown for 3s after
          transcription. Auto-accepts when timer hits 0; rep can also
          tap ✓ now or 🔁 re-record. */}
      {state === 'confirm' && (
        <div style={{
          marginTop: 6,
          padding: '8px 10px',
          background: 'rgba(255,230,0,0.08)',
          border: '1px solid var(--accent, #FFE600)',
          borderRadius: 8,
          fontSize: 12,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>{transcript}</span>
          <button
            type="button"
            onClick={() => acceptTranscript()}
            title="Accept now"
            style={{
              background: 'var(--success, #10B981)', color: '#fff',
              border: 0, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <Check size={12} /> {Math.ceil(confirmMs / 1000)}s
          </button>
          <button
            type="button"
            onClick={redoTranscript}
            title="Re-record"
            style={{
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border-strong)',
              padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <RefreshCw size={12} /> Redo
          </button>
          <button
            type="button"
            onClick={cancelConfirm}
            title="Discard"
            style={{
              background: 'transparent', color: 'var(--text-subtle)',
              border: 0, cursor: 'pointer', fontSize: 11,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>{error}</div>
      )}
    </div>
  )
}
