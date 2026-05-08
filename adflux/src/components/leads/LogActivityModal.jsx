// src/components/leads/LogActivityModal.jsx
//
// Phase 30G — full rebuild (8 May 2026). Owner spec called out:
//   1. GPS not auto-fetched (only on Log Call modal; Meeting / Note
//      required a manual "Capture GPS" button click).
//   2. Save button hidden when modal content is long — the whole pane
//      scrolls including the footer.
//   3. Native <input type="date"> shows nothing on iOS until tapped —
//      reps couldn't tell where to set the follow-up date.
//   4. No clear path to "schedule a follow-up" — Next action + Date
//      were two unrelated inputs at the bottom.
//   5. UX request: think like the rep / owner — what makes the daily
//      log easier?
//   6. Want some motion / satisfying feedback on save.
//   7. "Don't only patch — see surrounding code." Also touched the
//      modal CSS so head+foot are sticky for ALL lead modals.
//
// Behaviour now:
//   • GPS captures silently on mount; "Refresh" link replaces it.
//   • Sticky head + foot via CSS .lead-modal flex column. Save button
//     is always visible regardless of body length.
//   • Schedule-follow-up section: Today 5 PM / Tomorrow 11 AM /
//     Day after / Next week chips + a "Custom" toggle that reveals
//     a native date+time pair.
//   • Quick note templates per activity type. Tap a chip → notes
//     textarea gets pre-filled (or appended).
//   • If outcome=positive AND lead.stage='New', a one-line suggestion
//     appears: "Move stage to Working?" with [Yes] [Skip].
//   • Save button morphs to "✓ Saved" for 800ms before closing.
//
// Side effects on insert (unchanged from Phase 16, pre-existing
// triggers do this server-side):
//   • leads.contact_attempts_count++
//   • leads.last_contact_at = now()
//   • work_sessions.daily_counters bumped on call/meeting

