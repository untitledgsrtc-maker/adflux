// src/pages/v2/WorkV2.jsx
//
// Phase 16 commit 5 — /work mobile rep daily flow, ported in-place
// from _design_reference/Leads/lead-modals-mobile.jsx (MWorkPlan,
// MWorkActive, MWorkDone). 5-state machine drives the page render:
//
//   A_PLAN    — morning plan form (5 meeting slots + calls + leads + focus)
//   A_CHECKIN — plan saved, waiting for GPS check-in
//   B_ACTIVE  — checked in, live counters + quick actions + meeting list
//   C_CHECKOUT— evening report submitted, waiting for GPS check-out
//   D_DONE    — day complete summary
//
// State derived from work_sessions row (one per user_id × work_date).
// Counters auto-incremented by Postgres triggers when activities log.
// GPS captured silently on check-in/out — fails gracefully if denied.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun, MapPin, Phone, Calendar, UserPlus, Loader2, Trash2, Plus,
  CheckCircle2, Users as UsersIcon, Edit3, Mic, Square,
  Clock, Clock as ClockIcon,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { LeadAvatar, Pill } from '../../components/leads/LeadShared'
import TodayTasksPanel from '../../components/leads/TodayTasksPanel'
import UpcomingTasksCard from '../../components/leads/UpcomingTasksCard'
import MeetingsMapPanel from '../../components/leads/MeetingsMapPanel'
import RepDayTools from '../../components/leads/RepDayTools'
import { DidYouKnow } from '../../components/v2/DidYouKnow'
import V2Hero from '../../components/v2/V2Hero'
// Phase 34Z.1 (13 May 2026) — pull the shared `greetingFor` so the
// page-body greeting uses the same "morning ☀️ / afternoon ⛅ /
// evening 🌙" emoji variant as the topbar.
import { greetingFor as sharedGreetingFor } from '../../components/v2/V2AppShell'
// Phase 34S — RingMilestoneRow import removed; only TaPayoutsAdminV2
// still uses it. WorkV2 now relies on V2Hero alone for daily counters.
import { ensurePushOnLogin } from '../../utils/pushNotifications'
// Phase 31O — ProposedIncentiveCard import removed; the V2AppShell
// now mounts it once at the top of every sales page, so /work
// doesn't render it directly anymore.
// Phase 32M — LogMeetingModal: cold walk-in fast-path. One tap on the
// "Log meet" tile creates a lead + meeting activity + bumps the
// counter, all from inside the modal. The Postgres trigger
// bump_meeting_counter (Phase 32M SQL) handles the counter; we just
// need to reload the session row after save so the UI reflects it.
import LogMeetingModal from '../../components/leads/LogMeetingModal'

const TODAY = () => new Date().toISOString().slice(0, 10)

// Phase 33B.4 — audio chime on save. Web Audio API beep, no asset.
// Two short tones (E5 + A5) ~150ms total. Plays after meeting save.
// Browsers require a user gesture before AudioContext can fire; the
// click that triggers save IS that gesture, so it works on mobile.
function playChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const tones = [659.25, 880.0]  // E5, A5
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

