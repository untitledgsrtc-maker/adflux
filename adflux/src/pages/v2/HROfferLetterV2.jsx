// src/pages/v2/HROfferLetterV2.jsx
//
// Phase 50.3 — HR offer-letter generator at /hr/offer/:userId.
//
// Flow:
//   1. Load public.users row + their staff_incentive_profile.
//   2. HR picks a designation (defaults to the team_role match) so
//      we know position label + variable %. users.designation_id is
//      not persisted (Phase 50.2 keeps it form-local) so HR confirms
//      here.
//   3. HR fills the supplemental fields the letter needs that the
//      user row doesn't carry: father's name, full address, PAN,
//      joining date, place.
//   4. Compose a synthetic `offer` object matching the shape
//      `OfferLetterPDF.OfferDocument` expects.
//   5. "Download offer letter" generates a 4-page PDF (Letter of
//      Appointment + Annexure A/B/C) via @react-pdf/renderer and
//      hands the blob to the browser.
//
// No DB write. HR keeps the PDF in their records and shares it
// with the new joiner. If the joiner needs digital acceptance flow,
// HR uses the existing /hr "Send Offer" path (pre-hire) instead.
//
// Role gate: admin / co_owner / hr only.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, AlertTriangle, FileText, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { downloadOfferLetter } from '../../components/hr/OfferLetterPDF'

const STATES = [
  'Gujarat', 'Maharashtra', 'Rajasthan', 'Madhya Pradesh', 'Delhi',
  'Karnataka', 'Tamil Nadu', 'Telangana', 'Andhra Pradesh', 'Kerala',
  'West Bengal', 'Uttar Pradesh', 'Haryana', 'Punjab', 'Bihar',
  'Odisha', 'Chhattisgarh', 'Jharkhand', 'Assam', 'Other',
]

