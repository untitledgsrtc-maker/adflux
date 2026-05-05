// src/pages/v2/LeadFormV2.jsx
//
// Phase 12 rev3 — manual New Lead form. Owner spec §3.1:
// "/leads/new manual create form".
//
// Per-role behaviour:
//   admin / co_owner / sales_manager → can pick assignee + telecaller
//   sales / agency                   → assigned_to defaults to self
//   telecaller                       → telecaller_id defaults to self,
//                                      assignee can be picked or left blank
//
// Mandatory fields: name, source, segment.
// Phone is allowed (not required) since some sources are email-only.
// Stage defaults to 'New' so it lands in the Open bucket.

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Save, Loader2, Inbox,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const SOURCES = ['IndiaMart', 'Justdial', 'Cronberry WABA', 'Excel Upload', 'Manual', 'Referral', 'Walk-in', 'Website', 'Other']

export default function LeadFormV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile  = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)
  const isManager    = profile?.team_role === 'sales_manager' || isPrivileged

  // Optional prefill from /leads page state — used when admin clicks
  // "+ New Lead" with a hint (e.g. from search). Not used for editing.
  const prefill = location.state?.prefill || {}

  const [form, setForm] = useState({
    name:           prefill.name        || '',
    company:        prefill.company     || '',
    phone:          prefill.phone       || '',
    email:          prefill.email       || '',
    city:           prefill.city        || profile?.city || '',
    segment:        prefill.segment     || 'PRIVATE',
    source:         prefill.source      || 'Manual',
    industry:       prefill.industry    || '',
    expected_value: prefill.expected_value || '',
    heat:           prefill.heat        || 'cold',
    stage:          'New',
    notes:          prefill.notes       || '',
    assigned_to:    isPrivileged ? '' : profile?.id || '',
    telecaller_id:  profile?.team_role === 'telecaller' ? profile?.id : '',
  })

  const [users, setUsers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Pull assignable users for admin/manager dropdowns. RLS filters this
  // for non-admin so they only see their own team.
  useEffect(() => {
    supabase
      .from('users')
      .select('id, name, team_role, city, is_active')
      .eq('is_active', true)
      .in('team_role', ['sales','agency','sales_manager','telecaller'])
      .order('name')
      .then(({ data }) => setUsers(data || []))
  }, [])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    setError('')
    if (!form.name.trim()) { setError('Lead name is required.'); return }
    if (!form.source)      { setError('Source is required.'); return }
    if (!form.segment)     { setError('Segment is required.'); return }

    setSaving(true)
    const payload = {
      name:           form.name.trim(),
      company:        form.company.trim() || null,
      phone:          form.phone.trim() || null,
      email:          form.email.trim() || null,
      city:           form.city.trim() || null,
      segment:        form.segment,
      source:         form.source,
      industry:       form.industry.trim() || null,
      expected_value: form.expected_value ? Number(form.expected_value) : null,
      heat:           form.heat,
      stage:          form.stage,
      notes:          form.notes.trim() || null,
      assigned_to:    form.assigned_to || null,
      telecaller_id:  form.telecaller_id || null,
      created_by:     profile?.id,
    }

    const { data, error: err } = await supabase
      .from('leads')
      .insert([payload])
      .select()
      .single()

    setSaving(false)
    if (err) {
      setError(err.message || 'Failed to create lead.')
      return
    }
    navigate(`/leads/${data.id}`)
  }

  // Filter dropdowns to roles that can OWN a lead
  const salesUsers     = users.filter(u => ['sales','agency','sales_manager'].includes(u.team_role))
  const telecallerUsers = users.filter(u => u.team_role === 'telecaller')

  return (
    <div className="v2d-lead-form">
      <button
        className="v2d-ghost v2d-ghost--btn"
        onClick={() => navigate('/leads')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={14} /> All Leads
      </button>

      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">New lead</div>
          <h1 className="v2d-page-title">Create lead</h1>
          <div className="v2d-page-sub">
            Manually add a new lead. For bulk import, use Upload Excel.
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(248,113,113,.10)',
          border: '1px solid rgba(248,113,113,.28)',
          color: '#f87171',
          borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13,
        }}>⚠ {error}</div>
      )}

      <div className="v2d-panel" style={{ padding: 22, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          <Inbox size={14} style={{ verticalAlign: '-2px', marginRight: 8 }} />
          Contact
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Name <span style={{ color: '#f87171' }}>*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Person name or department" />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Company</label>
            <input value={form.company} onChange={e => set('company', e.target.value)} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Phone</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>City</label>
            <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="e.g. Vadodara" />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Industry</label>
            <input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="e.g. Education, Retail" />
          </div>
        </div>
      </div>

      <div className="v2d-panel" style={{ padding: 22, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Lead context</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Segment <span style={{ color: '#f87171' }}>*</span></label>
            <select value={form.segment} onChange={e => set('segment', e.target.value)}>
              <option value="PRIVATE">Private</option>
              <option value="GOVERNMENT">Government</option>
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Source <span style={{ color: '#f87171' }}>*</span></label>
            <select value={form.source} onChange={e => set('source', e.target.value)}>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Heat</label>
            <select value={form.heat} onChange={e => set('heat', e.target.value)}>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label>Expected value (₹)</label>
            <input type="number" min="0" value={form.expected_value} onChange={e => set('expected_value', e.target.value)} placeholder="optional" />
          </div>
        </div>
      </div>

      {(isPrivileged || isManager || profile?.team_role === 'telecaller') && (
        <div className="v2d-panel" style={{ padding: 22, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Assignment</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label>Sales rep</label>
              <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">— unassigned —</option>
                {salesUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.city ? ` · ${u.city}` : ''}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>
                Lead will appear in this rep's queue. Leave blank if uncertain.
              </p>
            </div>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label>Telecaller</label>
              <select value={form.telecaller_id} onChange={e => set('telecaller_id', e.target.value)}>
                <option value="">— none —</option>
                {telecallerUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.city ? ` · ${u.city}` : ''}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>
                Sets ownership for the call queue.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="v2d-panel" style={{ padding: 22, marginBottom: 14 }}>
        <div className="fg" style={{ marginBottom: 0 }}>
          <label>Notes</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Anything the next person calling this lead should know."
            style={{ minHeight: 80 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          className="v2d-ghost v2d-ghost--btn"
          onClick={() => navigate('/leads')}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="v2d-cta"
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
            : <><Save size={14} /> Create lead</>}
        </button>
      </div>
    </div>
  )
}