export default function WorkV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Phase 32M — modal toggle for the cold walk-in fast-path. The
  // modal owns its own form state; we just open it and reload the
  // session row on save so the meetings counter ticks up visibly.
  const [meetingModalOpen, setMeetingModalOpen] = useState(false)
  // Phase 34O — after LogMeetingModal saves a new lead, defer the
  // navigation to /leads/<id> until the WhatsApp prompt also closes
  // so the rep isn't yanked away mid-prompt.
  const [pendingNavLead, setPendingNavLead] = useState(null)
  // Phase 33A — success toast after Log Meeting save. Owner audit
  // (11 May) caught the modal closed silently; rep had no
  // confirmation. 2-second brand-yellow strip with "✓ Saved · N/5".
  const [toast, setToast] = useState('')

  /* ─── Morning plan draft ─── */
  const [plannedMeetings, setPlannedMeetings] = useState([
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
  ])
  const [plannedCalls, setPlannedCalls] = useState(20)
  const [plannedLeads, setPlannedLeads] = useState(10)
  const [focusArea, setFocusArea] = useState('')

  /* ─── Evening draft ─── */
  const [evening, setEvening] = useState({
    quotes_sent: '', blockers: '', tomorrow_focus: '',
  })

  /* ─── Phase 30D — free-text morning plan + Claude tasks ─── */
  const [planText, setPlanText] = useState('')
  const [parsing, setParsing]   = useState(false)
  const [lateReason, setLateReason] = useState('')

  /* ─── Phase 31A.6 — voice dictation on the plan textarea ───
     Owner spec (9 May 2026): typing the morning plan in Gujarati on
     a phone is slow. Reuses the existing voice-process Edge Function
     with mode='transcribe_only' (added this phase) — that returns the
     raw Whisper transcript without doing the lead_activities classify
     step. We append the result to whatever's already in the textarea. */
  const [recState, setRecState]   = useState('idle') // 'idle'|'recording'|'sending'
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [audioChunks, setAudioChunks]     = useState([])

  async function startRecording() {
    if (recState !== 'idle') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const chunks = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecState('sending')
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const buf  = await blob.arrayBuffer()
          // Convert to base64 (no streaming — clip is short, < 60s).
          let bin = ''
          const bytes = new Uint8Array(buf)
          for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
          const audio_base64 = btoa(bin)
          const { data: { session: authSession } } = await supabase.auth.getSession()
          const res = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-process`,
            {
              method: 'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                audio_base64,
                mime_type:        'audio/webm',
                lead_id:          null,
                duration_seconds: null,
                mode:             'transcribe_only',
              }),
            }
          )
          if (!res.ok) {
            const msg = await res.text().catch(() => '')
            setError('Voice failed: ' + msg.slice(0, 140))
            setRecState('idle')
            return
          }
          const json = await res.json()
          const transcript = (json?.transcript || '').trim()
          if (transcript) {
            // Phase 31Y — pipe the Whisper transcript through
            // parse-day-plan IMMEDIATELY (not just on Submit) so two
            // owner asks land at once:
            //   1. Claude returns transcript_corrected in the language
            //      script the rep selected (gu/hi/en) — fixes the
            //      "Hindi script even when I picked Gujarati" issue.
            //   2. Claude extracts structured meetings + calls + leads
            //      target + focus area, populating the form's manual
            //      input fields automatically.
            // If parse-day-plan fails for any reason, we still fall
            // back to inserting the raw transcript so the rep isn't
            // stuck — speech UX must never silently lose audio.
            try {
              const planRes = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-day-plan`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
                  },
                  body: JSON.stringify({ text: transcript, language: 'gu' }),
                }
              )
              if (planRes.ok) {
                const plan = await planRes.json().catch(() => ({}))
                const corrected = (plan.transcript_corrected || transcript).trim()
                // Replace the textarea content with the corrected
                // (Gujarati-script) transcript. If rep had typed
                // anything before tapping Speak, append below.
                setPlanText(prev => prev?.trim()
                  ? `${prev}${prev.endsWith(' ') ? '' : ' '}${corrected}`
                  : corrected
                )
                // Auto-fill structured fields — only fill empty rows
                // / unset values so we don't trample manual edits.
                if (Array.isArray(plan.meetings) && plan.meetings.length > 0) {
                  setPlannedMeetings(prev => {
                    const next = [...prev]
                    plan.meetings.forEach(m => {
                      // Find first empty slot
                      const idx = next.findIndex(s => !s.client && !s.time)
                      const meeting = {
                        time:   m.time   || '',
                        client: m.client || '',
                        where:  m.where  || '',
                      }
                      if (idx >= 0) next[idx] = meeting
                      else next.push(meeting)
                    })
                    return next
                  })
                }
                // If the rep explicitly stated a number ("10 calls",
                // "5 new leads"), trust that over our hardcoded
                // defaults (plannedCalls=20, plannedLeads=10). Can't
                // distinguish "rep typed 20" from "default 20" so we
                // unconditionally overwrite when Claude found a count.
                if (plan.calls_planned > 0) {
                  setPlannedCalls(plan.calls_planned)
                }
                if (plan.new_leads_target > 0) {
                  setPlannedLeads(plan.new_leads_target)
                }
                if (plan.focus && !focusArea) {
                  setFocusArea(plan.focus)
                }
              } else {
                // parse-day-plan errored — keep the raw transcript.
                setPlanText(prev => prev?.trim()
                  ? `${prev}${prev.endsWith(' ') ? '' : ' '}${transcript}`
                  : transcript
                )
              }
            } catch (_) {
              setPlanText(prev => prev?.trim()
                ? `${prev}${prev.endsWith(' ') ? '' : ' '}${transcript}`
                : transcript
              )
            }
          }
        } catch (e) {
          setError('Voice failed: ' + (e?.message || e))
        } finally {
          setRecState('idle')
          setMediaRecorder(null)
          setAudioChunks([])
        }
      }
      setMediaRecorder(mr)
      setAudioChunks(chunks)
      mr.start()
      setRecState('recording')
      // Auto-stop at 60s as a safety guard.
      setTimeout(() => {
        if (mr.state === 'recording') mr.stop()
      }, 60_000)
    } catch (e) {
      setError('Microphone access denied or unavailable: ' + (e?.message || e))
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop()
    }
  }
  // Show late-reason field only when current time > 9:30 AM and we
  // haven't checked in yet. Computed at render, not stored.
  const isLate = (() => {
    const now = new Date()
    return now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 30)
  })()

  // Phase 30E — focus mode. Owner spec (7 May 2026): "he/she must
  // need to see one by one task, followup, meeting until he reacts
  // on that particular card it will keep showing". Default ON for
  // mobile thumb-friendly flow; rep can toggle "Show all" to reveal
  // the full list view. Persisted in localStorage so the choice
  // sticks across reloads.
  const [focusMode, setFocusMode] = useState(() => {
    try { return localStorage.getItem('work_focus_mode') !== 'off' } catch (_) { return true }
  })
  function setFocusModeAndPersist(v) {
    setFocusMode(v)
    try { localStorage.setItem('work_focus_mode', v ? 'on' : 'off') } catch (_) {}
  }

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
      if (data?.planned_calls)             setPlannedCalls(data.planned_calls)
      if (data?.planned_leads)             setPlannedLeads(data.planned_leads)
      if (data?.evening_summary?.focus)    setFocusArea(data.evening_summary.focus)
      if (data?.evening_summary)           setEvening({
        quotes_sent: data.evening_summary.quotes_sent || '',
        blockers: data.evening_summary.blockers || '',
        tomorrow_focus: data.evening_summary.tomorrow_focus || '',
      })
      if (data?.morning_plan_text) setPlanText(data.morning_plan_text)
    }
    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])

  // Phase 33R — register service worker + request push permission
  // + subscribe (silent if already done). Skips silently if
  // VITE_VAPID_PUBLIC_KEY is unset.
  useEffect(() => {
    if (profile?.id) {
      ensurePushOnLogin(profile.id).catch(() => { /* silent */ })
    }
  }, [profile?.id])

  /* ─── Phase 30F — GPS interval polling ───
     Owner spec: 'every 10 min keep fetch location'. Fires only while
     the rep is checked in AND the evening report hasn't been submitted
     (B_ACTIVE state). Browser geolocation is foreground-only on iOS
     PWAs — once the tab is closed, polling pauses. Native wrapper
     follows in a later phase if owner needs background coverage. */
  useEffect(() => {
    if (!profile?.id) return
    // Phase 32F — agency users don't get GPS-tracked. Defense in depth
    // since RootRedirect now lands them on /quotes, but a directly-
    // typed /work URL would still mount this hook. Skip the polling.
    if (profile?.role === 'agency') return
    if (!session?.check_in_at) return
    if (session?.evening_report_submitted_at) return // day complete; stop pinging
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
          user_id:     profile.id,
          lat:         pos.coords.latitude,
          lng:         pos.coords.longitude,
          accuracy_m:  Math.round(pos.coords.accuracy || 0) || null,
          source,
        }])
      } catch (e) {
        // Permission denied / timeout / offline — just skip this tick.
        // Don't surface to the user; GPS is best-effort.
      }
    }

    // Capture immediately on mount (fresh load after check-in), then
    // every 5 min while the tab stays open.
    // Phase 31Z (10 May 2026) — owner asked for 5-minute pinging
    // (was 10 min). Caveat: iOS Safari pauses geolocation when the
    // tab is backgrounded; gaps show on the map when reps close the
    // app. Background GPS needs a Capacitor wrapper, separate phase.
    pingOnce('interval')
    const id = setInterval(() => pingOnce('interval'), 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, session?.check_in_at, session?.evening_report_submitted_at])

  const targets = useMemo(() => {
    return profile?.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
  }, [profile])
  const counters = session?.daily_counters || { meetings: 0, calls: 0, new_leads: 0 }

  const stateName =
    !session?.plan_submitted_at           ? 'A_PLAN'    :
    !session?.check_in_at                 ? 'A_CHECKIN' :
    !session?.evening_report_submitted_at ? 'B_ACTIVE'  :
    !session?.check_out_at                ? 'C_CHECKOUT':
    'D_DONE'

  /* ─── Submit morning plan ─── */
  async function submitPlan() {
    setBusy(true); setError('')
    const filtered = plannedMeetings.filter(m => m.client.trim())

    // Phase 30D — if rep wrote a free-text plan, send it to the
    // parse-day-plan Edge Function. Claude returns a discrete task
    // list which we persist on the row for display in B_ACTIVE.
    let parsedTasks = null
    const text = planText.trim()
    if (text) {
      setParsing(true)
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession()
        const fnRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-day-plan`,
          {
            method: 'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${authSession?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ text }),
          }
        )
        if (fnRes.ok) {
          const json = await fnRes.json()
          parsedTasks = Array.isArray(json?.tasks) ? json.tasks : null
        } else {
          // Non-fatal — save the plan text without tasks. Rep can still
          // see their own raw plan; admin can read it. Better to let
          // the day continue than block on a Claude hiccup.
          console.warn('[parse-day-plan] non-OK', fnRes.status, await fnRes.text().catch(() => ''))
        }
      } catch (e) {
        console.warn('[parse-day-plan] error', e?.message)
      } finally {
        setParsing(false)
      }
    }

    const payload = {
      user_id:           profile.id,
      work_date:         TODAY(),
      plan_submitted_at: new Date().toISOString(),
      planned_meetings:  filtered,
      planned_calls:     Number(plannedCalls) || 0,
      planned_leads:     Number(plannedLeads) || 0,
      evening_summary:   focusArea ? { focus: focusArea } : null,
      morning_plan_text:         text || null,
      morning_plan_tasks:        parsedTasks,
      morning_plan_submitted_at: text ? new Date().toISOString() : null,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .upsert(payload, { onConflict: 'user_id,work_date' })
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  /* ─── Phase 30D — toggle a parsed task done/undone ─── */
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
    setBusy(true); setError('')
    const next = session.planned_meetings.map((m, i) =>
      i === idx ? { ...m, done: !m.done } : m
    )
    const wasDone = !!session.planned_meetings[idx]?.done
    const nowDone = !wasDone
    const nextCounters = {
      ...(session.daily_counters || {}),
      meetings: Math.max(0, (session.daily_counters?.meetings || 0) + (nowDone ? 1 : -1)),
    }
    // Phase 34Z.1 (13 May 2026) — owner reported "swipe done refresh
    // not working": after tapping Done the row stayed visible until
    // the server roundtrip + load() completed (~1-2 s). Reps thought
    // the action hadn't fired and tapped again, creating ghost
    // double-toggles. Optimistic update flips the UI immediately;
    // server reconciliation via load() catches up.
    setSession(prev => prev ? { ...prev, planned_meetings: next, daily_counters: nextCounters } : prev)
    const { error: err } = await supabase
      .from('work_sessions')
      .update({ planned_meetings: next, daily_counters: nextCounters })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) {
      // Roll back the optimistic flip if the server rejected the write.
      setSession(prev => prev ? { ...prev, planned_meetings: session.planned_meetings, daily_counters: session.daily_counters } : prev)
      setError(err.message); return
    }
    load()
  }

  // Phase 33A — owner directive: collapse A_PLAN + A_CHECKIN into one
  // perceptual step. New "Start My Day" button does submitPlan
  // (possibly with empty plan) then immediately checks in. The plan
  // form is still reachable for power users via the collapsed
  // "Add plan (optional)" expand. doCheckIn waits for the row to
  // exist; we poll the session once after submitPlan.
  async function startDay() {
    if (busy || parsing) return
    setError('')
    // If we're already past A_PLAN (rare race), just check in directly.
    if (stateName !== 'A_PLAN') {
      return doCheckIn()
    }
    // Phase 34O — plan is now compulsory. Require at least ONE of:
    //   * a planned meeting with a client name (or location)
    //   * any free-text plan
    //   * a calls-planned > 0 OR new-leads target > 0
    // Voice dictation populates the free-text field automatically
    // so reps who tap the mic and speak satisfy the gate without
    // typing. Empty-plan reps see an inline error pointing them at
    // the voice mic.
    const hasMeeting = plannedMeetings.some((m) =>
      (m.client && m.client.trim()) || (m.location && m.location.trim()))
    const hasText    = !!(planText && planText.trim())
    const hasNumeric = (Number(plannedCalls) > 0) || (Number(plannedLeads) > 0)
    if (!hasMeeting && !hasText && !hasNumeric) {
      setError('Please add your plan first — tap the mic and speak it, or fill at least one meeting / call target.')
      return
    }
    await submitPlan()
    // submitPlan calls load() which moves us to A_CHECKIN. Wait one
    // tick then advance to check-in. This is conservative — if the
    // server reload is slow we still get to A_CHECKIN as a visible
    // intermediate state, then the rep taps once more.
    setTimeout(() => { doCheckIn() }, 100)
  }

  async function doCheckIn() {
    // Phase 30D — soft 9:30 AM gate. Don't block; require a reason.
    if (isLate && !lateReason.trim()) {
      setError('Please add a reason — check-in is past 9:30 AM.')
      return
    }
    setBusy(true); setError('')
    const gps = await captureGps()
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        check_in_at:          new Date().toISOString(),
        check_in_gps_lat:     gps?.lat || null,
        check_in_gps_lng:     gps?.lng || null,
        check_in_late_reason: isLate ? lateReason.trim() : null,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    // Phase 30F — also drop a 'checkin' ping in gps_pings so the
    // map view has the full track (start point + interval points +
    // end point) in a single source.
    if (gps?.lat && gps?.lng) {
      supabase.from('gps_pings').insert([{
        user_id: profile.id, lat: gps.lat, lng: gps.lng,
        accuracy_m: gps.accuracy || null, source: 'checkin',
      }]).then(() => {}, () => {})
    }
    load()
  }

  async function submitEvening() {
    setBusy(true); setError('')
    const summary = {
      ...(session?.evening_summary || {}),
      quotes_sent:    evening.quotes_sent,
      blockers:       evening.blockers,
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
        check_out_at:      new Date().toISOString(),
        check_out_gps_lat: gps?.lat || null,
        check_out_gps_lng: gps?.lng || null,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    // Phase 30F — drop a 'checkout' ping for the map endpoint.
    if (gps?.lat && gps?.lng) {
      supabase.from('gps_pings').insert([{
        user_id: profile.id, lat: gps.lat, lng: gps.lng,
        accuracy_m: gps.accuracy || null, source: 'checkout',
      }]).then(() => {}, () => {})
    }
    load()
  }

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

  const niceDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'short',
  })
  const repInitials = (profile?.name || '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  const repColor = profile?.id ? (profile.id.charCodeAt(0) % 6) + 1 : 4

  return (
    <div className="lead-root">
      <div className="m-screen">
        {/* Phase 34.9 discoverability — surface a tip rep didn't know
            existed. Dismisses to localStorage, never re-appears. */}
        <DidYouKnow id="work-voice-plan-2026-05-13" title="Speak your day plan">
          Tap the mic above and say what's on today. AI breaks it into tasks.
          Saves 3-5 minutes vs typing each one.
        </DidYouKnow>

        {/* Greet header — design: avatar on Plan, "● live" pill on Active,
            Day done greeting on D_DONE. */}
        <div className="m-greet">
          <div>
            <div className="hello">
              {stateName === 'D_DONE' ? 'Day done.' :
               stateName === 'B_ACTIVE' ? 'Day in progress' :
               /* Phase 34Z.1 — was hardcoded "Good morning, {first}",
                  which never matched the topbar greeting after dark.
                  Shared util now handles the time band + emoji. */
               sharedGreetingFor(profile)}
            </div>
            <div className="date">{niceDate}{session?.check_in_at ? ` · checked in ${formatTime(session.check_in_at)}` : ''}</div>
          </div>
          {stateName === 'B_ACTIVE' ? (
            <Pill tone="success">
              <span className="lead-live-dot" style={{ marginRight: 5, width: 6, height: 6 }} />
              live
            </Pill>
          ) : (
            profile?.name && (
              <span className={`lead-avatar av-${repColor}`} style={{ width: 36, height: 36, fontSize: 13 }}>
                {repInitials}
              </span>
            )
          )}
        </div>

        {error && (
          <div
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12,
            }}
          >
            ⚠ {error}
          </div>
        )}

        {/* Phase 31O — moved the ProposedIncentiveCard up into the
            V2AppShell so it persists across every sales page (owner
            directive 10 May 2026). The shell handles render + gating
            now; this page no longer mounts it directly. */}

        {/* Phase 33A — owner directive: collapse A_PLAN form behind a
            single "Start My Day" CTA. Reps who want to type/dictate a
            plan first can expand the "Add plan (optional)" section.
            Default flow: tap one button → plan submitted empty → GPS
            captured → checked in → on Today screen in one tap.

            Phase 34Z.1 (13 May 2026) — V2Hero added at the top so the
            morning page has the same teal-gradient + pulsing dot the
            rest of the app has. Shows today's targets so the rep
            opens the app and instantly knows the numbers (≥ N
            meetings, ≥ M calls, ≥ K new leads). */}
        {stateName === 'A_PLAN' && (
          <>
            <V2Hero
              eyebrow="Today · plan the day"
              value={`${targets.meetings || 5} meetings`}
              label="set the bar before you start"
              chip={`${targets.calls || 0} calls · ${targets.new_leads || 0} new leads`}
            />
            <button
              className="m-cta"
              onClick={startDay}
              disabled={busy || parsing}
              style={{ marginBottom: 16, minHeight: 64, fontSize: 18 }}
            >
              <Sun size={20} />
              {(busy || parsing) ? 'Starting…' : 'Start My Day'}
            </button>
          </>
        )}

        {/* ─── A_PLAN: morning plan form ─── */}
        {/* Phase 34O — plan is now compulsory. `<details>` removed
            in favour of always-open card so the voice mic + plan
            fields are visible without an extra tap. Header
            relabelled to drop the "(optional)" hint that misled
            reps into skipping the plan. */}
        {stateName === 'A_PLAN' && (
          <div className="m-card" style={{ padding: 0 }}>
            {/* Phase 34Z.1 — owner audit said the morning plan card
                "didn't look professional". Reworked header: a single
                clear heading with subtitle, no double-label, no
                "Step 1 of 3" pill (the rep only fills one step from
                this page so the count was confusing). Same data,
                cleaner top. */}
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

            {/* Phase 34O — prominent voice CTA. Tap to speak today's
                plan; the existing parse-day-plan Edge Function fills
                meetings + calls + focus automatically. Reps who don't
                want to speak can fill the form below by hand. */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: 'var(--accent-soft, rgba(255,230,0,0.14))',
              border: '1px solid var(--accent, #FFE600)',
              borderRadius: 10,
              marginBottom: 14,
            }}>
              <button
                type="button"
                onClick={recState === 'recording' ? stopRecording : startRecording}
                disabled={recState === 'sending' || busy || parsing}
                style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: recState === 'recording'
                    ? 'var(--danger, #EF4444)'
                    : 'var(--accent, #FFE600)',
                  color: recState === 'recording' ? '#fff' : '#0f172a',
                  border: 'none', cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 700,
                }}
                aria-label={recState === 'recording' ? 'Stop' : 'Speak plan'}
              >
                {recState === 'sending'
                  ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  : recState === 'recording' ? '■' : '🎤'}
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
            {/* Phase 34Z.1 — owner audit: the type=time input at
                width:80 was unreadable on iPhone (compact UA style
                clipped the AM/PM to ellipsis "12:30 PM" was actually
                "12:3…"). Bumped width + padding + font-size so the
                full time string is visible without zooming. */}
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

            {/* Phase 30D — free-text day plan in any language. Claude
                turns this into a checklist on submit. Optional but
                strongly encouraged: reps who type "આજે રાજેશ ને
                મળવા જવું છે, 5 cold calls કરવી છે" get tickable
                tasks waiting for them after check-in. */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border, rgba(255,255,255,.06))' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="lead-fld-label" style={{ marginBottom: 0 }}>
                  Today's plan in your words (Gujarati / Hindi / English)
                </label>
                {/* Phase 31A.6 — voice dictation. Tap → record up to
                    60s → Whisper transcribes → text appended to the
                    textarea. Reps can edit before submit. */}
                {recState === 'recording' ? (
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm"
                    onClick={stopRecording}
                    style={{ borderColor: 'var(--red, #EF4444)', color: 'var(--red, #EF4444)' }}
                  >
                    <Square size={11} /> Stop
                    <span className="lead-live-dot" style={{ marginLeft: 4, width: 6, height: 6 }} />
                  </button>
                ) : recState === 'sending' ? (
                  <button type="button" className="lead-btn lead-btn-sm" disabled>
                    <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Transcribing…
                  </button>
                ) : (
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm lead-btn-primary"
                    onClick={startRecording}
                    title="Speak your plan — Gujarati / Hindi / English"
                  >
                    <Mic size={11} /> Speak
                  </button>
                )}
              </div>
              <textarea
                className="lead-inp"
                rows={4}
                value={planText}
                onChange={e => setPlanText(e.target.value)}
                placeholder="આજે રાજેશ ને મળવા જવું છે 11 વાગ્યે, પછી 5 cold calls કરવી છે, અને Patel ને quote send કરવી છે…"
                style={{ resize: 'vertical', minHeight: 90 }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Optional. Type or tap <b>Speak</b>. We'll turn it into a checklist you can tick off through the day.
              </div>
            </div>
            {/* Phase 33A — keep a "Save plan only" button inside the
                details for reps who want to save without starting yet
                (e.g. typing plan night before). Default Start My Day
                flow does both in one tap above. */}
            <button
              type="button"
              className="lead-btn lead-btn-sm"
              onClick={submitPlan}
              disabled={busy || parsing}
              style={{ marginTop: 10 }}
            >
              {(busy || parsing)
                ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                : 'Save plan only'}
            </button>
            </div>
          </div>
        )}

        {/* ─── A_CHECKIN: plan submitted, waiting for check-in ─── */}
        {stateName === 'A_CHECKIN' && (
          <>
            <div className="m-card">
              <div className="m-card-title">Plan submitted ✓</div>
              <PlanSummary session={session} />
            </div>
            {/* Phase 30D — soft 9:30 AM gate. If past, require a
                reason. Admin sees the reason in the daily report;
                no punishment. */}
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
            <button className="m-cta" onClick={doCheckIn} disabled={busy || (isLate && !lateReason.trim())}>
              <MapPin size={16} />
              {busy ? 'Capturing GPS…' : 'Check in'}
            </button>
          </>
        )}

        {/* ─── B_ACTIVE: checked in, working day ─── */}
        {stateName === 'B_ACTIVE' && (
          <>
            {/* Phase 34R — teal-gradient day-progress hero from new
                design package. Sits above the meeting ring so the
                rep glances and instantly knows where they are vs
                target. Falls back to brand defaults if v2 tokens
                haven't loaded yet (inline gradient survives FOUC). */}
            <V2Hero
              eyebrow="Today · in progress"
              value={`${counters.meetings || 0} / ${targets.meetings || 5}`}
              label="meetings logged"
              chip={`${counters.calls || 0} calls · ${counters.new_leads || 0} new leads`}
              right={{
                tone: (counters.meetings || 0) >= (targets.meetings || 5) ? 'up' : 'down',
                text: (counters.meetings || 0) >= (targets.meetings || 5)
                  ? 'target hit'
                  : `${(targets.meetings || 5) - (counters.meetings || 0)} to go`,
              }}
              accent={(counters.meetings || 0) >= (targets.meetings || 5)}
            />

            {/* Phase 34S — May 13 UX audit confirmed Phase 34R was
                over-built. V2Hero above already shows meetings + the
                "calls · new leads" chip. The RingMilestoneRow AND
                MeetingRing both repeated the same data in two visual
                styles below. Removed both — single source of truth
                wins. The component imports are kept (used elsewhere)
                so this is a 30-line UI delete, not a code rewrite. */}

            {/* Phase 33D.6 — Today's tasks breakdown: count of due
                follow-ups + nurture calls. Shows alongside the meeting
                ring so the rep sees the full daily picture at a glance. */}
            <TodayTasksBreakdown userId={profile.id} navigate={navigate} />

            {/* Phase 33A — 3 giant action buttons (Meeting / Call /
                Voice). Phase 34Z.1 (13 May 2026) — owner audit dropped
                Call + Voice on mobile:
                  • Call just navigated to /leads → /leads already has
                    a per-lead Call button, so the global Call CTA
                    duplicated the action and ate a third of the home
                    screen.
                  • Voice is reachable from the hamburger menu and the
                    Speak button inside the morning plan card; the
                    standalone Voice CTA was a third route that few
                    reps used.
                Meeting stays — primary daily action; opens the log
                modal directly without navigation. */}
            <div className="m-cta-stack">
              <button
                className="m-cta-big m-cta-primary"
                onClick={() => setMeetingModalOpen(true)}
                disabled={busy}
              >
                <Calendar size={24} strokeWidth={1.8} />
                <span>Log Meeting</span>
              </button>
            </div>

            {/* Phase 33F (B8) — Focus mode toggle hidden. Low-literacy
                reps got confused by the "focus mode / show all" choice;
                most never used it. Defaulting to "show all" (focusMode
                state stays initially false). Admin can still hit the
                /work?focus=1 query param if they want it for testing. */}

            {/* FOCUS MODE — render only the next-best undone card. */}
            {focusMode && (() => {
              // Pick highest-priority pending item from the union of:
              //   1. Morning plan tasks not done (Phase 30D)
              //   2. Planned meetings not done
              // Smart Tasks panel is shown separately because each row
              // is already self-contained — focus mode just hides the
              // bulk list views, not the smart-task list.
              const planTasks = (session?.morning_plan_tasks || []).filter(t => !t.done)
              const meetings  = (session?.planned_meetings   || []).filter(m => !m.done)

              if (planTasks.length === 0 && meetings.length === 0) {
                return (
                  <div className="m-card" style={{ textAlign: 'center', padding: 24 }}>
                    {/* Phase 32J — replaced 🎯 emoji with Lucide
                        CheckCircle2 per CLAUDE.md §20. */}
                    <CheckCircle2 size={28} strokeWidth={1.6} style={{ color: 'var(--success)', marginBottom: 6 }} />
                    <div style={{ fontWeight: 600 }}>All caught up</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      No pending plan tasks or meetings. Use Smart Tasks below or log a new activity.
                    </div>
                  </div>
                )
              }

              // Prefer a meeting that has a time today (most time-bound)
              // else first undone plan task, else first undone meeting.
              const nextMeeting = meetings.find(m => m.time)
              const nextPlan    = planTasks[0]
              const card = nextMeeting
                ? { kind: 'meeting', data: nextMeeting }
                : nextPlan
                  ? { kind: 'plan', data: nextPlan }
                  : { kind: 'meeting', data: meetings[0] }

              return (
                <div className="m-card" style={{
                  borderColor: 'var(--accent, #FFE600)',
                  background: 'rgba(255,230,0,0.04)',
                }}>
                  <div className="m-card-title">
                    <span>Next up</span>
                    <span className="pill">{planTasks.length + meetings.length} pending</span>
                  </div>
                  {card.kind === 'meeting' ? (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                        {card.data.client || 'Meeting'}
                      </div>
                      {/* Phase 31G — replaced ⏰ + 📍 emoji per CLAUDE.md
                          §20 (no emoji in UI files). Lucide Clock and
                          MapPin match stroke / size used elsewhere. */}
                      {card.data.time && (
                        <div style={{
                          fontSize: 13, color: 'var(--accent)', marginTop: 6,
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                        }}>
                          <Clock size={14} strokeWidth={1.6} />
                          {card.data.time}
                        </div>
                      )}
                      {card.data.location && (
                        <div style={{
                          fontSize: 12, color: 'var(--text-muted)', marginTop: 4,
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                        }}>
                          <MapPin size={14} strokeWidth={1.6} />
                          {card.data.location}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                        <button
                          className="lead-btn lead-btn-primary"
                          style={{ flex: 1, minWidth: 120 }}
                          onClick={() => {
                            const idx = (session?.planned_meetings || []).findIndex(m => m === card.data)
                            if (idx >= 0) toggleMeetingDone(idx)
                          }}
                          disabled={busy}
                        >
                          <CheckCircle2 size={14} /> Done
                        </button>
                        <button
                          className="lead-btn"
                          onClick={() => navigate('/leads')}
                        >
                          Open leads
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>
                        {card.data.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {card.data.type}{card.data.due_time ? ` · ${card.data.due_time}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                        <button
                          className="lead-btn lead-btn-primary"
                          style={{ flex: 1, minWidth: 120 }}
                          onClick={() => toggleTaskDone(card.data.id)}
                          disabled={busy}
                        >
                          <CheckCircle2 size={14} /> Done
                        </button>
                        <button
                          className="lead-btn"
                          onClick={() => navigate('/leads')}
                        >
                          Open leads
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            {/* Phase 30D — morning plan checklist. Claude-parsed tasks
                from the rep's own description. Tap to mark done; the
                full original text is shown collapsed below.
                Phase 30E — hidden in focus mode (the Next-Up card
                above already surfaces the top item). */}
            {!focusMode && Array.isArray(session?.morning_plan_tasks) && session.morning_plan_tasks.length > 0 && (
              <div className="m-card">
                <div className="m-card-title">
                  <span>My plan for today</span>
                  <span className="pill">
                    {session.morning_plan_tasks.filter(t => t.done).length}
                    /{session.morning_plan_tasks.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {session.morning_plan_tasks.map(t => (
                    <label
                      key={t.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 12px', borderRadius: 8,
                        background: t.done ? 'rgba(16,185,129,.06)' : 'var(--surface-2)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!t.done}
                        onChange={() => toggleTaskDone(t.id)}
                        disabled={busy}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 500,
                          textDecoration: t.done ? 'line-through' : 'none',
                          color: t.done ? 'var(--text-muted)' : 'var(--text)',
                        }}>
                          {t.title}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                          {t.type}{t.due_time ? ` · ${t.due_time}` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                {session.morning_plan_text && (
                  <details style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                    <summary style={{ cursor: 'pointer' }}>Original plan text</summary>
                    <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, padding: 8, background: 'var(--surface-2)', borderRadius: 6 }}>
                      {session.morning_plan_text}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Phase 19 — Smart Task Engine: today's ranked call list.
                Phase 33B.4 — owner audit (11 May 2026) called out the
                list wasn't truncated to 3. Pass limit=3; overflow shows
                'View all' link inside the panel. */}
            <TodayTasksPanel userId={profile.id} limit={3} />

            {/* Phase 34C — Tomorrow + Next 7 days preview so the rep
                can prep at end-of-shift without leaving /work. */}
            <UpcomingTasksCard userId={profile.id} />

            {/* Phase 34G — Map view of this week's follow-ups. Closed
                by default; opens lazily so reps who don't want map
                don't pay the geocode + tile cost. */}
            <MeetingsMapPanel userId={profile.id} />

            {/* Phase 33Q — rep-side day tools: 3-day-miss warning,
                overnight stay toggle, request leave. One mountable
                block keeps WorkV2 tidy. */}
            <RepDayTools
              workDate={new Date().toISOString().slice(0, 10)}
              checkedIn={!!session?.check_in_at}
            />

            {/* Phase 33A — the old 5-tile m-quick grid replaced by
                the m-cta-stack of 3 giant buttons above. Surfaces
                left here as a small chip row for secondary actions
                (Follow-ups merged into Today's tasks card below
                already; this is the escape hatch). */}
            <div className="m-quick-chips">
              <button className="chip-link" onClick={() => navigate('/follow-ups')}>
                <ClockIcon size={13} /> Follow-ups
              </button>
              <button className="chip-link" onClick={() => navigate('/leads')}>
                <UsersIcon size={13} /> My leads
              </button>
              <button className="chip-link" onClick={() => navigate('/leads/new')}>
                <UserPlus size={13} /> New lead
              </button>
            </div>

            {!focusMode && session?.planned_meetings?.length > 0 && (
              <div className="m-card">
                <div className="m-card-title">Today's meetings</div>
                {session.planned_meetings.map((m, i) => (
                  <div key={i} className="m-meeting-row">
                    <span className="time">{m.time || '—'}</span>
                    <div className="info">
                      <div className="who">{m.client}</div>
                      {m.location && <div className="where">{m.location}</div>}
                    </div>
                    {/* Phase 22b — Mark done pattern from design.
                        m.done is a flag on the planned_meetings JSONB
                        array. Toggle persists to work_sessions row. */}
                    {m.done ? (
                      <Pill tone="success">✓ done</Pill>
                    ) : (
                      <button
                        type="button"
                        className="lead-btn lead-btn-sm lead-btn-primary"
                        onClick={() => toggleMeetingDone(i)}
                        disabled={busy}
                      >
                        Mark done
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Phase 33B.4 — voice-first evening report. Owner directive:
                speak the summary, don't type. The big mic button is the
                primary path; the form below is an optional fallback for
                reps who prefer typing. */}
            <button
              className="m-cta m-cta-big m-cta-primary"
              onClick={() => navigate('/voice/evening')}
              style={{ minHeight: 80, fontSize: 18, marginBottom: 14 }}
            >
              <Mic size={24} strokeWidth={1.8} />
              <span>Speak Evening Summary</span>
            </button>
            <details className="m-card" style={{ padding: 0 }}>
              <summary style={{
                padding: '12px 16px', cursor: 'pointer',
                fontSize: 13, color: 'var(--text-muted)',
                fontWeight: 500,
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
              <button className="m-cta" onClick={submitEvening} disabled={busy} style={{ marginTop: 12 }}>
                {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                Submit typed report
              </button>
              </div>
            </details>
          </>
        )}

        {/* ─── C_CHECKOUT: evening submitted, waiting for check-out ─── */}
        {stateName === 'C_CHECKOUT' && (
          <>
            <div className="m-card">
              <div className="m-card-title">Evening report submitted ✓</div>
              <DaySummary counters={counters} targets={targets} />
              {session?.evening_summary?.tomorrow_focus && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                  Tomorrow: {session.evening_summary.tomorrow_focus}
                </div>
              )}
            </div>
            <button className="m-cta" onClick={doCheckOut} disabled={busy}>
              <MapPin size={16} />
              {busy ? 'Capturing GPS…' : 'Check out'}
            </button>
          </>
        )}

        {/* ─── D_DONE ─── */}
        {stateName === 'D_DONE' && (
          <>
            <div className="m-counters">
              <Counter num={counters.meetings || 0} target={targets.meetings}  label="Meetings ✓" tone={counters.meetings >= targets.meetings ? 'good' : 'warn'} />
              <Counter num={counters.calls || 0}    target={targets.calls}     label="Calls"     tone={counters.calls >= targets.calls ? 'good' : 'warn'} />
              <Counter num={counters.new_leads || 0} target={targets.new_leads} label="Leads ✓"   tone={counters.new_leads >= targets.new_leads ? 'good' : 'warn'} />
            </div>

            <div className="m-card">
              <div className="m-card-title">Evening summary</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {session?.evening_summary?.quotes_sent ? `${session.evening_summary.quotes_sent} quotes sent. ` : ''}
                {session?.evening_summary?.blockers || ''}
              </div>
              {session?.evening_summary?.tomorrow_focus && (
                <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 8 }}>
                  <b>Tomorrow:</b> {session.evening_summary.tomorrow_focus}
                </div>
              )}
            </div>

            <button className="m-cta m-cta-ghost" onClick={() => navigate('/leads')}>
              View my leads
            </button>
          </>
        )}
      </div>

      {/* Phase 32M — Field Meeting fast-path. Opens from the "Log
          meeting" tile in B_ACTIVE. Modal handles its own form +
          INSERTs lead + activity. On save we reload the session row
          so the meetings counter at the top reflects the increment
          (Postgres trigger bump_meeting_counter does the actual bump
          on lead_activities INSERT). */}
      {meetingModalOpen && (
        <LogMeetingModal
          onClose={() => {
            setMeetingModalOpen(false)
            // Phase 34O — owner directive: after saving a meeting +
            // closing the post-save WhatsApp prompt, navigate the rep
            // to the new lead so they can keep working it (notes,
            // photo, schedule next-action). Previously the modal just
            // closed and left the rep stranded on /work.
            if (pendingNavLead) {
              const id = pendingNavLead
              setPendingNavLead(null)
              navigate(`/leads/${id}`)
            }
          }}
          onSaved={(newLeadId) => {
            // Phase 33A — surface a success toast so the rep gets
            // confirmation (audit P2 caught silent close on Phase 32M).
            // Compute the new meeting count optimistically — Phase 12
            // trigger has already fired by the time we get here.
            const next = (session?.daily_counters?.meetings || 0) + 1
            const tgt  = targets.meetings || 5
            setToast(`Saved · ${next}/${tgt} meetings today`)
            setTimeout(() => setToast(''), 2200)
            playChime()
            load()
            // Phase 34O — remember the new lead id; when the modal
            // closes (after the post-save WhatsApp prompt) navigate
            // to /leads/<id>.
            if (newLeadId) setPendingNavLead(newLeadId)
          }}
        />
      )}

      {/* Phase 33A — global toast strip. Slides up from bottom. Brand
          yellow with checkmark. Auto-clears after 2.2s. */}
      {toast && (
        <div className="m-toast">
          <CheckCircle2 size={16} strokeWidth={2} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}

/* ─── Sub-components ─── */
// Phase 33A — single big meeting ring on /work B_ACTIVE. Replaces
// the 3-counter row. SVG progress ring, big center number, tap to
// expand a sheet showing all 3 targets (meetings/calls/new leads).
// Phase 33D.6 — Today's task breakdown. Fetches today's open
// follow-ups for the current rep, classifies into general FUs vs
// nurture/lost calls, and offers tap-to-call-card actions. Tap any
// row → opens lead detail. Tap CALL → tel: with auto-log.
function TodayTasksBreakdown({ userId, navigate }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await supabase
        .from('follow_ups')
        .select(`
          id, lead_id, follow_up_date, follow_up_time, note,
          sequence, cadence_type, action_hint, auto_generated,
          lead:leads (id, name, company, phone, segment)
        `)
        .eq('is_done', false)
        .eq('assigned_to', userId)
        .lte('follow_up_date', today)
        .not('lead_id', 'is', null)
        .order('follow_up_date', { ascending: true })
        .limit(10)
      if (!cancelled) setRows(data || [])
    })()
    return () => { cancelled = true }
  }, [userId])

  // Phase 33D.6 — owner directive (11 May): overdue items shown first
  // so the rep sees what's already late before what's due today. The
  // query already pulls follow_up_date <= today; here we split into
  // overdue (< today) and today buckets, then sub-group by cadence.
  const today = new Date().toISOString().slice(0, 10)
  const isFollowUp = (r) => r.cadence_type === 'lead_intro' || r.cadence_type === 'quote_chase'
  const isNurture  = (r) => r.cadence_type === 'nurture' || r.cadence_type === 'lost_nurture'
  const overdueFollowUps = rows.filter(r => r.follow_up_date < today && isFollowUp(r))
  const overdueNurture   = rows.filter(r => r.follow_up_date < today && isNurture(r))
  const followUps        = rows.filter(r => r.follow_up_date >= today && isFollowUp(r))
  const nurtureCalls     = rows.filter(r => r.follow_up_date >= today && isNurture(r))
  const overdueCount = overdueFollowUps.length + overdueNurture.length

  if (rows.length === 0) {
    return (
      <div className="m-card" style={{ marginBottom: 14, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          ✓ All caught up — no follow-ups due
        </div>
      </div>
    )
  }

  function cleanPhone(raw) {
    if (!raw) return null
    const d = String(raw).replace(/\D/g, '')
    if (d.length < 10) return null
    return d.length === 10 ? '91' + d : d
  }

  function CallCard({ r }) {
    const phone = cleanPhone(r.lead?.phone)
    return (
      <div
        style={{
          padding: '10px 12px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10,
          marginBottom: 8,
        }}
      >
        <div
          onClick={() => navigate(`/leads/${r.lead_id}`)}
          style={{ cursor: 'pointer', marginBottom: 8 }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {r.lead?.name || 'Lead'}
            {r.lead?.company && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {r.lead.company}</span>
            )}
          </div>
          {r.action_hint && (
            <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
              → {r.action_hint}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {phone ? (
            <a
              href={`tel:+${phone}`}
              className="lead-btn lead-btn-sm lead-btn-primary"
              style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}
            >
              <Phone size={13} /> Call
            </a>
          ) : (
            <button className="lead-btn lead-btn-sm" disabled style={{ flex: 1 }}>No phone</button>
          )}
          {phone && (
            <a
              href={`https://wa.me/${phone}`}
              target="_blank" rel="noopener noreferrer"
              className="lead-btn lead-btn-sm"
              style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}
            >
              <Mic size={13} style={{ display: 'none' }} /> WhatsApp
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="m-card" style={{ marginBottom: 14, padding: '14px 16px' }}>
      <div style={{
        fontSize: 13, fontWeight: 600, marginBottom: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Today's tasks</span>
        <button
          className="lead-btn lead-btn-sm"
          onClick={() => navigate('/follow-ups')}
          style={{ fontSize: 11 }}
        >
          View all →
        </button>
      </div>
      {/* Phase 33D.6 — OVERDUE first (red), then today (muted).
          Within each, follow-ups before nurture. */}
      {overdueCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 700,
            color: 'var(--danger)',
            textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6,
          }}>
            ⚠ {overdueCount} overdue
          </div>
          {overdueFollowUps.slice(0, 3).map(r => <CallCard key={r.id} r={r} />)}
          {overdueNurture.slice(0, 2).map(r => <CallCard key={r.id} r={r} />)}
        </div>
      )}
      {followUps.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            {followUps.length} follow-up{followUps.length > 1 ? 's' : ''} today
          </div>
          {followUps.slice(0, 3).map(r => <CallCard key={r.id} r={r} />)}
        </div>
      )}
      {nurtureCalls.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            {nurtureCalls.length} nurture call{nurtureCalls.length > 1 ? 's' : ''} today
          </div>
          {nurtureCalls.slice(0, 3).map(r => <CallCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// Phase 33Q (item #1) — 3-round milestone rings. Owner asked for
// "all milestones in 3 rounds". Layout chosen: three side-by-side
// rings (Meetings · Calls · New leads), one for each daily target.
// Each ring is independently coloured by hit status. The middle ring
// is largest since Meetings is the variable-salary driver. Outer two
// are slightly smaller — visual hierarchy.
function MiniRing({ done, target, label, accent, isPrimary }) {
  const pct = Math.max(0, Math.min(1, target ? done / target : 0))
  const R = isPrimary ? 56 : 42
  const C = 2 * Math.PI * R
  const dash = C * pct
  const hit = done >= target
  const stroke = hit ? 'var(--success, #10B981)' : accent
  const size = isPrimary ? 140 : 110
  const view = isPrimary ? 160 : 130
  const cx = view / 2
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 4, flex: 1, minWidth: 0,
    }}>
      <svg viewBox={`0 0 ${view} ${view}`} width={size} height={size}>
        <circle cx={cx} cy={cx} r={R} fill="none"
          stroke="var(--surface-2, #1e293b)" strokeWidth={isPrimary ? 12 : 9} />
        <circle
          cx={cx} cy={cx} r={R} fill="none"
          stroke={stroke}
          strokeWidth={isPrimary ? 12 : 9}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: 'stroke-dasharray .4s ease' }}
        />
        <text x={cx} y={cx - 2} textAnchor="middle"
          fontSize={isPrimary ? 26 : 19} fontWeight="700"
          fontFamily="Space Grotesk, system-ui"
          fill="var(--text, #f1f5f9)">
          {done}/{target}
        </text>
      </svg>
      <div style={{
        fontSize: isPrimary ? 11 : 10, fontWeight: 600,
        letterSpacing: '.08em', textTransform: 'uppercase',
        color: hit ? 'var(--success, #10B981)' : 'var(--text-muted, #94a3b8)',
        marginTop: -4,
      }}>
        {label}
      </div>
    </div>
  )
}

function MeetingRing({ done, target, extras }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 4, padding: '6px 4px', flexWrap: 'wrap',
    }}>
      <MiniRing
        done={extras.calls} target={extras.callTarget}
        label="Calls" accent="var(--blue, #3B82F6)"
      />
      <MiniRing
        done={done} target={target}
        label="Meetings" accent="var(--accent, #FFE600)" isPrimary
      />
      <MiniRing
        done={extras.leads} target={extras.leadTarget}
        label="Leads" accent="#A78BFA"
      />
    </div>
  )
}

function Counter({ num, target, label, tone }) {
  const color = tone === 'good' ? 'var(--success)'
              : tone === 'warn' ? 'var(--warning)'
              : undefined
  return (
    <div className="m-count">
      <div className="num" style={color ? { color } : undefined}>
        {num}
        {target ? <span className="target">/{target}</span> : null}
      </div>
      <div className="lbl">{label}</div>
    </div>
  )
}

function PlanSummary({ session }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
      <span>{(session.planned_meetings || []).length} meetings · {session.planned_calls} calls · {session.planned_leads} new leads</span>
      {session.evening_summary?.focus && (
        <span>Focus: {session.evening_summary.focus}</span>
      )}
    </div>
  )
}

function DaySummary({ counters, targets }) {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
      <span><b style={{ color: 'var(--text)' }}>{counters.meetings}</b>/{targets.meetings} meetings</span>
      <span><b style={{ color: 'var(--text)' }}>{counters.calls}</b>/{targets.calls} calls</span>
      <span><b style={{ color: 'var(--text)' }}>{counters.new_leads}</b>/{targets.new_leads} new leads</span>
    </div>
  )
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