export default function HROfferLetterV2() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAuthorized = ['admin', 'co_owner', 'hr'].includes(profile?.role)

  const [loading,      setLoading]      = useState(true)
  const [user,         setUser]         = useState(null)
  const [profileRow,   setProfileRow]   = useState(null)
  const [designations, setDesignations] = useState([])
  const [generating,   setGenerating]   = useState(false)

  const [form, setForm] = useState({
    designation_id:                '',
    position_override:             '',
    fathers_name:                  '',
    address_line1:                 '',
    address_line2:                 '',
    city:                          '',
    district:                      '',
    state:                         'Gujarat',
    pincode:                       '',
    pan_number:                    '',
    place:                         'Vadodara',
    joining_date:                  new Date().toISOString().slice(0, 10),
    monthly_salary:                '',
    incentive_sales_multiplier:    '2',
    incentive_new_client_rate:     '0.03',
    incentive_renewal_rate:        '0.02',
    incentive_flat_bonus:          '0',
  })

  useEffect(() => {
    if (!isAuthorized) {
      navigate('/dashboard', { replace: true })
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [
        { data: u,   error: uErr },
        { data: pf,  error: pfErr },
        { data: ds,  error: dsErr },
      ] = await Promise.all([
        supabase.from('users')
          .select('id, name, email, phone, city, role, team_role, segment_access')
          .eq('id', userId).single(),
        supabase.from('staff_incentive_profiles')
          .select('user_id, monthly_salary')
          .eq('user_id', userId).maybeSingle(),
        supabase.from('designations')
          .select('id, name, auth_role, team_role, default_monthly_salary, has_incentive, default_variable_pct, display_order, is_active')
          .eq('is_active', true)
          .order('display_order'),
      ])
      if (cancelled) return
      if (uErr || !u) {
        toastError(uErr || new Error('User not found'), 'Could not load user.')
        setLoading(false)
        return
      }
      if (pfErr) console.warn('[hr-offer] incentive profile fetch failed:', pfErr.message)
      if (dsErr) console.warn('[hr-offer] designations fetch failed:', dsErr.message)

      setUser(u)
      setProfileRow(pf || null)
      setDesignations(ds || [])

      // Default-pick designation by team_role match.
      const defaultDes = (ds || []).find(x => x.team_role === u.team_role)
      setForm(f => ({
        ...f,
        designation_id:   defaultDes?.id || '',
        city:             u.city || 'Vadodara',
        monthly_salary:   (pf?.monthly_salary ?? defaultDes?.default_monthly_salary ?? '').toString(),
      }))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId, isAuthorized, navigate])

  const picked = useMemo(
    () => designations.find(x => x.id === form.designation_id) || null,
    [designations, form.designation_id]
  )

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleDownload() {
    if (!user) return
    if (!picked) {
      toastError(new Error('Designation missing'), 'Please pick a designation.')
      return
    }
    if (!form.fathers_name.trim() || !form.address_line1.trim() || !form.city.trim() || !form.pincode.trim()) {
      toastError(new Error('Address incomplete'), "Father's name, address line 1, city and pincode are required.")
      return
    }
    setGenerating(true)
    try {
      const offer = {
        // Identifiers / dates
        id:             user.id,
        reference_no:   `UA/HR/APPT/${new Date().getFullYear()}/${user.id.slice(0, 4).toUpperCase()}`,
        created_at:     new Date().toISOString(),
        accepted_terms_at: null,           // signed offline; HR can re-issue from pre-hire flow if needed

        // Identity
        candidate_name:   user.name,
        full_legal_name:  user.name,
        candidate_email:  user.email,
        personal_email:   user.email,
        mobile:           user.phone || '',
        fathers_name:     form.fathers_name.trim(),
        pan_number:       form.pan_number.trim() || null,

        // Address
        address_line1: form.address_line1.trim(),
        address_line2: form.address_line2.trim(),
        city:          form.city.trim(),
        district:      form.district.trim(),
        state:         form.state,
        pincode:       form.pincode.trim(),

        // Role
        position:      form.position_override.trim() || picked.name,
        territory:     user.segment_access === 'GOVERNMENT' ? 'Government segment, Gujarat'
                     : user.segment_access === 'PRIVATE'    ? 'Private segment, Gujarat'
                     : 'Gujarat (all segments)',
        place:         form.place || 'Vadodara',
        joining_date:  form.joining_date,

        // Compensation
        fixed_salary_monthly:        Number(form.monthly_salary) || 0,
        incentive_sales_multiplier:  Number(form.incentive_sales_multiplier) || 0,
        incentive_new_client_rate:   Number(form.incentive_new_client_rate)  || 0,
        incentive_renewal_rate:      Number(form.incentive_renewal_rate)     || 0,
        incentive_flat_bonus:        Number(form.incentive_flat_bonus)       || 0,
      }
      await downloadOfferLetter(offer, null)
      toastSuccess('Offer letter downloaded.')
    } catch (err) {
      toastError(err, 'Could not generate the PDF.')
    } finally {
      setGenerating(false)
    }
  }

  if (!isAuthorized) return null
  if (loading) {
    return (
      <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
        Loading user…
      </div>
    )
  }
  if (!user) {
    return (
      <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
        User not found.
        <div style={{ marginTop: 16 }}>
          <button onClick={() => navigate('/hr')} style={ghostBtn}>
            <ArrowLeft size={14} /> Back to HR
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={() => navigate(-1)} style={iconBtn} aria-label="Back">
          <ArrowLeft size={16} />
        </button>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Hiring · Phase 50.3
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text)' }}>
            Offer letter — {user.name}
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-muted)' }}>
            {user.email} · {user.role} · {user.team_role}
          </div>
        </div>
      </div>

      <div style={{
        marginBottom: 16,
        padding: '10px 14px',
        background: 'rgba(245,158,11,.10)',
        border: '1px solid rgba(245,158,11,.35)',
        borderRadius: 10,
        color: 'var(--warning)',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, lineHeight: 1.45 }}>
          This generates the printable offer letter (4 pages, A4 — Letter of
          Appointment + Annexure A/B/C). Nothing is saved to the database;
          download the PDF and share with the new joiner. For pre-hire
          digital-acceptance flow use HR → Send Offer instead.
        </div>
      </div>

      <Card title="Role & compensation">
        <FormField label="Designation">
          <select
            value={form.designation_id}
            onChange={e => {
              const id = e.target.value
              const d = designations.find(x => x.id === id)
              setForm(f => ({
                ...f,
                designation_id: id,
                monthly_salary: d?.default_monthly_salary?.toString() || f.monthly_salary,
              }))
            }}
            style={fullInput}
          >
            <option value="">Pick designation…</option>
            {designations.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Position label override (optional)">
          <input
            value={form.position_override}
            onChange={e => set('position_override', e.target.value)}
            placeholder={picked?.name || 'Pick designation first'}
            style={fullInput}
          />
        </FormField>
        <Row>
          <FormField label="Joining date">
            <input type="date" value={form.joining_date} onChange={e => set('joining_date', e.target.value)} style={fullInput} />
          </FormField>
          <FormField label="Place (offer issued at)">
            <input value={form.place} onChange={e => set('place', e.target.value)} style={fullInput} />
          </FormField>
        </Row>
        <Row>
          <FormField label="Monthly salary (₹)">
            <input
              type="number" min={0}
              value={form.monthly_salary}
              onChange={e => set('monthly_salary', e.target.value)}
              style={fullInput}
            />
          </FormField>
          <FormField label="Incentive multiplier (x fixed)">
            <input
              type="number" min={0} step={0.5}
              value={form.incentive_sales_multiplier}
              onChange={e => set('incentive_sales_multiplier', e.target.value)}
              style={fullInput}
            />
          </FormField>
        </Row>
        <Row>
          <FormField label="New-client commission (0–1)">
            <input
              type="number" min={0} max={1} step={0.005}
              value={form.incentive_new_client_rate}
              onChange={e => set('incentive_new_client_rate', e.target.value)}
              style={fullInput}
            />
          </FormField>
          <FormField label="Renewal commission (0–1)">
            <input
              type="number" min={0} max={1} step={0.005}
              value={form.incentive_renewal_rate}
              onChange={e => set('incentive_renewal_rate', e.target.value)}
              style={fullInput}
            />
          </FormField>
          <FormField label="Flat stretch bonus (₹)">
            <input
              type="number" min={0}
              value={form.incentive_flat_bonus}
              onChange={e => set('incentive_flat_bonus', e.target.value)}
              style={fullInput}
            />
          </FormField>
        </Row>
      </Card>

      <Card title="Personal details">
        <FormField label="Father's / guardian's name">
          <input
            value={form.fathers_name}
            onChange={e => set('fathers_name', e.target.value)}
            placeholder="e.g. Ramesh Solanki"
            style={fullInput}
          />
        </FormField>
        <FormField label="PAN number (optional)">
          <input
            value={form.pan_number}
            onChange={e => set('pan_number', e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            maxLength={10}
            style={fullInput}
          />
        </FormField>
      </Card>

      <Card title="Residential address">
        <FormField label="Address line 1">
          <input value={form.address_line1} onChange={e => set('address_line1', e.target.value)} style={fullInput} />
        </FormField>
        <FormField label="Address line 2 (optional)">
          <input value={form.address_line2} onChange={e => set('address_line2', e.target.value)} style={fullInput} />
        </FormField>
        <Row>
          <FormField label="City">
            <input value={form.city} onChange={e => set('city', e.target.value)} style={fullInput} />
          </FormField>
          <FormField label="District">
            <input value={form.district} onChange={e => set('district', e.target.value)} style={fullInput} />
          </FormField>
        </Row>
        <Row>
          <FormField label="State">
            <select value={form.state} onChange={e => set('state', e.target.value)} style={fullInput}>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Pincode">
            <input value={form.pincode} onChange={e => set('pincode', e.target.value)} maxLength={6} style={fullInput} />
          </FormField>
        </Row>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button onClick={() => navigate('/hr')} style={ghostBtn} disabled={generating}>
          Cancel
        </button>
        <button onClick={handleDownload} disabled={generating || !form.designation_id} style={primaryBtn}>
          {generating
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
            : <><Download size={14} /> Download offer letter</>}
        </button>
      </div>

      <div style={{
        marginTop: 20,
        padding: '10px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        color: 'var(--text-muted)',
        fontSize: 12,
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <FileText size={14} />
        <span>
          Renders Letter of Appointment + Annexure A (role KPIs) + Annexure B
          (compensation) + Annexure C (TA/DA chart) — 4 pages, A4, letterhead
          background.
        </span>
      </div>
    </div>
  )
}

// ─── styling helpers (same scale as HRNewUserV2) ───────────────────

function Card({ title, children }) {
  return (
    <div style={{
      marginBottom: 14,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: 18,
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase',
        color: 'var(--text-muted)', marginBottom: 12,
      }}>{title}</div>
      <div style={{ display: 'grid', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

function Row({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
      {children}
    </div>
  )
}

const fieldLabel = {
  fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase',
  color: 'var(--text-muted)',
}
const fullInput = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'var(--font-sans)',
}
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 14px',
  borderRadius: 10,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
}
const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
}
const iconBtn = {
  width: 32, height: 32,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
}
