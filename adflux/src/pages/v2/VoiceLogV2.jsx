// src/pages/v2/VoiceLogV2.jsx
//
// Phase 22 — Voice-First V2.
//
// Rebuilt to match the design source at
// _design_reference/Leads/lead-voice.jsx (MVoiceListening, MVoiceConfirm).
// The flow is now THREE distinct screens, not one state machine:
//
//   pick       → choose a lead, pick language hint, tap to start
//   listening  → big voice mic + animated wave + timer
//   sending    → small spinner while Whisper + Claude do their work
//   confirm    → bilingual transcript card (.guj-quote + .en) +
//                AI-extracted review (Outcome chips, Next action +
//                Amount inputs, Stage dropdown, GPS pill) +
//                "Looks good · save log" / "Re-record" CTAs
//   done       → quick success card with "View lead" / "Record another"
//
// Edge function still inserts the lead_activity automatically so the
// activity row exists by the time the rep gets to Confirm. Re-record
// deletes that row; Looks-good UPDATEs it with the rep's edits and
// optionally moves the lead stage if Claude suggested one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Mic, Square, Loader2, CheckCircle2,
  AlertTriangle, ChevronRight, RefreshCw, MapPin,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const MAX_SECONDS = 60
const FUNCTION_PATH = '/functions/v1/voice-process'

const LANG_HINTS = [
  { key: 'gu', label: 'Gujarati' },
  { key: 'hi', label: 'Hindi' },
  { key: 'en', label: 'English' },
]

// Phase 30A — collapsed to 5 stages.
const STAGE_OPTIONS = [
  '', 'Working', 'QuoteSent', 'Won', 'Lost',
]

