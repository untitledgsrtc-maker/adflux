// src/components/leads/MeetingWrapModal.jsx
//
// Last step of a field meeting: how did it go + notes. The Log Meeting form no
// longer asks these up front; the meeting row is saved first (outcome empty),
// then this screen fills it in. Shown right after Save when the rep skips the
// presentation, or after the presentation + follow-up prompt when they run it.
//
// Rules carried over unchanged from the old form:
//   - Good / Maybe / Lost  ->  lead_activities.outcome positive / neutral / negative
//   - Lost also moves the lead to stage 'Lost' (lost_reason 'NoNeed')
//   - the activity note reads "Field meeting · <outcome> — <notes>"
// Lead heat is NOT written here: the existing outcome trigger sets it
// (positive -> hot, negative -> cold) exactly as it did on the old save.
//
// No Skip: an outcome is compulsory, as on the old form. Errors stay inline and
// Confirm can be retried.

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import VoiceInput from '../voice/VoiceInput'

const CHOICES = [
  { value: 'good',  label: 'Good',  sub: 'Wants quote / more info', db: 'positive', tone: 'success' },
  { value: 'maybe', label: 'Maybe', sub: 'Come back in 30 days',    db: 'neutral',  tone: 'warn'    },
  { value: 'lost',  label: 'Lost',  sub: 'Politely refused',        db: 'negative', tone: 'danger'  },
]

const TINT = {
  success: 'var(--tint-success, rgba(16,185,129,0.14))',
  warn:    'var(--tint-warning, rgba(245,158,11,0.14))',
  danger:  'var(--tint-danger, rgba(239,68,68,0.14))',
}
const EDGE = {
  success: 'var(--success, #10B981)',
  warn:    'var(--warning, #F59E0B)',
  danger:  'var(--danger, #EF4444)',
}

export default function MeetingWrapModal({ leadId, activityId, onDone }) {
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const latchRef = useRef(false)   // same ghost-click latch as the other save modals

  // Outcome is compulsory: swallow the phone's back button while this is open so
  // the meeting can't be left without one. The extra history entry is replaced
  // when the parent navigates on (see onDone).
  useEffect(() => {
    window.history.pushState(null, '', window.location.href)
    const hold = () => window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', hold)
    return () => window.removeEventListener('popstate', hold)
  }, [])

  async function confirm() {
    if (latchRef.current || !outcome) return
    latchRef.current = true
    setSaving(true)
    setErr('')
    try {
      const choice = CHOICES.find(c => c.value === outcome)
      const text = notes.trim()
      const actNotes = [`Field meeting · ${outcome}`, text || null].filter(Boolean).join(' — ')

      const { error: aErr } = await supabase.from('lead_activities')
        .update({ outcome: choice.db, notes: actNotes })
        .eq('id', activityId)
      if (aErr) throw aErr

      if (outcome === 'lost') {
        const { error: lErr } = await supabase.from('leads')
          .update({ stage: 'Lost', lost_reason: 'NoNeed' }).eq('id', leadId)
        if (lErr) throw lErr
      }
      // Lead notes only when still empty: never overwrite what an existing lead already has.
      if (text) {
        const { error: nErr } = await supabase.from('leads')
          .update({ notes: text }).eq('id', leadId).is('notes', null)
        if (nErr) throw nErr
      }
    } catch (e) {
      setErr(e?.message || 'Could not save. Try again.')
      latchRef.current = false
      setSaving(false)
      return
    }
    onDone()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        background: 'rgba(2,6,23,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, overflowY: 'auto',
      }}
    >
      <div
        role="dialog"
        aria-label="How did the meeting go"
        style={{
          maxWidth: 460, width: '100%',
          background: 'var(--surface, #1e293b)',
          border: '1px solid var(--border, #334155)',
          borderRadius: 14, padding: 20,
          fontFamily: 'var(--font-sans, system-ui)',
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
          How did the meeting go?
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted, #94a3b8)' }}>
          Everything else is saved. Pick the outcome and add a note.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {CHOICES.map(o => {
            const on = outcome === o.value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                disabled={saving}
                aria-pressed={on}
                style={{
                  padding: '10px 12px', borderRadius: 10, minHeight: 44,
                  border: `1.5px solid ${on ? EDGE[o.tone] : 'var(--border-strong, #475569)'}`,
                  background: on ? TINT[o.tone] : 'var(--surface-2, #334155)',
                  color: 'var(--text, #f1f5f9)', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>{o.sub}</div>
              </button>
            )
          })}
        </div>

        <label className="lead-fld-label" style={{ display: 'block', marginTop: 16 }}>Notes</label>
        <VoiceInput
          multiline
          rows={3}
          value={notes}
          onChange={setNotes}
          placeholder="What did they say? Decision-maker name? Budget hint?"
          languageHint="gu"
        />

        {err && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--danger, #EF4444)' }}>{err}</div>
        )}

        <button
          type="button"
          onClick={confirm}
          disabled={saving || !outcome}
          style={{
            marginTop: 16, width: '100%', minHeight: 46, borderRadius: 10, border: 'none',
            background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
            fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            cursor: saving || !outcome ? 'default' : 'pointer',
            opacity: saving || !outcome ? 0.6 : 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {saving
            ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
            : 'Save outcome'}
        </button>
      </div>
    </div>
  )
}
