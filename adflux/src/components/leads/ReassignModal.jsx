// src/components/leads/ReassignModal.jsx
//
// Phase 16 — Reassign single lead modal. Ported from
// _design_reference/Leads/lead-modals-mobile.jsx (ReassignModal).
//
// Available to admin / co_owner / sales_manager (RLS gates the
// underlying UPDATE; UI just shows the picker).
//
// Inserts a status_change activity capturing the rep change so the
// timeline reflects the move.

import { useEffect, useState } from 'react'
import { X, Users as UsersIcon, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError } from '../v2/Toast'

export default function ReassignModal({ lead, onClose, onSaved }) {
  const profile = useAuthStore(s => s.profile)
  const [reps, setReps] = useState([])
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('users')
      // Phase 99.C — `role` added so the write path can detect
      // telecaller vs sales/agency target and pin the new owner
      // to the correct column instead of always writing
      // assigned_to. Without this the modal kept producing the
      // split state that Phase 99.A had to repair.
      .select('id, name, role, team_role, city, is_active')
      .in('team_role', ['sales', 'agency', 'sales_manager', 'telecaller'])
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setReps(data || []))
  }, [])

  async function handleSave() {
    if (!target) {
      setError('Pick a person to reassign to.')
      return
    }
    setSaving(true)
    setError('')

    const targetName = reps.find(r => r.id === target)?.name || 'a teammate'
    const fromName = lead.assigned?.name || 'previous rep'
    const note = reason.trim()
      ? `Reassigned: ${fromName} → ${targetName}. ${reason.trim()}`
      : `Reassigned: ${fromName} → ${targetName}.`

    // Phase 76.2.2 (2026-05-23) — order matters under RLS. If we
    // UPDATE leads.assigned_to FIRST, the OLD owner loses RLS access
    // to the lead, and the follow-up activity INSERT is denied
    // (lead_activities_via_lead policy checks SELECT on leads). Owner
    // report: "in lead ressinement history not there".
    //
    // Insert the timeline row FIRST while the current user still
    // owns the lead, THEN flip assigned_to. If the UPDATE then
    // fails (rare — RLS already passed the SELECT in the picker),
    // we have a stale activity row but the rep sees the failure
    // clearly via the error banner.
    const { error: actErr } = await supabase.from('lead_activities').insert([{
      lead_id:       lead.id,
      activity_type: 'status_change',
      notes:         note,
      created_by:    profile.id,
    }])
    if (actErr) {
      // Non-fatal — proceed with the reassign so owner workflow doesn't
      // stall on a missing timeline entry. Toast surfaces it for retry.
      toastError(actErr, 'Could not write timeline entry. Reassign still attempted.')
    }

    // Phase 99.C — role-aware reassign. Picking a TC writes to
    // telecaller_id and clears assigned_to (mirrors Phase 99.B
    // form-fix intent so /telecaller queue actually receives the
    // lead). Picking a sales / agency / sales_manager writes to
    // assigned_to and clears telecaller_id. Avoids the split
    // ownership state that produced 107 mis-columned leads
    // before Phase 99.A.
    const targetUser = reps.find(r => r.id === target)
    const isTC = targetUser?.role === 'telecaller'
    const patch = isTC
      ? { telecaller_id: target, assigned_to: null }
      : { assigned_to: target, telecaller_id: null }

    const { error: err } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', lead.id)

    if (err) {
      setSaving(false)
      setError('Reassign failed: ' + err.message)
      return
    }

    setSaving(false)
    onSaved?.()
    onClose?.()
  }

  return (
    <div
      className="lead-modal-back"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.() }}
    >
      <div className="lead-modal">
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <UsersIcon size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Reassign lead
            </div>
            <div className="lead-card-sub">{lead?.name}{lead?.company ? ` · ${lead.company}` : ''}</div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          <div>
            <label className="lead-fld-label">Pick rep</label>
            <select
              className="lead-inp"
              value={target}
              onChange={e => setTarget(e.target.value)}
              disabled={saving}
            >
              <option value="">— pick a person —</option>
              {reps.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.city ? ` · ${r.city}` : ''}{r.team_role ? ` · ${r.team_role}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lead-fld-label">Reason (optional)</label>
            <textarea
              className="lead-inp"
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why this reassign?"
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
            disabled={saving || !target}
          >
            {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            <span>Reassign</span>
          </button>
        </div>
      </div>
    </div>
  )
}
