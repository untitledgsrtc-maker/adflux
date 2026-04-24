import { useEffect, useRef, useState } from 'react'
import {
  User, Building2, Phone, Mail, FileText, MapPin, ChevronRight,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuthStore } from '../../../store/authStore'

/* Phone autocomplete
   ──────────────────
   When the rep types in the phone field, we query the clients table
   (RLS already scopes to their own rows) for phone ILIKE '%input%' —
   up to 6 matches. Selecting a match auto-fills every client_* field
   in the wizard state so the rep doesn't re-type what the CRM already
   knows.

   Debounced at 250ms so each keystroke doesn't hammer Supabase. Triggers
   only once the user has typed 3+ chars — short inputs match too many
   clients to be useful. */
function useClientAutocomplete(phoneInput, enabled) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const profile = useAuthStore(s => s.profile)

  useEffect(() => {
    const q = (phoneInput || '').trim()
    if (!enabled || q.length < 3 || !profile?.id) {
      setSuggestions([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, company, phone, email, gstin, address, notes')
        .ilike('phone', `%${q}%`)
        .order('last_quote_at', { ascending: false, nullsFirst: false })
        .limit(6)
      if (cancelled) return
      setSuggestions(data || [])
      setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [phoneInput, enabled, profile?.id])

  return { suggestions, loading }
}

export function Step1Client({ data, onChange, onNext }) {
  const [errors, setErrors] = useState({})
  const [acOpen, setAcOpen] = useState(false)
  const [pickedPhone, setPickedPhone] = useState(null) // last phone user explicitly picked, suppresses re-open
  const acBoxRef = useRef(null)

  // Autocomplete stays dormant until the rep is actually editing the
  // phone. Once they pick a suggestion we shut it off until the input
  // diverges again — otherwise the dropdown keeps reopening while they
  // fill in the rest of the form.
  const enabled = acOpen && data.client_phone !== pickedPhone
  const { suggestions, loading: acLoading } = useClientAutocomplete(
    data.client_phone,
    enabled,
  )

  function set(field, value) {
    onChange({ [field]: value })
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }))
  }

  function handlePhoneChange(value) {
    set('client_phone', value)
    setAcOpen(true)
    setPickedPhone(null)
  }

  function pickClient(c) {
    onChange({
      client_name:    c.name    || '',
      client_company: c.company || '',
      client_phone:   c.phone   || '',
      client_email:   c.email   || '',
      client_gst:     c.gstin   || '',
      client_address: c.address || '',
      client_notes:   c.notes   || '',
    })
    setAcOpen(false)
    setPickedPhone(c.phone || '')
  }

  // Close the dropdown if the user clicks outside of the phone block.
  useEffect(() => {
    function handler(e) {
      if (!acBoxRef.current) return
      if (!acBoxRef.current.contains(e.target)) setAcOpen(false)
    }
    if (acOpen) {
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }
  }, [acOpen])

  function validate() {
    const e = {}
    if (!data.client_name?.trim()) e.client_name = 'Client name is required'
    if (!data.client_phone?.trim()) e.client_phone = 'Phone number is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleNext() {
    if (validate()) onNext()
  }

  const showSuggestions = enabled && (suggestions.length > 0 || acLoading)

  return (
    <div className="wizard-step">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Client Information</h2>
        <p className="wizard-step-sub">Who is this quote for?</p>
      </div>

      <div className="wizard-fields">
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">
              <User size={12} style={{ display: 'inline', marginRight: 4 }} />
              Client Name *
            </label>
            <input
              className={`form-input${errors.client_name ? ' input-error' : ''}`}
              value={data.client_name}
              onChange={e => set('client_name', e.target.value)}
              placeholder="Full name"
              autoFocus
            />
            {errors.client_name && <span className="field-error">{errors.client_name}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">
              <Building2 size={12} style={{ display: 'inline', marginRight: 4 }} />
              Company
            </label>
            <input
              className="form-input"
              value={data.client_company}
              onChange={e => set('client_company', e.target.value)}
              placeholder="Company name"
            />
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group" ref={acBoxRef} style={{ position: 'relative' }}>
            <label className="form-label">
              <Phone size={12} style={{ display: 'inline', marginRight: 4 }} />
              Phone *
            </label>
            <input
              className={`form-input${errors.client_phone ? ' input-error' : ''}`}
              value={data.client_phone}
              onChange={e => handlePhoneChange(e.target.value)}
              onFocus={() => { if ((data.client_phone || '').length >= 3) setAcOpen(true) }}
              placeholder="10-digit mobile"
              type="tel"
              autoComplete="off"
            />
            {errors.client_phone && <span className="field-error">{errors.client_phone}</span>}

            {showSuggestions && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%', left: 0, right: 0,
                  zIndex: 20,
                  marginTop: 4,
                  background: 'var(--color-bg-2, #1a1d24)',
                  border: '1px solid var(--color-border, rgba(255,255,255,.1))',
                  borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,.4)',
                  overflow: 'hidden',
                }}
              >
                {acLoading && (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-2, #888)' }}>
                    Searching clients…
                  </div>
                )}
                {!acLoading && suggestions.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickClient(c)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 14px',
                      background: 'transparent',
                      border: 0,
                      borderBottom: '1px solid var(--color-border, rgba(255,255,255,.06))',
                      color: 'inherit',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {c.name || 'Unnamed'}
                      {c.company && (
                        <span style={{ color: 'var(--color-text-2, #999)', fontWeight: 400 }}> · {c.company}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-2, #888)' }}>
                      {c.phone}
                      {c.email && ` · ${c.email}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              <Mail size={12} style={{ display: 'inline', marginRight: 4 }} />
              Email
            </label>
            <input
              className="form-input"
              value={data.client_email}
              onChange={e => set('client_email', e.target.value)}
              placeholder="email@company.com"
              type="email"
            />
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">
              <FileText size={12} style={{ display: 'inline', marginRight: 4 }} />
              GST Number
            </label>
            <input
              className="form-input"
              value={data.client_gst}
              onChange={e => set('client_gst', e.target.value)}
              placeholder="GSTIN"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Revenue Type</label>
            <select
              className="form-select"
              value={data.revenue_type}
              onChange={e => set('revenue_type', e.target.value)}
            >
              <option value="new">New Client</option>
              <option value="renewal">Renewal</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            <MapPin size={12} style={{ display: 'inline', marginRight: 4 }} />
            Address
          </label>
          <input
            className="form-input"
            value={data.client_address}
            onChange={e => set('client_address', e.target.value)}
            placeholder="Billing address"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="form-textarea"
            value={data.client_notes}
            onChange={e => set('client_notes', e.target.value)}
            placeholder="Any special requirements or notes…"
            rows={3}
          />
        </div>
      </div>

      <div className="wizard-footer">
        <div />
        <button className="btn btn-primary" onClick={handleNext}>
          Next: Campaign
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}
