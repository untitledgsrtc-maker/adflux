// src/components/leads/ChangeStageModal.jsx
//
// Phase 16 — Move stage modal. Ported from
// _design_reference/Leads/lead-modals-mobile.jsx (ChangeStageModal).
//
// Conditional fields by target stage (matches Phase 12 schema rules):
//   • Lost       → mandatory lost_reason
//   • Nurture    → mandatory nurture_revisit_date (max 90 days out)
//   • SalesReady → 4 mandatory fields:
//                  budget_confirmed (checkbox)
//                  timeline_confirmed (checkbox)
//                  decision_maker_contact (text)
//                  service_interest (text)
//                  + handoff_to (sales rep dropdown — sets assigned_to)
//   • Qualified  → stamps qualified_at
//
// Side effects:
//   • Updates leads row (stage + relevant timestamps + lost_reason etc.)
//   • Inserts a status_change activity into lead_activities
//   • For SalesReady, sets assigned_to = handoff_to and timestamps
//     handoff_sla_due_at via Postgres trigger.

import { useEffect, useState } from 'react'
import { X, RefreshCw, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import {
  LEAD_STAGES, STAGE_LABELS, LOST_REASONS,
} from '../../hooks/useLeads'
import { StageChip } from './LeadShared'

export default function ChangeStageModal({ lead, onClose, onSaved }) {
  const profile = useAuthStore(s => s.profile)

  // Phase 30A — initial target overridden by useEffect below based on
  // current stage. 'Working' is the safest default before lead loads.
  const [target, setTarget] = useState('Working')

  // Conditional fields
  const [lostReason, setLostReason] = useState('')
  // Phase 30A — `revisitDate` now applies to Lost (was Nurture).
  // BANT / handoff fields removed (SalesReady is no longer a stage).
  const [revisitDate, setRevisitDate] = useState('')

  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Phase 30A — 5 stages: New → Working → QuoteSent → Won / Lost.
  // Suggest the next forward stage from current.
  useEffect(() => {
    const cur = lead?.stage
    if (cur === 'New')           setTarget('Working')
    else if (cur === 'Working')  setTarget('QuoteSent')
    else if (cur === 'QuoteSent') setTarget('Won')
    else                          setTarget('Working')
  }, [lead?.stage])

  // Validate + commit
  async function handleSave() {
    if (saving) return
    setError('')
    if (target === lead.stage) {
      setError('That is already the current stage.')
      return
    }
    if (target === 'Lost' && !lostReason) {
      setError('Lost reason is required.')
      return
    }
    setSaving(true)
    const patch = { stage: target }
    if (target === 'Lost') {
      patch.lost_reason = lostReason
      // Phase 30A — Lost can carry an optional revisit date (was a
      // separate Nurture stage). Reps filter "Lost with revisit in next
      // 90 days" to surface the long-tail follow-ups.
      if (revisitDate) patch.nurture_revisit_date = revisitDate
    }
    // Phase 30A — moving INTO Working stamps qualified_at the first
    // time, mirroring the old Qualified→Working merge.
    if (target === 'Working' && !lead.qualified_at) {
      patch.qualified_at = new Date().toISOString()
    }
    const { error: err } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', lead.id)

    if (err) {
      setSaving(false)
      setError('Stage change failed: ' + err.message)
      return
    }

    // Status_change activity entry
    const noteParts = [`Stage → ${STAGE_LABELS[target] || target}`]
    if (lostReason)  noteParts.push(`Reason: ${lostReason}`)
    if (revisitDate) noteParts.push(`Revisit: ${revisitDate}`)
    if (note.trim()) noteParts.push(note.trim())
    await supabase.from('lead_activities').insert([{
      lead_id:       lead.id,
      activity_type: 'status_change',
      notes:         noteParts.join(' · '),
      created_by:    profile.id,
    }])

    // Phase 19b — close any open Smart Tasks for this lead. A stage
    // change usually invalidates whatever rule generated them
    // (hot_idle is no longer hot_idle once the rep moved the lead;
    // sla_breach is no longer relevant if it left SalesReady; etc.).
    // Tomorrow's regenerate run will create new ones if rules still
    // apply.
    await supabase
      .from('lead_tasks')
      .update({ status: 'skipped' })
      .eq('lead_id', lead.id)
      .eq('status', 'open')

    setSaving(false)
    onSaved?.()
    onClose?.()
  }

  return (
    <div
      className="lead-modal-back"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.() }}
    >
      <div className="lead-modal" style={{ width: 'min(520px, calc(100% - 32px))' }}>
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <RefreshCw size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Move stage
            </div>
            <div className="lead-card-sub">
              Currently <StageChip stage={lead.stage} sm /> &nbsp;→ {STAGE_LABELS[target] || target}
            </div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          <div>
            <label className="lead-fld-label">Target stage</label>
            <select
              className="lead-inp"
              value={target}
              onChange={e => setTarget(e.target.value)}
              disabled={saving}
            >
              {LEAD_STAGES.map(s => (
                <option key={s} value={s}>{STAGE_LABELS[s] || s}</option>
              ))}
            </select>
          </div>

          {target === 'Lost' && (
            <>
              <div>
                <label className="lead-fld-label">Lost reason *</label>
                <select
                  className="lead-inp"
                  value={lostReason}
                  onChange={e => setLostReason(e.target.value)}
                  disabled={saving}
                >
                  <option value="">— pick —</option>
                  {LOST_REASONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              {/* Phase 30A — optional revisit date. Replaces the old
                  Nurture stage. Reps filter "Lost with revisit ≤ 90d"
                  to surface the long-tail follow-ups. */}
              <div>
                <label className="lead-fld-label">Revisit later (optional)</label>
                <input
                  className="lead-inp"
                  type="date"
                  value={revisitDate}
                  onChange={e => setRevisitDate(e.target.value)}
                  disabled={saving}
                  placeholder="Leave blank if dead permanently"
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Pick a date if you want to revisit this client later
                  (replaces the old Nurture stage).
                </div>
              </div>
            </>
          )}

          <div>
            <label className="lead-fld-label">Note (optional)</label>
            <textarea
              className="lead-inp"
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Why this stage move?"
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
            disabled={saving}
          >
            {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            <span>Move to {STAGE_LABELS[target] || target}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
