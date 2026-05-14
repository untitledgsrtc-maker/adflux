// src/components/leads/LogMeetingModal.jsx
//
// Phase 32M — Field Meeting fast-path.
//
// Opens from /work (sales rep's daily home) for "I just walked into a
// shop and met someone" — the cold walk-in milestone flow. Owner spec
// (10 May 2026): every rep does 5 of these per day, every meeting
// counts (even rejections), GPS pin proves the visit happened.
//
// What this modal does in ONE save click:
//   1. INSERT into `leads` with source='Field Meeting', stage mapped
//      from the outcome chip (Interested→Working, Maybe→Nurture,
//      Not interested→Lost with auto-reason).
//   2. INSERT into `lead_activities` with activity_type='meeting' and
//      GPS coords captured silently on modal mount.
//   3. The bump_meeting_counter Postgres trigger (Phase 32M SQL) auto-
//      increments work_sessions.daily_counters.meetings — no JS bump
//      required, the counter on /work refreshes via realtime.
//
// Distinct from LogActivityModal:
//   - LogActivityModal needs an existing lead. This one creates one.
//   - LogActivityModal opens from a lead detail page. This opens from
//     /work or anywhere a "+ Log Meeting" button lives.
//   - Fields are stripped to the minimum a rep needs at the door:
//     company name + outcome + notes. Phone is optional (cold walk-ins
//     often don't get a number on first meeting).
//
// On save success, calls onSaved(newLeadId) so the parent can navigate
// to the lead if they want, or just close and refresh counters.

