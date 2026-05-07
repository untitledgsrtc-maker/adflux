// src/components/team/TeamMemberModal.jsx
// Admin creates team member with password — no email invite, no session switch
import { useState } from 'react'
import { X } from 'lucide-react'
import { supabase, supabaseSignup } from '../../lib/supabase'
import { useTeam } from '../../hooks/useTeam'

// Phase 11g — owner spec (4 May 2026): "i want one more role / agency
// / its same like sale person but just name agency". Agency members
// behave like sales (incentive profile, commission tracking) but
// segregated for reporting / partner-channel distinction. The 'agency'
// value is already in the users_role_check constraint from Phase 8E,
// and the incentive payout triggers operate on any role with a
// staff_incentive_profile, so adding the dropdown option is enough.
const ROLES = [
  { value: 'sales',  label: 'Sales' },
  { value: 'agency', label: 'Agency (sales-like)' },
  { value: 'admin',  label: 'Admin' },
]

// Phase 11j — segment scope. Owner spec: "how can we define its for
// goverment work only or private work only". Wires the existing
// users.segment_access column (Phase 4b) into the team UI.
// Values match the DB CHECK constraint exactly.
const SEGMENT_SCOPES = [
  { value: 'ALL',        label: 'Both (Government + Private)' },
  { value: 'GOVERNMENT', label: 'Government only (DAVP / GSRTC)' },
  { value: 'PRIVATE',    label: 'Private only (LED clients)' },
]

function Field({ label, required, error, hint, children }) {
  return (
    <div className="fg">
      <label>{label}{required && <span style={{ color: 'var(--red)' }}> *</span>}</label>
      {children}
      {error && <p style={{ fontSize: '.75rem', color: 'var(--red)', marginTop: 3 }}>{error}</p>}
      {hint && !error && <p style={{ fontSize: '.75rem', color: 'var(--gray)', marginTop: 3 }}>{hint}</p>}
    </div>
  )
}

