// src/pages/v2/HRNewUserV2.jsx
//
// Phase 50.2 — HR Create User wizard.
//
// Flow:
//   1. HR picks designation from the master list.
//   2. Form auto-fills auth role + team role + salary + targets +
//      variable % + has_incentive (HR can override any field).
//   3. Submit → INSERT into public.users + staff_incentive_profiles
//      + daily_targets, all in one transaction-like sequence.
//   4. After success, show "Generate offer letter" button which
//      routes to /hr/offer/:userId (Phase 50.3 renderer).
//
// Auth note: this page does NOT create an auth.users row. Owner
// still invites the user via Supabase Auth → Users → Invite, then
// the auth.uid lands when they accept the invite. We pre-create the
// public.users row with email matching; the trigger that links
// auth.uid → public.users.id wires it up on first sign-in.
//
// Role gate: admin / co_owner / hr only.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserPlus, Save, AlertTriangle, CheckCircle2, ArrowLeft, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess, pushToast } from '../../components/v2/Toast'

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
  const profile = useAuthStore(s => s.profile)
  const isAuthorized = ['admin', 'co_owner', 'hr'].includes(profile?.role)

  const [designations, setDesignations] = useState([])
  const [managers,     setManagers]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [createdUser,  setCreatedUser]  = useState(null)

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
  useEffect(() => {
    if (!form.designation_id) return
    const d = designations.find(x => x.id === form.designation_id)
    if (!d) return
    setForm(f => ({
      ...f,
      monthly_salary: d.default_monthly_salary || '',
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

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return
    if (!form.name.trim() || !form.email.trim() || !pickedDesignation) {
      toastError(new Error('Missing fields'), 'Name, email and designation are required.')
      return
    }
    if (!form.password || form.password.length < 4) {
      toastError(new Error('Bad password'), 'Set a login password (min 4 chars).')
      return
    }
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

    const userRow = { id: created?.id, email: created?.email }

    // 2. INSERT staff_incentive_profile (so salary tab works).
    if (form.monthly_salary && Number(form.monthly_salary) > 0) {
      const { error: profErr } = await supabase
        .from('staff_incentive_profiles')
        .insert([{
          user_id:         userRow.id,
          monthly_salary:  Number(form.monthly_salary),
          is_active:       true,
        }])
      if (profErr) console.warn('[hr-create] profile insert failed:', profErr.message)
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

    setSaving(false)
    setCreatedUser(userRow)
    toastSuccess(`Created ${userRow.name}. Generate offer letter next →`)
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
          </div>
          <div style={{ fontSize: 12, color: 'var(--warning, #F59E0B)', marginBottom: 18, padding: 10, background: 'rgba(245,158,11,.08)', borderRadius: 8 }}>
            <strong>Next step:</strong> invite the user via Supabase Studio → Auth → Users → Invite. Use the same email. They sign in → their auth.uid links to this public.users row automatically.
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
              onClick={() => { setCreatedUser(null); setForm({
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
              onClick={() => navigate('/people')}
              style={ghostBtn}
            >
              View team
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
            <FormField label="Phone" v={form.phone} onChange={v => set('phone', v)} type="tel" />
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

        <Card title="Compensation + targets" sub="Pre-filled from designation defaults. Override per-user if needed.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FormField label="Monthly salary ₹" v={form.monthly_salary} onChange={v => set('monthly_salary', v)} type="number" placeholder="25000" />
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
