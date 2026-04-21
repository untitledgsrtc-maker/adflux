import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const GRADES = ['A', 'B', 'C']

const EMPTY = {
  name: '',
  station_name: '',
  grade: 'B',
  screens: 1,
  screen_size_inch: '',
  monthly_rate: '',
  offer_rate: '',
  impressions_day: '',
  impressions_month: '',
  unique_viewers: '',
  photo_url: '',
  is_active: true,
}

export function CityModal({ city, onClose, onSave, loading }) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const isEdit = !!city?.id

  useEffect(() => {
    if (city) {
      setForm({
        name: city.name || '',
        station_name: city.station_name || '',
        grade: city.grade || 'B',
        screens: city.screens || 1,
        screen_size_inch: city.screen_size_inch || '',
        monthly_rate: city.monthly_rate || '',
        offer_rate: city.offer_rate || '',
        impressions_day: city.impressions_day || '',
        impressions_month: city.impressions_month || '',
        unique_viewers: city.unique_viewers || '',
        photo_url: city.photo_url || '',
        is_active: city.is_active !== false,
      })
    } else {
      setForm(EMPTY)
    }
    setErrors({})
  }, [city])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }))
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'City name is required'
    if (!form.monthly_rate || isNaN(Number(form.monthly_rate))) e.monthly_rate = 'Enter a valid rate'
    if (!form.offer_rate || isNaN(Number(form.offer_rate))) e.offer_rate = 'Enter a valid rate'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    onSave({
      ...form,
      screens: Number(form.screens) || 1,
      screen_size_inch: form.screen_size_inch ? Number(form.screen_size_inch) : null,
      monthly_rate: Number(form.monthly_rate) || 0,
      offer_rate: Number(form.offer_rate) || 0,
      impressions_day: Number(form.impressions_day) || 0,
      impressions_month: Number(form.impressions_month) || 0,
      unique_viewers: Number(form.unique_viewers) || 0,
    })
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <p className="modal-title">{isEdit ? 'Edit City' : 'Add City'}</p>
          <button className="modal-close" onClick={onClose}><X size={17} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">City Name *</label>
                <input
                  className={`form-input${errors.name ? ' input-error' : ''}`}
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Ahmedabad"
                  autoFocus
                />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Station / Location</label>
                <input
                  className="form-input"
                  value={form.station_name}
                  onChange={e => set('station_name', e.target.value)}
                  placeholder="e.g. Central Station"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Grade</label>
                <select className="form-select" value={form.grade} onChange={e => set('grade', e.target.value)}>
                  {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Number of Screens</label>
                <input
                  type="number" min="1"
                  className="form-input"
                  value={form.screens}
                  onChange={e => set('screens', e.target.value)}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Screen Size (inches)</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.screen_size_inch}
                  onChange={e => set('screen_size_inch', e.target.value)}
                  placeholder="e.g. 55"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Photo URL</label>
                <input
                  className="form-input"
                  value={form.photo_url}
                  onChange={e => set('photo_url', e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="modal-section-label">Rates (per month)</div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Listed Rate (₹) *</label>
                <input
                  type="number"
                  className={`form-input${errors.monthly_rate ? ' input-error' : ''}`}
                  value={form.monthly_rate}
                  onChange={e => set('monthly_rate', e.target.value)}
                  placeholder="0"
                />
                {errors.monthly_rate && <span className="field-error">{errors.monthly_rate}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Offer Rate (₹) *</label>
                <input
                  type="number"
                  className={`form-input${errors.offer_rate ? ' input-error' : ''}`}
                  value={form.offer_rate}
                  onChange={e => set('offer_rate', e.target.value)}
                  placeholder="0"
                />
                {errors.offer_rate && <span className="field-error">{errors.offer_rate}</span>}
              </div>
            </div>

            <div className="modal-section-label">Audience Metrics</div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Impressions / Day</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.impressions_day}
                  onChange={e => set('impressions_day', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Impressions / Month</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.impressions_month}
                  onChange={e => set('impressions_month', e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Unique Viewers / Month</label>
              <input
                type="number"
                className="form-input"
                value={form.unique_viewers}
                onChange={e => set('unique_viewers', e.target.value)}
                placeholder="0"
              />
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add City'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