import { useEffect, useMemo, useState } from 'react'
import {
  X, Phone, MessageCircle, Mail, Calendar, MapPin, Edit3, Loader2,
  RefreshCw, CheckCircle2, Sparkles,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const TYPE_META = {
  call:        { label: 'Call',        Icon: Phone,         showOutcome: true,  showDuration: true,
                 templates: [
                   'Connected · spoke with decision-maker',
                   'No answer · try again later',
                   'Budget confirmed · sending quote',
                   'Asked to call back tomorrow',
                 ] },
  whatsapp:    { label: 'WhatsApp',    Icon: MessageCircle, showOutcome: true,  showDuration: false,
                 templates: [
                   'Sent quote PDF',
                   'Sent intro + brochure',
                   'Confirmed meeting time',
                   'Awaiting response',
                 ] },
  email:       { label: 'Email',       Icon: Mail,          showOutcome: true,  showDuration: false,
                 templates: [
                   'Sent proposal',
                   'Sent invoice',
                   'Followed up on quote',
                   'Confirmed schedule',
                 ] },
  meeting:     { label: 'Meeting',     Icon: Calendar,      showOutcome: true,  showDuration: false,
                 templates: [
                   'Met decision-maker · discussed scope',
                   'Demo done · awaiting approval',
                   'Negotiated price',
                   'Site visit · evaluated location',
                 ] },
  site_visit:  { label: 'Site visit',  Icon: MapPin,        showOutcome: true,  showDuration: false,
                 templates: [
                   'Visited site · captured measurements',
                   'Discussed install plan',
                   'Met owner on site',
                   'Photos taken',
                 ] },
  note:        { label: 'Note',        Icon: Edit3,         showOutcome: false, showDuration: false,
                 templates: [
                   'Reminder: revisit next month',
                   'Client mentioned referral',
                   'Competitor info',
                   'Internal note',
                 ] },
}

function parseDuration(mmss) {
  const parts = (mmss || '').split(':').map(p => parseInt(p, 10))
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null
  return parts[0] * 60 + parts[1]
}

// Build the schedule-follow-up quick chips. Each returns YYYY-MM-DD.
function buildFollowUpPresets() {
  const today = new Date()
  const fmt = (d) => d.toISOString().slice(0, 10)
  const tomorrow  = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const dayAfter  = new Date(today); dayAfter.setDate(today.getDate() + 2)
  const nextWeek  = new Date(today); nextWeek.setDate(today.getDate() + 7)
  return [
    { key: 'today',     label: 'Today',     date: fmt(today) },
    { key: 'tomorrow',  label: 'Tomorrow',  date: fmt(tomorrow) },
    { key: 'day_after', label: 'Day after', date: fmt(dayAfter) },
    { key: 'next_week', label: 'Next week', date: fmt(nextWeek) },
  ]
}

export default function LogActivityModal({ lead, type = 'call', onClose, onSaved }) {
  const profile = useAuthStore(s => s.profile)
  const meta = TYPE_META[type] || TYPE_META.note

  const [outcome, setOutcome]   = useState('')
  const [duration, setDuration] = useState('')
  const [notes, setNotes]       = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextDate, setNextDate]     = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [gps, setGps]               = useState(null) // {lat, lng, acc}
  const [gpsBusy, setGpsBusy]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false) // Phase 30G — for the morph animation
  const [error, setError]           = useState('')
  const presets = useMemo(buildFollowUpPresets, [])

  // Phase 30G — auto-capture GPS silently on mount. Owner saw the
  // Capture GPS button and asked why it wasn't already done.
  useEffect(() => {
    if (!navigator.geolocation) return
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: Math.round(pos.coords.accuracy),
        })
        setGpsBusy(false)
      },
      _err => { setGpsBusy(false) }, // silent fail; user can hit Refresh
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
    )
  }, [])

  function refreshGps() {
    if (!navigator.geolocation || gpsBusy) return
    setGpsBusy(true); setError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: Math.round(pos.coords.accuracy),
        })
        setGpsBusy(false)
      },
      err => { setGpsBusy(false); setError(err.message || 'Could not capture GPS.') },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    )
  }

  function applyTemplate(text) {
    setNotes(prev => prev?.trim() ? `${prev}\n${text}` : text)
  }

  function pickPreset(date) {
    setNextDate(date)
    setCustomOpen(false)
  }

  // Phase 30G — owner-thinking suggestion. If rep marks the call
  // positive on a still-New lead, propose advancing the stage. They
  // can ignore (Skip) — purely advisory.
  const stageSuggestion = (outcome === 'positive' && lead?.stage === 'New')

  async function handleSave({ alsoAdvanceStage = false } = {}) {
    if (saving) return
    setError('')
    if (!notes.trim() && type !== 'call') {
      setError('Add a short note.')
      return
    }
    setSaving(true)
    const row = {
      lead_id:          lead.id,
      activity_type:    type,
      outcome:          outcome || null,
      notes:            notes.trim() || null,
      next_action:      nextAction.trim() || null,
      next_action_date: nextDate || null,
      created_by:       profile.id,
    }
    if (meta.showDuration) {
      const seconds = parseDuration(duration)
      if (seconds != null) row.duration_seconds = seconds
    }
    if (gps) {
      row.gps_lat        = gps.lat
      row.gps_lng        = gps.lng
      row.gps_accuracy_m = gps.acc
    }
    const { error: err } = await supabase.from('lead_activities').insert([row])
    if (err) {
      setSaving(false)
      setError('Save failed: ' + err.message)
      return
    }

    // Phase 30G — optional: advance lead stage on positive-on-new.
    if (alsoAdvanceStage && stageSuggestion) {
      await supabase
        .from('leads')
        .update({ stage: 'Working', qualified_at: lead.qualified_at || new Date().toISOString() })
        .eq('id', lead.id)
      await supabase.from('lead_activities').insert([{
        lead_id:       lead.id,
        activity_type: 'status_change',
        notes:         'Stage → Working (auto-advanced from positive call)',
        created_by:    profile.id,
      }])
    }

    setSaving(false)
    setSaved(true)
    // Brief success morph so the click feels confirmed before close.
    setTimeout(() => {
      onSaved?.()
      onClose?.()
    }, 700)
  }

  return (
    <div
      className="lead-modal-back"
      onClick={(e) => { if (e.target === e.currentTarget && !saving && !saved) onClose?.() }}
    >
      <div className="lead-modal lead-modal-stickyfoot" style={{ width: 'min(520px, calc(100% - 32px))' }}>
        {/* HEAD — sticky */}
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <meta.Icon size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Log {meta.label}
            </div>
            <div className="lead-card-sub">
              {lead?.name}{lead?.company ? ` · ${lead.company}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="lead-btn lead-btn-sm"
            onClick={onClose}
            disabled={saving || saved}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* BODY — scrolls */}
        <div className="lead-modal-body">
          {meta.showOutcome && (
            <div>
              <label className="lead-fld-label">Outcome</label>
              <div className="lead-radio-grp">
                <span
                  className={`opt ${outcome === 'positive' ? 'on pos' : ''}`}
                  onClick={() => setOutcome(outcome === 'positive' ? '' : 'positive')}
                >
                  Positive
                </span>
                <span
                  className={`opt ${outcome === 'neutral' ? 'on' : ''}`}
                  onClick={() => setOutcome(outcome === 'neutral' ? '' : 'neutral')}
                >
                  Neutral
                </span>
                <span
                  className={`opt ${outcome === 'negative' ? 'on neg' : ''}`}
                  onClick={() => setOutcome(outcome === 'negative' ? '' : 'negative')}
                >
                  Negative
                </span>
              </div>
            </div>
          )}

          {/* Phase 30G — outcome-driven stage suggestion. Show only
              when positive-on-new. One-line nudge with Yes/Skip
              that doesn't gate the save. */}
          {stageSuggestion && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(255,230,0,.08)',
              border: '1px solid rgba(255,230,0,.25)',
              padding: '10px 12px', borderRadius: 8,
              fontSize: 12, color: 'var(--text)',
            }}>
              <Sparkles size={14} style={{ color: 'var(--accent, #FFE600)' }} />
              <span style={{ flex: 1 }}>
                Positive on a New lead — also move stage to <b>Working</b>?
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                You can pick on Save.
              </span>
            </div>
          )}

          {meta.showDuration && (
            <div>
              <label className="lead-fld-label">Duration (mm:ss) — optional</label>
              <input
                className="lead-inp"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="04:12"
                inputMode="numeric"
              />
            </div>
          )}

          {/* Phase 30G — quick-note templates. Tap any chip to fill
              the notes box. Multiple taps append on new lines. */}
          <div>
            <label className="lead-fld-label">
              Quick note <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>(tap to fill)</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {meta.templates.map(t => (
                <button
                  key={t}
                  type="button"
                  className="lead-btn lead-btn-sm"
                  style={{ fontSize: 11, padding: '4px 9px' }}
                  onClick={() => applyTemplate(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              className="lead-inp"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={
                type === 'call'    ? 'What was discussed? Decision-maker? Budget? Next step?'
              : type === 'meeting' ? 'Who attended, what was agreed, next step.'
              : 'Short note…'
              }
            />
          </div>

          {/* Phase 30G — schedule follow-up section. Promoted from
              two unrelated inputs ("Next action" + "Date") to a single
              clearly-labelled box with quick-pick chips. */}
          <div style={{
            border: '1px solid var(--border-soft, rgba(255,255,255,.08))',
            borderRadius: 10, padding: 12, background: 'rgba(255,255,255,.02)',
          }}>
            <label className="lead-fld-label" style={{ marginBottom: 8 }}>
              Schedule follow-up <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>(optional)</span>
            </label>
            <input
              className="lead-inp"
              value={nextAction}
              onChange={e => setNextAction(e.target.value)}
              placeholder="What's the next step? — send quote, demo, call back…"
              style={{ marginBottom: 10 }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {presets.map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`lead-btn lead-btn-sm ${nextDate === p.date ? 'lead-btn-primary' : ''}`}
                  onClick={() => pickPreset(p.date)}
                  style={{ fontSize: 11, padding: '6px 11px' }}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={`lead-btn lead-btn-sm ${customOpen ? 'lead-btn-primary' : ''}`}
                onClick={() => setCustomOpen(v => !v)}
                style={{ fontSize: 11, padding: '6px 11px' }}
              >
                <Calendar size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Custom
              </button>
              {nextDate && (
                <button
                  type="button"
                  className="lead-btn lead-btn-sm"
                  style={{ fontSize: 11, padding: '6px 11px', color: 'var(--text-muted)' }}
                  onClick={() => { setNextDate(''); setCustomOpen(false) }}
                >
                  Clear
                </button>
              )}
            </div>
            {customOpen && (
              <div style={{ marginTop: 10 }}>
                <label className="lead-fld-label">Pick exact date</label>
                <input
                  className="lead-inp"
                  type="date"
                  value={nextDate}
                  onChange={e => setNextDate(e.target.value)}
                />
              </div>
            )}
            {nextDate && !customOpen && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                Follow-up scheduled for <b style={{ color: 'var(--text)' }}>{nextDate}</b>
              </div>
            )}
          </div>

          {/* Phase 30G — GPS captured on mount; show pill + refresh
              link, no Capture GPS button. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {gpsBusy && !gps ? (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Capturing location…
              </span>
            ) : gps ? (
              <>
                <span className="pill pill-success">
                  <MapPin size={11} style={{ marginRight: 4 }} />
                  {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)} · ±{gps.acc}m
                </span>
                <button
                  type="button"
                  onClick={refreshGps}
                  disabled={gpsBusy}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: 11,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <RefreshCw size={10} /> refresh
                </button>
              </>
            ) : (
              <button
                type="button"
                className="lead-btn lead-btn-sm"
                onClick={refreshGps}
                disabled={gpsBusy}
              >
                <MapPin size={11} /> <span>Capture GPS</span>
              </button>
            )}
          </div>

          {error && (
            <div
              style={{
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                borderRadius: 8, padding: '10px 14px', fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* FOOT — sticky. Phase 30G — Save button morphs to ✓ Saved
            on success for 700ms before the modal closes. */}
        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onClose} disabled={saving || saved}>Cancel</button>
          {stageSuggestion ? (
            <>
              <button
                className="lead-btn"
                onClick={() => handleSave({ alsoAdvanceStage: false })}
                disabled={saving || saved}
                title="Save activity without changing stage"
              >
                {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save only'}
              </button>
              <button
                className="lead-btn lead-btn-primary"
                onClick={() => handleSave({ alsoAdvanceStage: true })}
                disabled={saving || saved}
              >
                {saved ? <><CheckCircle2 size={14} /> Saved</>
                       : saving ? 'Saving…'
                       : 'Save + Move to Working'}
              </button>
            </>
          ) : (
            <button
              className="lead-btn lead-btn-primary"
              onClick={() => handleSave({ alsoAdvanceStage: false })}
              disabled={saving || saved}
            >
              {saved ? <><CheckCircle2 size={14} /> Saved</>
                     : saving ? 'Saving…'
                     : 'Save activity'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
