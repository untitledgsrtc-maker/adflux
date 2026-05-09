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
import { X, MapPin, Loader2, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

// Outcome → (stage, lost_reason) mapping. Locked in this file because
// the modal owns the cold-meeting flow end-to-end. If you change these
// values, also update bump_meeting_counter expectations and the
// LeadsV2 'Field Meeting' filter chip (none today).
const OUTCOMES = [
  {
    value:      'interested',
    label:      'Interested',
    sub:        'Wants to know more / asked for quote',
    stage:      'Working',
    lostReason: null,
    tone:       'success',
  },
  {
    value:      'maybe',
    label:      'Maybe later',
    sub:        'Open but not now — revisit in 30 days',
    stage:      'Nurture',
    lostReason: null,
    tone:       'warn',
  },
  {
    value:      'not_interested',
    label:      'Not interested',
    sub:        'Politely refused — territory recorded',
    stage:      'Lost',
    lostReason: 'Cold meeting — no fit',
    tone:       'danger',
  },
]

export default function LogMeetingModal({ onClose, onSaved }) {
  const profile = useAuthStore(s => s.profile)

  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const [phone,   setPhone]   = useState('')
  const [city,    setCity]    = useState(profile?.city || '')
  const [outcome, setOutcome] = useState('')
  const [notes,   setNotes]   = useState('')

  const [gps, setGps]         = useState(null)   // {lat, lng, acc}
  const [gpsBusy, setGpsBusy] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

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

  async function handleSave() {
    if (saving) return
    setError('')
    if (!company.trim()) {
      setError('Company / shop name is required.')
      return
    }
    if (!outcome) {
      setError('Pick an outcome — Interested / Maybe / Not interested.')
      return
    }
    const oc = OUTCOMES.find(o => o.value === outcome)
    setSaving(true)

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
      source:      'Field Meeting',
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
      `Field meeting · ${oc.label}`,
      notes.trim() || null,
    ].filter(Boolean).join(' — ')

    const activityPayload = {
      lead_id:        leadRow.id,
      activity_type:  'meeting',
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
    onSaved?.(leadRow.id)
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
              Log field meeting
            </div>
            <div className="lead-card-sub">
              Cold walk-in · counts toward today's milestone
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
              background: gps ? 'rgba(16,185,129,.08)' : 'var(--surface-2)',
              border: `1px solid ${gps ? 'var(--success)' : 'var(--border-strong)'}`,
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

          <div>
            <label className="lead-fld-label">Company / shop name *</label>
            <input
              className="lead-inp"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="e.g. Sunrise Diagnostics"
              disabled={saving}
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="lead-fld-label">Contact name (optional)</label>
              <input
                className="lead-inp"
                value={contact}
                onChange={e => setContact(e.target.value)}
                placeholder="e.g. Dr. Mehta"
                disabled={saving}
              />
            </div>
            <div>
              <label className="lead-fld-label">Phone (optional)</label>
              <input
                className="lead-inp"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 98XXXX XXXXX"
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <label className="lead-fld-label">City</label>
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
                  o.tone === 'success' ? 'rgba(16,185,129,.14)'
                  : o.tone === 'warn'    ? 'rgba(245,158,11,.14)'
                  :                        'rgba(239,68,68,.14)'
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
            <textarea
              className="lead-inp"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="What did they say? Decision-maker name? Budget hint?"
              disabled={saving}
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
            disabled={saving || !company.trim() || !outcome}
          >
            {saving
              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : null}
            <span>Save meeting</span>
          </button>
        </div>
      </div>
    </div>
  )
}
