// src/components/team/TeamMemberModal.jsx
// Admin creates team member with password — no email invite, no session switch
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase, supabaseSignup } from '../../lib/supabase'
import { useTeam } from '../../hooks/useTeam'

// Phase 11g — owner spec (4 May 2026): agency role added.
// Phase 26b — owner spec (7 May 2026): telecaller + office_staff
// added so admin can register the inside-sales caller and back-office
// people (accounts / HR / ops) without forcing them into a sales role.
// users_role_check constraint extended in supabase_phase26b_extra_roles.sql.
// Phase 101.A2 — agency relabel: commission-only partner. Salary
// fields hidden; Commission % field shown; staff_incentive_profiles
// upsert skipped. Backend rules in supabase_phase101_a1_agency_split.sql.
const ROLES = [
  { value: 'sales',        label: 'Sales' },
  { value: 'agency',       label: 'Agency (commission-only partner)' },
  { value: 'telecaller',   label: 'Telecaller' },
  { value: 'office_staff', label: 'Office staff (back office)' },
  { value: 'admin',        label: 'Admin' },
]

// Roles that don't work on quotes — segment access dropdown is
// irrelevant for them. We hide it so the form is shorter and the
// admin doesn't have to think about a meaningless field.
const ROLES_WITHOUT_SEGMENT = new Set(['admin', 'office_staff'])

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
    // Phase 101.A2 — agency commission %. Reads users.agency_commission_percent
    // (Phase 101.A1 column, default 5.00). Used only when role='agency'.
    agency_commission_percent: member?.agency_commission_percent != null
      ? String(member.agency_commission_percent)
      : '5.00',
    // Phase 101.C.JSX — agency default proposal signer. Reads
    // users.default_signer_user_id (Phase 101.C SQL column, FK to
    // users.id with validation trigger). Used only when role='agency'.
    // Empty string = unassigned; admin must pick from signers list.
    default_signer_user_id: member?.default_signer_user_id || '',
  })
  const [errors, setErrors]           = useState({})
  const [saving, setSaving]           = useState(false)
  const [serverError, setServerError] = useState('')
  // Phase 101.C.JSX — signers list for agency Default Proposal Signer
  // dropdown. Inline-fetched here (avoids importing useSigners which
  // mounts an effect we'd then ignore for non-agency edits). Fetched
  // lazily — only when form.role === 'agency' OR member's existing role
  // is agency on edit-open.
  const [signers, setSigners] = useState([])
  const [signersLoading, setSignersLoading] = useState(false)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
  }

  // Phase 101.C.JSX — lazy-fetch signers when agency role selected.
  // Single query; cached for the modal lifetime. Re-fires when admin
  // flips role to agency mid-edit (rare).
  useEffect(() => {
    if (form.role !== 'agency') return
    if (signers.length > 0) return
    let cancelled = false
    setSignersLoading(true)
    supabase
      .from('users')
      .select('id, name, role, signature_title, signing_authority, is_active')
      .eq('signing_authority', true)
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (cancelled) return
        setSignersLoading(false)
        if (err) {
          console.warn('[TeamMemberModal] signers load failed:', err.message)
          return
        }
        setSigners(data || [])
      })
    return () => { cancelled = true }
  }, [form.role, signers.length])

  function validate() {
    const errs = {}
    if (!form.name.trim())  errs.name  = 'Name is required'
    if (!form.email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email'
    if (mode === 'add') {
      if (!form.password) errs.password = 'Password is required'
      else if (form.password.length < 6) errs.password = 'Minimum 6 characters'
    }
    // Phase 101.A2 — split salary vs commission validation by role.
    // Agency = commission-only, validate commission % (0..100). All
    // other roles validate Monthly Salary in add mode per Phase 11g.
    if (form.role === 'agency') {
      const pct = Number(form.agency_commission_percent)
      if (form.agency_commission_percent === '' || form.agency_commission_percent === null) {
        errs.agency_commission_percent = 'Commission % is required'
      } else if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        errs.agency_commission_percent = 'Enter a number between 0 and 100'
      }
    } else if (mode === 'add') {
      // Phase 11g (rev) — owner spec: salary may be 0 (commission-only
      // for a non-agency rep is allowed; admin chooses). Empty /
      // negative is invalid.
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
      // Phase 101.A2 — agency carries agency_commission_percent
      // (Phase 101.A1 column) instead of monthly_salary. Other roles
      // do not write that field — DEFAULT 5.00 only applies to
      // agency rows since downstream reads only consult the column
      // when role='agency'.
      const baseInsert = {
        id:        userId,
        name:      form.name.trim(),
        email:     form.email.trim().toLowerCase(),
        role:      form.role,
        // Phase 27 — mirror role into team_role. The Reassign +
        // Default Assignee dropdowns + AI briefing all filter on
        // team_role; without this, telecallers and office_staff
        // created via the modal are invisible to those queries.
        team_role: form.role,
        designation: form.designation.trim() || null,
        // Phase 11j — admin always 'ALL' regardless of dropdown
        // (admin must see/manage everything). Other roles get the
        // selected scope.
        segment_access: ROLES_WITHOUT_SEGMENT.has(form.role) ? 'ALL' : form.segment_access,
        is_active: true,
      }
      if (form.role === 'agency') {
        baseInsert.agency_commission_percent = Number(form.agency_commission_percent)
        // Phase 101.C.JSX — persist default proposal signer when set.
        // Empty string = NULL (admin chose to leave unassigned). DB
        // validation trigger (Phase 101.C SQL) rejects writes to
        // inactive / non-signing-authority targets.
        baseInsert.default_signer_user_id = form.default_signer_user_id || null
      }
      const { error: userError } = await supabase
        .from('users')
        .insert([baseInsert])

      if (userError) {
        setServerError(userError.message || 'Failed to save user profile')
        setSaving(false)
        return
      }

      // Phase 101.A2 — agency = commission-only. Skip incentive
      // profile upsert entirely. Phase 101.A1 trigger
      // auto_create_incentive_profile now excludes role='agency'
      // so there's no placeholder row to overwrite either.
      if (form.role !== 'agency') {
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
      }

    } else {
      // Phase 101.A2 — edit mode: persist agency_commission_percent
      // when role is (or becomes) 'agency'. If admin flips an existing
      // sales user to agency, the Phase 101.A1
      // users_agency_deactivate_incentive trigger fires server-side
      // to deactivate the staff_incentive_profiles row.
      const updatePayload = {
        name: form.name.trim(),
        role: form.role,
        // Phase 27 — mirror role into team_role on edit too. If admin
        // changes Dhara from 'sales' → 'telecaller', team_role must
        // follow or the dropdowns will keep showing her as sales.
        team_role: form.role,
        designation: form.designation.trim() || null,
        // Phase 11j — admin can change a rep's segment scope from edit.
        segment_access: ROLES_WITHOUT_SEGMENT.has(form.role) ? 'ALL' : form.segment_access,
      }
      if (form.role === 'agency') {
        updatePayload.agency_commission_percent = Number(form.agency_commission_percent)
        // Phase 101.C.JSX — persist default proposal signer on edit.
        // Empty string = NULL (admin cleared the assignment).
        updatePayload.default_signer_user_id = form.default_signer_user_id || null
      }
      const { error } = await updateMember(member.id, updatePayload)
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

          {/* Phase 11j — segment scope. Hidden for admin (always ALL).
              Phase 26b — also hidden for office_staff (no quote access). */}
          {!ROLES_WITHOUT_SEGMENT.has(form.role) && (
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

          {/* Phase 101.A2 — agency = commission-only partner. Show
              Commission % input instead of Monthly Salary. Available
              in both add and edit modes (admin can adjust % later).
              Phase 101.C.JSX — Default Proposal Signer field added
              below Commission. */}
          {form.role === 'agency' && (
            <>
              <div style={{ borderTop: '1px solid var(--brd)', margin: '16px 0 14px', paddingTop: 14, fontSize: '.72rem', fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                Commission
              </div>
              <Field
                label="Commission %"
                required
                error={errors.agency_commission_percent}
                hint="Paid on Won quote base amount (GST-excluded). Default 5.00%. No salary, no incentive slab, no TA/DA."
              >
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.10"
                  placeholder="e.g. 5.00"
                  value={form.agency_commission_percent}
                  onChange={e => set('agency_commission_percent', e.target.value)}
                  style={errors.agency_commission_percent ? { borderColor: 'var(--red)' } : {}}
                />
              </Field>

              {/* Phase 101.C.JSX — Default proposal signer. Required
                  for the agency to be able to ship govt proposals;
                  Step 2 of the Auto Hood + GSRTC LED wizards locks
                  this value in place when present, blocks Next when
                  unset. Backed by users.default_signer_user_id +
                  validate_default_signer trigger (Phase 101.C SQL). */}
              <Field
                label="Default proposal signer"
                hint={
                  signersLoading
                    ? 'Loading signers…'
                    : signers.length === 0
                      ? 'No active signers found. Promote a user on Master → Signers first.'
                      : 'Locks govt proposal Step 2 to this signer when the agency creates an Auto Hood / GSRTC LED quote.'
                }
              >
                <select
                  value={form.default_signer_user_id}
                  onChange={e => set('default_signer_user_id', e.target.value)}
                  disabled={signersLoading || signers.length === 0}
                >
                  <option value="">— unassigned (agency cannot ship govt yet) —</option>
                  {signers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.signature_title ? ` (${s.signature_title})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {/* Phase 101.A2 — Monthly Salary / Incentive Profile only for
              non-agency roles. Hidden in edit mode too when role flipped
              to agency, so admin stops accidentally setting a salary on
              a commission-only partner. */}
          {mode === 'add' && form.role !== 'agency' && (
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
