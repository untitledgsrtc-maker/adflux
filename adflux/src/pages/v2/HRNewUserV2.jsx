// src/pages/v2/HRNewUserV2.jsx
//
// Phase 50.2 — HR Create User wizard.
//
// Flow:
//   1. HR picks designation from the master list.
//   2. Form auto-fills auth role + team role + targets + variable % +
//      has_incentive (HR can override any field). SALARY IS NEVER
//      PRE-FILLED (Phase 328): HR must type it for every hire; 0 is
//      allowed only after an explicit confirm (commission-only people).
//   3. Submit → admin_create_user RPC (auth.users + public.users), then
//      an UPSERT of staff_incentive_profiles (always, so the person
//      shows up in Incentives / Salary) + daily_targets.
//   4. After success, show "Generate offer letter" button which
//      routes to /hr/offer/:userId (Phase 50.3 renderer).
//
// Auth note (Phase 66): the admin_create_user RPC creates BOTH the
// auth.users row (bcrypt password) and the public.users row, so the
// person can sign in immediately with the email + password HR sets
// here. No Supabase Studio invite step.
//
// Role gate: admin / co_owner / hr only.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { UserPlus, Save, AlertTriangle, CheckCircle2, ArrowLeft, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess, pushToast } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const CITIES = [
  'Vadodara', 'Surat', 'Ahmedabad', 'Gandhinagar', 'Rajkot',
  'Jamnagar', 'Bhavnagar', 'Veraval', 'Junagadh', 'Anand',
  'Bharuch', 'Mehsana', 'Other',
]

const SEGMENTS = [
  { v: 'PRIVATE',    label: 'Private' },
  { v: 'GOVERNMENT', label: 'Government' },
  { v: 'ALL',        label: 'Both (Private + Government)' },
]

