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
  // Negative — not interested, refused, lost
  if (/\b(not interested|no interest|lost|refused?|reject(ed)?|na nahi|nahi(\s|$)|nahi chahiye|no chance|dropped?|cancel(led)?)\b/.test(text)
      || /રસ નથી|ના\s?પાડી|ખરીદવુ?\s?નથી|રિજેક્ટ/.test(text)
      || /नहीं चाहिए|नहीं\s?चाहिए|दिलचस्पी नहीं|मना/.test(text)) {
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
  // "next month" / "ek mahine" / "આવતા મહિને" / "nurture"
  if (days === null && /next month|aagla mahina|agle maheene|આવત(ા|ી)\s?મહિને|अगले महीने|nurture/.test(text)) {
    days = 30
  }
  if (days !== null) out.days = days

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
  } else if (days === 3) {
    out.nextAction = 'follow_up_3d'
  } else if (days === 7) {
    out.nextAction = 'follow_up_7d'
  } else if (days === 30) {
    out.nextAction = 'nurture_30d'
  } else if (days !== null && days > 0) {
    // Custom days — keep the date but don't pick a preset chip.
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

const OUTCOMES = [
  { value: 'positive', label: 'Good',  sub: 'Wants quote / more info', tone: 'success' },
  { value: 'neutral',  label: 'Maybe', sub: 'Try again in a few days', tone: 'warn' },
  { value: 'negative', label: 'Lost',  sub: 'Politely refused',        tone: 'danger' },
]

const NEXT_ACTIONS = [
  { value: 'follow_up_tomorrow', label: 'Follow up tomorrow', days: 1 },
  { value: 'follow_up_3d',       label: 'Follow up in 3 days', days: 3 },
  { value: 'follow_up_7d',       label: 'Follow up next week', days: 7 },
  { value: 'nurture_30d',        label: 'Nurture · 30 days',   days: 30 },
  // Phase 34Z.53 — meeting now carries a date (default tomorrow). Date
  // input below the chips lets the rep pick any date for any chip.
  { value: 'meeting',            label: 'Schedule a meeting',  days: 1 },
  { value: 'follow_up_custom',   label: 'Pick custom date…',   days: null },
  { value: 'none',               label: 'No next action',      days: 0 },
]

// Language toggle for the voice transcriber. 'auto' (default) sends an
// empty hint to voice-process, which makes Whisper genuinely auto-
// detect — fixes the Phase 34Z.49 default 'gu' that was biasing English
// and Hindi speech into Gujarati script.
const VOICE_LANGS = [
  { value: 'auto', label: 'Auto', hint: '' },
  { value: 'gu',   label: 'ગુ',    hint: 'gu' },
  { value: 'hi',   label: 'हि',    hint: 'hi' },
  { value: 'en',   label: 'En',   hint: 'en' },
]

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
  const [nextAction, setNextAction] = useState('follow_up_3d')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  // Phase 34Z.53 — custom date picker drives the follow_ups row date.
  // Defaults to the preset offset for the selected chip; rep can edit
  // freely. Once edited manually, chip selection no longer overrides.
  const [customDate, setCustomDate] = useState(addDays(null, 3))
  // Phase 34Z.60 — optional time of day. Owner asked for a time picker
  // alongside the date so "meet at 11 AM tomorrow" is one tap. Empty
  // string means "no time set" — follow_ups.follow_up_time stays null.
  const [customTime, setCustomTime] = useState('')
  const dateTouchedRef = useRef(false)
  const timeTouchedRef = useRef(false)
  // Language toggle for the voice mic. 'auto' is the new default
  // (Phase 34Z.49 hardcoded 'gu' which was biasing English/Hindi).
  const [voiceLang, setVoiceLang] = useState('auto')

  // Reset state every time the modal opens for a fresh call.
  useEffect(() => {
    if (open) {
      setOutcome('')
      setNextAction('follow_up_3d')
      setNotes('')
      setCustomDate(addDays(null, 3))
      setCustomTime('')
      setVoiceLang('auto')
      dateTouchedRef.current = false
      timeTouchedRef.current = false
    }
  }, [open])

  // When the rep picks a chip, snap the date input to the preset
  // (unless they already overrode it manually).
  useEffect(() => {
    if (!open) return
    if (dateTouchedRef.current) return
    const meta = NEXT_ACTIONS.find(n => n.value === nextAction)
    if (meta && meta.days != null && meta.days > 0) {
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
    if (saving) return
    if (!outcome) {
      toastError(new Error('Pick an outcome'), 'Tap Good / Maybe / Lost first.')
      return
    }
    setSaving(true)

    // 1. Patch the previously-inserted activity row with outcome + notes.
    //    Falls back to a fresh insert when pendingActivityId is missing
    //    (e.g. rep opened the modal manually instead of via tel:).
    let activityError = null
    if (pendingActivityId) {
      const { error } = await supabase.from('lead_activities').update({
        outcome,
        notes: [`Call · ${OUTCOMES.find(o => o.value === outcome)?.label}`, notes.trim() || null]
          .filter(Boolean).join(' — '),
      }).eq('id', pendingActivityId)
      activityError = error
    } else {
      const { error } = await supabase.from('lead_activities').insert([{
        lead_id: lead.id,
        activity_type: 'call',
        outcome,
        notes: [`Call · ${OUTCOMES.find(o => o.value === outcome)?.label}`, notes.trim() || null]
          .filter(Boolean).join(' — '),
        created_by: profile?.id,
      }])
      activityError = error
    }
    if (activityError) {
      setSaving(false)
      toastError(activityError, 'Could not save call outcome.')
      return
    }

    // 2. Stage advancement based on outcome.
    //    positive on New → Working (auto-qualify)
    //    negative on anything → suggest Lost via the existing 15-attempt
    //    soft trigger (don't flip stage hard here)
    if (outcome === 'positive' && lead.stage === 'New') {
      const { error: stageErr } = await supabase.from('leads').update({
        stage: 'Working',
        qualified_at: lead.qualified_at || new Date().toISOString(),
      }).eq('id', lead.id)
      if (stageErr) toastError(stageErr, 'Stage auto-advance failed (lead saved).')
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
            : `After call · ${OUTCOMES.find(o => o.value === outcome)?.label}`)
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
      const { error: fuErr } = await supabase.from('follow_ups').insert([fuRow])
      if (fuErr) {
        toastError(fuErr, 'Follow-up scheduled but DB write failed: ' + fuErr.message)
      }
      // Nurture pseudo-action also flips the lead to Nurture stage.
      if (nextAction === 'nurture_30d' && lead.stage !== 'Won' && lead.stage !== 'Lost') {
        await supabase.from('leads').update({
          stage: 'Nurture',
          revisit_date: customDate,
        }).eq('id', lead.id)
      }
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

    setSaving(false)
    toastSuccess('Call outcome saved.')

    // 4. Hand off to parent. parent decides whether to open WA prompt
    //    or jump to Log meeting based on nextAction.
    onSaved?.({ outcome, nextAction })
    if (nextAction === 'meeting') {
      onLogMeeting?.()
    }
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {OUTCOMES.map(o => {
                  const on = outcome === o.value
                  const tint =
                    o.tone === 'success' ? 'var(--tint-success, rgba(16,185,129,0.14))'
                    : o.tone === 'warn'   ? 'var(--tint-warning, rgba(245,158,11,0.14))'
                    :                       'var(--tint-danger, rgba(239,68,68,0.14))'
                  const bd =
                    o.tone === 'success' ? 'var(--success, #10B981)'
                    : o.tone === 'warn'   ? 'var(--warning, #F59E0B)'
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

          {/* Voice notes */}
          <div className="lead-card lead-card-pad" style={{ marginBottom: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, marginBottom: 6, flexWrap: 'wrap',
            }}>
              <label className="lead-fld-label" style={{ margin: 0 }}>
                What did they say? (voice or type)
              </label>
              {/* Phase 34Z.53 — language toggle. Default Auto so Whisper
                  detects the spoken language. Earlier 'gu' default was
                  forcing Gujarati script on English/Hindi speech. */}
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {VOICE_LANGS.map(l => {
                  const on = voiceLang === l.value
                  return (
                    <button
                      key={l.value}
                      type="button"
                      onClick={() => setVoiceLang(l.value)}
                      disabled={saving}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 999,
                        border: `1px solid ${on ? 'var(--v2-yellow, var(--accent, #FFE600))' : 'var(--border-strong, var(--v2-line))'}`,
                        background: on
                          ? 'var(--accent-soft, rgba(255,230,0,0.14))'
                          : 'var(--v2-bg-2, var(--surface-2))',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 11,
                        lineHeight: 1.2,
                      }}
                      title={`Voice transcribe as ${l.label}`}
                    >
                      {l.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <VoiceInput
              multiline
              rows={3}
              value={notes}
              onChange={handleVoiceNotes}
              placeholder="Speak: 'after 3 days follow up' / 'મીટિંગ આવતી કાલે' / 'lost, not interested'"
              disabled={saving}
              languageHint={VOICE_LANGS.find(l => l.value === voiceLang)?.hint || ''}
            />
            <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 6, lineHeight: 1.4 }}>
              Say outcome + next action — chips fill in automatically.
              Examples: "good, follow up in 3 days" · "meeting tomorrow" · "lost, not interested".
            </div>
          </div>

          {/* Next action chooser */}
          <div className="lead-card" style={{ marginBottom: 14 }}>
            <div className="lead-card-head"><div className="lead-card-title">Next action</div></div>
            <div className="lead-card-pad">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {NEXT_ACTIONS.map(n => {
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
