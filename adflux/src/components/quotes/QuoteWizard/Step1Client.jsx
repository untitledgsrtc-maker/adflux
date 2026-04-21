import { useState } from 'react'
import { User, Building2, Phone, Mail, FileText, MapPin, ChevronRight } from 'lucide-react'

export function Step1Client({ data, onChange, onNext }) {
  const [errors, setErrors] = useState({})

  function set(field, value) {
    onChange({ [field]: value })
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }))
  }

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
          <div className="form-group">
            <label className="form-label">
              <Phone size={12} style={{ display: 'inline', marginRight: 4 }} />
              Phone *
            </label>
            <input
              className={`form-input${errors.client_phone ? ' input-error' : ''}`}
              value={data.client_phone}
              onChange={e => set('client_phone', e.target.value)}
              placeholder="10-digit mobile"
              type="tel"
            />
            {errors.client_phone && <span className="field-error">{errors.client_phone}</span>}
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