export default function VoiceLogV2() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const profile = useAuthStore(s => s.profile)

  const initialLeadId = params.get('lead') || null

  /* ─── Phase state ─── */
  const [phase, setPhase] = useState('pick') // pick | listening | sending | confirm | done | error
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')

  /* ─── Lead + language ─── */
  const [leads, setLeads] = useState([])
  const [leadId, setLeadId] = useState(initialLeadId)
  const [langHint, setLangHint] = useState('gu')

  /* ─── Recording ─── */
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioMime, setAudioMime] = useState('audio/webm')
  const [gps, setGps] = useState(null)

  /* ─── Confirm screen edit state ─── */
  const [result, setResult] = useState(null)
  const [editOutcome, setEditOutcome] = useState('neutral')
  const [editNextAction, setEditNextAction] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editStage, setEditStage] = useState('')
  const [saving, setSaving] = useState(false)

  /* ─── Recorder refs ─── */
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const tickRef = useRef(null)
  const chunksRef = useRef([])

  /* ─── Load assignable leads ─── */
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

  /* ─── GPS capture (silent, fail-open) ─── */
  async function captureGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null
    try {
      const pos = await new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: false, timeout: 4000, maximumAge: 60000,
        })
      })
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
      }
    } catch { return null }
  }

  /* ─── Recorder ─── */
  async function startRecording() {
    setError('')
    setResult(null)
    setAudioBlob(null)
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Your browser does not support audio recording. Use Chrome on Android or Safari on iOS.')
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
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    // Silent GPS — capture in parallel; doesn't block recording
    captureGps().then(setGps)

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

  // When the recorder finishes (audioBlob set after stopRecording), send.
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
          audio_base64:     base64,
          mime_type:        audioMime,
          lead_id:          leadId || null,
          duration_seconds: seconds,
          language_hint:    langHint || null,
          gps_lat:          gps?.lat ?? null,
          gps_lng:          gps?.lng ?? null,
          gps_accuracy_m:   gps?.accuracy ?? null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPhase('error')
        setError(json?.error || `Edge function failed (${res.status})`)
        return
      }
      // Hydrate Confirm-screen edit fields from Claude's classification
      const c = json.classified || {}
      setResult(json)
      setEditOutcome(c.outcome || 'neutral')
      setEditNextAction(c.next_action || '')
      setEditAmount(c.amount ? String(c.amount) : '')
      setEditStage(c.stage_to || '')
      setPhase('confirm')
    } catch (e) {
      setPhase('error')
      setError('Send failed: ' + (e?.message || e))
    }
  }

  /* ─── Save (Looks good) ─── */
  async function saveLog() {
    if (!result?.activity_id) {
      setError('Activity row missing — cannot save edits.')
      return
    }
    setSaving(true)
    setError('')

    // 1. Update the activity row with the rep's confirmed values.
    const patch = {
      outcome:     editOutcome || null,
      next_action: editNextAction.trim() || null,
    }
    const { error: actErr } = await supabase
      .from('lead_activities')
      .update(patch)
      .eq('id', result.activity_id)
    if (actErr) {
      setSaving(false)
      setError('Could not save edits: ' + actErr.message)
      return
    }

    // 2. If Claude suggested a stage and rep kept it, move the lead.
    if (editStage && lead) {
      const { error: stgErr } = await supabase
        .from('leads')
        .update({ stage: editStage })
        .eq('id', lead.id)
      if (stgErr) {
        // Don't block save — surface a warning but continue
        console.warn('[voice] stage move failed:', stgErr)
      }
    }

    // 3. Update voice_logs with the user-confirmed amount (audit only)
    if (result.voice_log_id) {
      const finalAmount = Number(editAmount) || 0
      const final = { ...(result.classified || {}),
        outcome: editOutcome,
        next_action: editNextAction || '',
        amount: finalAmount,
        stage_to: editStage || '',
      }
      await supabase
        .from('voice_logs')
        .update({ classified: final })
        .eq('id', result.voice_log_id)
    }

    setSaving(false)
    setPhase('done')
  }

  /* ─── Re-record: delete activity, return to listening ─── */
  async function reRecord() {
    if (result?.activity_id) {
      await supabase.from('lead_activities').delete().eq('id', result.activity_id)
    }
    if (result?.voice_log_id) {
      await supabase.from('voice_logs').delete().eq('id', result.voice_log_id)
    }
    setResult(null)
    setAudioBlob(null)
    setSeconds(0)
    setPhase('pick')
  }

  function backToStart() {
    setResult(null)
    setAudioBlob(null)
    setSeconds(0)
    setError('')
    setPhase('pick')
  }

  /* ─── Render ─── */
  return (
    <div className="lead-root">
      {/* Mobile preview frame keeps the page readable on desktop */}
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
          {phase === 'pick' && (
            <PickScreen
              leads={leads}
              leadId={leadId} setLeadId={setLeadId}
              langHint={langHint} setLangHint={setLangHint}
              onBack={() => navigate(leadId ? `/leads/${leadId}` : '/leads')}
              onStart={startRecording}
              error={error}
            />
          )}

          {phase === 'listening' && (
            <ListeningScreen
              leadName={lead?.name || 'lead'}
              langLabel={LANG_HINTS.find(l => l.key === langHint)?.label || 'Gujarati'}
              seconds={seconds}
              onStop={stopRecording}
            />
          )}

          {phase === 'sending' && (
            <SendingScreen />
          )}

          {phase === 'confirm' && result && (
            <ConfirmScreen
              leadName={lead?.name || 'lead'}
              result={result}
              gps={gps}
              seconds={seconds}
              editOutcome={editOutcome}     setEditOutcome={setEditOutcome}
              editNextAction={editNextAction} setEditNextAction={setEditNextAction}
              editAmount={editAmount}       setEditAmount={setEditAmount}
              editStage={editStage}         setEditStage={setEditStage}
              saving={saving}
              onSave={saveLog}
              onReRecord={reRecord}
              error={error}
            />
          )}

          {phase === 'done' && (
            <DoneScreen
              leadId={lead?.id}
              onView={() => lead && navigate(`/leads/${lead.id}`)}
              onAnother={backToStart}
            />
          )}

          {phase === 'error' && (
            <ErrorScreen
              error={error}
              onRetry={backToStart}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Sub-screens
   ───────────────────────────────────────────────── */

function PickScreen({ leads, leadId, setLeadId, langHint, setLangHint, onBack, onStart, error }) {
  // Phase 31D — owner reported (9 May 2026) the lead picker was an
  // 80-row alphabetical-ish dropdown that was unusable on mobile. Now
  // a typeahead: type to filter by name / company / phone, and the
  // list below is recent-first (load order from useEffect already
  // returns DESC by created_at). Picking a row sets leadId.
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return leads
    return leads.filter(l => {
      const hay = `${l.name || ''} ${l.company || ''} ${l.phone || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [leads, filter])
  const selectedLead = leads.find(l => l.id === leadId) || null

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <button className="lead-btn lead-btn-sm" onClick={onBack} style={{ padding: '4px 8px' }}>
          <ArrowLeft size={12} />
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Voice log · pick lead + language
        </span>
      </div>

      <div className="m-card">
        <div className="m-card-title">Logging for which lead?</div>

        {selectedLead && (
          <div
            style={{
              marginTop: 8, padding: '8px 12px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedLead.name}
                {selectedLead.company ? ` · ${selectedLead.company}` : ''}
              </div>
              {selectedLead.stage && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedLead.stage}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLeadId(null)}
              style={{
                background: 'transparent', border: 0, color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 11, padding: '4px 8px',
              }}
            >
              Change
            </button>
          </div>
        )}

        {!selectedLead && (
          <>
            <input
              type="text"
              className="lead-inp"
              placeholder="Type to search by name, company, or phone…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ marginTop: 8 }}
              autoFocus
            />
            <div
              style={{
                marginTop: 8,
                maxHeight: 240,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface)',
              }}
            >
              {filtered.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No leads match "{filter}". Leave empty for an orphan note.
                </div>
              )}
              {filtered.slice(0, 30).map(l => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => { setLeadId(l.id); setFilter('') }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 12px', background: 'transparent',
                    border: 0, borderBottom: '1px solid var(--border)',
                    color: 'var(--text)', cursor: 'pointer', fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {l.name}{l.company ? ` · ${l.company}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {l.stage || '—'}{l.phone ? ` · ${l.phone}` : ''}
                  </div>
                </button>
              ))}
              {filtered.length > 30 && (
                <div style={{ padding: 8, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Showing 30 of {filtered.length}. Type to narrow.
                </div>
              )}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              Or leave it empty — you can always file a quick voice note without a lead and link it later.
            </div>
          </>
        )}

        <div className="lead-fld-label" style={{ marginTop: 14 }}>Language hint</div>
        <div className="lead-radio-grp">
          {LANG_HINTS.map(l => (
            <span
              key={l.key}
              className={`opt ${langHint === l.key ? 'on' : ''}`}
              onClick={() => setLangHint(l.key)}
              style={{ cursor: 'pointer' }}
            >
              {l.label}
            </span>
          ))}
        </div>
      </div>

      <div className="voice-card" style={{ textAlign: 'center', padding: 24, marginTop: 12 }}>
        <span className="voice-pill"><span className="mic" /> Ready</span>
        <button
          type="button"
          className="voice-mic"
          style={{ width: 96, height: 96, margin: '20px auto 14px', cursor: 'pointer', border: 0 }}
          onClick={onStart}
          aria-label="Start recording"
        >
          <Mic size={36} />
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Tap to start. Up to {MAX_SECONDS}s. Speak naturally.
        </div>
      </div>

      {error && <ErrBanner text={error} />}
    </>
  )
}

function ListeningScreen({ leadName, langLabel, seconds, onStop }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <ArrowLeft size={14} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Logging call · {leadName}
        </span>
      </div>

      <div className="voice-card" style={{ textAlign: 'center', padding: 24 }}>
        <span className="voice-pill"><span className="mic" /> Listening · {langLabel}</span>
        <button
          type="button"
          className="voice-mic live"
          style={{ width: 96, height: 96, margin: '20px auto 14px', cursor: 'pointer', border: 0 }}
          onClick={onStop}
          aria-label="Stop recording"
        >
          <Square size={32} />
        </button>
        <div className="wave-big">
          {Array.from({ length: 20 }).map((_, i) => <span key={i} />)}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--purple)' }}>
          {fmt(seconds)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          Tap to stop
        </div>
      </div>

      <div className="m-card" style={{ marginTop: 12 }}>
        <div className="m-card-title">Live transcript</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Recording… transcript will appear here once you stop.
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>
          Speak naturally — the system understands Gujarati, Hindi, and English.
        </div>
      </div>
    </>
  )
}

