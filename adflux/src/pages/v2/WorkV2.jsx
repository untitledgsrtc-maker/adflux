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
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Sun, MapPin, Phone, Calendar, Loader2, Trash2, Plus,
  CheckCircle2, Mic, Square, Clock, AlertTriangle, X,
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
import TodaySummaryCard from '../../components/leads/TodaySummaryCard'
import MeetingsMapPanel from '../../components/leads/MeetingsMapPanel'
// Phase 35 PR 2.7 — RepDayTools no longer mounted on /work (owner
// asked to drop overnight/leave/test push from the Today panel).
// Import kept (no-op) so the file's import-graph footprint doesn't
// invalidate caches if it returns to a different surface later.
// eslint-disable-next-line no-unused-vars
import RepDayTools from '../../components/leads/RepDayTools'
import { pushToast } from '../../components/v2/Toast'
import V2Hero from '../../components/v2/V2Hero'
import LogMeetingModal from '../../components/leads/LogMeetingModal'
// Phase 34Z.51 — bring the LeadDetailV2 call-outcome flow to the
// /work Next-up smart-task card. Tapping Call on the card now inserts
// the lead_activities row, fires the tel:, and opens the outcome modal
// 1.5s later — same chain that LeadDetailV2 uses. After save, the
// stage-aware WhatsApp prompt fires.
import PostCallOutcomeModal from '../../components/leads/PostCallOutcomeModal'
import WhatsAppPromptModal from '../../components/leads/WhatsAppPromptModal'
import { useLeadTasks } from '../../hooks/useLeadTasks'
import useAutoRefresh from '../../hooks/useAutoRefresh'
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
  // Phase 34Z.43 — re-run load() on every navigate-back to /work
  // (location.key changes per navigation). Owner reported saves
  // don't reflect until manual reload because /work was retaining
  // state from before the navigate-away.
  const location = useLocation()
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

  // Phase 34Z.51 — call-outcome modal state for the Next-up smart-task
  // Call button. Mirrors the LeadDetailV2 chain: tel: fires, activity
  // row inserted, modal opens 1.5s later, save chains into the
  // WhatsApp prompt. callLead holds the full lead row so the modal +
  // WA prompt have the same context they'd have on lead detail.
  const [postCallOpen, setPostCallOpen] = useState(false)
  const [pendingActivityId, setPendingActivityId] = useState(null)
  const [callLead, setCallLead] = useState(null)
  const [waPrompt, setWaPrompt] = useState(null)
  // Phase 34Z.54 — track which smart-task row triggered the call so
  // we can close it from the outcome modal's onSaved callback. Owner
  // reported the task stayed on /work after capturing the outcome.
  const [callTaskId, setCallTaskId] = useState(null)

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
      // Phase 34Z.80 — drop hardcoded `audio/webm` mimeType. iOS
      // Safari MediaRecorder ONLY supports `audio/mp4`; the forced
      // webm option threw NotSupportedError and the morning voice
      // plan was silently broken for every iOS rep. Let the browser
      // pick its native format and read `mr.mimeType` after start
      // for the blob + edge-fn payload. Whisper accepts both.
      const mr = new MediaRecorder(stream)
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
          const recMime = mr.mimeType || 'audio/webm'
          const blob = new Blob(chunks, { type: recMime })
          const buf = await blob.arrayBuffer()
          let bin = ''
          const bytes = new Uint8Array(buf)
          for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
          const audio_base64 = btoa(bin)
          const res = await edgeFetch('voice-process', {
            audio_base64, mime_type: recMime,
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
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id, location.key])
  // Phase 34Z.59 — also refetch on tab-resume (return from dialer /
  // WhatsApp / Log meeting modal). location.key only fires on
  // in-app router navigation, not on browser-level resume.
  useAutoRefresh(load, { enabled: !!profile?.id })

  // Phase 34Z.70 — fix #17: ensurePushOnLogin call moved to
  // V2AppShell (Phase 34Z.69) so every rep-facing page enrolls,
  // not just /work. Toast-on-failure logic moved into the shell
  // too — see V2AppShell.jsx. This useEffect is intentionally
  // empty here (kept as a marker so blame still points at the
  // intent + history).

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

    // Phase 34Z.7 — iOS Safari pauses geolocation when tab backgrounds.
    // True background tracking needs a Capacitor wrapper (separate
    // phase). Cheap mitigation: when the rep brings the app back to
    // the foreground, fire a ping immediately instead of waiting for
    // the next 5-min tick. Closes the most painful gaps without any
    // native code. Owner directive (14 May 2026) — "fetch his
    // geolocation every five to ten minutes... I want it perfect."
    function handleVisible() {
      if (document.visibilityState === 'visible') {
        // Phase 34Z.10 — gps_pings.source CHECK enum only allows
        // ('checkin','interval','checkout','manual'). 'resume' 400s.
        // Use 'interval' since a visibility-resume ping is the same
        // semantic as the regular 5-min auto-ping.
        pingOnce('interval')
      }
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
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
          const detail = await fnRes.text().catch(() => '')
          console.warn('[parse-day-plan] non-OK', fnRes.status, detail)
          // Phase 34Z.9 — surface to user too. Plan still saves even if
          // AI parsing fails, so this is informational not blocking.
          pushToast('AI couldn\'t parse the plan — saved your text as-is.', 'warning')
        }
      } catch (e) {
        console.warn('[parse-day-plan] error', e?.message)
        pushToast('AI plan parser unreachable — saved your text as-is.', 'warning')
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

  // Phase 34Z.51 — quick-log a call from the Next-up smart-task card.
  // Mirrors LeadDetailV2.quickLog('call', ...): inserts a lead_activities
  // row, captures the id, fires the tel: link, and schedules the
  // PostCallOutcomeModal 1.5s later. The setTimeout(0) wrapper around
  // the insert keeps the user-gesture intact so iOS Safari hands off
  // to the dialer reliably (same trick LeadDetailV2 uses).
  async function quickLogCall(lead, taskId = null) {
    if (!lead?.id || !profile?.id) return
    const phone = cleanPhone(lead.phone)
    if (!phone) {
      pushToast('No phone on this lead — tap Open and add the mobile number first.', 'danger')
      return
    }
    setCallLead(lead)
    setCallTaskId(taskId)
    // Fire the dialer immediately on the user gesture, then queue the
    // activity insert + modal on the next event-loop tick.
    window.location.href = `tel:+${phone}`
    setTimeout(async () => {
      const { data: actRow, error: insErr } = await supabase
        .from('lead_activities')
        .insert([{
          lead_id:       lead.id,
          activity_type: 'call',
          outcome:       null,
          notes:         `Call → ${lead.phone}`,
          created_by:    profile.id,
        }])
        .select('id')
        .single()
      if (insErr) {
        pushToast(`Could not log call: ${insErr.message}`, 'danger')
        return
      }
      setPendingActivityId(actRow?.id || null)
      setTimeout(() => setPostCallOpen(true), 1500)
    }, 0)
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
  // Phase 34Z.54 — also grab complete + skip so the Next-up card can
  // (a) close itself when the rep saves an outcome, (b) expose a
  // manual dismiss (X) for tasks the rep doesn't want to action.
  // Phase 34Z.79 — completeSmartTask no longer destructured; modal
  // handles task close via direct UPDATE. Keep `skip` for the
  // manual dismiss-X path on NextActionSurface.
  const { tasks: smartTasks, skip: skipSmartTask } = useLeadTasks({ userId: profile?.id })
  // Phase 34Z.47 — compute the Next-up pick once at parent scope so
  // both NextActionSurface (uses it as the hero) and TodayTasksPanel
  // (excludes the duplicate row) read the same reference. Owner
  // reported the same lead appearing twice — once as "Next up", once
  // as the first row in TODAY'S TASKS.
  const nextActionPick = useMemo(
    () => pickNextAction({ session, smartTasks }),
    [session, smartTasks]
  )
  const nextUpSmartId = nextActionPick?.kind === 'smart' ? nextActionPick.data?.id : null

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

  return (
    <div className="lead-root">
      <div className="m-screen">
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

        {/* Phase 34Z.61 — today's load at a glance. Owner directive:
            "When checking in the today page, somebody should show
            there. Like today you have 10 follow-ups and 3 meetings
            and 2 schedule meetings." Three-cell summary card. Hidden
            on the morning-plan-not-submitted state — the rep should
            see the plan form first, not their queue. */}
        {checkedIn && !dayDone && (
          <TodaySummaryCard userId={profile?.id} session={session} />
        )}

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
          // Phase 34Z.20 — both CTAs now navigate to LeadFormV2.
          // Meeting passes meetingMode=true → form shows Outcome
          // section + GPS strip + saves a lead_activities row.
          // Lead is the plain create flow. One form, two modes.
          // Owner directive (14 May 2026): "I need same copy and
          // paste form in log in the meeting. Both must have auto
          // fetch GPS."
          onOpenMeeting={() => navigate('/leads/new', {
            state: { meetingMode: true, prefill: { city: profile?.city || '' } },
          })}
          onOpenLead={() => navigate('/leads/new', {
            state: { prefill: { city: profile?.city || '' } },
          })}
        />

        {checkedIn && !dayDone && (
          <NextActionSurface
            session={session}
            smartTasks={smartTasks}
            navigate={navigate}
            toggleMeetingDone={toggleMeetingDone}
            toggleTaskDone={toggleTaskDone}
            onCallLead={quickLogCall}
            onDismissSmart={skipSmartTask}
            busy={busy}
          />
        )}

        {checkedIn && !dayDone && (
          <>
            {/* Phase 34Z.47 — skip the smart-task that's already the
                "Next up" hero so the same row doesn't appear twice on
                /work. nextUpSmartId is null when the active pick is
                a meeting / plan task (those don't appear in this list
                anyway). */}
            <TodayTasksPanel
              userId={profile.id}
              limit={3}
              excludeTaskId={nextUpSmartId}
              // Phase 34Z.70 — fix #16: wire the same outcome modal
              // chain that the Next-up card uses. Tap Phone icon →
              // tel: + activity log + modal.
              onCallLead={quickLogCall}
            />
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

      {/* Phase 34Z.51 — voice-driven outcome capture for the Next-up
          smart-task Call. Mirrors the LeadDetailV2 chain so the rep
          gets the same flow no matter where they tap Call from. After
          save, fires the stage-aware WhatsApp prompt unless they
          picked "Log a meeting now" (rare path; LogMeetingModal lives
          on lead detail). */}
      <PostCallOutcomeModal
        open={postCallOpen}
        lead={callLead}
        pendingActivityId={pendingActivityId}
        onClose={() => { setPostCallOpen(false); setPendingActivityId(null); setCallTaskId(null) }}
        onSaved={async ({ nextAction }) => {
          setPostCallOpen(false)
          setPendingActivityId(null)
          // Phase 34Z.79 — dropped explicit completeSmartTask RPC.
          // PostCallOutcomeModal handleSave already closes EVERY open
          // lead_task for (lead, rep) via direct UPDATE (Phase 34Z.60).
          // Calling complete_lead_task(p_task_id) here raised P0001
          // 'Task not found or RLS denied' because the row was already
          // status='done' by the time this ran. Just clear local state.
          if (callTaskId) setCallTaskId(null)
          load()
          if (nextAction === 'meeting') {
            // Smart card has no LogMeetingModal mounted; send rep to
            // lead detail where the Meeting button + map live.
            if (callLead?.id) navigate(`/leads/${callLead.id}`)
            return
          }
          // Refetch stage so WA prompt picks the right template
          // (PostCallOutcomeModal may have flipped New → Working
          // or set Nurture, which changes the canned message).
          if (callLead?.id) {
            const { data } = await supabase
              .from('leads').select('stage').eq('id', callLead.id).maybeSingle()
            setTimeout(() => {
              setWaPrompt({ stage: data?.stage || callLead.stage || 'post_call' })
            }, 200)
          }
        }}
        onLogMeeting={() => {
          setPostCallOpen(false)
          setPendingActivityId(null)
          // Phase 34Z.79 — same reasoning as onSaved above; modal
          // already closed the task via direct UPDATE.
          if (callTaskId) setCallTaskId(null)
          if (callLead?.id) navigate(`/leads/${callLead.id}`)
        }}
      />

      <WhatsAppPromptModal
        open={!!waPrompt}
        stage={waPrompt?.stage}
        lead={callLead}
        profile={profile}
        onClose={() => setWaPrompt(null)}
      />
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
    const summary = `${counters.meetings || 0} / ${targets.meetings || 5}`
    return (
      <>
        <V2Hero
          eyebrow={session?.check_in_at ? `In · ${formatTime(session.check_in_at)}` : 'In progress'}
          value={summary}
          label="meetings logged"
          chip={`${counters.calls || 0} call${(counters.calls || 0) === 1 ? '' : 's'} · ${counters.new_leads || 0} new lead${(counters.new_leads || 0) === 1 ? '' : 's'}`}
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
  // Phase 34Z.64 — before 17:00 IST the evening summary CTA is noise.
  // Owner audit: "EveningReportBlock — only relevant at end of day.
  // Make a <details> that opens after 5 PM IST." When it's still
  // daytime, collapse to a thin link. Rep can still expand if they're
  // closing early.
  const istHour = Number(new Date().toLocaleString('en-IN', {
    hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
  }))
  const isEvening = istHour >= 17

  if (!isEvening) {
    return (
      <details className="m-card" style={{ padding: 0, marginTop: 14 }}>
        <summary style={{
          padding: '10px 14px', cursor: 'pointer',
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          Evening summary · tap if you're closing early
        </summary>
        <div style={{ padding: '0 14px 14px' }}>
          <ActionButton
            variant="primary"
            size="md"
            iconLeft={Mic}
            onClick={() => navigate('/voice/evening')}
            style={{ width: '100%', marginTop: 8 }}
          >
            Speak evening summary
          </ActionButton>
        </div>
      </details>
    )
  }

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

/* ─── Phase 34Z.46 — last-activity-aware subtitle for smart tasks.
   Reads the most recent lead_activities row for the lead and surfaces
   its activity_type as a coloured chip so owner sees
   "MEETING · cd" instead of "Follow-up: cd". Falls back to the kind
   label if no activity is on file. */
function SmartTaskSubtitle({ leadId, note, kind }) {
  const [lastType, setLastType] = useState(null)
  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    supabase
      .from('lead_activities')
      .select('activity_type')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.activity_type) setLastType(data.activity_type)
      })
    return () => { cancelled = true }
  }, [leadId])

  const labelMap = {
    call:       { txt: 'CALL',       color: 'var(--success, #10B981)' },
    whatsapp:   { txt: 'WHATSAPP',   color: 'var(--success, #10B981)' },
    email:      { txt: 'EMAIL',      color: 'var(--blue, #3B82F6)' },
    meeting:    { txt: 'MEETING',    color: 'var(--accent, #FFE600)' },
    site_visit: { txt: 'SITE VISIT', color: 'var(--accent, #FFE600)' },
    note:       { txt: 'NOTE',       color: 'var(--text-muted)' },
  }
  const fallback = kind === 'follow_up_due'    ? { txt: 'FOLLOW-UP', color: 'var(--accent, #FFE600)' }
                 : kind === 'hot_idle'         ? { txt: 'HOT',       color: 'var(--danger, #EF4444)' }
                 : kind === 'new_untouched'    ? { txt: 'NEW LEAD',  color: 'var(--blue, #3B82F6)' }
                 : kind === 'sla_breach'       ? { txt: 'SLA',       color: 'var(--danger, #EF4444)' }
                 : kind === 'qualified_no_quote' ? { txt: 'NEEDS QUOTE', color: 'var(--accent, #FFE600)' }
                 : kind === 'nurture_revisit'  ? { txt: 'NURTURE',   color: 'var(--text-muted)' }
                 : { txt: 'TASK', color: 'var(--text-muted)' }
  const tag = (lastType && labelMap[lastType]) || fallback

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        padding: '2px 7px', borderRadius: 999,
        color: tag.color,
        background: 'color-mix(in srgb, currentColor 14%, transparent)',
      }}>
        {tag.txt}
      </span>
      {note && <span style={{ color: 'var(--accent)' }}>{note}</span>}
    </span>
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

function NextActionCard({ tone, title, subtitle, meta, primary, secondary, onDismiss, dismissTitle }) {
  return (
    <div className="m-card" style={{
      borderColor: 'var(--accent, #FFE600)',
      background: 'rgba(255,230,0,0.04)',
      position: 'relative',
    }}>
      {/* Phase 34Z.54 — dismiss (X). Owner asked for a way to close a
          smart task without making a call. Surfaces only when the
          parent passes onDismiss (smart-task branch); plan / meeting
          branches keep their existing Done CTAs. */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          title={dismissTitle || 'Dismiss task'}
          aria-label={dismissTitle || 'Dismiss task'}
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 28, height: 28, borderRadius: 999,
            background: 'transparent',
            border: '1px solid var(--border-strong, var(--v2-line, #475569))',
            color: 'var(--text-muted)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      )}
      {/* Phase 34Z.89 — when dismiss (X) is present, push the
          badge left by 36 px so it doesn't sit under the X. Owner
          reported the "smart task" pill clipping the close button
          at top-right of the Next-up card. */}
      <div className="m-card-title" style={onDismiss ? { paddingRight: 36 } : undefined}>
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

function NextActionSurface({ session, smartTasks, navigate, toggleMeetingDone, toggleTaskDone, onCallLead, onDismissSmart, busy }) {
  const pick = pickNextAction({ session, smartTasks })

  // Phase 34Z.65 — drop the "Day is clear · Add lead" empty card.
  // Owner directive (15 May 2026): redundant with TodaySummaryCard's
  // empty state + the /follow-ups page already shows the queue.
  // Render nothing when there's no priority pick.
  if (!pick) return null

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
    // Phase 34Z.46 — owner reported "Follow-up: cd" rendered on a
    // task whose last activity was a Meeting. Strip the generic
    // "Follow-up: " prefix from the reason so the rep sees just the
    // free-text note. The action-type chip is rendered separately
    // by SmartTaskSubtitle below from the lead's last activity.
    const cleanReason = (t.reason || '').replace(/^Follow-up:\s*/i, '')
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
        subtitle={<SmartTaskSubtitle leadId={t.lead_id || lead.id} note={cleanReason} kind={t.kind} />}
        primary={phone
          ? {
              icon: Phone,
              label: 'Call',
              // Phase 34Z.51 — same chain as LeadDetailV2's Call:
              // inserts the activity row, fires tel:, then opens the
              // PostCallOutcomeModal 1.5s later. Owner reported the
              // smart-task card was firing tel: without logging the
              // call or surfacing the outcome modal.
              // Phase 34Z.54 — pass the smart-task id so the parent
              // can close it after the outcome is saved.
              onClick: () => onCallLead?.({
                id: t.lead_id || lead.id,
                phone: lead.phone,
                name: lead.name,
                company: lead.company,
                stage: lead.stage,
              }, t.id),
            }
          : { variant: 'subtle', label: 'No phone', disabled: true, onClick: () => {} }
        }
        secondary={{ label: 'Open', onClick: () => navigate(`/leads/${t.lead_id || lead.id}`) }}
        // Phase 34Z.54 — manual dismiss (X). Owner: "there is no
        // option for close smart task close." Skips the row via the
        // useLeadTasks hook; the realtime sub removes it from the
        // list and a new Next-up pick is computed.
        onDismiss={onDismissSmart ? () => onDismissSmart(t.id) : null}
        dismissTitle="Dismiss this task"
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
    // Phase 34Z.11 — owner reported (14 May 2026) two Check-in
    // buttons stacked on /work. DayStatusSurface's variant B
    // already renders a Check-in button right under the late-reason
    // box; this surface mounts at the bottom of the page and was
    // duplicating it. Return null so only the contextual button
    // remains.
    return null
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
