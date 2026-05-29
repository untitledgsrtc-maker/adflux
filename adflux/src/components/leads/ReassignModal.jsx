// src/components/leads/ReassignModal.jsx
//
// Phase 16 — Reassign single lead modal. Ported from
// _design_reference/Leads/lead-modals-mobile.jsx (ReassignModal).
//
// Phase 100.B (2026-05-29) — wired to public.reassign_lead RPC.
// Previous direct UPDATE + INSERT path silently RLS-denied for
// non-admin reps even on their own leads. RPC enforces:
//   • lane-aware routing (TC vs sales column)
//   • cross-team reason gate (≥3 chars)
//   • sales→TC stage gate (New/Working/Nurture only)
//   • Won/Lost block for non-admin
//   • daily cap 5 / bulk cap 20 / segment guards
// Inline helpers below mirror the SQL lane logic so the picker UX
// matches what the backend enforces. Per owner override 2026-05-29:
// "no new utility file" — duplicated in LeadsV2.jsx by design.
//
// Available to admin / co_owner / sales_manager / sales / agency /
// telecaller (RLS + the RPC gate the actual write).
//
// RPC inserts the status_change activity itself; modal no longer
// writes lead_activities directly (single source of truth).

import { useEffect, useMemo, useState } from 'react'
import { X, Users as UsersIcon, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

// ─── Phase 100.B inline helpers ───────────────────────────────────
// Mirror public._reassign_lead_apply lane logic (Phase 100.A SQL).
// Owner override "no new utility file" → inline here and in LeadsV2.

function callerLane(profile) {
  if (!profile) return 'other'
  // W5 — sales_manager team_role overrides role='telecaller' into sales.
  if (profile.role === 'telecaller' && profile.team_role === 'sales_manager') return 'sales'
  if (profile.role === 'telecaller')                                          return 'tc'
  if (['sales', 'agency'].includes(profile.role))                             return 'sales'
  if (['admin', 'co_owner'].includes(profile.role))                           return 'admin'
  return 'other'
}

function targetLane(rep) {
  if (!rep) return 'other'
  if (rep.role === 'telecaller' && rep.team_role === 'sales_manager') return 'sales'
  if (rep.role === 'telecaller')                                      return 'tc'
  if (['sales', 'agency'].includes(rep.role))                         return 'sales'
  if (['admin', 'co_owner'].includes(rep.role))                       return 'admin'
  return 'other'
}

function eligibleTargets(reps, profile) {
  if (!profile) return []
  // Self-exclude only. The SELECT already filters to active reps in
  // sales/agency/sales_manager/telecaller team_roles, so admin/other
  // never reach this list. Per owner override: fetch-time filter OK.
  return (reps || []).filter(r => r.id !== profile.id)
}

function isCrossTeam(profile, rep) {
  if (!profile || !rep) return false
  const c = callerLane(profile)
  const t = targetLane(rep)
  return (c === 'tc' && t === 'sales') || (c === 'sales' && t === 'tc')
}

// Humanize RPC failure reasons + raised exceptions. Keep the raw
// string as fallback so unknown reasons still surface to the rep.
function humanizeReason(s) {
  if (!s) return 'Reassign failed.'
  if (s.includes('daily reassign limit reached')) return 'Daily limit reached (5 reassigns/day).'
  if (s.includes('bulk cap 20'))                   return 'Bulk cap is 20. Reduce your selection.'
  if (s.includes('auth.uid()'))                    return 'Session expired. Reload and sign back in.'
  switch (s) {
    case 'cannot reassign to self':                          return 'Cannot pick yourself.'
    case 'target not found':                                 return 'Target user not found.'
    case 'target not active':                                return 'Target rep is inactive.'
    case 'cannot reassign to admin':                         return 'Cannot reassign to admin. Pick a rep or telecaller.'
    case 'lead not found':                                   return 'Lead not found.'
    case 'not lead owner':                                   return "You don't own this lead. Ask admin to move it."
    case 'cannot reassign closed lead':                      return 'Won / Lost leads cannot be reassigned. Reopen first.'
    case 'target segment access mismatch':                   return "Target doesn't have access to this segment."
    case 'sales→TC only allowed on New/Working/Nurture stages':
                                                             return 'Can only send back to telecaller on New / Follow-up / Nurture.'
    case 'reason required for cross-team reassign':          return 'Reason required (≥3 chars) for cross-team reassign.'
    case 'role not allowed to reassign':                     return "Your role can't reassign leads."
    case 'target role not eligible':                         return "Target rep can't own leads."
    case 'government_partner caller cannot touch non-GOVERNMENT leads':
                                                             return 'Government Partner can only reassign GOVERNMENT leads.'
    default:                                                 return s
  }
}

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
      // assigned_to. Phase 100.B keeps it: the inline helpers
      // above need `role` to compute targetLane().
      .select('id, name, role, team_role, city, is_active')
      .in('team_role', ['sales', 'agency', 'sales_manager', 'telecaller'])
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setReps(data || []))
  }, [])

  // Phase 100.B — picker filter + cross-team flag derived from the
  // current pick. The flag drives the "Reason required" UI label +
  // the pre-validation gate in handleSave.
  const targets = useMemo(() => eligibleTargets(reps, profile), [reps, profile])
  const targetRep = useMemo(
    () => targets.find(r => r.id === target) || null,
    [targets, target]
  )
  const cross = isCrossTeam(profile, targetRep)

  async function handleSave() {
    if (!target) {
      setError('Pick a person to reassign to.')
      return
    }
    // Phase 100.B — cross-team reason gate. RPC enforces this too,
    // but pre-validating gives the rep a clear required-field
    // message instead of a generic RPC reason after the round-trip.
    if (cross && reason.trim().length < 3) {
      setError('Reason required (≥3 chars) for cross-team reassign.')
      return
    }

    setSaving(true)
    setError('')

    // Phase 100.B — single-lead RPC. Replaces the prior direct
    // INSERT-then-UPDATE path (Phase 76.2.2 ordering) which RLS
    // denied silently for non-admin even when they owned the lead.
    // RPC inserts the timeline row + reassign_audit row + flips
    // ownership in one SECDEF transaction.
    const { data, error: err } = await supabase.rpc('reassign_lead', {
      p_lead_id:   lead.id,
      p_new_owner: target,
      p_reason:    reason.trim() || null,
    })

    if (err) {
      setSaving(false)
      setError(humanizeReason(err.message))
      return
    }
    // RPC may return {ok:false, reason} without throwing — surface
    // those reasons via the same humanizer.
    if (data && data.ok === false) {
      setSaving(false)
      setError(humanizeReason(data.reason))
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
              {targets.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.city ? ` · ${r.city}` : ''}{r.team_role ? ` · ${r.team_role}` : ''}
                </option>
              ))}
            </select>
            {/* Phase 100.B — cross-team flag visible above the reason
                box so the rep understands why the reason is required. */}
            {cross && (
              <div
                style={{
                  marginTop: 8,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 999,
                  background: 'var(--warning-soft, rgba(245,158,11,0.14))',
                  border: '1px solid var(--warning, #F59E0B)',
                  color: 'var(--warning, #F59E0B)',
                  fontSize: 11, fontWeight: 600,
                  letterSpacing: '.04em',
                }}
              >
                <AlertTriangle size={14} />
                Cross-team move · reason required
              </div>
            )}
          </div>
          <div>
            <label className="lead-fld-label">
              Reason {cross ? <span style={{ color: 'var(--danger)' }}>(required)</span> : '(optional)'}
            </label>
            <textarea
              className="lead-inp"
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={cross ? 'Why send this to the other team?' : 'Why this reassign?'}
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
