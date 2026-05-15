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

import { useEffect, useState } from 'react'
import { Phone, Loader2, CheckCircle2, X, Calendar, MessageSquare, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import VoiceInput from '../voice/VoiceInput'
import { toastError, toastSuccess } from '../v2/Toast'

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
  { value: 'meeting',            label: 'Log a meeting now',   days: null },
  { value: 'none',               label: 'No next action',      days: 0 },
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

  // Reset state every time the modal opens for a fresh call.
  useEffect(() => {
    if (open) {
      setOutcome('')
      setNextAction('follow_up_3d')
      setNotes('')
    }
  }, [open])

  if (!open || !lead) return null

  const tone = OUTCOMES.find(o => o.value === outcome)?.tone
  const nextActionMeta = NEXT_ACTIONS.find(n => n.value === nextAction)

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

    // 3. Next-action: follow_up_* / nurture_30d → upsert follow_ups row.
    //    meeting → caller opens LogMeetingModal.
    //    none → no-op.
    if (nextActionMeta?.days != null && nextActionMeta.days > 0) {
      const d = new Date()
      d.setDate(d.getDate() + nextActionMeta.days)
      const isoDate = d.toISOString().slice(0, 10)
      const { error: fuErr } = await supabase.from('follow_ups').insert([{
        lead_id: lead.id,
        assigned_to: profile?.id,
        follow_up_date: isoDate,
        note: notes.trim() || `After call · ${OUTCOMES.find(o => o.value === outcome)?.label}`,
        is_done: false,
      }])
      if (fuErr) {
        toastError(fuErr, 'Follow-up scheduled but DB write failed: ' + fuErr.message)
      }
      // Nurture pseudo-action also flips stage.
      if (nextAction === 'nurture_30d' && lead.stage !== 'Won' && lead.stage !== 'Lost') {
        await supabase.from('leads').update({
          stage: 'Nurture',
          revisit_date: isoDate,
        }).eq('id', lead.id)
      }
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
            <label className="lead-fld-label">What did they say? (voice or type)</label>
            <VoiceInput
              multiline
              rows={3}
              value={notes}
              onChange={setNotes}
              placeholder="Decision-maker name · budget · next steps · objections"
              disabled={saving}
              languageHint="gu"
            />
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
                             :                         MessageSquare
                  const Icon = icon
                  return (
                    <button
                      key={n.value}
                      type="button"
                      onClick={() => setNextAction(n.value)}
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
