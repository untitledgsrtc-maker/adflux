// src/pages/v2/WorkV2.jsx
//
// /work — rep's daily home. Three-surface architecture (replaces the
// old A_PLAN / A_CHECKIN / B_ACTIVE / C_CHECKOUT / D_DONE state machine).
//
// Surface 1 — DayStatusSurface (top, always visible)
//   Content gates on session attributes:
//     • plan not submitted          → "Plan today" + voice mic + form + Start My Day
//     • plan submitted, not checked → check-in CTA (+ late-reason if past 9:30)
//     • checked in, day running     → V2Hero progress (meetings / calls / leads)
//     • evening report submitted    → "Day done." summary + check-out CTA if pending
//
// Surface 2 — NextActionSurface (middle, always visible)
//   ONE highest-priority undone item — picks from planned meetings,
//   ranked smart tasks (useLeadTasks), and overdue follow-ups. Single
//   empty-state if nothing is pending.
//
// Surface 3 — StickyLogMeetingCta (bottom, sticky)
//   Fixed Log Meeting CTA. Sits above the mobile bottom nav (76 px).
//   Opens LogMeetingModal.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun, MapPin, Phone, Calendar, Loader2, Trash2, Plus,
  CheckCircle2, Mic, Square, Clock, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
// Pill from LeadShared kept for any consumer below; NextActionCard
// now uses the StatusBadge primitive (supports tints `warning`,
// `blue`, `success` natively; LeadShared.Pill only had `warn`/`success`
// /`danger`/`blue` classes, so `warning`/`info`/`neutral` rendered flat).
// eslint-disable-next-line no-unused-vars
import { Pill } from '../../components/leads/LeadShared'
import TodayTasksPanel from '../../components/leads/TodayTasksPanel'
import MeetingsMapPanel from '../../components/leads/MeetingsMapPanel'
// Phase 35 PR 2.7 — RepDayTools no longer mounted on /work (owner
// asked to drop overnight/leave/test push from the Today panel).
// Import kept (no-op) so the file's import-graph footprint doesn't
// invalidate caches if it returns to a different surface later.
// eslint-disable-next-line no-unused-vars
import RepDayTools from '../../components/leads/RepDayTools'
import { DidYouKnow } from '../../components/v2/DidYouKnow'
import V2Hero from '../../components/v2/V2Hero'
import { ensurePushOnLogin } from '../../utils/pushNotifications'
import LogMeetingModal from '../../components/leads/LogMeetingModal'
import { useLeadTasks } from '../../hooks/useLeadTasks'
import { EmptyState, ActionButton, MonoNumber, StatusBadge } from '../../components/v2/primitives'

const TODAY = () => new Date().toISOString().slice(0, 10)

// Audio chime on save — Web Audio API beep, no asset. Two short tones
// (E5 + A5) ~150 ms total. Plays after meeting save.
function playChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const tones = [659.25, 880.0]
    tones.forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      o.connect(g); g.connect(ctx.destination)
      const t0 = ctx.currentTime + i * 0.09
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12)
      o.start(t0); o.stop(t0 + 0.13)
    })
    setTimeout(() => { try { ctx.close() } catch {} }, 400)
  } catch {}
}

async function captureGps() {
  if (!navigator.geolocation) return null
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, timeout: 5000, maximumAge: 60000,
      })
    })
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy),
    }
  } catch (e) {
    return null
  }
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function cleanPhone(raw) {
  if (!raw) return null
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length === 10 ? '91' + d : d
}

async function edgeFetch(path, body) {
  const { data: { session: authSession } } = await supabase.auth.getSession()
  return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })
}

function appendText(prev, addition) {
  if (!prev?.trim()) return addition
  return `${prev}${prev.endsWith(' ') ? '' : ' '}${addition}`
}

function logGpsPing(userId, gps, source) {
  if (!gps?.lat || !gps?.lng) return
  supabase.from('gps_pings').insert([{
    user_id: userId, lat: gps.lat, lng: gps.lng,
    accuracy_m: gps.accuracy || null, source,
  }]).then(() => {}, () => {})
}

