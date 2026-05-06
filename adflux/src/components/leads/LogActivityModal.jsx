// src/components/leads/LogActivityModal.jsx
//
// Phase 16 — Log activity modal (call / whatsapp / email / meeting /
// site_visit / note). Ported from _design_reference/Leads/lead-modals-mobile.jsx
// (LogActivityModal). Real-data wired:
//   • Inserts into lead_activities
//   • Captures GPS lat/lng/accuracy when the browser allows
//   • For 'call' type, accepts a duration mm:ss → duration_seconds
//   • Updates parent on success via onSaved()
//
// Side effects (silent, schema triggers):
//   • leads.contact_attempts_count++
//   • leads.last_contact_at = now()
//   • work_sessions.daily_counters bumped if call/meeting/new_lead
//   • Auto-Lost on 3+ contact attempts without a 'positive' outcome

import { useState } from 'react'
import {
  X, Phone, MessageCircle, Mail, Calendar, MapPin, Edit3, Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const TYPE_META = {
  call:        { label: 'Call',        Icon: Phone,         showOutcome: true,  showDuration: true  },
  whatsapp:    { label: 'WhatsApp',    Icon: MessageCircle, showOutcome: true,  showDuration: false },
  email:       { label: 'Email',       Icon: Mail,          showOutcome: true,  showDuration: false },
  meeting:     { label: 'Meeting',     Icon: Calendar,      showOutcome: true,  showDuration: false },
  site_visit:  { label: 'Site visit',  Icon: MapPin,        showOutcome: true,  showDuration: false },
  note:        { label: 'Note',        Icon: Edit3,         showOutcome: false, showDuration: false },
}

function parseDuration(mmss) {
  const parts = (mmss || '').split(':').map(p => parseInt(p, 10))
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null
  return parts[0] * 60 + parts[1]
}

export default function LogActivityModal({ lead, type = 'call', onClose, onSaved }) {
  const profile = useAuthStore(s => s.profile)
  const meta = TYPE_META[type] || TYPE_META.note

  const [outcome, setOutcome]   = useState('')
  const [duration, setDuration] = useState('')
  const [notes, setNotes]       = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextDate, setNextDate]     = useState('')
  const [gps, setGps]               = useState(null) // {lat, lng, acc}
  const [gpsBusy, setGpsBusy]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  function captureGps() {
    if (!navigator.geolocation) {
      setError('GPS not supported on this device.')
      return
    }
    setGpsBusy(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: Math.round(pos.coords.accuracy),
        })
        setGpsBusy(false)
      },
      err => {
        setGpsBusy(false)
        setError(err.message || 'Could not capture GPS.')
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 }
    )
  }

  async function handleSave() {
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
    setSaving(false)
    if (err) {
      setError('Save failed: ' + err.message)
      return
    }
    onSaved?.()
    onClose?.()
  }

  return (
    <div
      className="lead-modal-back"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.() }}
    >
      <div className="lead-modal" style={{ width: 'min(480px, calc(100% - 32px))' }}>
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
            disabled={saving}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

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

          {meta.showDuration && (
            <div>
              <label className="lead-fld-label">Duration (mm:ss) — optional</label>
              <input
                className="lead-inp"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="04:12"
              />
            </div>
          )}

          <div>
            <label className="lead-fld-label">Notes{type === 'note' ? ' *' : ''}</label>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="lead-fld-label">Next action</label>
              <input
                className="lead-inp"
                value={nextAction}
                onChange={e => setNextAction(e.target.value)}
                placeholder="Send quote, follow up, demo…"
              />
            </div>
            <div>
              <label className="lead-fld-label">Date</label>
              <input
                className="lead-inp"
                type="date"
                value={nextDate}
                onChange={e => setNextDate(e.target.value)}
              />
            </div>
          </div>

          {/* GPS capture row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {gps ? (
              <span className="pill pill-success" style={{ alignSelf: 'flex-start' }}>
                <MapPin size={11} style={{ marginRight: 4 }} />
                {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)} · ±{gps.acc}m
              </span>
            ) : (
              <button
                type="button"
                className="lead-btn lead-btn-sm"
                onClick={captureGps}
                disabled={gpsBusy}
              >
                {gpsBusy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <MapPin size={11} />}
                <span>{gpsBusy ? 'Capturing…' : 'Capture GPS'}</span>
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

        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="lead-btn lead-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save activity'}
          </button>
        </div>
      </div>
    </div>
  )
}
