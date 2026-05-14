// src/pages/v2/LeadFormV2.jsx
//
// Phase 16 commit 4 — New Lead form, ported in-place from
// _design_reference/Leads/lead-admin.jsx (AdminLeadCreate).
//
// Per-role behaviour:
//   admin / co_owner / sales_manager → can pick assignee + telecaller
//   sales / agency                   → assigned_to defaults to self
//   telecaller                       → telecaller_id defaults to self,
//                                      assignee can be picked or left blank
//
// Mandatory: name, source, segment.
// Stage defaults to 'New' so it lands in Open bucket.
// Heat defaults to 'cold' (manual rep judgment per spec §6).

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Loader2, Save, Flame, Snowflake, Zap, Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import PhotoCapture from '../../components/leads/PhotoCapture'
import VoiceInput   from '../../components/voice/VoiceInput'
import { findLeadByPhone } from '../../utils/leadDedup'

const SOURCES = [
  'IndiaMart', 'Justdial', 'Cronberry WABA', 'Excel Upload',
  'Manual', 'Referral', 'Walk-in', 'Website',
  // Phase 32M — Field Meeting = cold walk-in logged from /work via
  // LogMeetingModal. Listed here so reps creating leads manually can
  // back-fill a field meeting they forgot to log via the fast-path.
  'Field Meeting',
  'Other',
]