export default function WorkV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [meetingModalOpen, setMeetingModalOpen] = useState(false)
  // Phase 35 PR 2.5 — modal mode: 'meeting' or 'lead'. Same form,
  // different save semantics.
  const [meetingMode, setMeetingMode] = useState('meeting')
  const [pendingNavLead, setPendingNavLead] = useState(null)
  const [toast, setToast] = useState('')

  /* Morning plan draft */
  const [plannedMeetings, setPlannedMeetings] = useState([
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
  ])
  const [plannedCalls, setPlannedCalls] = useState(20)
  const [plannedLeads, setPlannedLeads] = useState(10)
  const [focusArea, setFocusArea] = useState('')

  /* Evening draft */
  const [evening, setEvening] = useState({
    quotes_sent: '', blockers: '', tomorrow_focus: '',
  })

  /* Free-text plan + parse-day-plan state */
  const [planText, setPlanText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [lateReason, setLateReason] = useState('')

  /* Voice dictation */
  const [recState, setRecState] = useState('idle') // 'idle' | 'recording' | 'sending'
  const mediaRecorderRef = useRef(null)
  const recTimerRef = useRef(null)
  const recStreamRef = useRef(null)

  async function startRecording() {
    if (recState !== 'idle') return
    // P0-4: clear any stale auto-stop timer from a previous session.
    if (recTimerRef.current) {
      clearTimeout(recTimerRef.current)
      recTimerRef.current = null
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const chunks = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = async () => {
        // P0-4: clear timer here too — manual stop must release it.
        if (recTimerRef.current) {
          clearTimeout(recTimerRef.current)
          recTimerRef.current = null
        }
        stream.getTracks().forEach(t => t.stop())
        recStreamRef.current = null
        setRecState('sending')
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const buf = await blob.arrayBuffer()
          let bin = ''
          const bytes = new Uint8Array(buf)
          for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
          const audio_base64 = btoa(bin)
          const res = await edgeFetch('voice-process', {
            audio_base64, mime_type: 'audio/webm',
            lead_id: null, duration_seconds: null, mode: 'transcribe_only',
          })
          if (!res.ok) {
            const msg = await res.text().catch(() => '')
            setError('Voice failed: ' + msg.slice(0, 140))
            setRecState('idle')
            return
          }
          const transcript = ((await res.json())?.transcript || '').trim()
          if (transcript) {
            let plan = null
            try {
              const planRes = await edgeFetch('parse-day-plan', { text: transcript, language: 'gu' })
              if (planRes.ok) plan = await planRes.json().catch(() => null)
            } catch (_) { /* fall through to raw transcript */ }
            const corrected = (plan?.transcript_corrected || transcript).trim()
            setPlanText(prev => appendText(prev, corrected))
            if (Array.isArray(plan?.meetings) && plan.meetings.length > 0) {
              setPlannedMeetings(prev => {
                const next = [...prev]
                plan.meetings.forEach(m => {
                  const idx = next.findIndex(s => !s.client && !s.time)
                  const meeting = { time: m.time || '', client: m.client || '', where: m.where || '' }
                  if (idx >= 0) next[idx] = meeting
                  else next.push(meeting)
                })
                return next
              })
            }
            if (plan?.calls_planned > 0) setPlannedCalls(plan.calls_planned)
            if (plan?.new_leads_target > 0) setPlannedLeads(plan.new_leads_target)
            if (plan?.focus && !focusArea) setFocusArea(plan.focus)
          }
        } catch (e) {
          setError('Voice failed: ' + (e?.message || e))
        } finally {
          setRecState('idle')
          mediaRecorderRef.current = null
        }
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecState('recording')
      // 60-s safety auto-stop.
      recTimerRef.current = setTimeout(() => {
        try {
          if (mr.state === 'recording') mr.stop()
        } catch {}
      }, 60_000)
    } catch (e) {
      setError('Microphone access denied or unavailable: ' + (e?.message || e))
    }
  }

  function stopRecording() {
    if (recTimerRef.current) {
      clearTimeout(recTimerRef.current)
      recTimerRef.current = null
    }
    const mr = mediaRecorderRef.current
    if (mr && mr.state === 'recording') {
      try { mr.stop() } catch {}
    }
  }

  // P0-4: cleanup on unmount — release the auto-stop timer and any open stream.
  useEffect(() => () => {
    if (recTimerRef.current) {
      clearTimeout(recTimerRef.current)
      recTimerRef.current = null
    }
    if (recStreamRef.current) {
      try { recStreamRef.current.getTracks().forEach(t => t.stop()) } catch {}
      recStreamRef.current = null
    }
  }, [])

  const isLate = (() => {
    const now = new Date()
    return now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 30)
  })()

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
      .maybeSingle()
    if (err) {
      setError(err.message)
      setSession(null)
    } else {
      setSession(data)
      if (data?.planned_meetings?.length) setPlannedMeetings(data.planned_meetings)
      if (data?.planned_calls) setPlannedCalls(data.planned_calls)
      if (data?.planned_leads) setPlannedLeads(data.planned_leads)
      if (data?.evening_summary?.focus) setFocusArea(data.evening_summary.focus)
      if (data?.evening_summary) setEvening({
        quotes_sent: data.evening_summary.quotes_sent || '',
        blockers: data.evening_summary.blockers || '',
        tomorrow_focus: data.evening_summary.tomorrow_focus || '',
      })
      if (data?.morning_plan_text) setPlanText(data.morning_plan_text)
    }
    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])

  useEffect(() => {
    if (profile?.id) {
      ensurePushOnLogin(profile.id).catch(() => { /* silent */ })
    }
  }, [profile?.id])

  // GPS interval polling while the rep is checked in and the day
  // isn't done. iOS Safari pauses geolocation on backgrounded tabs;
  // gaps on the map are expected. Background GPS needs a Capacitor
  // wrapper, separate phase.
  useEffect(() => {
    if (!profile?.id) return
    if (profile?.role === 'agency') return
    if (!session?.check_in_at) return
    if (session?.evening_report_submitted_at) return
    if (!navigator.geolocation) return

    let cancelled = false

    async function pingOnce(source = 'interval') {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false, timeout: 10000, maximumAge: 60000,
          })
        })
        if (cancelled) return
        await supabase.from('gps_pings').insert([{
          user_id: profile.id,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy || 0) || null,
          source,
        }])
      } catch (e) { /* best-effort */ }
    }

    pingOnce('interval')
    const id = setInterval(() => pingOnce('interval'), 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, session?.check_in_at, session?.evening_report_submitted_at])

  const targets = useMemo(() => {
    return profile?.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
  }, [profile])
  const counters = session?.daily_counters || { meetings: 0, calls: 0, new_leads: 0 }

  /* Submit morning plan */
  async function submitPlan() {
    setBusy(true); setError('')
    const filtered = plannedMeetings.filter(m => m.client.trim())

    let parsedTasks = null
    const text = planText.trim()
    if (text) {
      setParsing(true)
      try {
        const fnRes = await edgeFetch('parse-day-plan', { text })
        if (fnRes.ok) {
          const json = await fnRes.json()
          parsedTasks = Array.isArray(json?.tasks) ? json.tasks : null
        } else {
          console.warn('[parse-day-plan] non-OK', fnRes.status, await fnRes.text().catch(() => ''))
        }
      } catch (e) {
        console.warn('[parse-day-plan] error', e?.message)
      } finally {
        setParsing(false)
      }
    }

    const payload = {
      user_id: profile.id,
      work_date: TODAY(),
      plan_submitted_at: new Date().toISOString(),
      planned_meetings: filtered,
      planned_calls: Number(plannedCalls) || 0,
      planned_leads: Number(plannedLeads) || 0,
      evening_summary: focusArea ? { focus: focusArea } : null,
      morning_plan_text: text || null,
      morning_plan_tasks: parsedTasks,
      morning_plan_submitted_at: text ? new Date().toISOString() : null,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .upsert(payload, { onConflict: 'user_id,work_date' })
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  async function toggleTaskDone(taskId) {
    if (!session?.morning_plan_tasks) return
    const next = session.morning_plan_tasks.map(t =>
      t.id === taskId ? { ...t, done: !t.done } : t
    )
    setBusy(true)
    const { error: err } = await supabase
      .from('work_sessions')
      .update({ morning_plan_tasks: next })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  async function toggleMeetingDone(idx) {
    if (!session?.planned_meetings) return
    // P0-5: capture prev at function start so rollback restores the
    // real pre-toggle state, not whatever closure `session` points at.
    const prev = session
    setBusy(true); setError('')
    const next = prev.planned_meetings.map((m, i) =>
      i === idx ? { ...m, done: !m.done } : m
    )
    const wasDone = !!prev.planned_meetings[idx]?.done
    const nowDone = !wasDone
    const nextCounters = {
      ...(prev.daily_counters || {}),
      meetings: Math.max(0, (prev.daily_counters?.meetings || 0) + (nowDone ? 1 : -1)),
    }
    setSession(p => p ? { ...p, planned_meetings: next, daily_counters: nextCounters } : p)
    const { error: err } = await supabase
      .from('work_sessions')
      .update({ planned_meetings: next, daily_counters: nextCounters })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) {
      setSession(prev)
      setError(err.message)
      return
    }
    load()
  }

  // Collapse plan + check-in into a single "Start My Day" tap.
  async function startDay() {
    if (busy || parsing) return
    setError('')
    if (session?.plan_submitted_at) {
      return doCheckIn()
    }
    const hasMeeting = plannedMeetings.some((m) =>
      (m.client && m.client.trim()) || (m.location && m.location.trim()))
    const hasText = !!(planText && planText.trim())
    const hasNumeric = (Number(plannedCalls) > 0) || (Number(plannedLeads) > 0)
    if (!hasMeeting && !hasText && !hasNumeric) {
      setError('Please add your plan first — tap the mic and speak it, or fill at least one meeting / call target.')
      return
    }
    await submitPlan()
    setTimeout(() => { doCheckIn() }, 100)
  }

  async function doCheckIn() {
    if (isLate && !lateReason.trim()) {
      setError('Please add a reason — check-in is past 9:30 AM.')
      return
    }
    setBusy(true); setError('')
    const gps = await captureGps()
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        check_in_at: new Date().toISOString(),
        check_in_gps_lat: gps?.lat || null,
        check_in_gps_lng: gps?.lng || null,
        check_in_late_reason: isLate ? lateReason.trim() : null,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    logGpsPing(profile.id, gps, 'checkin')
    load()
  }

  async function submitEvening() {
    setBusy(true); setError('')
    const summary = {
      ...(session?.evening_summary || {}),
      quotes_sent: evening.quotes_sent,
      blockers: evening.blockers,
      tomorrow_focus: evening.tomorrow_focus,
      counters,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        evening_report_submitted_at: new Date().toISOString(),
        evening_summary: summary,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  async function doCheckOut() {
    setBusy(true); setError('')
    const gps = await captureGps()
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        check_out_at: new Date().toISOString(),
        check_out_gps_lat: gps?.lat || null,
        check_out_gps_lng: gps?.lng || null,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    logGpsPing(profile.id, gps, 'checkout')
    load()
  }

  // Smart-task feed for the NextActionSurface priority resolver.
  const { tasks: smartTasks } = useLeadTasks({ userId: profile?.id })

  if (loading) {
    return (
      <div className="lead-root">
        <div className="m-screen">
          <div className="m-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ marginTop: 8 }}>Loading work session…</div>
          </div>
        </div>
      </div>
    )
  }

  const dayDone = !!session?.evening_report_submitted_at
  const checkedIn = !!session?.check_in_at
  const planSubmitted = !!session?.plan_submitted_at

  // Phase 36 — gather activity timestamps for the Day Spine. Bin
  // includes logged meetings (from planned_meetings .done=true) +
  // smart tasks completed today. Pure derivation off `session` so
  // the spine updates in lockstep with every save.
  const spineActivities = useMemo(() => {
    const ts = []
    const pm = session?.planned_meetings || []
    for (const m of pm) {
      if (m.done && m.done_at) ts.push(m.done_at)
    }
    // If we ever store per-task completion timestamps in session,
    // append them here. For now the meeting-done timestamps are the
    // canonical activity feed.
    return ts
  }, [session])

  return (
    <div className="lead-root">
      <div className="m-screen">
        {/* Discoverability tip — irrelevant once the day is over. */}
        {!dayDone && (
          <DidYouKnow id="work-voice-plan-2026-05-13" title="Speak your day plan">
            Tap the mic above and say what's on today. AI breaks it into tasks.
            Saves 3-5 minutes vs typing each one.
          </DidYouKnow>
        )}

        {error && (
          <div
            role="alert"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12,
            }}
          >
            <AlertTriangle size={14} strokeWidth={1.6} />
            <span>{error}</span>
          </div>
        )}

        <DayStatusSurface
          session={session}
          profile={profile}
          targets={targets}
          counters={counters}
          plannedMeetings={plannedMeetings}
          setPlannedMeetings={setPlannedMeetings}
          plannedCalls={plannedCalls}
          setPlannedCalls={setPlannedCalls}
          plannedLeads={plannedLeads}
          setPlannedLeads={setPlannedLeads}
          focusArea={focusArea}
          setFocusArea={setFocusArea}
          planText={planText}
          setPlanText={setPlanText}
          evening={evening}
          setEvening={setEvening}
          lateReason={lateReason}
          setLateReason={setLateReason}
          isLate={isLate}
          recState={recState}
          startRecording={startRecording}
          stopRecording={stopRecording}
          busy={busy}
          parsing={parsing}
          startDay={startDay}
          doCheckIn={doCheckIn}
          submitEvening={submitEvening}
          doCheckOut={doCheckOut}
          navigate={navigate}
        />

        {/* Phase 35 PR 2.11 — locked order in B_ACTIVE state:
              V2Hero (in DayStatusSurface above)
              Log meeting + Log lead inline CTAs   ← moved up
              Next-up priority card
              Today's Tasks (smart-task list)
              Map
              Evening summary
            Owner: "need Log meeting + Log lead above Next-up card".
        */}
        <StickyPrimaryCta
          session={session}
          busy={busy}
          parsing={parsing}
          startDay={startDay}
          doCheckIn={doCheckIn}
          submitEvening={submitEvening}
          onOpenMeeting={() => { setMeetingMode('meeting'); setMeetingModalOpen(true) }}
          onOpenLead={() => { setMeetingMode('lead'); setMeetingModalOpen(true) }}
        />

        {checkedIn && !dayDone && (
          <NextActionSurface
            session={session}
            smartTasks={smartTasks}
            navigate={navigate}
            toggleMeetingDone={toggleMeetingDone}
            toggleTaskDone={toggleTaskDone}
            busy={busy}
          />
        )}

        {checkedIn && !dayDone && (
          <>
            <TodayTasksPanel userId={profile.id} limit={3} />
            <MeetingsMapPanel userId={profile.id} />
            <EveningReportBlock
              evening={evening}
              setEvening={setEvening}
              submitEvening={submitEvening}
              busy={busy}
              navigate={navigate}
            />
          </>
        )}
      </div>

      {meetingModalOpen && (
        <LogMeetingModal
          mode={meetingMode}
          onClose={() => {
            setMeetingModalOpen(false)
            // Phase 35 PR 2.5 — direct navigate after save; the
            // WhatsApp prompt step was removed inside the modal.
            if (pendingNavLead) {
              const id = pendingNavLead
              setPendingNavLead(null)
              navigate(`/leads/${id}`)
            }
          }}
          onSaved={(newLeadId, { mode: savedMode } = {}) => {
            const isLeadSave = savedMode === 'lead'
            if (isLeadSave) {
              // Manual lead → bump new_leads counter client-side
              // (no server trigger for this).
              const cur = session?.daily_counters?.new_leads || 0
              const tgt = targets.new_leads || 10
              setToast(`Saved · ${cur + 1}/${tgt} new leads today`)
              if (session) {
                setSession({
                  ...session,
                  daily_counters: {
                    ...(session.daily_counters || {}),
                    new_leads: cur + 1,
                  },
                })
              }
            } else {
              const next = (session?.daily_counters?.meetings || 0) + 1
              const tgt = targets.meetings || 5
              setToast(`Saved · ${next}/${tgt} meetings today`)
            }
            setTimeout(() => setToast(''), 2200)
            playChime()
            load()
            if (newLeadId) setPendingNavLead(newLeadId)
          }}
        />
      )}

      {toast && (
        <div className="m-toast">
          <CheckCircle2 size={16} strokeWidth={2} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}

/* ─── Surface 1: Day status ─────────────────────────────────────── */

function DayStatusSurface(props) {
  const {
    session, targets, counters,
    plannedMeetings, setPlannedMeetings,
    plannedCalls, setPlannedCalls,
    plannedLeads, setPlannedLeads,
    focusArea, setFocusArea,
    planText, setPlanText,
    evening, setEvening,
    lateReason, setLateReason,
    isLate,
    recState, startRecording, stopRecording,
    busy, parsing,
    startDay, doCheckIn, submitEvening, doCheckOut,
    navigate,
  } = props

  const planSubmitted = !!session?.plan_submitted_at
  const checkedIn = !!session?.check_in_at
  const dayDone = !!session?.evening_report_submitted_at
  const checkedOut = !!session?.check_out_at

  // Variant D — day done
  if (dayDone) {
    const tone = (counters.meetings || 0) >= (targets.meetings || 5) ? 'good' : 'warn'
    return (
      <>
        <V2Hero
          eyebrow="Today · day done"
          value="Day done."
          label="Final counters below."
          right={{
            tone: tone === 'good' ? 'up' : 'down',
            text: tone === 'good' ? 'target hit' : `${(targets.meetings || 5) - (counters.meetings || 0)} short`,
          }}
          accent={tone === 'good'}
        />
        <div className="m-counters">
          <Counter num={counters.meetings || 0} target={targets.meetings} label="Meetings" tone={counters.meetings >= targets.meetings ? 'good' : 'warn'} />
          <Counter num={counters.calls || 0} target={targets.calls} label="Calls" tone={counters.calls >= targets.calls ? 'good' : 'warn'} />
          <Counter num={counters.new_leads || 0} target={targets.new_leads} label="Leads" tone={counters.new_leads >= targets.new_leads ? 'good' : 'warn'} />
        </div>
        {session?.evening_summary?.tomorrow_focus && (
          <div className="m-card">
            <div className="m-card-title">Evening summary</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {session?.evening_summary?.quotes_sent ? `${session.evening_summary.quotes_sent} quotes sent. ` : ''}
              {session?.evening_summary?.blockers || ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 8 }}>
              <b>Tomorrow:</b> {session.evening_summary.tomorrow_focus}
            </div>
          </div>
        )}
        {!checkedOut && (
          <ActionButton
            variant="primary"
            size="lg"
            iconLeft={MapPin}
            onClick={doCheckOut}
            disabled={busy}
            loading={busy}
            style={{ width: '100%', marginBottom: 12 }}
          >
            {busy ? 'Capturing GPS…' : 'Check out'}
          </ActionButton>
        )}
        <ActionButton
          variant="ghost"
          size="lg"
          onClick={() => navigate('/leads')}
          style={{ width: '100%' }}
        >
          View my leads
        </ActionButton>
      </>
    )
  }

  // Variant C — checked in, day running
  if (checkedIn) {
    const hitTarget = (counters.meetings || 0) >= (targets.meetings || 5)
    const summary = `${counters.meetings || 0} / ${targets.meetings || 5} meetings`
    return (
      <>
        <V2Hero
          eyebrow={`Today · in progress${session?.check_in_at ? ` · checked in ${formatTime(session.check_in_at)}` : ''}`}
          value={summary}
          label="meetings logged"
          chip={`${counters.calls || 0} calls · ${counters.new_leads || 0} new leads`}
          right={{
            tone: hitTarget ? 'up' : 'down',
            text: hitTarget ? 'target hit' : `${(targets.meetings || 5) - (counters.meetings || 0)} to go`,
          }}
          accent={hitTarget}
        />
        {/* Phase 35 PR 2.6 — EveningReportBlock moved OUT of the
            B_ACTIVE branch of DayStatusSurface. Owner: "i want this
            evening summry in bottome". It now mounts at the bottom of
            the page main flow, below RepDayTools and just above the
            Log meeting / Log lead inline CTAs. */}
      </>
    )
  }

  // Variant B — plan submitted, waiting for check-in
  if (planSubmitted) {
    return (
      <>
        <V2Hero
          eyebrow="Today · ready to start"
          value="Ready to check in"
          label="GPS captures your start location."
        />
        <div className="m-card">
          <div className="m-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} strokeWidth={1.6} style={{ color: 'var(--success)' }} />
            <span>Plan submitted</span>
          </div>
          <PlanSummary session={session} />
        </div>
        {isLate && (
          <div className="m-card" style={{ borderColor: 'var(--warning)' }}>
            <div className="m-card-title">
              <span>Late check-in — please add a reason</span>
            </div>
            <input
              className="lead-inp"
              placeholder="Doctor appointment / Site visit / Traffic…"
              value={lateReason}
              onChange={e => setLateReason(e.target.value)}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Cut-off is 9:30 AM. Admin reviews late reasons in the daily summary.
            </div>
          </div>
        )}
        <ActionButton
          variant="primary"
          size="lg"
          iconLeft={MapPin}
          onClick={doCheckIn}
          disabled={busy || (isLate && !lateReason.trim())}
          loading={busy}
          style={{ width: '100%' }}
        >
          {busy ? 'Capturing GPS…' : 'Check in'}
        </ActionButton>
      </>
    )
  }

  // Variant A — plan today
  return (
    <PlanTodayBlock
      targets={targets}
      plannedMeetings={plannedMeetings}
      setPlannedMeetings={setPlannedMeetings}
      plannedCalls={plannedCalls}
      setPlannedCalls={setPlannedCalls}
      plannedLeads={plannedLeads}
      setPlannedLeads={setPlannedLeads}
      focusArea={focusArea}
      setFocusArea={setFocusArea}
      planText={planText}
      setPlanText={setPlanText}
      recState={recState}
      startRecording={startRecording}
      stopRecording={stopRecording}
      busy={busy}
      parsing={parsing}
      startDay={startDay}
    />
  )
}

function PlanTodayBlock(props) {
  const {
    targets,
    plannedMeetings, setPlannedMeetings,
    plannedCalls, setPlannedCalls,
    plannedLeads, setPlannedLeads,
    focusArea, setFocusArea,
    planText, setPlanText,
    recState, startRecording, stopRecording,
    busy, parsing,
    startDay,
  } = props

  return (
    <>
      <V2Hero
        eyebrow="Today · plan the day"
        value={`${targets.meetings || 5} meetings`}
        label="set the bar before you start"
        chip={`${targets.calls || 0} calls · ${targets.new_leads || 0} new leads`}
      />
      <ActionButton
        variant="primary"
        size="lg"
        iconLeft={Sun}
        onClick={startDay}
        disabled={busy || parsing}
        loading={busy || parsing}
        style={{ width: '100%', marginBottom: 16, minHeight: 56, fontSize: 16 }}
      >
        {(busy || parsing) ? 'Starting…' : 'Start My Day'}
      </ActionButton>

      <div className="m-card" style={{ padding: 0 }}>
        <div style={{
          padding: '14px 16px 8px',
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
            fontWeight: 700, fontSize: 16, color: 'var(--text)',
          }}>
            <Sun size={18} style={{ color: 'var(--accent, #FFE600)' }} />
            <span>Plan today</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Speak in Gujarati / Hindi / English, or fill the form below.
          </div>
        </div>
        <div style={{ padding: '14px 16px 16px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px',
            background: 'var(--accent-soft, rgba(255,230,0,0.14))',
            border: '1px solid var(--accent, #FFE600)',
            borderRadius: 10, marginBottom: 14,
          }}>
            <button
              type="button"
              onClick={recState === 'recording' ? stopRecording : startRecording}
              disabled={recState === 'sending' || busy || parsing}
              style={{
                width: 48, height: 48, borderRadius: '50%',
                background: recState === 'recording' ? 'var(--danger, #EF4444)' : 'var(--accent, #FFE600)',
                color: recState === 'recording' ? '#fff' : '#0f172a',
                border: 'none', cursor: 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label={recState === 'recording' ? 'Stop' : 'Speak plan'}
            >
              {recState === 'sending'
                ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                : recState === 'recording'
                  ? <Square size={18} strokeWidth={2} />
                  : <Mic size={20} strokeWidth={1.8} />}
            </button>
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                {recState === 'recording'
                  ? 'Listening… tap to stop'
                  : recState === 'sending'
                    ? 'Reading your plan…'
                    : 'Tap to speak today\'s plan'}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                Gujarati / Hindi / English — AI fills meetings + calls below.
              </div>
            </div>
          </div>

          <label className="lead-fld-label">Planned meetings</label>
          {plannedMeetings.map((m, i) => (
            <div key={i} className="m-meeting-row">
              <input
                className="lead-inp m-time-inp"
                type="time"
                style={{ width: 108, padding: '10px 10px', fontSize: 14, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)' }}
                value={m.time}
                onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, time: e.target.value } : x))}
              />
              <div className="info" style={{ display: 'grid', gap: 6 }}>
                <input
                  className="lead-inp"
                  placeholder="Client"
                  style={{ padding: '10px 12px', fontSize: 14 }}
                  value={m.client}
                  onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, client: e.target.value } : x))}
                />
                <input
                  className="lead-inp"
                  placeholder="Where"
                  style={{ padding: '8px 12px', fontSize: 13 }}
                  value={m.location}
                  onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
                />
              </div>
              <button
                type="button"
                className="lead-btn lead-btn-sm"
                onClick={() => setPlannedMeetings(prev => prev.filter((_, j) => j !== i))}
                aria-label="Remove"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="lead-btn lead-btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => setPlannedMeetings(prev => [...prev, { client: '', time: '', location: '' }])}
          >
            <Plus size={12} /> Add another
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
            <div>
              <label className="lead-fld-label">Calls planned</label>
              <input
                className="lead-inp"
                type="number"
                value={plannedCalls}
                onChange={e => setPlannedCalls(e.target.value)}
              />
            </div>
            <div>
              <label className="lead-fld-label">New leads target</label>
              <input
                className="lead-inp"
                type="number"
                value={plannedLeads}
                onChange={e => setPlannedLeads(e.target.value)}
              />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="lead-fld-label">Focus area</label>
            <input
              className="lead-inp"
              value={focusArea}
              onChange={e => setFocusArea(e.target.value)}
              placeholder="Close Sunrise · push 2 quotes"
            />
          </div>

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border, rgba(255,255,255,.06))' }}>
            <label className="lead-fld-label">
              Today's plan in your words (Gujarati / Hindi / English)
            </label>
            <textarea
              className="lead-inp"
              rows={4}
              value={planText}
              onChange={e => setPlanText(e.target.value)}
              placeholder="આજે રાજેશ ને મળવા જવું છે 11 વાગ્યે, પછી 5 cold calls કરવી છે, અને Patel ને quote send કરવી છે…"
              style={{ resize: 'vertical', minHeight: 90 }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Optional. Use the mic above, or type. We'll turn it into a checklist.
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function EveningReportBlock({ evening, setEvening, submitEvening, busy, navigate }) {
  return (
    <>
      <ActionButton
        variant="primary"
        size="lg"
        iconLeft={Mic}
        onClick={() => navigate('/voice/evening')}
        style={{ width: '100%', minHeight: 64, marginTop: 14, marginBottom: 14 }}
      >
        Speak evening summary
      </ActionButton>
      <details className="m-card" style={{ padding: 0 }}>
        <summary style={{
          padding: '12px 16px', cursor: 'pointer',
          fontSize: 13, color: 'var(--text-muted)', fontWeight: 500,
        }}>
          Type instead
        </summary>
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label className="lead-fld-label">Quotes sent today</label>
              <input
                className="lead-inp"
                type="number"
                value={evening.quotes_sent}
                onChange={e => setEvening(prev => ({ ...prev, quotes_sent: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <label className="lead-fld-label">Blockers</label>
              <textarea
                className="lead-inp"
                rows={2}
                value={evening.blockers}
                onChange={e => setEvening(prev => ({ ...prev, blockers: e.target.value }))}
                placeholder="What stopped you closing?"
              />
            </div>
            <div>
              <label className="lead-fld-label">Tomorrow focus</label>
              <input
                className="lead-inp"
                value={evening.tomorrow_focus}
                onChange={e => setEvening(prev => ({ ...prev, tomorrow_focus: e.target.value }))}
                placeholder="Sunrise close, push 2 quotes"
              />
            </div>
          </div>
          <ActionButton
            variant="primary"
            size="md"
            onClick={submitEvening}
            disabled={busy}
            loading={busy}
            style={{ width: '100%', marginTop: 12 }}
          >
            Submit typed report
          </ActionButton>
        </div>
      </details>
    </>
  )
}

/* ─── Surface 2: Next action ────────────────────────────────────── */

function pickNextAction({ session, smartTasks }) {
  // 1. Planned meeting with closest non-empty time, !done.
  const meetings = (session?.planned_meetings || [])
    .map((m, idx) => ({ ...m, idx }))
    .filter(m => !m.done && (m.client?.trim() || m.location?.trim()))
  if (meetings.length > 0) {
    const withTime = meetings.filter(m => m.time)
    const pick = withTime.length
      ? withTime.slice().sort((a, b) => a.time.localeCompare(b.time))[0]
      : meetings[0]
    return { kind: 'meeting', data: pick }
  }
  // 2. Highest-heat / highest-priority smart task (the hook already sorts).
  const openSmart = (smartTasks || []).find(t => t.status === 'open' || t.status === undefined)
  if (openSmart) {
    return { kind: 'smart', data: openSmart }
  }
  // 3. Most overdue plan task from the parsed checklist.
  const planTasks = (session?.morning_plan_tasks || []).filter(t => !t.done)
  if (planTasks.length > 0) {
    return { kind: 'plan', data: planTasks[0] }
  }
  return null
}

function NextActionCard({ tone, title, subtitle, meta, primary, secondary }) {
  return (
    <div className="m-card" style={{
      borderColor: 'var(--accent, #FFE600)',
      background: 'rgba(255,230,0,0.04)',
    }}>
      <div className="m-card-title">
        <span>Next up</span>
        <StatusBadge tint={tone.tint}>{tone.label}</StatusBadge>
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>
          {subtitle}
        </div>
      )}
      {meta && <div style={{ marginTop: 4 }}>{meta}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <ActionButton
          variant={primary.variant || 'primary'}
          size="md"
          iconLeft={primary.icon}
          onClick={primary.onClick}
          disabled={primary.disabled}
          style={{ flex: 1, minWidth: 120 }}
        >
          {primary.label}
        </ActionButton>
        <ActionButton variant="ghost" size="md" onClick={secondary.onClick}>
          {secondary.label}
        </ActionButton>
      </div>
    </div>
  )
}

function NextActionSurface({ session, smartTasks, navigate, toggleMeetingDone, toggleTaskDone, busy }) {
  const pick = pickNextAction({ session, smartTasks })

  if (!pick) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Day is clear"
        sub="Send a quote or add a lead while you have a minute."
        action={{ label: 'Add lead', onClick: () => navigate('/leads/new') }}
      />
    )
  }

  if (pick.kind === 'meeting') {
    const m = pick.data
    const meta = (
      <>
        {m.time && (
          <span style={{
            fontSize: 13, color: 'var(--accent)', marginRight: 12,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Clock size={14} strokeWidth={1.6} />
            <MonoNumber>{m.time}</MonoNumber>
          </span>
        )}
        {m.location && (
          <span style={{
            fontSize: 12, color: 'var(--text-muted)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <MapPin size={14} strokeWidth={1.6} />
            {m.location}
          </span>
        )}
      </>
    )
    return (
      <NextActionCard
        tone={{ tint: 'warning', label: 'meeting' }}
        title={m.client || 'Meeting'}
        meta={meta}
        primary={{ icon: CheckCircle2, label: 'Done', onClick: () => toggleMeetingDone(m.idx), disabled: busy }}
        secondary={{ label: 'Open leads', onClick: () => navigate('/leads') }}
      />
    )
  }

  if (pick.kind === 'smart') {
    const t = pick.data
    const lead = t.lead || {}
    const phone = cleanPhone(lead.phone)
    const title = (
      <>
        {lead.name || 'Lead'}
        {lead.company && (
          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {lead.company}</span>
        )}
      </>
    )
    return (
      <NextActionCard
        tone={{ tint: 'blue', label: 'smart task' }}
        title={title}
        subtitle={t.reason}
        primary={phone
          ? { icon: Phone, label: 'Call', onClick: () => { window.location.href = `tel:+${phone}` } }
          : { variant: 'subtle', label: 'No phone', disabled: true, onClick: () => {} }
        }
        secondary={{ label: 'Open', onClick: () => navigate(`/leads/${t.lead_id || lead.id}`) }}
      />
    )
  }

  // kind === 'plan'
  const p = pick.data
  const meta = (
    <span style={{
      fontSize: 11, color: 'var(--text-subtle)',
      textTransform: 'uppercase', letterSpacing: '.08em',
    }}>
      {p.type}{p.due_time ? ` · ${p.due_time}` : ''}
    </span>
  )
  return (
    <NextActionCard
      tone={{ tint: 'neutral', label: 'plan task' }}
      title={p.title}
      meta={meta}
      primary={{ icon: CheckCircle2, label: 'Done', onClick: () => toggleTaskDone(p.id), disabled: busy }}
      secondary={{ label: 'Open leads', onClick: () => navigate('/leads') }}
    />
  )
}

/* ─── Surface 3: sticky Log Meeting CTA ─────────────────────────── */

// State-aware sticky bottom CTA. Single button that always shows the
// rep's NEXT primary action, picked from session attributes. Owner UX
// feedback: when the plan form was scrolled, the in-card Start My Day
// button slid off-screen and there was no submit button visible above
// the bottom nav. Sticky CTA below the scroll content fixes that —
// rep types plan, sees the CTA pinned at the bottom of the viewport.
function StickyPrimaryCta({
  session, busy, parsing,
  startDay, doCheckIn, submitEvening,
  onOpenMeeting, onOpenLead,
}) {
  const planSubmitted = !!session?.plan_submitted_at
  const checkedIn     = !!session?.check_in_at
  const dayDone       = !!session?.evening_report_submitted_at
  const eveningSent   = !!session?.evening_summary

  // Phase 35 PR 2.5 — B_ACTIVE state shows TWO sticky CTAs side by
  // side (Log meeting + Log lead). Every other state shows a single
  // primary CTA appropriate to the state.
  const isActiveState = planSubmitted && checkedIn && !dayDone

  let label = 'Log meeting'
  let icon = Calendar
  let handler = onOpenMeeting
  let isBusy = busy
  let loading = false

  if (!planSubmitted) {
    label   = (busy || parsing) ? 'Starting…' : 'Start My Day'
    icon    = Sun
    handler = startDay
    isBusy  = busy || parsing
    loading = busy || parsing
  } else if (!checkedIn) {
    label   = busy ? 'Capturing GPS…' : 'Check in'
    icon    = MapPin
    handler = doCheckIn
    isBusy  = busy
    loading = busy
  } else if (!dayDone) {
    // Falls through to two-button render below.
  } else if (!eveningSent) {
    label   = busy ? 'Submitting…' : 'Submit evening report'
    icon    = CheckCircle2
    handler = submitEvening
    isBusy  = busy
    loading = busy
  } else {
    return null
  }

  return (
    // Phase 35 PR 2.6 — inline (NOT sticky / NOT fixed) per owner
    // directive. Earlier iterations tried sticky (didn't pin) and
    // fixed (worked but owner preferred inline flow). CTAs sit at
    // the end of the scroll content, after EveningReportBlock.
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
      {isActiveState ? (
        <>
          <ActionButton
            variant="primary"
            size="lg"
            iconLeft={Calendar}
            onClick={onOpenMeeting}
            disabled={busy}
            style={{ flex: 1, minHeight: 52 }}
          >
            Log meeting
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="lg"
            iconLeft={Plus}
            onClick={onOpenLead}
            disabled={busy}
            style={{ flex: 1, minHeight: 52, background: 'var(--surface)' }}
          >
            Log lead
          </ActionButton>
        </>
      ) : (
        <ActionButton
          variant="primary"
          size="lg"
          iconLeft={icon}
          onClick={handler}
          disabled={isBusy}
          loading={loading}
          style={{ width: '100%', minHeight: 52 }}
        >
          {label}
        </ActionButton>
      )}
    </div>
  )
}

/* ─── Small helpers ─────────────────────────────────────────────── */

function Counter({ num, target, label, tone }) {
  const color = tone === 'good' ? 'var(--success)'
              : tone === 'warn' ? 'var(--warning)'
              : undefined
  return (
    <div className="m-count">
      <div className="num" style={color ? { color } : undefined}>
        <MonoNumber>{num}</MonoNumber>
        {target ? <span className="target">/<MonoNumber>{target}</MonoNumber></span> : null}
      </div>
      <div className="lbl">{label}</div>
    </div>
  )
}

function PlanSummary({ session }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
      <span>
        {(session.planned_meetings || []).length} meetings · {session.planned_calls} calls · {session.planned_leads} new leads
      </span>
      {session.evening_summary?.focus && (
        <span>Focus: {session.evening_summary.focus}</span>
      )}
    </div>
  )
}