export default function HRNewUserV2() {
  const navigate = useNavigate()
  const location = useLocation()
  // Phase 281 — convert-to-hire: HRCandidatesV2 sends {prefill:{name,email,phone,candidate_id}}.
  const prefill = location.state?.prefill || null
  const profile = useAuthStore(s => s.profile)
  const isAuthorized = ['admin', 'co_owner', 'hr'].includes(profile?.role)

  const [designations, setDesignations] = useState([])
  const [managers,     setManagers]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [createdUser,  setCreatedUser]  = useState(null)
  // Phase 328 — outcome of the salary-profile write, shown on the success
  // screen: { saved: number|null, error: string, note: string }.
  const [salaryResult, setSalaryResult] = useState(null)
  // Section 47 — synchronous latch (state alone is not enough against a
  // WebView ghost-click firing handleSubmit several times in one tick).
  const savingRef = useRef(false)

  const [form, setForm] = useState({
    designation_id:    '',
    name:              '',
    email:             '',
    // Phase 66 (21 May 2026) — password field. Form now creates
    // auth.users + public.users in one shot via admin_create_user
    // RPC, so HR doesn't need to open Studio Auth UI separately.
    password:          '',
    phone:             '',
    city:              'Vadodara',
    segment_access:    'PRIVATE',
    manager_id:        '',
    join_date:         new Date().toISOString().slice(0, 10),
    // Overrides — autofill from designation, HR can edit.
    monthly_salary:    '',
    has_incentive:     false,
    variable_pct:      0,
    min_calls:         0,
    min_quotes:        0,
    min_followups:     0,
    // Phase 57 — per-user expense kind toggles. Snap from
    // designation default; HR overrides per-user.
    allow_ta:          false,
    allow_da:          false,
    allow_hotel:       false,
    allow_other:       true,
  })

  useEffect(() => {
    if (profile && !isAuthorized) navigate('/dashboard', { replace: true })
  }, [profile, isAuthorized, navigate])

  // Phase 281 — seed name/email/phone from the candidate being converted (once).
  useEffect(() => {
    if (!prefill) return
    setForm(f => ({
      ...f,
      name:  f.name  || prefill.name  || '',
      email: f.email || prefill.email || '',
      phone: f.phone || prefill.phone || '',
    }))
  }, [prefill])

  useEffect(() => {
    if (!isAuthorized) return
    let cancelled = false
    async function load() {
      const [desRes, mgrRes] = await Promise.all([
        supabase.from('designations').select('*').eq('is_active', true).order('display_order'),
        // Phase 97.8 (2026-05-28, F-001a) — 'owner' role dropped
        // from the DB CHECK constraint (§8); literal removed here
        // so the filter array matches reality. No behavior change
        // (zero rows ever matched 'owner' anyway).
        supabase.from('users').select('id, name, team_role').in('team_role', ['sales_manager', 'admin']).eq('is_active', true).order('name'),
      ])
      if (cancelled) return
      setDesignations(desRes.data || [])
      setManagers(mgrRes.data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [isAuthorized])

  // When designation picked, snap form defaults to the master row.
  // Phase 328 — monthly_salary is deliberately NOT snapped: there is no
  // salary rate card. The box stays empty until HR types the figure (and
  // keeps whatever HR already typed if the designation is changed).
  useEffect(() => {
    if (!form.designation_id) return
    const d = designations.find(x => x.id === form.designation_id)
    if (!d) return
    setForm(f => ({
      ...f,
      has_incentive:  d.has_incentive,
      variable_pct:   d.default_variable_pct || 0,
      min_calls:      d.default_min_calls || 0,
      min_quotes:     d.default_min_quotes || 0,
      min_followups:  d.default_min_followups || 0,
      // Phase 57 — pull the 4 expense flags from the designation
      // defaults. HR can override the checkboxes after this snap.
      allow_ta:       !!d.default_allow_ta,
      allow_da:       !!d.default_allow_da,
      allow_hotel:    !!d.default_allow_hotel,
      allow_other:    d.default_allow_other !== false,  // default true
    }))
  }, [form.designation_id, designations])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const pickedDesignation = useMemo(
    () => designations.find(x => x.id === form.designation_id),
    [designations, form.designation_id]
  )

  // Section 47 latch wrapper. The latch is taken synchronously before the first
  // await (the confirm dialogs below) and released on EVERY exit path.
  async function handleSubmit(e) {
    e.preventDefault()
    if (savingRef.current || saving) return
    savingRef.current = true
    try {
      await createMember()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function createMember() {
    if (!form.name.trim() || !form.email.trim() || !pickedDesignation) {
      toastError(new Error('Missing fields'), 'Name, email and designation are required.')
      return
    }
    // Phase 282 — mobile compulsory: it auto-maps to whatsapp_number so the new
    // rep gets the morning greet-gate + daily WhatsApp assistant from day one.
    if (String(form.phone || '').replace(/\D/g, '').length < 10) {
      toastError(new Error('Mobile required'), 'A 10-digit mobile number is required (it connects them to the daily WhatsApp assistant).')
      return
    }
    if (!form.password || form.password.length < 4) {
      toastError(new Error('Bad password'), 'Set a login password (min 4 chars).')
      return
    }

    // Phase 328 — salary must be typed explicitly (no rate-card default).
    // Blank / negative / not-a-number is rejected; 0 is allowed ONLY after a
    // confirm (commission-only people). Full sentence goes in the toast
    // message itself: toastError shows error.message, not the fallback.
    const salaryRaw = String(form.monthly_salary ?? '').trim()
    const salaryNum = Number(salaryRaw)
    if (salaryRaw === '' || !Number.isFinite(salaryNum) || salaryNum < 0) {
      pushToast('Type the monthly salary for this person. There is no default - type 0 only for commission-only people.', 'danger')
      return
    }
    if (salaryNum === 0) {
      // Money disclosure (B4 review): for an incentive person the profile keeps the
      // incentive defaults, and the salary engine has no zero-salary guard - the
      // earned-incentive threshold AND target are salary-based, so at salary 0 both
      // are 0: incentive pays from the first rupee of sales and the flat bonus
      // (10,000 by default) is paid on any sale. HR must see that before saying yes.
      // (Disclosure only - no number is changed here. An engine-side zero-salary
      // guard is a separate shadow-compared change, section 71 rule 3.)
      const incentiveNote = form.has_incentive
        ? ' This person has incentive switched on: with salary 0 the incentive starts paying from the FIRST rupee of sales, and the flat bonus (10,000 by default) is paid on any sale. Go back and type a real salary unless that is what you want.'
        : ''
      const zeroOk = await confirmDialog({
        title: 'Salary is 0?',
        message: 'Salary 0 means no fixed pay - only OK for commission-only people.' + incentiveNote + ' Continue?',
        confirmLabel: 'Yes, salary 0',
        cancelLabel: 'Back',
      })
      if (!zeroOk) return
    }

    // Phase 183 — confirm the RESOLVED role before minting. The designation
    // dropdown lists every role in one flat list (Sales / Telecaller / Office
    // / Accounts) so a wrong pick is easy; this surfaces auth_role + team_role
    // + salary in plain words so HR catches it before the account exists.
    // (JAYNA ROHIT was created 'sales' from a mis-picked designation — the RPC
    // faithfully mints whatever is picked; there is no code path Telecaller→sales.)
    const salaryTxt = salaryNum > 0
      ? '₹' + salaryNum.toLocaleString('en-IN')
      : (form.has_incentive ? '₹0 (no fixed pay, incentive from the first rupee)' : '₹0 (no fixed pay)')
    const ok = await confirmDialog({
      title: 'Create this member?',
      message: `Creating ${form.name.trim()} as role ${String(pickedDesignation.auth_role).toUpperCase()} · team ${pickedDesignation.team_role} · designation ${pickedDesignation.name} · salary ${salaryTxt}. Correct?`,
      confirmLabel: 'Create',
      cancelLabel: 'Back',
    })
    if (!ok) return

    setSaving(true)

    // Phase 66 (21 May 2026) — single RPC creates auth.users +
    // public.users with bcrypt-hashed password. Replaces the prior
    // direct INSERT INTO public.users which (a) crashed on the
    // non-existent `phone` column and (b) required admin to set
    // the login password manually in Studio Auth UI afterwards.
    const { data: created, error: rpcErr } = await supabase.rpc('admin_create_user', {
      p_email:            form.email.trim().toLowerCase(),
      p_password:         form.password,
      p_name:             form.name.trim(),
      p_role:             pickedDesignation.auth_role,
      p_team_role:        pickedDesignation.team_role,
      p_designation:      pickedDesignation.name || null,
      p_signature_mobile: form.phone.trim() || null,
      p_city:             form.city || null,
      p_segment_access:   form.segment_access || 'PRIVATE',
      p_manager_id:       form.manager_id || null,
      p_allow_ta:         !!form.allow_ta,
      p_allow_da:         !!form.allow_da,
      p_allow_hotel:      !!form.allow_hotel,
      p_allow_other:      form.allow_other !== false,
    })

    if (rpcErr) {
      setSaving(false)
      toastError(rpcErr, 'Could not create user.')
      return
    }

    // Phase 282 — surface the rare case where the mobile is already mapped to
    // another user (unique whatsapp_number): the user is still created, but they
    // won't get the assistant until the clash is resolved.
    if (created && created.whatsapp_mapped === false) {
      toastError(new Error('Mobile not mapped'), 'User created, but this mobile is already linked to another user — they will not get the WhatsApp assistant until the number is fixed.')
    }

    // The admin_create_user RPC returns only { id, email }; the success view +
    // toast also read name/role/team_role — fill them from the in-scope form +
    // picked designation so the confirmation screen shows the real member (not
    // "Created undefined."). Phase 281 convert-to-hire terminates on this screen.
    const userRow = {
      id:        created?.id,
      email:     created?.email,
      name:      form.name.trim(),
      role:      pickedDesignation.auth_role,
      team_role: pickedDesignation.team_role,
    }

    // 2. UPSERT staff_incentive_profile — ALWAYS, so the person shows up in
    //    Incentives / Salary even when the salary is 0 (Phase 328).
    //    Why upsert: for role 'sales' the users trigger
    //    auto_create_incentive_profile has ALREADY inserted a salary-0 row, so
    //    the old plain insert hit UNIQUE(user_id) and HR's typed salary was
    //    silently dropped.
    //    Rates: a person WITHOUT incentive (ops / accounts / HR / designers)
    //    gets 0 for multiplier / new / renewal / bonus so the table defaults
    //    (5x / 5% / 2% / 10,000) never attach to them. For incentive people
    //    those 4 columns are NOT sent, so the trigger's incentive_settings
    //    values (sales) or the table defaults (telecaller) stay as before.
    //    Safety: if this email already had a profile with a salary > 0 (the RPC
    //    reuses an existing login), that row is left untouched - never
    //    overwritten silently.
    const salaryOutcome = { saved: null, error: '', note: '' }
    if (!userRow.id) {
      salaryOutcome.error = 'the server did not return the new user id'
    } else {
      const { data: existingProf, error: exErr } = await supabase
        .from('staff_incentive_profiles')
        .select('id, monthly_salary')
        .eq('user_id', userRow.id)
        .maybeSingle()
      if (exErr) {
        salaryOutcome.error = exErr.message
      } else if (existingProf && Number(existingProf.monthly_salary) > 0) {
        const keptSalary = Number(existingProf.monthly_salary)
        salaryOutcome.saved = keptSalary
        if (keptSalary !== salaryNum) {
          salaryOutcome.note = `${userRow.name} already had a salary of ₹${keptSalary.toLocaleString('en-IN')} on file, so it was NOT changed. If it should change, edit it in People → Team.`
        }
      } else {
        const profilePayload = {
          user_id:        userRow.id,
          monthly_salary: salaryNum,
          is_active:      true,
        }
        if (!form.has_incentive) {
          profilePayload.sales_multiplier = 0
          profilePayload.new_client_rate  = 0
          profilePayload.renewal_rate     = 0
          profilePayload.flat_bonus       = 0
        }
        const { error: profErr } = await supabase
          .from('staff_incentive_profiles')
          .upsert([profilePayload], { onConflict: 'user_id' })
        if (profErr) salaryOutcome.error = profErr.message
        else salaryOutcome.saved = salaryNum
      }
    }
    if (salaryOutcome.error) {
      console.warn('[hr-create] salary profile write failed:', salaryOutcome.error)
      pushToast(`Login created but salary not saved - set it in People → Team (or ask the admin). Reason: ${salaryOutcome.error}`, 'danger', { ttl: 0 })
    }

    // 3. INSERT daily_targets (only when at least one target is non-zero).
    if (form.min_calls > 0 || form.min_quotes > 0 || form.min_followups > 0) {
      const { error: tgtErr } = await supabase
        .from('daily_targets')
        .insert([{
          user_id:               userRow.id,
          min_calls:             Number(form.min_calls) || 0,
          min_quotes:            Number(form.min_quotes) || 0,
          min_followups:         Number(form.min_followups) || 0,
          effective_from:        form.join_date,
        }])
      if (tgtErr) console.warn('[hr-create] target insert failed:', tgtErr.message)
    }

    // Phase 281 — if converting a recruit candidate, link it to the new login
    // (candidate card then shows "Login created"). Best-effort.
    if (prefill?.candidate_id && userRow.id) {
      const { error: linkErr } = await supabase
        .from('hr_candidates')
        .update({ converted_user_id: userRow.id, stage: 'hired' })
        .eq('id', prefill.candidate_id)
      if (linkErr) console.warn('[hr-create] candidate link failed:', linkErr.message)
    }

    // Phase 282 — auto-start the new hire's onboarding from their role template.
    // Best-effort: no template for the role yet → RPC returns null, no run, no error.
    if (userRow.id) {
      const { error: obErr } = await supabase.rpc('create_onboarding_run', { p_user_id: userRow.id })
      if (obErr) console.warn('[hr-create] onboarding run failed:', obErr.message)
    }

    setSaving(false)
    setSalaryResult(salaryOutcome)
    setCreatedUser(userRow)
    // No success toast when the salary failed: the red toast above (and the red
    // banner on the next screen) must not be contradicted by a green one.
    if (!salaryOutcome.error) {
      toastSuccess(`Created ${userRow.name}. Generate offer letter next →`)
    }
  }

  if (!isAuthorized) return null
  if (loading) {
    return <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
  }

  // Success view — show next-step CTAs.
  if (createdUser) {
    return (
      <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
        <div style={{
          padding: '20px 24px',
          background: 'rgba(16,185,129,.08)',
          border: '1px solid rgba(16,185,129,.35)',
          borderRadius: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <CheckCircle2 size={20} style={{ color: 'var(--success, #10B981)' }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
              {createdUser.name} created
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            Email: <strong>{createdUser.email}</strong> · Role: <strong>{createdUser.role}</strong> · Team: <strong>{createdUser.team_role}</strong>
            {salaryResult?.saved != null && (
              <> · Salary: <strong>₹{Number(salaryResult.saved).toLocaleString('en-IN')}</strong></>
            )}
          </div>
          {/* Phase 328 — a failed salary write must be impossible to miss
              (the old code only console.warn()ed it). */}
          {salaryResult?.error && (
            <div
              role="alert"
              style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                fontSize: 13, color: 'var(--text)', marginBottom: 14, padding: 12,
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius)',
              }}
            >
              <AlertTriangle size={16} strokeWidth={1.6} style={{ color: 'var(--danger)', flex: '0 0 auto', marginTop: 1 }} />
              <div>
                <strong>Login created but salary not saved.</strong> Set it in People → Team (or ask the admin) before payroll is run.
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>Reason: {salaryResult.error}</div>
              </div>
            </div>
          )}
          {salaryResult?.note && (
            <div
              style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                fontSize: 13, color: 'var(--text)', marginBottom: 14, padding: 12,
                background: 'var(--warning-soft)',
                border: '1px solid var(--warning)',
                borderRadius: 'var(--radius)',
              }}
            >
              <AlertTriangle size={16} strokeWidth={1.6} style={{ color: 'var(--warning)', flex: '0 0 auto', marginTop: 1 }} />
              <div>{salaryResult.note}</div>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 18, padding: 10, background: 'var(--success-soft)', borderRadius: 'var(--radius)' }}>
            <strong>Next step:</strong> share the login. {createdUser.name} can sign in right now with <strong>{createdUser.email}</strong> and the password you set - no Supabase Studio invite is needed.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => navigate(`/hr/offer/${createdUser.id}`)}
              style={primaryBtn}
            >
              <Send size={14} /> Generate offer letter
            </button>
            <button
              type="button"
              onClick={() => { setCreatedUser(null); setSalaryResult(null); setForm({
                designation_id: '', name: '', email: '', password: '', phone: '', city: 'Vadodara',
                segment_access: 'PRIVATE', manager_id: '',
                join_date: new Date().toISOString().slice(0, 10),
                monthly_salary: '', has_incentive: false, variable_pct: 0,
                min_calls: 0, min_quotes: 0, min_followups: 0,
              }) }}
              style={ghostBtn}
            >
              <UserPlus size={14} /> Add another
            </button>
            <button
              type="button"
              // Phase 109 — HR can't reach /people (admin-only). Send the
              // HR role to the HR home; admin/co_owner keep the roster.
              onClick={() => navigate(profile?.role === 'hr' ? '/hr' : '/people')}
              style={ghostBtn}
            >
              {profile?.role === 'hr' ? 'Done' : 'View team'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Form view.
  return (
    <div style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={iconBtn}><ArrowLeft size={18} /></button>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.10em', fontWeight: 600 }}>
            HR · New hire
          </div>
          <h1 style={{ margin: '4px 0 0', fontSize: 22, color: 'var(--text)' }}>Create user</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        <Card title="Designation">
          <select
            value={form.designation_id}
            onChange={e => set('designation_id', e.target.value)}
            required
            style={fullInput}
          >
            <option value="">— Pick a designation —</option>
            {designations.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {pickedDesignation && (
            <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,255,255,.02)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              Auth role <strong style={{ color: 'var(--text)' }}>{pickedDesignation.auth_role}</strong> ·
              Team role <strong style={{ color: 'var(--text)' }}>{pickedDesignation.team_role}</strong> ·
              {pickedDesignation.has_incentive
                ? <> Incentive <strong style={{ color: 'var(--success)' }}>{pickedDesignation.default_variable_pct}%</strong></>
                : <> <em>Flat salary</em></>}
              {pickedDesignation.notes && (
                <div style={{ marginTop: 6, fontStyle: 'italic' }}>{pickedDesignation.notes}</div>
              )}
            </div>
          )}
        </Card>

        <Card title="Personal details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Name *" v={form.name} onChange={v => set('name', v)} required />
            <FormField label="Email *" v={form.email} onChange={v => set('email', v)} type="email" required placeholder="firstname@untitledadvertising.in" />
            <FormField label="Mobile *" v={form.phone} onChange={v => set('phone', v)} type="tel" required placeholder="10-digit WhatsApp mobile" />
            {/* Phase 66 — login password (creates auth.users row).
                Min 4 chars enforced server-side. Owner default = 123456
                for staging; rep can change later via password-reset. */}
            <FormField label="Login password *" v={form.password} onChange={v => set('password', v)} type="password" required placeholder="min 4 chars" />
            <SelectField label="City" v={form.city} onChange={v => set('city', v)} options={CITIES.map(c => [c, c])} />
            <SelectField label="Segment access" v={form.segment_access} onChange={v => set('segment_access', v)} options={SEGMENTS.map(s => [s.v, s.label])} />
            <FormField label="Join date" v={form.join_date} onChange={v => set('join_date', v)} type="date" />
          </div>
        </Card>

        <Card title="Reports to (optional)">
          <select
            value={form.manager_id}
            onChange={e => set('manager_id', e.target.value)}
            style={fullInput}
          >
            <option value="">— No manager —</option>
            {managers.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.team_role})
              </option>
            ))}
          </select>
        </Card>

        <Card title="Compensation + targets" sub="Salary has no default: type it for every hire (0 only for commission-only people). Targets, incentive and expense flags are pre-filled from the designation - change them per person if needed.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FormField label="Monthly salary ₹ *" v={form.monthly_salary} onChange={v => set('monthly_salary', v)} type="number" required placeholder="Type salary" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13 }}>
              <input type="checkbox" checked={form.has_incentive} onChange={e => set('has_incentive', e.target.checked)} />
              Has incentive
            </label>
            <FormField label="Variable %" v={form.variable_pct} onChange={v => set('variable_pct', v)} type="number" />
            <FormField label="Min calls / day" v={form.min_calls} onChange={v => set('min_calls', v)} type="number" />
            <FormField label="Min quotes / wk" v={form.min_quotes} onChange={v => set('min_quotes', v)} type="number" />
            <FormField label="Min follow-ups" v={form.min_followups} onChange={v => set('min_followups', v)} type="number" />
          </div>

          {/* Phase 57 — per-user expense kind toggles. Snap defaults
              from designation; HR overrides per rep (e.g. specific
              TC who occasionally travels gets TA + DA + Hotel
              ticked). TaDaRequestPanel reads these flags and only
              shows tabs the user is allowed to file. */}
          <div style={{
            marginTop: 14,
            padding: '12px 14px',
            background: 'rgba(255,255,255,.03)',
            border: '1px solid var(--border)',
            borderRadius: 10,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '.12em',
              color: 'var(--text-muted)', textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              Expense claims this user can file
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: 13 }}>
              <label style={checkRow}>
                <input type="checkbox" checked={form.allow_ta} onChange={e => set('allow_ta', e.target.checked)} />
                TA (bike km × city rate)
              </label>
              <label style={checkRow}>
                <input type="checkbox" checked={form.allow_da} onChange={e => set('allow_da', e.target.checked)} />
                DA (overnight)
              </label>
              <label style={checkRow}>
                <input type="checkbox" checked={form.allow_hotel} onChange={e => set('allow_hotel', e.target.checked)} />
                Hotel stay
              </label>
              <label style={checkRow}>
                <input type="checkbox" checked={form.allow_other} onChange={e => set('allow_other', e.target.checked)} />
                Other expenses
              </label>
            </div>
          </div>
        </Card>

        <div style={{
          padding: 12,
          background: 'rgba(245,158,11,.08)',
          border: '1px solid rgba(245,158,11,.30)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--text)',
          display: 'flex', gap: 8,
        }}>
          <AlertTriangle size={14} style={{ color: 'var(--warning)', flex: '0 0 auto', marginTop: 2 }} />
          <div>
            {/* Phase 66 — RPC creates BOTH auth.users + public.users.
                Rep can log in with the password above immediately. */}
            <strong>User created in one shot.</strong> Rep can sign in immediately with the email + login password set above. No extra Supabase Studio step needed.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={() => navigate(-1)} style={ghostBtn}>Cancel</button>
          <button type="submit" disabled={saving || !form.name.trim() || !form.email.trim() || !form.designation_id} style={primaryBtn}>
            <Save size={14} /> {saving ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Card({ title, sub, children }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 18,
    }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{title}</h3>
        {sub && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function FormField({ label, v, onChange, type = 'text', required, placeholder }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={fieldLabel}>{label}</span>
      <input
        type={type}
        value={v}
        onChange={e => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        style={fullInput}
      />
    </label>
  )
}

function SelectField({ label, v, onChange, options }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={fieldLabel}>{label}</span>
      <select value={v} onChange={e => onChange(e.target.value)} style={fullInput}>
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </label>
  )
}

const fieldLabel = {
  fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '.08em', fontWeight: 600,
}
const checkRow = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '6px 0', fontSize: 13,
  color: 'var(--text)', cursor: 'pointer',
}
const fullInput = {
  width: '100%', padding: '9px 12px',
  background: 'var(--surface-2, var(--bg))',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13, fontFamily: 'inherit', outline: 'none',
}
const primaryBtn = {
  padding: '10px 18px',
  background: 'var(--accent, #FFE600)',
  color: 'var(--accent-fg, #0f172a)',
  border: 'none', borderRadius: 10,
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontFamily: 'inherit',
}
const ghostBtn = {
  padding: '10px 18px',
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontWeight: 600, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontFamily: 'inherit',
}
const iconBtn = {
  ...ghostBtn,
  padding: 8,
}