function SendingScreen() {
  return (
    <div className="voice-card" style={{ textAlign: 'center', padding: 36 }}>
      <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--purple)' }} />
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 14 }}>
        Transcribing and classifying…
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6 }}>
        Typically 5–10 seconds.
      </div>
    </div>
  )
}

function ConfirmScreen({
  leadName, result, gps, seconds,
  editOutcome, setEditOutcome,
  editNextAction, setEditNextAction,
  editAmount, setEditAmount,
  editStage, setEditStage,
  saving, onSave, onReRecord, error,
}) {
  const transcriptGu = result.transcript || ''
  const transcriptEn = result.classified?.transcript_en || ''
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <ArrowLeft size={14} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Confirm log · {leadName}
        </span>
      </div>

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

      {/* AI extracted · review */}
      <div className="m-card">
        <div className="m-card-title">AI extracted · review</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Outcome chips */}
          <div>
            <div className="lead-fld-label">Outcome</div>
            <div className="lead-radio-grp">
              <span
                className={`opt ${editOutcome === 'positive' ? 'on pos' : ''}`}
                onClick={() => setEditOutcome('positive')}
                style={{ cursor: 'pointer' }}
              >
                Positive
              </span>
              <span
                className={`opt ${editOutcome === 'neutral' ? 'on' : ''}`}
                onClick={() => setEditOutcome('neutral')}
                style={{ cursor: 'pointer' }}
              >
                Neutral
              </span>
              <span
                className={`opt ${editOutcome === 'negative' ? 'on neg' : ''}`}
                onClick={() => setEditOutcome('negative')}
                style={{ cursor: 'pointer' }}
              >
                Negative
              </span>
            </div>
          </div>

          {/* Next action + Amount side-by-side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="lead-fld-label">Next action</div>
              <input
                className="lead-inp"
                value={editNextAction}
                onChange={e => setEditNextAction(e.target.value)}
                placeholder="Send quote"
              />
            </div>
            <div>
              <div className="lead-fld-label">Amount</div>
              <input
                className="lead-inp"
                value={editAmount}
                onChange={e => setEditAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="₹3,80,000"
                inputMode="numeric"
              />
            </div>
          </div>

          {/* Move stage to */}
          <div>
            <div className="lead-fld-label">Move stage to</div>
            <select
              className="lead-inp"
              value={editStage}
              onChange={e => setEditStage(e.target.value)}
            >
              <option value="">— don't move —</option>
              {STAGE_OPTIONS.filter(Boolean).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* GPS pill */}
          {gps && (
            <span
              className="lead-pill"
              style={{
                alignSelf: 'flex-start',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'var(--surface-3, rgba(255,255,255,.04))',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                padding: '4px 10px', borderRadius: 999, fontSize: 11,
              }}
            >
              <MapPin size={11} />
              GPS · {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)} · ±{gps.accuracy}m
            </span>
          )}
        </div>
      </div>

      <button
        className="m-cta"
        onClick={onSave}
        disabled={saving}
        style={{ marginTop: 14 }}
      >
        {saving
          ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} /> Saving…</>
          : <>Looks good · save log</>}
      </button>
      <button
        className="m-cta m-cta-ghost"
        onClick={onReRecord}
        disabled={saving}
        style={{ marginTop: 8 }}
      >
        Re-record
      </button>

      {error && <ErrBanner text={error} />}
    </>
  )
}

function DoneScreen({ leadId, onView, onAnother }) {
  return (
    <>
      <div className="voice-card" style={{ textAlign: 'center', padding: 28 }}>
        <CheckCircle2 size={36} style={{ color: 'var(--success)' }} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, marginTop: 10 }}>
          Saved
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Activity logged on the lead's timeline.
        </div>
      </div>

      <button className="m-cta" onClick={onView} style={{ marginTop: 14 }} disabled={!leadId}>
        View lead <ChevronRight size={14} />
      </button>
      <button className="m-cta m-cta-ghost" onClick={onAnother} style={{ marginTop: 8 }}>
        <Mic size={14} /> Record another
      </button>
    </>
  )
}

function ErrorScreen({ error, onRetry }) {
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
      const idx = s.indexOf(',')
      resolve(idx >= 0 ? s.slice(idx + 1) : s)
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