import { useEffect, useState } from 'react'
import { X, MapPin, Loader2, Building2, Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import VoiceInput from '../voice/VoiceInput'
import PhotoCapture from './PhotoCapture'
import { toastError } from '../v2/Toast'
import WhatsAppPromptModal from './WhatsAppPromptModal'
import { findLeadByPhone } from '../../utils/leadDedup'

// Outcome → (stage, lost_reason) mapping. Locked in this file because
// the modal owns the cold-meeting flow end-to-end. If you change these
// values, also update bump_meeting_counter expectations and the
// LeadsV2 'Field Meeting' filter chip (none today).
// Phase 33A — owner locked the 3-outcome model (11 May 2026):
// Good / Maybe / Lost. Single-word labels per the bilingual-label
// stripped redesign. Sub-text kept short for low-literacy reps.
const OUTCOMES = [
  {
    value:      'interested',
    label:      'Good',
    sub:        'Wants quote / more info',
    stage:      'Working',
    lostReason: null,
    tone:       'success',
  },
  {
    value:      'maybe',
    label:      'Maybe',
    sub:        'Come back in 30 days',
    stage:      'Nurture',
    lostReason: null,
    tone:       'warn',
  },
  {
    value:      'not_interested',
    label:      'Lost',
    sub:        'Politely refused',
    stage:      'Lost',
    // Phase 32M fix — leads_lost_reason_check is a CHECK constraint
    // restricted to: Price, Timing, Competitor, NoNeed, NoResponse,
    // WrongContact, Stale. Cold-walk-in rejection most accurately maps
    // to NoNeed (prospect has no need for outdoor advertising right
    // now). Free-text reason "Cold meeting — no fit" gets surfaced in
    // the activity notes instead so the audit trail still shows it.
    lostReason: 'NoNeed',
    tone:       'danger',
  },
]

// Phase 35 PR 2.5 — `mode` prop added. Same form, two save paths:
//   • 'meeting' (default) — field meeting; bumps `meetings` counter,
//     activity_type='meeting', source='Field Meeting'.
//   • 'lead'             — manual lead entry; bumps `new_leads`,
//     activity_type='note', source='Manual Lead'. Owner directive:
//     "log lead and meeting lead form must be same" — form is
//     identical, only save logic differs.
export default function LogMeetingModal({ onClose, onSaved, mode = 'meeting' }) {
  const isLead = mode === 'lead'
  const profile = useAuthStore(s => s.profile)

  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const [phone,   setPhone]   = useState('')
  const [city,    setCity]    = useState(profile?.city || '')
  const [outcome, setOutcome] = useState('')
  const [notes,   setNotes]   = useState('')

  // Phase 34.10 — phone-first dedup. Was previously a check on Save
  // which dropped the rep's typed company/contact when a match was
  // found. Now we check as the rep types phone (debounced 600 ms)
  // and show an inline preview so the rep can switch to follow-up-
  // on-existing mode without losing typed work.
  const [dupPreview, setDupPreview] = useState(null)   // {id, name, company, stage}
  const [dupBusy,    setDupBusy]    = useState(false)

  const [gps, setGps]         = useState(null)   // {lat, lng, acc}
  const [gpsBusy, setGpsBusy] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  // Phase 33D.5 — post-save WhatsApp prompt. After successful save we
  // stash the new lead row here and render WhatsAppPromptModal on top.
  // The outer modal stays open behind it so the rep can review their
  // entry while seeing the thank-you message. Closing the prompt
  // closes everything via onClose.
  const [savedLead, setSavedLead] = useState(null)

  // Auto-capture GPS silently on mount. This is the whole point of the
  // milestone — without GPS, fake-logging from home is trivial. We
  // capture but don't BLOCK on it; if denied, the meeting still saves
  // with no GPS and admin can see the missing pin in the audit map.
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
      _err => { setGpsBusy(false) },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    )
  }, [])

  // Phase 34.10 — debounced phone-first dedup. As the rep types the
  // phone number we poll findLeadByPhone (~600 ms after last keystroke)
  // and surface a preview chip. Rep can tap "Use existing lead" to
  // skip new-lead creation and log the activity onto the matched
  // lead — without losing the company / contact fields they already
  // typed (those get saved into the activity notes for context).
  useEffect(() => {
    const trimmed = (phone || '').trim()
    if (trimmed.length < 6) {
      setDupPreview(null)
      return
    }
    let cancelled = false
    setDupBusy(true)
    const t = setTimeout(async () => {
      try {
        const dup = await findLeadByPhone(trimmed)
        if (!cancelled) setDupPreview(dup || null)
      } catch {
        if (!cancelled) setDupPreview(null)
      } finally {
        if (!cancelled) setDupBusy(false)
      }
    }, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [phone])

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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  // Phase 35Z (14 May 2026) — surface validation errors via toast in
  // addition to the inline banner so the rep sees feedback even if the
  // banner is scrolled out of view at the bottom of a long modal.
  function fail(msg) {
    setError(msg)
    toastError(new Error(msg), msg)
  }

  async function handleSave() {
    if (saving) return
    setError('')
    if (!company.trim()) { fail('Company / shop name is required.'); return }
    if (!contact.trim()) { fail('Person name is required — who did you meet?'); return }
    if (!phone.trim())   { fail('Mobile number is required — without it the lead can\'t be followed up.'); return }
    if (!city.trim())    { fail('City is required.'); return }
    if (!outcome)        { fail('Pick an outcome — Good / Maybe / Lost.'); return }
    const oc = OUTCOMES.find(o => o.value === outcome)
    setSaving(true)

    // Phase 33D.6 — duplicate check by phone. If the rep just walked
    // into a shop whose number is already in our pipeline, this is a
    // follow-up meeting on the EXISTING lead, not a new lead. Insert
    // a lead_activities row tied to that lead and short-circuit out.
    const dup = await findLeadByPhone(phone)
    if (dup) {
      const activityPayload = {
        lead_id:        dup.id,
        activity_type:  'meeting',
        outcome:        outcome === 'interested' ? 'positive'
                        : outcome === 'maybe' ? 'neutral'
                        : 'negative',
        notes:          `Follow-up meeting · ${oc.label}` + (notes.trim() ? ` — ${notes.trim()}` : ''),
        created_by:     profile.id,
        gps_lat:        gps?.lat || null,
        gps_lng:        gps?.lng || null,
        gps_accuracy_m: gps?.acc || null,
      }
      const { error: actErr } = await supabase
        .from('lead_activities').insert([activityPayload])
      if (actErr) {
        setSaving(false)
        setError('Could not log follow-up meeting: ' + actErr.message)
        return
      }
      setSaving(false)
      // Treat as a save — surface that it's a follow-up + open the
      // existing lead for the prompt.
      onSaved?.(dup.id)
      setSavedLead({ id: dup.id, name: dup.name, company: dup.company, phone, segment: 'PRIVATE' })
      return
    }

    // 1) Create the lead. Field Meeting source, stage mapped from
    //    outcome. Sales rep owns the lead (assigned_to = themselves).
    //    Segment defaults to PRIVATE — cold walk-ins are almost
    //    always private; reps can flip it on lead detail later.
    const leadPayload = {
      name:        contact.trim() || company.trim(), // contact preferred, else fall back
      company:     company.trim(),
      phone:       phone.trim() || null,
      email:       null,
      city:        city.trim() || null,
      segment:     'PRIVATE',
      source:      isLead ? 'Manual Lead' : 'Field Meeting',
      industry:    null,
      heat:        outcome === 'interested' ? 'warm'
                   : outcome === 'maybe' ? 'cold'
                   : 'cold',
      stage:       oc.stage,
      lost_reason: oc.lostReason,
      notes:       notes.trim() || null,
      assigned_to: profile.id,
      created_by:  profile.id,
      // Nurture revisit defaults to 30 days from today (reps can edit
      // on the lead detail page).
      revisit_date: oc.stage === 'Nurture'
        ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
        : null,
    }
    const { data: leadRow, error: leadErr } = await supabase
      .from('leads')
      .insert([leadPayload])
      .select()
      .single()

    if (leadErr) {
      setSaving(false)
      setError('Could not create lead: ' + leadErr.message)
      return
    }

    // 2) Log the meeting activity. GPS attached if we got it. Notes
    //    field carries the structured outcome label so the timeline
    //    reads cleanly: "Meeting · Interested — Wants to know more".
    const activityNotes = [
      isLead ? `New lead · ${oc.label}` : `Field meeting · ${oc.label}`,
      notes.trim() || null,
    ].filter(Boolean).join(' — ')

    const activityPayload = {
      lead_id:        leadRow.id,
      // Phase 35 PR 2.5 — 'note' for manual lead entry (counts in
      // new_leads counter via client-side bump in parent); 'meeting'
      // for field meeting (bumped server-side via Phase 32M trigger).
      activity_type:  isLead ? 'note' : 'meeting',
      outcome:        outcome === 'interested' ? 'positive'
                      : outcome === 'maybe' ? 'neutral'
                      : 'negative',
      notes:          activityNotes,
      created_by:     profile.id,
      gps_lat:        gps?.lat || null,
      gps_lng:        gps?.lng || null,
      gps_accuracy_m: gps?.acc || null,
    }
    const { error: actErr } = await supabase
      .from('lead_activities')
      .insert([activityPayload])

    if (actErr) {
      setSaving(false)
      // Lead was created but activity failed — surface so the rep can
      // open the lead and log the activity from there. Counter won't
      // bump but at least the lead exists.
      setError(
        `Lead created but activity log failed: ${actErr.message}. ` +
        `Open the lead and log the meeting from there.`
      )
      return
    }

    setSaving(false)
    // Phase 35 PR 2.5 — skip the WhatsApp prompt; fire onSaved with
    // the new lead id + close. Parent (WorkV2) navigates to the lead
    // detail page so the rep lands on the row they just created
    // (owner UX: "after adding it not land in any other page" was the
    // bug). The WhatsApp prompt was Phase 33D.5; useful but blocked
    // the navigate intent. If owner wants it back, gate behind a
    // `promptWhatsApp` prop.
    onSaved?.(leadRow.id, { mode })
    onClose?.()
  }

  function closeAll() {
    setSavedLead(null)
    onClose?.()
  }

  return (
    <div
      className="lead-modal-back"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.() }}
    >
      <div className="lead-modal" style={{ width: 'min(560px, calc(100% - 32px))' }}>
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <Building2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {isLead ? 'Log new lead' : 'Log field meeting'}
            </div>
            <div className="lead-card-sub">
              {isLead
                ? 'Add manually · counts toward new leads today'
                : 'Cold walk-in · counts toward today\'s milestone'}
            </div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          {/* GPS strip — show what we got. If denied, prompt user to
              refresh; it's not blocking but the audit trail is weaker
              without a pin. */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px',
              background: gps ? 'var(--tint-success, rgba(16,185,129,0.14))' : 'var(--surface-2)',
              border: `1px solid ${gps ? 'var(--tint-success-bd, rgba(16,185,129,0.40))' : 'var(--border-strong)'}`,
              borderRadius: 8, fontSize: 12,
            }}
          >
            <MapPin size={14} style={{ color: gps ? 'var(--success)' : 'var(--text-muted)' }} />
            {gpsBusy ? (
              <span>Capturing GPS…</span>
            ) : gps ? (
              <span style={{ color: 'var(--text)' }}>
                Pin captured · ±{gps.acc}m
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>
                No GPS — admin will see this meeting as un-pinned
              </span>
            )}
            <button
              type="button"
              className="lead-btn lead-btn-sm"
              onClick={refreshGps}
              disabled={gpsBusy || saving}
              style={{ marginLeft: 'auto' }}
            >
              {gpsBusy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : 'Refresh'}
            </button>
          </div>

          {/* Phase 33D.2 — business-card scanner inside LogMeeting.
              Owner directive (11 May 2026): OCR everywhere a new
              lead gets created. Tap → camera → OCR → auto-fills
              company/contact/phone in this modal's state. Email
              isn't a field on this modal so it's dropped. */}
          <div style={{
            padding: '10px 12px',
            background: 'var(--tint-yellow, rgba(255,230,0,0.14))',
            border: '1px dashed var(--tint-yellow-bd, rgba(255,230,0,0.50))',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <Camera size={16} style={{ color: 'var(--accent)' }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              Got a business card? Scan it.
            </div>
            <PhotoCapture
              buttonLabel="Scan card"
              onFieldsExtracted={(fields) => {
                if (fields.company && !company.trim()) setCompany(fields.company)
                if (fields.name    && !contact.trim()) setContact(fields.name)
                if (fields.phone   && !phone.trim())   setPhone(fields.phone)
                if (fields.city    && !city.trim())    setCity(fields.city)
              }}
            />
          </div>

          <div>
            <label className="lead-fld-label">Company / shop name *</label>
            {/* Phase 35 PR 2.7 — mic dropped on Identity field, same
                reason as LeadFormV2 PR 2.5: OCR populates it. Plain
                text input. Notes mic below still kept (free-text). */}
            <input
              className="lead-inp"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="e.g. Sunrise Diagnostics"
              disabled={saving}
            />
          </div>

          {/* Phase 33B.3 — owner revised (11 May 2026): Person, Phone,
              City are now all REQUIRED (not collapsed). A field meeting
              missing any of these can't be followed up. Email + address
              still optional. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="lead-fld-label">Person name *</label>
              <input
                className="lead-inp"
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="e.g. Dr. Mehta"
                disabled={saving}
              />
            </div>
            <div>
              <label className="lead-fld-label">Mobile number *</label>
              <input
                className="lead-inp"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="98XXXXXXXX or +91 98XXXXXXXX"
                disabled={saving}
              />
              {/* Phase 34.10 — phone-first dedup preview. Shows the
                  match as the rep types, before they fill the rest. */}
              {dupBusy && (
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', marginTop: 4 }}>
                  Checking for existing lead…
                </div>
              )}
              {dupPreview && !dupBusy && (
                <div
                  style={{
                    marginTop: 6,
                    padding: '8px 10px',
                    background: 'rgba(245, 158, 11, .10)',
                    border: '1px solid var(--warning, #F59E0B)',
                    borderRadius: 8,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>Already in pipeline:</strong>{' '}
                    {dupPreview.name || '—'}
                    {dupPreview.company ? ` · ${dupPreview.company}` : ''}
                    {dupPreview.stage ? ` (${dupPreview.stage})` : ''}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="lead-fld-label">City *</label>
            <input
              className="lead-inp"
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="Surat"
              disabled={saving}
            />
          </div>

          <div>
            <label className="lead-fld-label">Outcome *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {OUTCOMES.map(o => {
                const on = outcome === o.value
                const tint =
                  o.tone === 'success' ? 'var(--tint-success, rgba(16,185,129,0.14))'
                  : o.tone === 'warn'    ? 'var(--tint-warning, rgba(245,158,11,0.14))'
                  :                        'var(--tint-danger, rgba(239,68,68,0.14))'
                const bd =
                  o.tone === 'success' ? 'var(--success)'
                  : o.tone === 'warn'    ? 'var(--warning)'
                  :                        'var(--danger)'
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOutcome(o.value)}
                    disabled={saving}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `1.5px solid ${on ? bd : 'var(--border-strong)'}`,
                      background: on ? tint : 'var(--surface-2)',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {o.sub}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="lead-fld-label">Notes (optional)</label>
            <VoiceInput
              multiline
              rows={3}
              value={notes}
              onChange={setNotes}
              placeholder="What did they say? Decision-maker name? Budget hint?"
              disabled={saving}
              languageHint="gu"
            />
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

        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="lead-btn lead-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving
              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : null}
            <span>Save meeting</span>
          </button>
        </div>
      </div>
      {/* Phase 33D.5 — post-meeting thank-you prompt. Auto-opens after
          successful save. Rep can edit or skip. */}
      <WhatsAppPromptModal
        open={!!savedLead}
        stage="post_meeting"
        lead={savedLead}
        profile={profile}
        onClose={closeAll}
      />
    </div>
  )
}
