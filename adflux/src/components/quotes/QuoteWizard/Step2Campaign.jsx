import { useEffect, useState, useMemo } from 'react'
import { Search, Plus, Trash2, ChevronLeft, ChevronRight, Monitor, X, Lock } from 'lucide-react'
import { useCities } from '../../../hooks/useCities'
import { useAuth } from '../../../hooks/useAuth'
import { formatCurrency } from '../../../utils/formatters'

// Duration model:
// Previously this was a fixed 1/3/6/12 dropdown with bulk-discount
// multipliers (2.8/5.2/9.6). That silently applied ~7–20% off on
// multi-month quotes, which surprised reps reading the total and
// trying to reconcile it with `screens × rate × months`. It also
// meant arbitrary durations (2, 5, 7…) were un-expressible.
//
// New model: straight math. total = rate × screens × months, no
// multipliers. Quick-pick pills for 1/3/6/12 are just shortcuts —
// the underlying field is a free number 1–12.
const QUICK_DURATIONS = [1, 3, 6, 12]
const MIN_MONTHS = 1
const MAX_MONTHS = 12

function calcTotal(offeredRate, screens, durationMonths) {
  const m = Math.max(MIN_MONTHS, Math.min(MAX_MONTHS, Number(durationMonths) || 1))
  const r = Number(offeredRate) || 0
  const s = Math.max(1, Number(screens) || 1)
  return Math.round(r * s * m)
}

// Slot seconds (ad spot length). Pure metadata — NOT a price factor.
// We only show these on the quote for planning; the rep negotiates a
// per-screen monthly rate and that's what the client pays regardless
// of spot length or daily slot count. If pricing ever needs to depend
// on these, the change goes in calcTotal, not here.
const SLOT_SECONDS_OPTIONS = [10, 15, 20, 30]
const DEFAULT_SLOT_SECONDS = 10

// Slots per screen per day — default 100. Rep can edit up (premium
// placement) or down (low-traffic board). Editing away from 100
// requires a reason, matching the pattern used for rate overrides.
const DEFAULT_SLOTS_PER_DAY = 100