export function TeamMemberModal({ mode = 'add', member = null, onClose, onSuccess }) {
  const { updateMember } = useTeam()

  const [form, setForm] = useState({
    name:           member?.name || '',
    email:          member?.email || '',
    password:       '',
    role:           member?.role || 'sales',
    // Phase 26 — free-text job title. Distinct from role (system enum).
    // Examples: "Senior Sales Manager", "BDM Surat", "Account Executive".
    designation:    member?.designation || '',
    // Phase 11j — segment scope. Reuses the existing users.segment_access
    // column (Phase 4b). Defaults to 'ALL' for new members.
    segment_access: member?.segment_access || 'ALL',
    monthly_salary: member?.staff_incentive_profiles?.[0]?.monthly_salary?.toString() || '',
  })
  const [errors, setErrors]           = useState({})
  const [saving, setSaving]           = useState(false)
  const [serverError, setServerError] = useState('')

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
  }

  function validate() {
    const errs = {}
    if (!form.name.trim())  errs.name  = 'Name is required'
    if (!form.email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email'
    if (mode === 'add') {
      if (!form.password) errs.password = 'Password is required'
      else if (form.password.length < 6) errs.password = 'Minimum 6 characters'
      // Phase 11g (rev) — owner spec: agency members can have 0
      // salary (commission-only). Accept "0" as a valid salary; only
      // empty / negative is invalid. For SALES role we still warn the
      // admin on empty since 0-salary sales is unusual but allow it.
      if (form.monthly_salary === '' || form.monthly_salary === null) {
        errs.monthly_salary = 'Salary is required (enter 0 for commission-only)'
      } else if (Number(form.monthly_salary) < 0 || Number.isNaN(Number(form.monthly_salary))) {
        errs.monthly_salary = 'Enter 0 or a positive number'
      }
    }
    return errs
  }

  async function handleSubmit() {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setServerError('')

    if (mode === 'add') {
      // Create the new auth user on the ISOLATED signup client.
      // That client has `persistSession: false`, so the SIGNED_IN auth
      // event never fires on the primary `supabase` client and the
      // admin stays logged in. No session save/restore dance needed.
      const { data: authData, error: authError } = await supabaseSignup.auth.signUp({
        email:    form.email.trim().toLowerCase(),
        password: form.password,
        options:  { data: { name: form.name.trim() } }
      })

      if (authError) {
        setServerError(authError.message || 'Failed to create user')
        setSaving(false)
        return
      }

      const userId = authData.user?.id
      if (!userId) {
        setServerError('User creation failed')
        setSaving(false)
        return
      }

      // Drop the new user's session from the isolated client so we don't
      // accidentally reuse it on a later call. The primary `supabase`
      // client was never touched, so the admin's session is intact.
      try { await supabaseSignup.auth.signOut() } catch (_) { /* ignore */ }

      // Insert into users table
      const { error: userError } = await supabase
        .from('users')
        .insert([{
          id:        userId,
          name:      form.name.trim(),
          email:     form.email.trim().toLowerCase(),
          role:      form.role,
          designation: form.designation.trim() || null,
          // Phase 11j — admin always 'ALL' regardless of dropdown
          // (admin must see/manage everything). Other roles get the
          // selected scope.
          segment_access: form.role === 'admin' ? 'ALL' : form.segment_access,
          is_active: true,
        }])

      if (userError) {
        setServerError(userError.message || 'Failed to save user profile')
        setSaving(false)
        return
      }

      // Upsert the incentive profile. The DB trigger
      // `auto_create_incentive_profile` has already inserted a row
      // with monthly_salary=0 using the incentive_settings defaults.
      // We upsert on user_id so the correct salary from the form
      // replaces the trigger's placeholder. We intentionally DO NOT
      // pass rate/multiplier/bonus here so whatever the trigger read
      // from incentive_settings stays in place (admin-configured
      // defaults, not the old hard-coded 5 / 0.05 / 0.02 / 10000).
      await supabase.from('staff_incentive_profiles').upsert(
        {
          user_id:        userId,
          monthly_salary: Number(form.monthly_salary),
          join_date:      new Date().toISOString().split('T')[0],
          is_active:      true,
        },
        { onConflict: 'user_id' }
      )

    } else {
      const { error } = await updateMember(member.id, {
        name: form.name.trim(),
        role: form.role,
        designation: form.designation.trim() || null,
        // Phase 11j — admin can change a rep's segment scope from edit.
        segment_access: form.role === 'admin' ? 'ALL' : form.segment_access,
      })
      if (error) {
        setServerError(error.message || 'Failed to update member')
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onSuccess?.()
    onClose()
  }

  return (
    <div className="mo" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="md">
        <div className="md-h">
          <div className="md-t">{mode === 'add' ? 'Add Team Member' : 'Edit Member'}</div>
          <button className="md-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="md-b">
          {serverError && (
            <div style={{
              background: 'rgba(229,57,53,.08)', border: '1px solid rgba(229,57,53,.25)',
              borderRadius: 8, padding: '11px 14px', fontSize: '.82rem',
              color: '#ef9a9a', marginBottom: 14,
            }}>
              {serverError}
            </div>
          )}

          <Field label="Full Name" required error={errors.name}>
            <input
              placeholder="e.g. Rahul Sharma"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              style={errors.name ? { borderColor: 'var(--red)' } : {}}
            />
          </Field>

          <Field label="Email Address" required error={errors.email} hint={mode === 'edit' ? 'Email cannot be changed' : undefined}>
            <input
              type="email"
              placeholder="rahul@company.com"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              disabled={mode === 'edit'}
              style={{ ...(mode === 'edit' ? { opacity: .5 } : {}), ...(errors.email ? { borderColor: 'var(--red)' } : {}) }}
            />
          </Field>

          {mode === 'add' && (
            <Field label="Password" required error={errors.password} hint="Min 6 characters. Share this with the team member.">
              <input
                type="text"
                placeholder="Set a password"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                style={errors.password ? { borderColor: 'var(--red)' } : {}}
              />
            </Field>
          )}

          <Field label="Role" required>
            <select value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>

          {/* Phase 26 — designation (job title). Free text, optional.
              Distinct from role: role is the system enum (admin/sales/
              agency); designation is the human-readable title shown on
              team list and lead-detail "assigned to" stamps. */}
          <Field
            label="Designation"
            hint="Job title shown on team list, lead assignments, signer blocks. e.g. Senior Sales Manager, BDM Surat, Account Executive."
          >
            <input
              type="text"
              placeholder="e.g. Senior Sales Manager"
              value={form.designation}
              onChange={e => set('designation', e.target.value)}
            />
          </Field>

          {/* Phase 11j — segment scope. Hidden for admin (always ALL). */}
          {form.role !== 'admin' && (
            <Field
              label="Segment access"
              required
              hint="What kind of quotes this person works on. Affects which New Quote options and quote-list rows they see."
            >
              <select
                value={form.segment_access}
                onChange={e => set('segment_access', e.target.value)}
              >
                {SEGMENT_SCOPES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          )}

          {mode === 'add' && (
            <>
              <div style={{ borderTop: '1px solid var(--brd)', margin: '16px 0 14px', paddingTop: 14, fontSize: '.72rem', fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                Incentive Profile
              </div>
              <Field label="Monthly Salary (₹)" required error={errors.monthly_salary} hint="Used to calculate incentive target.">
                <input
                  type="number" min="0"
                  placeholder="e.g. 35000"
                  value={form.monthly_salary}
                  onChange={e => set('monthly_salary', e.target.value)}
                  style={errors.monthly_salary ? { borderColor: 'var(--red)' } : {}}
                />
              </Field>
              <p style={{ fontSize: '.75rem', color: 'var(--gray)', marginTop: -8 }}>
                Default: 5% new clients · 2% renewals · ₹10,000 flat bonus above target
              </p>
            </>
          )}
        </div>

        <div className="md-f">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-y" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : mode === 'add' ? 'Create Member' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
