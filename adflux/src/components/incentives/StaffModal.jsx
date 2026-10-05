// src/components/incentives/StaffModal.jsx
import { useState, useEffect, useRef } from 'react'
import { X, User, Loader2, AlertTriangle } from 'lucide-react'
import { useIncentive } from '../../hooks/useIncentive'
import { initials, formatCurrency } from '../../utils/formatters'
import { confirmDialog } from '../v2/ConfirmDialog'

// Phase 328 — this modal used to build its form from a snapshot taken when the
// list loaded and then write salary + 5 other fields together, so it could
// silently put back a salary that had been changed somewhere else. Now:
//   1. on open it re-reads the person's CURRENT profile row,
//   2. on save it sends ONLY the fields the user actually changed,
//   3. a salary change asks for confirmation (it re-prices every month) and is
//      written only if the stored salary is still the one this window loaded.
const NUMERIC_FIELDS = ['monthly_salary', 'sales_multiplier', 'new_client_rate', 'renewal_rate', 'flat_bonus']

// Two form values are "the same" when both are blank or both are the same number.
function sameValue(a, b) {
  const ab = String(a ?? '').trim() === ''
  const bb = String(b ?? '').trim() === ''
  if (ab || bb) return ab && bb
  return Number(a) === Number(b)
}

export function StaffModal({ member, settings, onClose, onSaved }) {
  const { updateProfile, fetchProfileForUser } = useIncentive()

  // The row the list handed in. It can be stale, so it is only the first paint
  // and the fallback if the fresh read below fails.
  const propProfile = member.staff_incentive_profiles?.[0] || {}

  // DB row -> form values. The SAME mapping builds the form AND the baseline it
  // is compared with, so a column that is NULL in the database (shown here as
  // the settings default) is never written back unless the user edits it.
  function toForm(p) {
    return {
      monthly_salary:   p.monthly_salary    ?? '',
      sales_multiplier: p.sales_multiplier  ?? settings?.default_multiplier ?? 5,
      new_client_rate:  p.new_client_rate   ?? settings?.new_client_rate    ?? 0.05,
      renewal_rate:     p.renewal_rate      ?? settings?.renewal_rate       ?? 0.02,
      flat_bonus:       p.flat_bonus        ?? settings?.default_flat_bonus ?? settings?.flat_bonus ?? 10000,
      join_date:        p.join_date         ?? '',
    }
  }

  const [latest,    setLatest]    = useState(propProfile)       // row the form was built from
  const [baseline,  setBaseline]  = useState(() => toForm(propProfile))
  const [form, setForm]           = useState(() => toForm(propProfile))
  // 'loading' = re-reading the current row · 'fresh' = form shows the live row ·
  // 'stale' = the re-read failed, form shows the list's copy.
  const [loadState, setLoadState] = useState('loading')
  const [errors,  setErrors]  = useState({})
  const [saving,  setSaving]  = useState(false)
  const [apiError, setApiError] = useState(null)
  const savingRef = useRef(false)   // §47 synchronous latch

  useEffect(() => {
    let alive = true
    ;(async () => {
      const userId = propProfile.user_id || member.id
      if (!userId) { if (alive) setLoadState('stale'); return }
      const { data, error } = await fetchProfileForUser(userId)
      if (!alive) return
      if (error || !data) { setLoadState('stale'); return }
      const fresh = toForm(data)
      setLatest(data)
      setBaseline(fresh)
      setForm(fresh)
      setLoadState('fresh')
    })()
    return () => { alive = false }
    // Runs once per open: the parent mounts a new modal for every Edit click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const locked = loadState === 'loading'

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: null }))
    setApiError(null)
  }

  function validate() {
    // Phase 11g (rev) — owner spec (4 May 2026): "agency can be with
    // 0 salary and 0 multiplier". Agency members are partner-channel
    // and may not draw a fixed salary or hit a sales-multiplier
    // target — they earn purely on per-deal commission. Relaxed the
    // rules from "> 0" to ">= 0" so 0 is a valid entry. Negative
    // numbers still rejected.
    const errs = {}
    const salary     = form.monthly_salary === '' || form.monthly_salary === null
      ? null
      : Number(form.monthly_salary)
    const multiplier = form.sales_multiplier === '' || form.sales_multiplier === null
      ? null
      : Number(form.sales_multiplier)
    if (salary === null || Number.isNaN(salary) || salary < 0)
      errs.monthly_salary = 'Enter 0 or a positive number'
    if (multiplier === null || Number.isNaN(multiplier) || multiplier < 0)
      errs.sales_multiplier = 'Enter 0 or a positive number'
    if (form.new_client_rate === '' || form.new_client_rate === null)
      errs.new_client_rate = 'Required'
    if (form.renewal_rate === '' || form.renewal_rate === null)
      errs.renewal_rate = 'Required'
    return errs
  }

  async function handleSave() {
    if (savingRef.current || saving || locked) return
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    const profileId = latest.id || propProfile.id
    if (!profileId) {
      setApiError('No incentive profile found. Add this member from the Team page first.')
      return
    }

    // Send ONLY what the user changed: an untouched field is never rewritten,
    // so it cannot revert a value changed elsewhere since the list loaded.
    const updates = {}
    for (const k of NUMERIC_FIELDS) {
      if (!sameValue(form[k], baseline[k])) updates[k] = Number(form[k])
    }
    if ((form.join_date || null) !== (baseline.join_date || null)) {
      updates.join_date = form.join_date || null
    }
    if (Object.keys(updates).length === 0) {
      onClose()          // nothing changed - nothing to write
      return
    }

    savingRef.current = true
    try {
      const salaryChanged = Object.prototype.hasOwnProperty.call(updates, 'monthly_salary')
      if (salaryChanged) {
        const was = latest.monthly_salary
        const ok = await confirmDialog({
          title: 'Change salary?',
          message: `This changes ${member.name}'s monthly salary from ${was == null ? 'not set' : formatCurrency(Number(was))} to ${formatCurrency(updates.monthly_salary)}. Salary is read live for every month, so this re-prices EVERY month already calculated, including months already paid. The amounts recorded as paid stay as they are, but "Pending" for those months will change. Continue?`,
          confirmLabel: 'Change salary',
          cancelLabel: 'Back',
          danger: true,
        })
        if (!ok) return
      }

      setSaving(true)
      const { error } = await updateProfile(
        profileId,
        updates,
        // Salary is only written if it is still what this window loaded.
        salaryChanged ? { expectedSalary: latest.monthly_salary } : undefined,
      )
      if (error) { setApiError(error.message); return }
      onSaved?.()
      onClose()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const salary    = Number(form.monthly_salary) || 0
  const target    = salary * (Number(form.sales_multiplier) || 5)
  const threshold = salary * 2

  return (
    <div className="staff-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="staff-modal">
        <div className="staff-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="staff-avatar">{initials(member.name)}</div>
            <div>
              <h3 style={{ margin: 0 }}>{member.name}</h3>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{member.email}</div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="staff-modal-body">
          {loadState === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              <Loader2 size={14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
              Loading the latest saved values…
            </div>
          )}
          {loadState === 'stale' && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--warning)' }}>
              <AlertTriangle size={14} strokeWidth={1.6} style={{ flex: '0 0 auto', marginTop: 1 }} />
              Could not re-read the latest saved values, so this shows the list's copy. A salary change is still checked against the database when you save.
            </div>
          )}

          <div className="staff-divider">Salary & Target</div>

          <div className="staff-form-row">
            <div className="staff-field">
              <label className="staff-label">Monthly Salary (₹) *</label>
              <input
                className={`staff-input${errors.monthly_salary ? ' error' : ''}`}
                type="number"
                min="0"
                value={form.monthly_salary}
                disabled={locked}
                onChange={e => set('monthly_salary', e.target.value)}
                placeholder="e.g. 35000"
              />
              {errors.monthly_salary && <span className="staff-field-error">{errors.monthly_salary}</span>}
            </div>

            <div className="staff-field">
              <label className="staff-label">Sales Multiplier *</label>
              <input
                className={`staff-input${errors.sales_multiplier ? ' error' : ''}`}
                type="number"
                min="1"
                step="0.5"
                value={form.sales_multiplier}
                disabled={locked}
                onChange={e => set('sales_multiplier', e.target.value)}
              />
              {errors.sales_multiplier && <span className="staff-field-error">{errors.sales_multiplier}</span>}
            </div>
          </div>

          {salary > 0 && (
            <div className="staff-info-row">
              Threshold: <strong>{formatCurrency(threshold)}</strong> &nbsp;·&nbsp;
              Target: <strong>{formatCurrency(target)}</strong>
            </div>
          )}

          <div className="staff-divider">Incentive Rates</div>

          <div className="staff-form-row">
            <div className="staff-field">
              <label className="staff-label">New Client Rate *</label>
              <input
                className={`staff-input${errors.new_client_rate ? ' error' : ''}`}
                type="number"
                min="0"
                max="1"
                step="0.005"
                value={form.new_client_rate}
                disabled={locked}
                onChange={e => set('new_client_rate', e.target.value)}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                e.g. 0.05 = 5%
              </span>
              {errors.new_client_rate && <span className="staff-field-error">{errors.new_client_rate}</span>}
            </div>

            <div className="staff-field">
              <label className="staff-label">Renewal Rate *</label>
              <input
                className={`staff-input${errors.renewal_rate ? ' error' : ''}`}
                type="number"
                min="0"
                max="1"
                step="0.005"
                value={form.renewal_rate}
                disabled={locked}
                onChange={e => set('renewal_rate', e.target.value)}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                e.g. 0.02 = 2%
              </span>
              {errors.renewal_rate && <span className="staff-field-error">{errors.renewal_rate}</span>}
            </div>
          </div>

          <div className="staff-field">
            <label className="staff-label">Flat Bonus Above Target (₹)</label>
            <input
              className="staff-input"
              type="number"
              min="0"
              step="1000"
              value={form.flat_bonus}
              disabled={locked}
              onChange={e => set('flat_bonus', e.target.value)}
            />
          </div>

          <div className="staff-divider">Join Date</div>

          <div className="staff-field">
            <label className="staff-label">Join Date</label>
            <input
              className="staff-input"
              type="date"
              value={form.join_date}
              disabled={locked}
              onChange={e => set('join_date', e.target.value)}
            />
          </div>

          {apiError && (
            <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 4 }}>
              {apiError}
            </div>
          )}
        </div>

        <div className="staff-modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || locked}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