export default function LeadFormV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)
  const isManager    = profile?.team_role === 'sales_manager' || isPrivileged
  const isTelecaller = profile?.team_role === 'telecaller'

  const prefill = location.state?.prefill || {}

  const [form, setForm] = useState({
    name:           prefill.name        || '',
    company:        prefill.company     || '',
    // Phase 33D.3 — new fields per owner spec (11 May 2026)
    designation:    prefill.designation || '',
    phone:          prefill.phone       || '',
    email:          prefill.email       || '',
    city:           prefill.city        || profile?.city || '',
    website:        prefill.website     || '',
    segment:        prefill.segment     || 'PRIVATE',
    source:         prefill.source      || 'Manual',
    industry:       prefill.industry    || '',
    expected_value: prefill.expected_value || '',
    heat:           prefill.heat        || 'cold',
    stage:          'New',
    notes:          prefill.notes       || '',
    assigned_to:    isPrivileged ? '' : (profile?.id || ''),
    telecaller_id:  isTelecaller ? (profile?.id || '') : '',
  })

  const [reps, setReps] = useState([])
  const [telecallers, setTelecallers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  // Phase 33D.6 — duplicate phone warning
  const [dupLead, setDupLead] = useState(null)

  async function checkPhoneDup(p) {
    setDupLead(null)
    const hit = await findLeadByPhone(p)
    if (hit) setDupLead(hit)
  }

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  useEffect(() => {
    supabase
      .from('users')
      .select('id, name, team_role, city, is_active')
      .in('team_role', ['sales', 'agency', 'sales_manager'])
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setReps(data || []))
    supabase
      .from('users')
      .select('id, name, team_role, city, is_active')
      .eq('team_role', 'telecaller')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setTelecallers(data || []))
  }, [])

  async function handleSave(openAfter = false) {
    setError('')
    if (!form.name.trim()) {
      setError('Person name is required.')
      return
    }
    // Phase 33B.3 (11 May 2026) — owner locked the required-field set
    // for lead create: Company, Person, Phone, City all required.
    // Email + address optional. Govt segment still exempted from
    // phone (tender/RFP leads often only have a department email).
    if (!form.company.trim()) {
      setError('Company name is required.')
      return
    }
    if (form.segment !== 'GOVERNMENT' && !form.phone.trim()) {
      setError('Mobile number is required — call / WhatsApp won\'t work without it.')
      return
    }
    if (!form.city.trim()) {
      setError('City is required.')
      return
    }
    // Phase 33D.6 — re-check dup at save time too (in case rep didn't blur).
    const dup = await findLeadByPhone(form.phone)
    if (dup) {
      setDupLead(dup)
      setError(`This phone is already in your pipeline as "${dup.name}". Open the existing lead instead of creating a duplicate.`)
      return
    }
    if (!form.source) {
      setError('Source is required.')
      return
    }
    if (!form.segment) {
      setError('Segment is required.')
      return
    }
    setSaving(true)
    const payload = {
      name:          form.name.trim(),
      company:       form.company.trim() || null,
      designation:   form.designation.trim() || null,
      phone:         form.phone.trim() || null,
      email:         form.email.trim() || null,
      city:          form.city.trim() || null,
      website:       form.website.trim() || null,
      segment:       form.segment,
      source:        form.source,
      industry:      form.industry.trim() || null,
      expected_value: form.expected_value === '' ? null : Number(form.expected_value),
      heat:          form.heat,
      stage:         form.stage,
      notes:         form.notes.trim() || null,
      assigned_to:   form.assigned_to || null,
      telecaller_id: form.telecaller_id || null,
      created_by:    profile.id,
    }
    const { data, error: err } = await supabase
      .from('leads')
      .insert([payload])
      .select()
      .single()
    setSaving(false)
    if (err) {
      setError('Save failed: ' + err.message)
      return
    }
    navigate(openAfter ? `/leads/${data.id}` : '/leads')
  }

  return (
    <div className="lead-root" style={{ maxWidth: 760, margin: '0 auto' }}>
      <button className="lead-btn lead-btn-sm" onClick={() => navigate('/leads')} style={{ marginBottom: 16 }}>
        <ArrowLeft size={12} /> All leads
      </button>

      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Add to pipeline</div>
          <div className="lead-page-title">New Lead</div>
          <div className="lead-page-sub">30 seconds · all fields can be edited later</div>
        </div>
      </div>

      {/* Phase 33D.1 — business-card scanner. Owner directive (11 May
          2026): at top of New Lead, allow capture/upload of a card
          photo. OCR runs via the same ocr-business-card Edge Function
          and pre-fills name / phone / email / company in the form
          state below. Rep reviews + edits + saves. Photo itself is
          NOT stored (no lead row exists yet); rep can take a follow-
          up photo from the lead detail later to keep it on record. */}
      <div className="lead-card" style={{
        marginBottom: 14,
        padding: '14px 16px',
        background: 'rgba(255,230,0,0.06)',
        border: '1px dashed var(--accent, #FFE600)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Camera size={20} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              Have a business card?
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Snap or upload a photo — we'll fill the form for you.
            </div>
          </div>
          <PhotoCapture
            buttonLabel="Scan card"
            onFieldsExtracted={(fields) => {
              setForm(prev => ({
                ...prev,
                name:        prev.name        || fields.name        || '',
                company:     prev.company     || fields.company     || '',
                designation: prev.designation || fields.designation || fields.role || '',
                phone:       prev.phone       || fields.phone       || '',
                email:       prev.email       || fields.email       || '',
                city:        prev.city        || fields.city        || '',
                website:     prev.website     || fields.website     || '',
              }))
            }}
          />
        </div>
      </div>

      {/* Phase 33D.6 — duplicate-phone warning. Fired when rep blurs
          the Mobile field. Blocks save until rep changes the number
          or navigates to the existing lead. */}
      {dupLead && (
        <div style={{
          marginBottom: 14, padding: '12px 14px',
          background: 'var(--danger-soft)', border: '1px solid var(--danger)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 13, color: 'var(--danger)' }}>
            This number is already in your pipeline as <b>{dupLead.name}</b>
            {dupLead.company ? ` (${dupLead.company})` : ''} · {dupLead.stage}
          </div>
          <button className="lead-btn lead-btn-sm" onClick={() => navigate(`/leads/${dupLead.id}`)}>
            Open existing
          </button>
        </div>
      )}

      {/* ─── Identity ─── */}
      <div className="lead-card" style={{ marginBottom: 14 }}>
        <div className="lead-card-head"><div className="lead-card-title">Identity</div></div>
        <div className="lead-card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Phase 33D.3 — locked field set (11 May 2026):
                Company* / Person* / Designation / Mobile* / Email /
                City* / Website. Govt segment exempts phone (tender
                leads have only a department email). */}
          {/* Phase 35 PR 2.5 — mics dropped from Identity fields per
              owner: OCR business-card scan already fills these, and
              double mic-on-every-field added visual noise. Voice
              still available on the Notes textarea below where
              free-text actually benefits from dictation. */}
          <Field label="Company *"      value={form.company}     onChange={v => set('company', v)}     placeholder="e.g. Sunrise Diagnostics" />
          <Field label="Person name *"  value={form.name}        onChange={v => set('name', v)}        placeholder="e.g. Dr. Mehta" />
          <Field label="Designation"    value={form.designation} onChange={v => set('designation', v)} placeholder="e.g. Marketing Manager" />
          <Field
            label={form.segment === 'GOVERNMENT' ? 'Phone' : 'Mobile *'}
            value={form.phone}
            onChange={v => { set('phone', v); if (dupLead) setDupLead(null) }}
            onBlur={() => checkPhoneDup(form.phone)}
            placeholder="98XXXXXXXX or +91 98XXXXXXXX"
          />
          <Field label="Email"          value={form.email}       onChange={v => set('email', v)}       placeholder="name@company.com" type="email" />
          <Field label="City *"         value={form.city}        onChange={v => set('city', v)}        placeholder="Surat" />
          <Field label="Website"        value={form.website}     onChange={v => set('website', v)}     placeholder="www.example.com" />
        </div>
      </div>

      {/* ─── Classification ─── */}
      <div className="lead-card" style={{ marginBottom: 14 }}>
        <div className="lead-card-head"><div className="lead-card-title">Classification</div></div>
        <div className="lead-card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label className="lead-fld-label">Source *</label>
            <select className="lead-inp" value={form.source} onChange={e => set('source', e.target.value)}>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="lead-fld-label">Segment *</label>
            <div className="lead-radio-grp">
              <span
                className={`opt ${form.segment === 'GOVERNMENT' ? 'on' : ''}`}
                onClick={() => set('segment', 'GOVERNMENT')}
              >
                Government
              </span>
              <span
                className={`opt ${form.segment === 'PRIVATE' ? 'on' : ''}`}
                onClick={() => set('segment', 'PRIVATE')}
              >
                Private
              </span>
            </div>
          </div>
          <Field label="Industry" value={form.industry} onChange={v => set('industry', v)} placeholder="Healthcare, Retail, …" />
        </div>
      </div>

      {/* ─── Money + temperature ─── */}
      <div className="lead-card" style={{ marginBottom: 14 }}>
        <div className="lead-card-head"><div className="lead-card-title">Money &amp; temperature</div></div>
        <div className="lead-card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field
            label="Expected value (₹)"
            value={form.expected_value}
            onChange={v => set('expected_value', v)}
            placeholder="3,80,000"
            type="number"
          />
          <div>
            <label className="lead-fld-label">Heat</label>
            <div className="lead-radio-grp">
              <span
                className={`opt ${form.heat === 'hot' ? 'on neg' : ''}`}
                onClick={() => set('heat', 'hot')}
              >
                <Flame size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} /> Hot
              </span>
              <span
                className={`opt ${form.heat === 'warm' ? 'on' : ''}`}
                onClick={() => set('heat', 'warm')}
              >
                <Zap size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} /> Warm
              </span>
              <span
                className={`opt ${form.heat === 'cold' ? 'on' : ''}`}
                onClick={() => set('heat', 'cold')}
              >
                <Snowflake size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} /> Cold
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Ownership ─── */}
      <div className="lead-card" style={{ marginBottom: 14 }}>
        <div className="lead-card-head"><div className="lead-card-title">Ownership</div></div>
        <div className="lead-card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label className="lead-fld-label">Assigned to {!isManager ? '(you)' : ''}</label>
            <select
              className="lead-inp"
              value={form.assigned_to}
              onChange={e => set('assigned_to', e.target.value)}
              disabled={!isManager}
            >
              <option value="">— unassigned —</option>
              {reps.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.city ? ` · ${r.city}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lead-fld-label">Telecaller {isTelecaller ? '(you)' : ''}</label>
            <select
              className="lead-inp"
              value={form.telecaller_id}
              onChange={e => set('telecaller_id', e.target.value)}
              disabled={!isManager && !isTelecaller}
            >
              <option value="">— none —</option>
              {telecallers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ─── Notes ─── */}
      {/* Phase 33F (K3) — voice mic on Notes textarea. */}
      <div className="lead-card lead-card-pad" style={{ marginBottom: 14 }}>
        <label className="lead-fld-label">Notes</label>
        <VoiceInput
          multiline
          rows={3}
          value={form.notes}
          onChange={(v) => set('notes', v)}
          placeholder="Visited last Diwali, owner met us at the trade fair…"
          languageHint="gu"
        />
      </div>

      {error && (
        <div
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            borderRadius: 8, padding: '10px 14px', fontSize: 13,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="lead-btn" onClick={() => navigate('/leads')} disabled={saving}>Cancel</button>
        <button className="lead-btn" onClick={() => handleSave(true)} disabled={saving}>
          Save &amp; open
        </button>
        <button className="lead-btn lead-btn-primary" onClick={() => handleSave(false)} disabled={saving}>
          {saving
            ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
            : <><Save size={12} /> Save Lead</>}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, onBlur, placeholder, type, voice }) {
  // Phase 33F (K3) — optional voice mic on text fields. Pass voice=true
  // to render VoiceInput instead of plain <input>. Default = no mic.
  if (voice) {
    return (
      <div>
        <label className="lead-fld-label">{label}</label>
        <VoiceInput
          value={value}
          onChange={onChange}
          placeholder={placeholder || ''}
          languageHint="gu"
        />
      </div>
    )
  }
  return (
    <div>
      <label className="lead-fld-label">{label}</label>
      <input
        className="lead-inp"
        type={type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder || ''}
      />
    </div>
  )
}
