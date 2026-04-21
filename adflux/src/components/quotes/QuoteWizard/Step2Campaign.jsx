import { useEffect, useState, useMemo } from 'react'
import { Search, Plus, Trash2, ChevronLeft, ChevronRight, Monitor, X } from 'lucide-react'
import { useCities } from '../../../hooks/useCities'
import { formatCurrency } from '../../../utils/formatters'

const DURATION_OPTIONS = [
  { months: 1, label: '1 Month', multiplier: 1.0 },
  { months: 3, label: '3 Months', multiplier: 2.8 },
  { months: 6, label: '6 Months', multiplier: 5.2 },
  { months: 12, label: '12 Months', multiplier: 9.6 },
]

function calcTotal(offeredRate, screens, durationMonths) {
  const opt = DURATION_OPTIONS.find(d => d.months === durationMonths) || DURATION_OPTIONS[0]
  return Math.round(offeredRate * screens * opt.multiplier)
}

export function Step2Campaign({ selectedCities, onChange, onBack, onNext }) {
  const { cities, fetchCities } = useCities()
  const [search, setSearch] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchCities()
  }, [])

  const filteredCities = useMemo(() => {
    const q = search.toLowerCase()
    return cities.filter(
      c =>
        c.is_active &&
        !selectedCities.find(sc => sc.city.id === c.id) &&
        (c.name.toLowerCase().includes(q) || c.station_name?.toLowerCase().includes(q))
    )
  }, [cities, search, selectedCities])

  function buildEntry(city) {
    return {
      city,
      screens: city.screens || 1,
      duration_months: 1,
      listed_rate: city.monthly_rate || 0,
      offered_rate: city.offer_rate || 0,
      override_reason: '',
      campaign_total: calcTotal(city.offer_rate || 0, city.screens || 1, 1),
    }
  }

  function addCity(city) {
    onChange([...selectedCities, buildEntry(city)])
    setShowPicker(false)
    setSearch('')
  }

  // Bulk-add every city currently in view (respects the search filter).
  // Common ask: a quote covers every city in a region, so forcing the
  // user to click each one is tedious — and more importantly, they'd
  // have to click ~30+ times with the picker closing after each.
  function addAllVisible() {
    if (!filteredCities.length) return
    onChange([...selectedCities, ...filteredCities.map(buildEntry)])
    setShowPicker(false)
    setSearch('')
  }

  function removeCity(cityId) {
    onChange(selectedCities.filter(sc => sc.city.id !== cityId))
  }

  function updateEntry(cityId, field, value) {
    onChange(
      selectedCities.map(sc => {
        if (sc.city.id !== cityId) return sc
        const updated = { ...sc, [field]: value }
        updated.campaign_total = calcTotal(updated.offered_rate, updated.screens, updated.duration_months)
        return updated
      })
    )
  }

  const subtotal = selectedCities.reduce((s, c) => s + c.campaign_total, 0)

  function handleNext() {
    if (!selectedCities.length) {
      setError('Add at least one city to continue.')
      return
    }
    // Check override reasons are filled when offered_rate != default
    for (const sc of selectedCities) {
      const defaultRate = sc.city.offer_rate || 0
      const offeredRate = sc.offered_rate || 0
      if (Math.abs(offeredRate - defaultRate) > 0.01 && !sc.override_reason?.trim()) {
        setError('Please provide reason for all rate overrides.')
        return
      }
    }
    setError('')
    onNext()
  }

  return (
    <div className="wizard-step">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Campaign Locations</h2>
        <p className="wizard-step-sub">Select cities, screens, duration and rates</p>
      </div>

      {error && <div className="wizard-inline-error">{error}</div>}

      {/* Selected cities */}
      {selectedCities.length > 0 && (
        <div className="campaign-cities">
          {selectedCities.map(sc => (
            <div key={sc.city.id} className="campaign-city-row">
              <div className="campaign-city-name">
                <Monitor size={13} />
                <div>
                  <p className="ccr-name">{sc.city.name}</p>
                  {sc.city.station_name && (
                    <p className="ccr-station">{sc.city.station_name}</p>
                  )}
                </div>
              </div>

              <div className="campaign-city-controls">
                <div className="ccr-field">
                  <label className="ccr-label">Screens</label>
                  <input
                    type="number"
                    min="1"
                    className="ccr-input"
                    value={sc.screens}
                    onChange={e => updateEntry(sc.city.id, 'screens', Number(e.target.value) || 1)}
                  />
                </div>

                <div className="ccr-field">
                  <label className="ccr-label">Duration</label>
                  <select
                    className="ccr-select"
                    value={sc.duration_months}
                    onChange={e => updateEntry(sc.city.id, 'duration_months', Number(e.target.value))}
                  >
                    {DURATION_OPTIONS.map(d => (
                      <option key={d.months} value={d.months}>{d.label}</option>
                    ))}
                  </select>
                </div>

                <div className="ccr-field">
                  <label className="ccr-label">Listed (₹)</label>
                  <input
                    type="number"
                    min="0"
                    className="ccr-input"
                    value={sc.listed_rate}
                    onChange={e => updateEntry(sc.city.id, 'listed_rate', Number(e.target.value))}
                  />
                </div>

                <div className="ccr-field">
                  <label className="ccr-label">Offered (₹)</label>
                  <input
                    type="number"
                    min="0"
                    className="ccr-input ccr-input--accent"
                    value={sc.offered_rate}
                    onChange={e => updateEntry(sc.city.id, 'offered_rate', Number(e.target.value))}
                  />
                </div>

                <div className="ccr-field">
                  <label className="ccr-label">Total</label>
                  <p className="ccr-total">{formatCurrency(sc.campaign_total)}</p>
                </div>

                {Math.abs((sc.offered_rate || 0) - (sc.city.offer_rate || 0)) > 0.01 && (
                  <div className="ccr-field" style={{ gridColumn: '1 / -1' }}>
                    <label className="ccr-label" style={{ color: '#ffb74d' }}>Reason for Override *</label>
                    <input
                      type="text"
                      className="ccr-input"
                      placeholder="Why is the rate different?"
                      value={sc.override_reason || ''}
                      onChange={e => updateEntry(sc.city.id, 'override_reason', e.target.value)}
                    />
                  </div>
                )}

                <button
                  className="ccr-remove"
                  onClick={() => removeCity(sc.city.id)}
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}

          <div className="campaign-subtotal">
            <span>Subtotal (before GST)</span>
            <strong>{formatCurrency(subtotal)}</strong>
          </div>
        </div>
      )}

      {/* City picker */}
      {showPicker ? (
        <div className="city-picker">
          <div className="city-picker-search">
            <Search size={14} />
            <input
              autoFocus
              className="city-picker-input"
              placeholder="Search cities…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button onClick={() => { setShowPicker(false); setSearch('') }}>
              <X size={14} />
            </button>
          </div>

          {/* Select-all row — adds every visible (filtered) city at once.
              Typing in search narrows the set first, e.g. "ahme" →
              Ahmedabad stations, then "Add all" bulks them in. */}
          {filteredCities.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255,255,255,.06)',
                fontSize: '.78rem',
                color: 'var(--gray)',
              }}
            >
              <span>
                {filteredCities.length} {filteredCities.length === 1 ? 'city' : 'cities'}
                {search && <> matching “{search}”</>}
              </span>
              <button
                type="button"
                className="btn btn-y btn-sm"
                onClick={addAllVisible}
                title="Add every city shown below"
              >
                <Plus size={12} /> Add all {filteredCities.length}
              </button>
            </div>
          )}

          <div className="city-picker-list">
            {filteredCities.length === 0 ? (
              <p className="city-picker-empty">No cities found</p>
            ) : (
              filteredCities.map(city => (
                <button
                  key={city.id}
                  className="city-picker-item"
                  onClick={() => addCity(city)}
                >
                  <div>
                    <p className="city-picker-name">{city.name}</p>
                    {city.station_name && (
                      <p className="city-picker-station">{city.station_name}</p>
                    )}
                  </div>
                  <div className="city-picker-meta">
                    <span className="city-picker-grade">Grade {city.grade}</span>
                    <span>{formatCurrency(city.offer_rate)}/mo</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <button
          className="btn btn-ghost campaign-add-btn"
          onClick={() => setShowPicker(true)}
        >
          <Plus size={15} />
          Add City
        </button>
      )}

      <div className="wizard-footer">
        <button className="btn btn-ghost" onClick={onBack}>
          <ChevronLeft size={15} />
          Back
        </button>
        <button className="btn btn-primary" onClick={handleNext}>
          Review Quote
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}
