// src/components/leads/PostCallOutcomeModal.jsx
//
// Phase 34Z.49 — voice-driven post-call outcome capture.
//
// Owner directive (15 May 2026):
//   "After I call the client, it land to the dialer. After I come back,
//    I see the WhatsApp message pop up. But what I want, after I come
//    back, I want lead status update. Like, you can open a voice tab.
//    Salesforce can speak and input the next follow-up or meeting or
//    whatever the output of the lead. Then once you submit the output
//    of that call or meeting, then you pop up the WhatsApp."
//
// Flow change in LeadDetailV2:
//   tap Call → tel: opens dialer → activity row inserted (outcome=null)
//   → 1.5s later this modal opens instead of WhatsApp
//   → rep speaks outcome (Gu/Hi/En via VoiceInput) + ticks chip
//   → optional Next-action: pick a follow-up date OR jump to Log meeting
//   → Save → patches the activity row with outcome + notes, upserts a
//     follow_ups row if a date was set, advances stage if needed
//   → onSaved fires which triggers WhatsApp prompt in the parent
//
// All writes go through supabase directly. No new RPC needed.

import { useEffect, useRef, useState } from 'react'
// eslint-disable-next-line no-unused-vars
import { Phone, Loader2, CheckCircle2, X, Calendar, MessageSquare, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import VoiceInput from '../voice/VoiceInput'
import { toastError, toastSuccess } from '../v2/Toast'
// Phase 56c — auto-fetch real call duration from Android CallLog
// after the modal save. No-op on web.
import { fetchAndPatchCallDuration } from '../../utils/callLogReader'
import { getCallElapsed } from '../../utils/callTimer'
// Phase 96.0 (2026-05-27) — schedule an AlarmManager-backed
// LocalNotification on the device when the rep saves a follow-up.
// OEM-immune (Vivo / Xiaomi / Realme can't kill an AlarmManager).
// Web no-op via Capacitor.isNativePlatform() guard inside helper.
//
// Phase B1/F-401 (2026-05-28) — also cancel alarms for follow-ups
// that get bulk-closed via Phase 34Z.62 close-prior-followups path.
// Cancel AFTER the UPDATE succeeds (not before): if UPDATE fails,
// row stays open + alarm stays armed = consistent. Cancel-first +
// UPDATE-fail would erase the alarm but leave the row open =
// missed reminder (worse than phantom).
import { scheduleFollowUpAlarm, cancelFollowUpAlarm } from '../../utils/scheduleFollowUpAlarm'

// Phase 34Z.53 — client-side intent parser. When the rep speaks
// (Whisper transcript appended to the notes field), scan for outcome
// + next-action + date keywords in English / Hindi / Gujarati and
// pre-fill the chips and the date picker. Edge-fn Claude classify
// would be more robust, but it inserts a duplicate lead_activities
// row in lead mode — keeping this local for the v1.
//
// Returns { outcome?, nextAction?, days? } — only fields it found.
function parseCallIntent(rawText) {
  const text = (rawText || '').toLowerCase().normalize('NFC')
  if (!text) return {}
  const out = {}

  // Outcome ---------------------------------------------------------
  // Positive — wants quote, agreed, said yes
  if (/\b(good|great|positive|interested|wants? (a )?(quote|price)|will (buy|book)|han|haan|haa\b|yes\b|yeah\b|agree[ds]?|confirmed|fix(ed)?)\b/.test(text)
      || /ગમ્યુ|ગમ્યું|હા\b|રસ છે|ક્વોટ|ખરીદ/.test(text)
      || /हाँ\b|हां\b|पसंद|दिलचस्पी|खरीद/.test(text)) {
    out.outcome = 'positive'
  }
  // Negative — not interested, refused, lost.
  // Phase 34Z.69 — broadened negation match. The earlier `\bnahi(\s|$)\b`
  // word-boundary rejected "nahi chahiye", "nahi nakhari", "nahi
  // interested" because Whisper sometimes emits them as one token or
  // glues a non-word char between them. Drop the trailing boundary —
  // any character after `nahi` is allowed; we just need to spot the
  // negation root in the utterance.
  if (/\b(not interested|no interest|lost|refused?|reject(ed)?|na nahi|nahi|na\s?nahi|nahi(\s|$)?(chahiye|nakhari|interested|kharido|levanu)?|no chance|dropped?|cancel(led)?)\b/.test(text)
      || /રસ નથી|ના\s?પાડી|ખરીદવુ?\s?નથી|રિજેક્ટ|નથી\s?જોઈતું|નથી\s?લેવુ/.test(text)
      || /नहीं चाहिए|नहीं\s?चाहिए|दिलचस्पी नहीं|मना|नहीं\s?लेना/.test(text)) {
    out.outcome = 'negative'
  }
  // Neutral — maybe, think, callback later
  if (!out.outcome && /\b(maybe|think|considering|callback|call back|try again|later|baad me|बाद|પછી|વિચાર|sochenge|sochna|will see|let me know)\b/.test(text)) {
    out.outcome = 'neutral'
  }

  // Days offset -----------------------------------------------------
  // "after 3 days" / "in 3 days" / "3 days later" — English
  let days = null
  const wordToNum = {
    // English
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    ten: 10, fifteen: 15, twenty: 20, thirty: 30,
    // Hindi (Latin transliteration)
    ek: 1, do: 2, teen: 3, char: 4, paanch: 5, saat: 7, das: 10, tees: 30,
    // Gujarati (Latin transliteration) — overlaps with Hindi for some.
    be: 2, tran: 3, panch: 5,
  }
  const m1 = text.match(/\b(?:after|in|aft|baad|બાદ|पछी|पछि)\s+(\d{1,3}|one|two|three|four|five|six|seven|ten|fifteen|twenty|thirty|ek|do|teen|char|paanch|saat|das|tees|be|tran|panch)\s*(?:days?|day|din|દિવસ|दिन)?/)
  if (m1) {
    const v = m1[1]
    days = /^\d+$/.test(v) ? parseInt(v, 10) : (wordToNum[v] ?? null)
  }
  // "tomorrow" / "kal" / "આવતી કાલે"
  if (days === null && /\btomorrow|kal\b|kalle\b|aavti\s?kaale|આવતી\s?કાલે|कल\b/.test(text)) {
    days = 1
  }
  // "next week" / "agle hafte" / "આવતા અઠવાડિયે"
  if (days === null && /next week|aglhe hafte|agla hafta|આવત(ા|ી)\s?અઠવાડિ|अगले हफ्ते/.test(text)) {
    days = 7
  }
  // "next month" / "ek mahine" / "આવતા મહિને"
  if (days === null && /next month|aagla mahina|agle maheene|આવત(ા|ી)\s?મહિને|अगले महीने/.test(text)) {
    days = 30
  }
  if (days !== null) out.days = days

  // Phase 107 — explicit "nurture" maps to the Nurture OUTCOME (park the
  // lead + auto 30-day re-pitch via the stage trigger), NOT a custom
  // 30-day follow-up. The outcome→default effect then forces nextAction
  // ='none', so no manual follow_up is inserted (the trigger owns it).
  if (/\bnurture\b/.test(text)) out.outcome = 'nurture'

  // Time of day -----------------------------------------------------
  // English: "at 3 pm", "at 11:30", "3 o'clock"
  // Hindi/Gujarati: "3 baje", "तीन बजे", "ત્રણ વાગ્યે", "બાર વાગ્યે"
  let hour = null, minute = 0
  const mClock = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/)
  if (mClock) {
    hour = parseInt(mClock[1], 10)
    minute = mClock[2] ? parseInt(mClock[2], 10) : 0
    const isPm = /p/.test(mClock[3])
    if (isPm && hour < 12) hour += 12
    if (!isPm && hour === 12) hour = 0
  }
  if (hour === null) {
    const mBaje = text.match(/\b(\d{1,2})\s*(?:o'?clock|baje|बजे|વાગ્યે|vagye)\b/)
    if (mBaje) {
      hour = parseInt(mBaje[1], 10)
      // Indian-English / Gujarati / Hindi reps usually mean PM for 1-7
      // when they say "X વાગ્યે" / "X baje" in a sales context — calls
      // happen in business hours. Treat 1-7 as PM unless "morning"
      // / "savaare" / "subah" / "સવારે" is in the same phrase.
      const morningHint = /\b(morning|am|savaare|savare|subah|સવારે)\b/.test(text)
      if (!morningHint && hour >= 1 && hour <= 7) hour += 12
    }
  }
  // Phase 34Z.69 — clamp out-of-range hours. Whisper occasionally
  // mis-transcribes "5" as "25", or matches the wrong digit group.
  // follow_ups.follow_up_time is a Postgres `time` column and rejects
  // hours >= 24 on insert. Drop the value rather than poison the row.
  if (hour !== null && (hour < 0 || hour > 23)) hour = null
  if (minute < 0 || minute > 59) minute = 0
  if (hour !== null) {
    const hh = String(hour).padStart(2, '0')
    const mm = String(minute).padStart(2, '0')
    out.time = `${hh}:${mm}`
  }

  // Meeting keyword overrides ---------------------------------------
  if (/\b(meeting|met him|met her|visit|site visit|in person|meet (them|him|her)|મીટિંગ|मीटिंग|मिलना|મળવા)\b/.test(text)) {
    out.nextAction = 'meeting'
  } else if (days === 1) {
    out.nextAction = 'follow_up_tomorrow'
  } else if (days !== null && days > 0) {
    // Phase 107 — the 3d / 7d / 30d preset chips were removed. Any parsed
    // day count other than 1 keeps its date via the custom-date path
    // (no preset chip). The "nurture" keyword routes to the Nurture
    // OUTCOME above instead of a day count.
    out.nextAction = 'follow_up_custom'
  }

  return out
}

function addDays(baseISO, days) {
  const d = baseISO ? new Date(baseISO) : new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

// Phase 47.9 — IST helpers via Intl.DateTimeFormat. Earlier
// version did `(5.5*60 - getTimezoneOffset())*60000` which only
// works when device is UTC. On an IST iOS device (offset = -330),
// the formula added 11h instead of 5.5h. Owner saw "Call back in
// 2h" at 18:21 IST set date=May 19 + time=01:50 AM (wrong).
// Intl with timeZone: 'Asia/Kolkata' always returns IST regardless
// of where the device clock is set.
function istTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${m.year}-${m.month}-${m.day}`
}
function istNowPlusHoursDateTime(hours) {
  const future = new Date(Date.now() + hours * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(future)
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]))
  // Some Intl impls return '24' for midnight; normalize.
  const hh = m.hour === '24' ? '00' : m.hour
  return {
    date: `${m.year}-${m.month}-${m.day}`,
    time: `${hh}:${m.minute}`,
  }
}

const OUTCOMES = [
  { value: 'positive', label: 'Good',       sub: 'Wants quote / more info', tone: 'success' },
  { value: 'neutral',  label: 'Maybe',      sub: 'Try again in a few days', tone: 'warn' },
  // Phase 45.3 — new "Call later" outcome. Distinct from Maybe so
  // we can capture "they want a callback" as a real signal (vs
  // generic Maybe = "not sure yet"). When picked, auto-fills
  // next_action = call_back_2h with today's date + now+2h.
  { value: 'callback', label: 'Call later', sub: 'Wants a callback',       tone: 'warn' },
  // Phase 107 — Nurture: a Lost-style outcome that PARKS the lead in
  // Nurture (not dead). The stage→Nurture cadence trigger
  // (lead_stage_change_cadence) auto-spawns the 30-day re-pitch follow-up,
  // so the modal forces nextAction='none' (no double insert). Blue (info)
  // tone keeps it visually distinct from the red Lost tile.
  { value: 'nurture',  label: 'Nurture',     sub: 'Re-pitch in 30 days',    tone: 'info' },
  { value: 'negative', label: 'Lost',       sub: 'Politely refused',       tone: 'danger' },
]

const NEXT_ACTIONS = [
  // Phase 45.1 / 47.9 — same-day callback chip. Owner trimmed
  // "Call back in 4 hours" + "Call back later today" — only
  // "Call back in 2 hours" remains. days=0 + hours=2 → auto-set
  // customDate=today (IST) and customTime=now+2h (IST).
  { value: 'call_back_2h',       label: 'Call back in 2 hours', days: 0, hours: 2 },
  { value: 'follow_up_tomorrow', label: 'Follow up tomorrow', days: 1 },
  // Phase 34Z.53 — meeting now carries a date (default tomorrow). Date
  // input below the chips lets the rep pick any date for any chip.
  { value: 'meeting',            label: 'Schedule a meeting',  days: 1 },
  { value: 'follow_up_custom',   label: 'Pick custom date…',   days: null },
  // Phase 107 #6 — owner trimmed "Follow up in 3 days", "Follow up next
  // week", and "Nurture · 30 days" from the visible chips (Nurture is now
  // an OUTCOME). 'none' is KEPT but hidden:true (filtered from the chip
  // grid) because Lost + Nurture force it so the save skips a manual
  // follow_up — their cadence triggers own the follow-up.
  { value: 'none',               label: 'No next action',      days: 0, hidden: true },
]

// Phase 107 — the VOICE_LANGS toggle was removed (owner shrank the
// "what did they say" section to a mic-only icon). VoiceInput now
// auto-detects the spoken language (languageHint="").

export default function PostCallOutcomeModal({
  open,
  lead,
  pendingActivityId,   // the activity row id inserted by quickLog (outcome=null)
  onClose,
  onSaved,             // fires after save — parent uses this to trigger WA prompt
  onLogMeeting,        // if rep picks 'meeting', parent opens LogMeetingModal
}) {
  const profile = useAuthStore(s => s.profile)
  const [outcome, setOutcome] = useState('')
  const [nextAction, setNextAction] = useState('follow_up_tomorrow')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  // Phase 113.4 — synchronous re-entrancy latch. The `saving` STATE guard
  // can't stop WebView ghost-clicks that fire handleSave several times in
  // one event-loop tick (state flips after a render). savingRef flips
  // before the activity write so re-entrant calls bail — no duplicate rows.
  const savingRef = useRef(false)
  // Phase 34Z.53 — custom date picker drives the follow_ups row date.
  // Defaults to the preset offset for the selected chip; rep can edit
  // freely. Once edited manually, chip selection no longer overrides.
  const [customDate, setCustomDate] = useState(addDays(null, 1))
  // Phase 34Z.60 — optional time of day. Owner asked for a time picker
  // alongside the date so "meet at 11 AM tomorrow" is one tap. Empty
  // string means "no time set" — follow_ups.follow_up_time stays null.
  const [customTime, setCustomTime] = useState('')
  const dateTouchedRef = useRef(false)
  const timeTouchedRef = useRef(false)
  // Phase 45.4 — declared up here alongside the other touched refs
  // so it exists before the reset useEffect callback writes to it.
  // (Previously declared after, which worked at runtime but was a
  // linter/reader hazard.)
  const nextActionTouchedRef = useRef(false)
  // Phase 107 — voiceLang toggle removed; VoiceInput auto-detects.
  // Phase 107 #7 — lost reason, captured when the Lost outcome is picked.
  // Saved to leads.lost_reason (the LeadsV2 "Price problem" filter reads
  // it). Replaces the removed "Call language (optional)" analytics section.
  const [lostReason, setLostReason] = useState('')  // '' = unset

  // Reset state every time the modal opens for a fresh call.
  useEffect(() => {
    if (open) {
      setOutcome('')
      setNextAction('follow_up_tomorrow')
      setNotes('')
      setCustomDate(addDays(null, 1))
      setCustomTime('')
      setLostReason('')
      dateTouchedRef.current = false
      timeTouchedRef.current = false
      // Phase 45.1 — reset smart-default tracker so each fresh modal
      // open re-runs the outcome→nextAction default rule.
      nextActionTouchedRef.current = false
    }
  }, [open])

  // Phase 45.1 + 45.3 — smart default. outcome='neutral' (Maybe) or
  // outcome='callback' (Call later) both default next-action to
  // "call back in 2 hours". Only fires if rep hasn't manually picked.
  // The call_back_2h chip's own auto-snap then fills customDate=today
  // and customTime=now+2h IST.
  //
  // Phase 97.6 (2026-05-28) — outcome='negative' (Lost) forces
  // nextAction='none'. Lost lead = no future contact needed.
  // The Next action card is hidden in the render block below when
  // outcome === 'negative' so the rep doesn't even see the chips.
  // (nextActionTouchedRef declared above with the other touched refs.)
  useEffect(() => {
    if (!open) return
    if (outcome === 'negative' || outcome === 'nurture') {
      // Force nextAction='none' on Lost AND Nurture — both hide the Next
      // action card, so override any prior manual pick. Lost = dead, no
      // follow-up. Nurture = the stage→Nurture cadence trigger
      // (lead_stage_change_cadence) spawns the 30-day re-pitch follow-up,
      // so a modal insert would DOUBLE it. Save chain skips the follow_up
      // insert (handleSave checks `nextAction !== 'none' && customDate`).
      setNextAction('none')
      return
    }
    if (nextActionTouchedRef.current) return
    if (outcome === 'neutral' || outcome === 'callback') {
      setNextAction('call_back_2h')
    }
  }, [outcome, open])

  // When the rep picks a chip, snap the date input to the preset
  // (unless they already overrode it manually). Phase 45.1 — extended
  // for same-day callback chips (days=0): force customDate to today
  // (IST), and if the chip carries an `hours` offset, auto-set
  // customTime = now + N hours IST. Rep can still override either.
  useEffect(() => {
    if (!open) return
    const meta = NEXT_ACTIONS.find(n => n.value === nextAction)
    if (!meta) return
    // Phase 45.4 — for call_back_* chips with hours set, compute
    // BOTH date + time together so midnight rollover (e.g. 22:30
    // IST + 4h = 02:30 next day) advances customDate too. Previous
    // implementation set customDate=today and customTime=02:30,
    // yielding a follow_up in the past.
    if (meta.days === 0 && meta.value.startsWith('call_back_') && typeof meta.hours === 'number') {
      const { date, time } = istNowPlusHoursDateTime(meta.hours)
      if (!dateTouchedRef.current) setCustomDate(date)
      if (!timeTouchedRef.current) setCustomTime(time)
      return
    }
    // Same-day callback without preset hours (call_back_today):
    // snap date to today; rep picks time manually.
    if (meta.days === 0 && meta.value.startsWith('call_back_')) {
      if (!dateTouchedRef.current) setCustomDate(istTodayISO())
      return
    }
    // Standard chips with day offset.
    if (!dateTouchedRef.current && meta.days != null && meta.days > 0) {
      setCustomDate(addDays(null, meta.days))
    }
  }, [nextAction, open])

  if (!open || !lead) return null

  const tone = OUTCOMES.find(o => o.value === outcome)?.tone
  const nextActionMeta = NEXT_ACTIONS.find(n => n.value === nextAction)
  const wantsDate = nextAction !== 'none'

  // Voice intent — wraps VoiceInput.onChange so each appended transcript
  // is scanned and the chips / date input updated. Owner directive:
  // "If I say call him after three days... the action must be filled
  // accordingly." Notes still receive the raw transcript so the rep
  // can review the actual words spoken.
  function handleVoiceNotes(next) {
    setNotes(next)
    if (!next) return
    // Only run the parser on the most recent appended sentence — keeps
    // the chips from flipping every keystroke. VoiceInput appends with
    // a space, so the tail after the last newline / period is the new
    // utterance.
    const tail = String(next).split(/[.\n]/).filter(Boolean).pop() || next
    const intent = parseCallIntent(tail)
    if (intent.outcome) setOutcome(intent.outcome)
    if (intent.nextAction) {
      setNextAction(intent.nextAction)
      if (intent.days != null && intent.days > 0) {
        setCustomDate(addDays(null, intent.days))
        // The voice command IS the rep's intent — let the chip-snap
        // useEffect keep working after this point.
        dateTouchedRef.current = false
      }
    }
    if (intent.time) {
      setCustomTime(intent.time)
      timeTouchedRef.current = true
    }
  }

  async function handleSave() {
    if (savingRef.current || saving) return
    if (!outcome) {
      toastError(new Error('Pick an outcome'), 'Tap Good / Maybe / Lost first.')
      return
    }
    // Phase 110 — block a follow-up scheduled in the PAST. The date input
    // already pins min=today (no past dates); this catches a past TIME
    // picked for today. Compares the absolute IST instant to now, so it's
    // timezone-correct. Future times + the auto-future chips pass through.
    if (nextAction !== 'none' && customDate && customTime) {
      const dueMs = new Date(`${customDate}T${customTime}:00+05:30`).getTime()
      if (Number.isFinite(dueMs) && dueMs <= Date.now()) {
        toastError(new Error('past time'), 'Pick a future time — that time has already passed.')
        return
      }
    }
    // Phase 113.4 — latch synchronously before the first write. The
    // validation above is synchronous (no await), so a ghost-click burst
    // already bails at the top guard the moment this is set — no re-check
    // needed here. Released on both exits below.
    savingRef.current = true
    setSaving(true)

    // 1. Patch the previously-inserted activity row with outcome + notes.
    //    Falls back to a fresh insert when pendingActivityId is missing
    //    (e.g. rep opened the modal manually instead of via tel:).
    // Phase 107 — Nurture is a UI-only outcome. lead_activities.outcome
    // CHECK allows positive/neutral/negative/callback (Phase 45.3), NOT
    // 'nurture'. Save it as 'neutral' (no heat change — correct for a
    // nurture); the real signal is stage→Nurture + the cadence trigger's
    // 30-day follow-up. The timeline note still reads "Call · Nurture".
    const savedOutcome = outcome === 'nurture' ? 'neutral' : outcome
    let activityError = null
    if (pendingActivityId) {
      const { error } = await supabase.from('lead_activities').update({
        outcome: savedOutcome,
        notes: [`Call · ${OUTCOMES.find(o => o.value === outcome)?.label || outcome}`, notes.trim() || null]
          .filter(Boolean).join(' — '),
      }).eq('id', pendingActivityId)
      activityError = error
    } else {
      const { error } = await supabase.from('lead_activities').insert([{
        lead_id: lead.id,
        activity_type: 'call',
        outcome: savedOutcome,
        notes: [`Call · ${OUTCOMES.find(o => o.value === outcome)?.label || outcome}`, notes.trim() || null]
          .filter(Boolean).join(' — '),
        created_by: profile?.id,
      }])
      activityError = error
    }
    if (activityError) {
      setSaving(false)
      savingRef.current = false   // Phase 113.4 — release latch
      toastError(activityError, 'Could not save call outcome.')
      return
    }

    // Phase 88.1 — optimistic close after the core write succeeds.
    // The activity row is the source of truth (Phase 34Z.66 score
    // trigger fires on it, Phase 34Z.55 push trigger fires on the
    // follow_up insert below, but neither blocks the user from
    // closing this modal). Everything below is secondary — fire in
    // the background so perceived save time drops from ~1500ms
    // (4-5 sequential awaits) to ~200ms (single activity round-
    // trip). Errors toast async; the chain contract still holds.
    setSaving(false)
    savingRef.current = false   // Phase 113.4 — release latch
    toastSuccess('Call outcome saved.')
    onSaved?.({ outcome, nextAction })
    if (nextAction === 'meeting') {
      onLogMeeting?.()
    }
    // Phase 88.1 — secondary writes in background. Wrapped in an
    // IIFE so the synchronous return path above can complete + the
    // modal can unmount before these promises resolve.
    ;(async () => {
      try {

    // Phase 97.3.1 (2026-05-28) — capture closing follow-up ids
    // BEFORE the stage advance below. Reason: trg_z_close_followups_
    // on_terminal fires AFTER UPDATE OF stage and flips ALL open
    // follow_ups on this lead to is_done=true at DB level. The Phase
    // 34Z.62 SELECT later (with .eq('is_done', false)) then finds 0
    // rows + the alarm cancel never fires + the in-AlarmManager alarm
    // for the just-closed follow_up survives + pops phantom hours
    // later. Capture here while is_done is still false.
    //
    // Phase 102.A (2026-05-29) — widen the SELECT to match the wider
    // close UPDATE below. Drops the prior `assigned_to = me` and
    // `follow_up_date <= today` filters so the alarm-cancel fan-out
    // covers EVERY open follow_up on the lead (cadence-spawned,
    // future-dated, reassigned). RLS still gates what the UPDATE
    // can actually flip; the SELECT runs against the same RLS so
    // ids returned here are exactly the ids the UPDATE will close.
    let earlyClosingIds = []
    if (profile?.id && lead.id) {
      const { data: ids, error: earlySelErr } = await supabase.from('follow_ups')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('is_done', false)
      if (earlySelErr) {
        console.warn('[phase-97.3.1] early SELECT failed; alarm cancel may miss:', earlySelErr.message)
      }
      earlyClosingIds = Array.isArray(ids) ? ids : []
    }

    // Phase 47.8 — patch most recent call_logs row for this user +
    // lead in the last 10 minutes with the picked call language.
    // Phase 54 F2 — same patch also writes the real outcome back to
    // call_logs (tel-tap defaults to 'no_answer'; here we upgrade
    // to 'connected' or 'callback_requested' once the rep confirms
    // what happened on the call). Combined patch = one round-trip.
    // Fire-and-forget; failure doesn't block save (analytics only).
    if (profile?.id && lead?.id) {
      // Phase 128.4 — cutoff 10 → 40 min. The Phase 126 aggressive dedup
      // can merge a re-tap into a call_logs row up to ~30 min old (survivor
      // keeps the OLDEST call_at); a 10-min window then matched 0 rows, the
      // row stayed no_answer, and the duration patch was filtered out
      // forever (Dhara 11 Jun: real 1m33s talk showed "—"). Guards intact:
      // same user+lead, outgoing-only, fires only on this rep's explicit
      // outcome save. The >=10s gate still solely decides the count (§49).
      const cutoff = new Date(Date.now() - 40 * 60 * 1000).toISOString()
      const callLogPatch = {}
      // Map lead_activities outcome → call_logs outcome enum.
      // Phase 107 — Nurture is a connected call too (the rep spoke to them).
      // (The "Call language" analytics write was removed in Phase 107 #3.)
      if (outcome === 'positive' || outcome === 'neutral' || outcome === 'negative' || outcome === 'nurture') {
        callLogPatch.outcome = 'connected'
      } else if (outcome === 'callback') {
        callLogPatch.outcome = 'callback_requested'
      }
      if (Object.keys(callLogPatch).length > 0) {
        // Phase 93.2c (24 May 2026) — restrict patch to outgoing rows.
        // Bug: when rep returned a missed-inbound call within the 10-
        // minute cutoff, this UPDATE also patched the missed-inbound
        // row to outcome='connected', creating impossible direction=
        // 'missed' + outcome='connected' combos that overstated
        // qualified-call counts on TeamDashboard / TC hero. The 93.1
        // hotfix masked the symptom at read-time; this one fixes the
        // root cause at write-time.
        //
        // .or() preserves legacy tel-tap audit rows where direction=
        // NULL (callAudit.js doesn't set direction on insert).
        // Phase 120 — AWAIT this outcome flip BEFORE the duration patch
        // (fetchAndPatchCallDuration) runs below. Root cause of the
        // call_logs-duration gap: the duration patch only writes onto a
        // row whose outcome is already 'connected'/'callback_requested'
        // (Phase 102.B). This flip used to be fire-and-forget and RACED
        // the duration patch; on the fallback path (no device CallLog
        // read → no await) the duration write fired first, saw the row
        // still at 'no_answer' (tel-tap default), and skipped — so the
        // duration landed in lead_activities only and call_logs stayed
        // NULL (TC console + 50-count undercount). Awaiting here is free:
        // we're already inside the Phase 88.1 background IIFE, after the
        // modal closed, so it adds zero perceived save latency.
        const { error: clOutErr } = await supabase.from('call_logs')
          .update(callLogPatch)
          .eq('user_id', profile.id)
          .eq('lead_id', lead.id)
          .gte('call_at', cutoff)
          .or('direction.is.null,direction.eq.outgoing')
        if (clOutErr) console.warn('[call-log-patch] update failed:', clOutErr.message)
      }

      // Phase 56c — Android wrapper only. Ask the native CallLog
      // reader for the real call duration (system call log holds
      // duration in seconds) and patch our row. Fire-and-forget
      // so the modal save UX doesn't wait for it. On web this
      // call returns null instantly.
      if (lead.phone) {
        // Pass the modal-save moment as telTapMs; callLogReader
        // applies its own 60-min lookback. Avoids compound
        // subtraction (guardian P3, 18 May 2026).
        // Phase 56j — also pass pendingActivityId so the patch
        // writes duration into lead_activities (which the
        // LeadDetailV2 timeline reads at line 1254). Without this
        // the duration sat in call_logs only and the timeline
        // showed no duration even after capture.
        fetchAndPatchCallDuration({
          userId:     profile.id,
          leadId:     lead.id,
          phone:      lead.phone,
          telTapMs:   Date.now(),
          activityId: pendingActivityId || null,
          // Phase 116 — in-app time-away fallback (callTimer). Used only
          // if the device CallLog read finds nothing; capped + connected-
          // only inside fetchAndPatchCallDuration.
          fallbackSeconds: getCallElapsed(lead.id),
        }).then((dur) => {
          if (dur != null) console.info('[call-log] patched duration', dur, 's')
        }).catch(() => { /* swallowed; permission deny is normal */ })
      }
    }

    // 2. Stage advancement based on outcome.
    //    positive on New → Working (auto-qualify)
    //    negative (rep tapped the Lost chip) → flip stage to Lost.
    //      Phase 56k (19 May 2026) — owner reported the Lost chip
    //      tagged the activity but left lead.stage untouched, so
    //      "Lost" leads kept appearing in the queue. Hard-flip on
    //      explicit Lost click. lost_reason stays NULL — rep can
    //      set it via Change stage modal later if they want a
    //      specific reason. stage_changed_at auto-stamps via the
    //      Phase 34L trigger.
    if (outcome === 'positive' && lead.stage === 'New') {
      const { error: stageErr } = await supabase.from('leads').update({
        stage: 'Working',
        qualified_at: lead.qualified_at || new Date().toISOString(),
      }).eq('id', lead.id)
      if (stageErr) toastError(stageErr, 'Stage auto-advance failed (lead saved).')
    } else if (outcome === 'nurture' && !['Nurture', 'Won', 'Lost'].includes(lead.stage)) {
      // Phase 107 — park the lead in Nurture. The stage→Nurture cadence
      // trigger (lead_stage_change_cadence) auto-spawns the 30-day re-pitch
      // follow-up, so the modal forces nextAction='none' (no double).
      const { error: stageErr } = await supabase.from('leads').update({
        stage: 'Nurture',
      }).eq('id', lead.id)
      if (stageErr) toastError(stageErr, 'Stage → Nurture failed (lead saved).')
    } else if (outcome === 'negative' && lead.stage !== 'Lost' && lead.stage !== 'Won') {
      const { error: stageErr } = await supabase.from('leads').update({
        stage: 'Lost',
        lost_reason: lostReason || null,   // Phase 107 #7 — capture the reason
      }).eq('id', lead.id)
      if (stageErr) toastError(stageErr, 'Stage auto-flip to Lost failed (lead saved).')
    }

    // Phase 34Z.62 — close the follow-up row that prompted this call.
    // Owner reported the home-page summary count stayed put after a
    // successful outcome because the OLD follow_up never flipped to
    // is_done. Mark every open follow_up on this lead as done so the
    // follow-up count on TodaySummaryCard / FollowUpsV2 / TelecallerV2
    // recomputes via realtime + auto-refresh.
    //
    // Phase 102.A (2026-05-29) — widen the UPDATE to cover all open
    // follow_ups on the lead. Drops the prior `assigned_to = me` and
    // `follow_up_date <= today` filters because (a) cadence triggers
    // (Phase 33D.6 trg_followup_after_done) spawn future-dated rows
    // owned by the same rep that were never closed, and (b) auto-
    // assign / reassign can drift `assigned_to` to a different rep
    // after a cadence row was spawned, leaving orphan opens.
    //
    // RLS still gates which rows actually flip:
    //   • fu_admin_all       — admin / co_owner full UPDATE
    //   • fu_sales_own       — sales rep on quote-linked follow_ups
    //   • (fu_telecaller_own — proposed; deferred to separate paste
    //                          if telecaller path silently fails)
    //
    // After this UPDATE, the new-FU INSERT at line ~636 lands a fresh
    // is_done=false row for the just-picked next-action. Order is
    // preserved: close all → insert one new.
    if (profile?.id && lead.id) {
      // Phase 97.3.1 — UPDATE is idempotent: trg_z_close_followups_
      // on_terminal already closed these rows above (if stage flipped
      // to Lost/Won) but the UPDATE still fires safely. The ids we
      // need for alarm cancel were captured BEFORE the stage advance
      // in earlyClosingIds.
      const { error: closeErr } = await supabase.from('follow_ups')
        .update({ is_done: true, done_at: new Date().toISOString() })
        .eq('lead_id', lead.id)
        .eq('is_done', false)
      if (closeErr) {
        // Truth 3b — was console.warn only (88.1 optimistic path): the old
        // follow-up silently stayed open → duplicate task tomorrow. Surface
        // it so the rep can re-save or mark it done by hand.
        console.warn('[phase-97.3.1] follow_ups UPDATE failed:', closeErr.message)
        toastError(closeErr, 'Could not close the old follow-up — it may reappear; mark it done from Follow-ups.')
      }
      if (earlyClosingIds.length > 0) {
        // Fan-out cancel using ids captured BEFORE stage advance.
        // allSettled so one cancel failure doesn't block the chain.
        // Failures logged but never bubble — stale cancel of an
        // already-fired alarm in AlarmManager is benign.
        Promise.allSettled(
          earlyClosingIds.map(r => cancelFollowUpAlarm(r.id))
        ).then(results => {
          results.forEach((res, i) => {
            if (res.status === 'rejected') {
              console.warn('[phase-97.3.1] cancel failed for',
                earlyClosingIds[i]?.id, res.reason?.message || res.reason)
            }
          })
        })
      }
    }

    // 3. Next-action: insert a follow_ups row dated to customDate.
    //    Owner directive (15 May 2026): every chip — including
    //    Meeting and Custom — carries a user-pickable date, no longer
    //    a fixed preset. 'none' is the only no-op.
    //    Phase 34Z.60 — also write follow_up_time when the rep set
    //    one in the time picker / voice intent.
    if (nextAction !== 'none' && customDate) {
      const isMeeting = nextAction === 'meeting'
      const noteText = notes.trim()
        || (isMeeting
            ? `Meeting · ${OUTCOMES.find(o => o.value === outcome)?.label || 'after call'}`
            : `After call · ${OUTCOMES.find(o => o.value === outcome)?.label || outcome}`)
      const fuRow = {
        lead_id: lead.id,
        assigned_to: profile?.id,
        follow_up_date: customDate,
        note: isMeeting ? `Meeting — ${noteText}` : noteText,
        is_done: false,
      }
      if (customTime) {
        // follow_ups.follow_up_time is a `time` column. HH:MM accepted.
        fuRow.follow_up_time = customTime
      }
      // Phase 96.0 — capture inserted id so we can schedule the
      // on-device alarm. Use plain .select('id') (no FK embed) +
      // array unwrap to dodge the .single() APK race (Phase 95.8
      // foot-gun: FK-embed + RLS combos return wrapped array on
      // Capacitor WebView). Bare insert+select has no FK embed
      // so this is purely defensive.
      const fuInsertRes = await supabase.from('follow_ups').insert([fuRow]).select('id')
      const fuErr = fuInsertRes.error
      const fuId  = Array.isArray(fuInsertRes.data)
        ? fuInsertRes.data[0]?.id
        : fuInsertRes.data?.id
      if (fuErr) {
        toastError(fuErr, 'Follow-up scheduled but DB write failed: ' + fuErr.message)
      } else if (fuId) {
        // Fire-and-forget AlarmManager schedule. Helper is native-only;
        // web/SSR path returns immediately. Failure here is a UX
        // degradation (rep still gets FCM push as backup) — log only.
        scheduleFollowUpAlarm({
          id:             fuId,
          lead_id:        lead.id,
          lead_name:      lead?.name || lead?.contact_name || 'Lead',
          follow_up_date: customDate,
          follow_up_time: customTime || null,
          note:           fuRow.note,
        }).catch((e) => console.warn('[phase96] alarm schedule failed:', e?.message || e))
      }
      // Phase 107 — the old `nurture_30d` pseudo-action stage flip was
      // removed. The Nurture OUTCOME now owns stage→Nurture (in the
      // handleSave stage block) + the stage→Nurture cadence trigger spawns
      // the 30-day re-pitch follow-up. This stale block double-wrote both.
      // Phase 34Z.60 — when nextAction is 'meeting', also insert a
      // separate lead_activities row of type 'meeting'. Without this
      // the timeline only shows the originating 'call' row and the
      // rep wonders where the scheduled meeting went. Owner reported
      // "when I schedule a meeting, it is not showing the meeting, it
      // is showing only on call notes."
      if (isMeeting) {
        const whenLabel = customTime
          ? `${customDate} ${customTime}`
          : customDate
        // Note: we deliberately DON'T pass next_action_date here —
        // Phase 34 trg_lead_activity_sync_followup would then upsert
        // another follow_ups row and overwrite the one we just wrote
        // above (with our custom note + time). Bake the date into the
        // notes text instead so the timeline still shows it.
        const { error: mtErr } = await supabase.from('lead_activities').insert([{
          lead_id: lead.id,
          activity_type: 'meeting',
          outcome: null,
          notes: `Meeting scheduled · ${whenLabel}${notes.trim() ? ' — ' + notes.trim() : ''}`,
          created_by: profile?.id,
        }])
        if (mtErr) {
          // Non-fatal — the follow_ups row above is the source of
          // truth for the rep's queue. Surface so we know.
          toastError(mtErr, 'Meeting scheduled but timeline write failed: ' + mtErr.message)
        }
      }
    }

    // 4. Phase 34Z.60 — close any open smart task on this lead
    //    assigned to this rep. Owner reported smart tasks staying
    //    visible after the outcome was logged, even from lead detail
    //    (Phase 34Z.54 only closed them when the call originated on
    //    /work). Use a single best-effort UPDATE; failure is non-fatal.
    if (profile?.id && lead.id) {
      await supabase.from('lead_tasks')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('lead_id', lead.id)
        .eq('assigned_to', profile.id)
        .eq('status', 'open')
    }
      } catch (e) {
        // Phase 88.1 — never throw out of the background IIFE; the
        // modal already closed + the rep already moved on.
        console.warn('[post-call-outcome] background write failed:', e?.message || e)
        toastError(e, 'Some follow-up writes failed — refresh to recheck.')
      }
    })()
  }

  return (
    <div className="lead-modal-back" onClick={(e) => {
      if (e.target === e.currentTarget && !saving) onClose?.()
    }}>
      <div className="lead-modal" style={{ width: 'min(520px, calc(100% - 32px))' }}>
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <Phone size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              How did the call go?
            </div>
            <div className="lead-card-sub">
              {lead.name || lead.company || 'Lead'} · speak or type the outcome
            </div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          {/* Outcome chips */}
          <div className="lead-card" style={{ marginBottom: 14 }}>
            <div className="lead-card-head"><div className="lead-card-title">Outcome *</div></div>
            <div className="lead-card-pad">
              {/* Phase 45.4 — 4-col grid (was 3) for 4 outcome chips
                  (Good / Maybe / Call later / Lost). Wraps to 2-col
                  on narrow screens. */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 8,
              }}>
                {OUTCOMES.map(o => {
                  const on = outcome === o.value
                  const tint =
                    o.tone === 'success' ? 'var(--tint-success, rgba(16,185,129,0.14))'
                    : o.tone === 'warn'   ? 'var(--tint-warning, rgba(245,158,11,0.14))'
                    : o.tone === 'info'   ? 'var(--tint-blue, rgba(59,130,246,0.14))'
                    :                       'var(--tint-danger, rgba(239,68,68,0.14))'
                  const bd =
                    o.tone === 'success' ? 'var(--success, #10B981)'
                    : o.tone === 'warn'   ? 'var(--warning, #F59E0B)'
                    : o.tone === 'info'   ? 'var(--blue, #3B82F6)'
                    :                       'var(--danger, #EF4444)'
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setOutcome(o.value)}
                      disabled={saving}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: `1.5px solid ${on ? bd : 'var(--border-strong, var(--v2-line))'}`,
                        background: on ? tint : 'var(--v2-bg-2, var(--surface-2))',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{o.sub}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Phase 107 — owner: shrink "what did they say" to just the
              voice-mic icon. No big textarea, no language toggle, no helper.
              The transcript still fills the outcome/next-action chips +
              notes via handleVoiceNotes; VoiceInput's confirm strip shows
              what was captured. Language auto-detects (Whisper). */}
          <div className="lead-card lead-card-pad" style={{ marginBottom: 14 }}>
            <label className="lead-fld-label" style={{ margin: 0, display: 'block', marginBottom: 6 }}>
              What did they say?
            </label>
            <VoiceInput
              value={notes}
              onChange={handleVoiceNotes}
              disabled={saving}
              languageHint=""
              placeholder="Type or speak what they said…"
            />
          </div>

          {/* Phase 107 #3 — "Call language (optional)" section removed per
              owner (redundant with the voice transcribe toggle above). */}

          {/* Phase 97.6 (2026-05-28) — Lost outcome hides the Next
              action card entirely. Lead is dead; no follow-up needed.
              Banner replaces the card so the rep sees explicit
              confirmation + a single Save action. The smart-default
              useEffect above sets nextAction='none' which makes
              handleSave skip the follow_up insert. */}
          {outcome === 'negative' ? (
            <div className="lead-card" style={{ marginBottom: 14 }}>
              <div className="lead-card-pad" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 16px',
                background: 'var(--danger-soft, rgba(239,68,68,0.12))',
                border: '1px solid var(--danger, #EF4444)',
                borderRadius: 'var(--radius, 10px)',
                color: 'var(--text)',
              }}>
                <span style={{ color: 'var(--danger, #EF4444)', flex: '0 0 auto', display: 'inline-flex' }}>
                  <X size={18} strokeWidth={1.6} />
                </span>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Marked Lost</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    Stage flips to Lost + open follow-ups close. No next-action needed.
                  </div>
                </div>
              </div>
              {/* Phase 107 #7 — lost reason → leads.lost_reason (the LeadsV2
                  "Price problem" filter reads it). Tap again to clear. */}
              <div className="lead-card-pad" style={{ paddingTop: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em',
                }}>
                  Reason <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
                </div>
                <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    { v: 'Price',        label: 'Price' },
                    { v: 'NoNeed',       label: 'No need' },
                    { v: 'WrongContact', label: 'Wrong contact' },
                    { v: 'NoResponse',   label: 'No response' },
                  ].map(r => {
                    const on = lostReason === r.v
                    return (
                      <button
                        key={r.v}
                        type="button"
                        onClick={() => setLostReason(on ? '' : r.v)}
                        disabled={saving}
                        style={{
                          padding: '6px 12px', borderRadius: 999,
                          border: `1px solid ${on ? 'var(--danger, #EF4444)' : 'var(--border-strong, var(--v2-line))'}`,
                          background: on ? 'var(--danger-soft, rgba(239,68,68,0.12))' : 'var(--v2-bg-2, var(--surface-2))',
                          color: on ? 'var(--danger, #EF4444)' : 'var(--text)',
                          cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {r.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : outcome === 'nurture' ? (
            /* Phase 107 #4 — Nurture parks the lead; the stage→Nurture
               cadence trigger auto-spawns the 30-day re-pitch. Next-action
               card hidden (like Lost) so no conflicting manual follow-up. */
            <div className="lead-card" style={{ marginBottom: 14 }}>
              <div className="lead-card-pad" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 16px',
                background: 'var(--tint-blue, rgba(59,130,246,0.12))',
                border: '1px solid var(--blue, #3B82F6)',
                borderRadius: 'var(--radius, 10px)',
                color: 'var(--text)',
              }}>
                <span style={{ color: 'var(--blue, #3B82F6)', flex: '0 0 auto', display: 'inline-flex' }}>
                  <Calendar size={18} strokeWidth={1.6} />
                </span>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Parked in Nurture</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    Stage → Nurture. Auto re-pitch follow-up in 30 days — no action needed now.
                  </div>
                </div>
              </div>
            </div>
          ) : (
          /* Next action chooser */
          <div className="lead-card" style={{ marginBottom: 14 }}>
            <div className="lead-card-head"><div className="lead-card-title">Next action</div></div>
            <div className="lead-card-pad">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {NEXT_ACTIONS.filter(n => !n.hidden).map(n => {
                  const on = nextAction === n.value
                  const icon = n.value === 'meeting' ? Calendar
                             : n.value === 'none'    ? null
                             : n.value === 'follow_up_custom' ? Pencil
                             :                         MessageSquare
                  const Icon = icon
                  return (
                    <button
                      key={n.value}
                      type="button"
                      onClick={() => {
                        setNextAction(n.value)
                        // Re-arm chip-driven date snap whenever the
                        // rep deliberately picks a chip.
                        dateTouchedRef.current = false
                        // Phase 45.1 — same-day callback chips also
                        // need the time-snap re-armed so the auto
                        // now+Nh fires after manual override.
                        if (n.value && n.value.startsWith('call_back_')) {
                          timeTouchedRef.current = false
                        }
                        // Phase 45.1 — mark next-action as touched so
                        // the outcome→default rule won't override.
                        nextActionTouchedRef.current = true
                      }}
                      disabled={saving}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: `1.5px solid ${on ? 'var(--v2-yellow, var(--accent, #FFE600))' : 'var(--border-strong, var(--v2-line))'}`,
                        background: on ? 'var(--accent-soft, rgba(255,230,0,0.14))' : 'var(--v2-bg-2, var(--surface-2))',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      {Icon && <Icon size={13} />}
                      <span>{n.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Phase 34Z.53 — custom date input. Visible for every
                  chip except "No next action". Snaps to preset offset
                  when chip changes; rep can pick any date freely.
                  Owner directive: meeting + follow-up need date pickers.
                  Phase 34Z.60 — paired with an optional time picker.
                  Voice intent ("at 11 am" / "3 baje" / "બાર વાગ્યે")
                  fills it automatically. */}
              {wantsDate && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <label className="lead-fld-label" style={{ margin: 0, fontSize: 11, minWidth: 36 }}>
                      Date
                    </label>
                    <input
                      type="date"
                      className="lead-inp"
                      value={customDate}
                      min={TODAY_ISO()}
                      onChange={(e) => {
                        setCustomDate(e.target.value)
                        dateTouchedRef.current = true
                      }}
                      disabled={saving}
                      style={{ maxWidth: 180 }}
                    />
                    <label className="lead-fld-label" style={{ margin: 0, fontSize: 11, minWidth: 36 }}>
                      Time
                    </label>
                    <input
                      type="time"
                      className="lead-inp"
                      value={customTime}
                      onChange={(e) => {
                        setCustomTime(e.target.value)
                        timeTouchedRef.current = true
                      }}
                      disabled={saving}
                      placeholder="optional"
                      style={{ maxWidth: 130 }}
                    />
                    {customTime && (
                      <button
                        type="button"
                        onClick={() => { setCustomTime(''); timeTouchedRef.current = false }}
                        disabled={saving}
                        style={{
                          background: 'transparent', border: 0,
                          color: 'var(--text-muted)', fontSize: 11,
                          cursor: 'pointer', textDecoration: 'underline',
                        }}
                      >
                        clear time
                      </button>
                    )}
                  </div>
                  {dateTouchedRef.current && (
                    <button
                      type="button"
                      onClick={() => {
                        const meta = NEXT_ACTIONS.find(n => n.value === nextAction)
                        const d = (meta && meta.days != null && meta.days > 0) ? meta.days : 1
                        setCustomDate(addDays(null, d))
                        dateTouchedRef.current = false
                      }}
                      disabled={saving}
                      style={{
                        marginTop: 6,
                        background: 'transparent', border: 0,
                        color: 'var(--text-muted)', fontSize: 11,
                        cursor: 'pointer', textDecoration: 'underline',
                      }}
                    >
                      reset date to preset
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          )}
        </div>

        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onClose} disabled={saving}>Skip for now</button>
          <button
            className="lead-btn lead-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving
              ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
              : <><CheckCircle2 size={12} /> Save outcome</>}
          </button>
        </div>
      </div>
    </div>
  )
}
