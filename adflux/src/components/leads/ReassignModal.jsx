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
      .select('id, name, team_role, city, is_active')
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
    const { error: err } = await supabase
      .from('leads')
      .update({ assigned_to: target })
      .eq('id', lead.id)

    if (err) {
      setSaving(false)
      setError('Reassign failed: ' + err.message)
      return
    }
    const targetName = reps.find(r => r.id === target)?.name || 'a teammate'
    const note = reason.trim()
      ? `Reassigned to ${targetName}. ${reason.trim()}`
      : `Reassigned to ${targetName}.`
    // Phase 34b — was unchecked. If this insert fails, the lead is
    // reassigned but the timeline has no record of who/when. Surface
    // via toast (non-blocking) so the rep can re-add the note.
    const { error: actErr } = await supabase.from('lead_activities').insert([{
      lead_id:       lead.id,
      activity_type: 'status_change',
      notes:         note,
      created_by:    profile.id,
    }])
    if (actErr) {
      toastError(actErr, 'Reassigned, but the timeline note could not be saved.')
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
