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

  const [target, setTarget] = useState('SalesReady')
  const [reps, setReps] = useState([])

  // Conditional fields
  const [lostReason, setLostReason] = useState('')
  const [revisitDate, setRevisitDate] = useState('')
  const [budgetOk, setBudgetOk] = useState(false)
  const [timelineOk, setTimelineOk] = useState(false)
  const [dmContact, setDmContact] = useState('')
  const [serviceInterest, setServiceInterest] = useState('')
  const [handoffTo, setHandoffTo] = useState('')

  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Initial sensible target — if currently New/Contacted, suggest Qualified;
  // if Qualified, suggest SalesReady; otherwise next forward stage.
  useEffect(() => {
    const cur = lead?.stage
    const idx = LEAD_STAGES.indexOf(cur)
    if (cur === 'New' || cur === 'Contacted') setTarget('Qualified')
    else if (cur === 'Qualified')             setTarget('SalesReady')
    else if (cur === 'SalesReady')            setTarget('MeetingScheduled')
    else if (cur === 'MeetingScheduled')      setTarget('QuoteSent')
    else if (cur === 'QuoteSent')             setTarget('Negotiating')
    else if (cur === 'Negotiating')           setTarget('Won')
    else if (idx < LEAD_STAGES.length - 1)    setTarget(LEAD_STAGES[idx + 1])
  }, [lead?.stage])

  // Load active sales reps for the SalesReady hand-off picker.
  useEffect(() => {
    supabase
      .from('users')
      .select('id, name, team_role, city, is_active')
      .in('team_role', ['sales', 'agency', 'sales_manager'])
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setReps(data || []))
  }, [])

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
    if (target === 'Nurture' && !revisitDate) {
      setError('Nurture revisit date is required.')
      return
    }
    if (target === 'SalesReady') {
      if (!budgetOk || !timelineOk || !dmContact.trim() || !serviceInterest.trim()) {
        setError('All four BANT fields are required for Sales Ready.')
        return
      }
      if (!handoffTo) {
        setError('Pick a sales rep to hand off to.')
        return
      }
    }
    setSaving(true)
    const patch = { stage: target }
    if (target === 'Lost')      patch.lost_reason         = lostReason
    if (target === 'Nurture')   patch.nurture_revisit_date = revisitDate
    if (target === 'Qualified') patch.qualified_at         = lead.qualified_at || new Date().toISOString()
    if (target === 'SalesReady') {
      patch.qualified_at   = lead.qualified_at || new Date().toISOString()
      patch.sales_ready_at = new Date().toISOString()
      patch.assigned_to    = handoffTo
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
    if (lostReason)       noteParts.push(`Reason: ${lostReason}`)
    if (revisitDate)      noteParts.push(`Revisit: ${revisitDate}`)
    if (target === 'SalesReady') {
      noteParts.push(`BANT confirmed`)
      noteParts.push(`DM: ${dmContact}`)
      noteParts.push(`Interest: ${serviceInterest}`)
    }
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
          )}

          {target === 'Nurture' && (
            <div>
              <label className="lead-fld-label">Revisit date * (within 90 days)</label>
              <input
                className="lead-inp"
                type="date"
                value={revisitDate}
                onChange={e => setRevisitDate(e.target.value)}
                disabled={saving}
              />
            </div>
          )}

          {target === 'SalesReady' && (
            <div className="lead-card" style={{ background: 'var(--surface-2)' }}>
              <div className="lead-card-pad">
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
                  Qualification checklist
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={budgetOk}
                      onChange={e => setBudgetOk(e.target.checked)}
                      disabled={saving}
                    />
                    Budget confirmed
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={timelineOk}
                      onChange={e => setTimelineOk(e.target.checked)}
                      disabled={saving}
                    />
                    Timeline confirmed
                  </label>
                  <div>
                    <label className="lead-fld-label">Decision-maker contact</label>
                    <input
                      className="lead-inp"
                      value={dmContact}
                      onChange={e => setDmContact(e.target.value)}
                      placeholder="Name + role (e.g. Dr. Mehta, owner)"
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="lead-fld-label">Service interest</label>
                    <input
                      className="lead-inp"
                      value={serviceInterest}
                      onChange={e => setServiceInterest(e.target.value)}
                      placeholder="Auto Hood, GSRTC LED, Newspaper, …"
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="lead-fld-label">Hand off to</label>
                    <select
                      className="lead-inp"
                      value={handoffTo}
                      onChange={e => setHandoffTo(e.target.value)}
                      disabled={saving}
                    >
                      <option value="">— pick a sales rep —</option>
                      {reps.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.city ? ` · ${r.city}` : ''}{r.team_role ? ` · ${r.team_role}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
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
