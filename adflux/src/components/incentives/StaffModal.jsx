// src/components/incentives/StaffModal.jsx
import { useState, useEffect } from 'react'
import { X, User } from 'lucide-react'
import { useIncentive } from '../../hooks/useIncentive'
import { initials, formatCurrency } from '../../utils/formatters'

export function StaffModal({ member, settings, onClose, onSaved }) {
  const { updateProfile } = useIncentive()

  const profile = member.staff_incentive_profiles?.[0] || {}

  const [form, setForm]     = useState({
    monthly_salary:   profile.monthly_salary    ?? '',
    sales_multiplier: profile.sales_multiplier  ?? settings?.default_multiplier ?? 5,
    new_client_rate:  profile.new_client_rate   ?? settings?.new_client_rate    ?? 0.05,
    renewal_rate:     profile.renewal_rate      ?? settings?.renewal_rate       ?? 0.02,
    flat_bonus:       profile.flat_bonus        ?? settings?.default_flat_bonus ?? settings?.flat_bonus ?? 10000,
    join_date:        profile.join_date         ?? '',
  })
  const [errors,  setErrors]  = useState({})
  const [saving,  setSaving]  = useState(false)
  const [apiError, setApiError] = useState(null)

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
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    if (!profile.id) {
      setApiError('No incentive profile found. Add this member from the Team page first.')
      return
    }

    setSaving(true)
    const { error } = await updateProfile(profile.id, {
      monthly_salary:   Number(form.monthly_salary),
      sales_multiplier: Number(form.sales_multiplier),
      new_client_rate:  Number(form.new_client_rate),
      renewal_rate:     Number(form.renewal_rate),
      flat_bonus:       Number(form.flat_bonus),
      join_date:        form.join_date || null,
    })
    setSaving(false)
    if (error) { setApiError(error.message); return }
    onSaved?.()
    onClose()
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
          <div className="staff-divider">Salary & Target</div>

          <div className="staff-form-row">
            <div className="staff-field">
              <label className="staff-label">Monthly Salary (₹) *</label>
              <input
                className={`staff-input${errors.monthly_salary ? ' error' : ''}`}
                type="number"
                min="0"
                value={form.monthly_salary}
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
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