export function Step2Campaign({ selectedCities, onChange, onBack, onNext }) {
  const { cities, fetchCities } = useCities()
  const { isAdmin } = useAuth()
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
      slot_seconds: DEFAULT_SLOT_SECONDS,
      slots_per_day: DEFAULT_SLOTS_PER_DAY,
      slots_override_reason: '',
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
        // Only three fields feed campaign_total. Slot seconds and
        // slots_per_day are intentionally excluded — they are
        // metadata, not price inputs.
        if (field === 'offered_rate' || field === 'screens' || field === 'duration_months') {
          updated.campaign_total = calcTotal(updated.offered_rate, updated.screens, updated.duration_months)
        }
        return updated
      })
    )
  }

  // Clamp duration on blur so pasted/typed values like 0, 13, or
  // empty strings don't poison the state. Using blur (not change) so
  // the user can clear the input while editing.
  function clampDuration(cityId, raw) {
    let n = Number(raw)
    if (!Number.isFinite(n) || n < MIN_MONTHS) n = MIN_MONTHS
    if (n > MAX_MONTHS) n = MAX_MONTHS
    n = Math.round(n)
    updateEntry(cityId, 'duration_months', n)
  }

  const subtotal = selectedCities.reduce((s, c) => s + c.campaign_total, 0)

  function handleNext() {
    if (!selectedCities.length) {
      setError('Add at least one city to continue.')
      return
    }
    // Override reason required whenever the rep deviates from the
    // stored default for either rate or slots. Slot-count overrides
    // tracked separately so admin review knows WHY a rep cut the
    // daily spot commitment below 100 — common negotiation lever.
    for (const sc of selectedCities) {
      const defaultRate = sc.city.offer_rate || 0
      const offeredRate = sc.offered_rate || 0
      if (Math.abs(offeredRate - defaultRate) > 0.01 && !sc.override_reason?.trim()) {
        setError('Please provide reason for all rate overrides.')
        return
      }
      const slots = Number(sc.slots_per_day) || DEFAULT_SLOTS_PER_DAY
      if (slots !== DEFAULT_SLOTS_PER_DAY && !sc.slots_override_reason?.trim()) {
        setError('Please provide reason when slots/day differs from 100.')
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
          {selectedCities.map(sc => {
            const rateOverridden = Math.abs((sc.offered_rate || 0) - (sc.city.offer_rate || 0)) > 0.01
            const slotsOverridden = (Number(sc.slots_per_day) || DEFAULT_SLOTS_PER_DAY) !== DEFAULT_SLOTS_PER_DAY
            return (
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

                  {/* Duration: free 1–12 input plus quick-pick pills.
                      The input is the source of truth; pills just
                      write into it. No bulk discount applied. */}
                  <div className="ccr-field">
                    <label className="ccr-label">Duration (months)</label>
                    <input
                      type="number"
                      min={MIN_MONTHS}
                      max={MAX_MONTHS}
                      step="1"
                      className="ccr-input"
                      value={sc.duration_months}
                      onChange={e => updateEntry(sc.city.id, 'duration_months', e.target.value)}
                      onBlur={e => clampDuration(sc.city.id, e.target.value)}
                      title="Any value 1 to 12"
                    />
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        marginTop: 4,
                        flexWrap: 'wrap',
                      }}
                    >
                      {QUICK_DURATIONS.map(m => {
                        const active = Number(sc.duration_months) === m
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => updateEntry(sc.city.id, 'duration_months', m)}
                            style={{
                              fontSize: 10,
                              padding: '2px 8px',
                              borderRadius: 999,
                              border: active
                                ? '1px solid var(--v2-yellow, #fbc42d)'
                                : '1px solid rgba(255,255,255,.15)',
                              background: active
                                ? 'rgba(251,196,45,.15)'
                                : 'transparent',
                              color: active
                                ? 'var(--v2-yellow, #fbc42d)'
                                : 'rgba(255,255,255,.6)',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            {m}mo
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="ccr-field">
                    <label className="ccr-label">
                      Listed (₹)
                      {!isAdmin && (
                        <Lock
                          size={10}
                          style={{ marginLeft: 4, verticalAlign: 'middle', opacity: 0.6 }}
                          aria-label="Admin-only"
                        />
                      )}
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="ccr-input"
                      value={sc.listed_rate}
                      readOnly={!isAdmin}
                      disabled={!isAdmin}
                      onChange={e => updateEntry(sc.city.id, 'listed_rate', Number(e.target.value))}
                      title={!isAdmin ? 'Listed rate can only be changed by admin' : ''}
                      style={!isAdmin ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
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

                  {/* Slot seconds — ad-spot length. Metadata only.
                      Does NOT change campaign_total on purpose: the
                      rep-negotiated offered_rate is the sole price
                      input. If this ever needs to scale pricing,
                      update calcTotal() and the comment on top. */}
                  <div className="ccr-field">
                    <label className="ccr-label">Slot Sec</label>
                    <select
                      className="ccr-select"
                      value={sc.slot_seconds || DEFAULT_SLOT_SECONDS}
                      onChange={e => updateEntry(sc.city.id, 'slot_seconds', Number(e.target.value))}
                    >
                      {SLOT_SECONDS_OPTIONS.map(s => (
                        <option key={s} value={s}>{s}s</option>
                      ))}
                    </select>
                  </div>

                  {/* Slots per screen per day. Default 100. Edit
                      down for weak boards or as a negotiation lever,
                      up for premium routes. Override reason enforced
                      downstream in handleNext(). */}
                  <div className="ccr-field">
                    <label className="ccr-label">Slots/day</label>
                    <input
                      type="number"
                      min="1"
                      className="ccr-input"
                      value={sc.slots_per_day ?? DEFAULT_SLOTS_PER_DAY}
                      onChange={e => updateEntry(sc.city.id, 'slots_per_day', Number(e.target.value) || DEFAULT_SLOTS_PER_DAY)}
                      title="Spots delivered per screen per day (default 100)"
                    />
                  </div>

                  <div className="ccr-field">
                    <label className="ccr-label">Total</label>
                    <p className="ccr-total">{formatCurrency(sc.campaign_total)}</p>
                  </div>

                  {rateOverridden && (
                    <div className="ccr-field" style={{ gridColumn: '1 / -1' }}>
                      <label className="ccr-label" style={{ color: '#ffb74d' }}>Reason for Rate Override *</label>
                      <input
                        type="text"
                        className="ccr-input"
                        placeholder="Why is the rate different?"
                        value={sc.override_reason || ''}
                        onChange={e => updateEntry(sc.city.id, 'override_reason', e.target.value)}
                      />
                    </div>
                  )}

                  {slotsOverridden && (
                    <div className="ccr-field" style={{ gridColumn: '1 / -1' }}>
                      <label className="ccr-label" style={{ color: '#ffb74d' }}>
                        Reason for Slots Override *
                      </label>
                      <input
                        type="text"
                        className="ccr-input"
                        placeholder={`Why not ${DEFAULT_SLOTS_PER_DAY} slots/day?`}
                        value={sc.slots_override_reason || ''}
                        onChange={e => updateEntry(sc.city.id, 'slots_override_reason', e.target.value)}
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
            )
          })}

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
