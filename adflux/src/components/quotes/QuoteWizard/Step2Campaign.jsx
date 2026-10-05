import { useEffect, useState, useMemo, useRef } from 'react'
import { Search, Plus, Trash2, ChevronLeft, ChevronRight, ChevronDown, Layers, Monitor, X, Lock } from 'lucide-react'
import { confirmDialog } from '../../v2/ConfirmDialog'
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
  // Phase 331 — bulk edit: set the same offered rate / duration / slot seconds /
  // slots-per-day on EVERY city already in the quote. Empty box = leave unchanged.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulk, setBulk] = useState({ offered_rate: '', duration_months: '', slot_seconds: '', slots_per_day: '', reason: '' })
  const [bulkNote, setBulkNote] = useState('')
  // Phase 331.1 — tick rows to bulk-edit only those; nothing ticked = all cities.
  const [picked, setPicked] = useState(() => new Set())
  // Re-entrancy latch (section 47): a double tap on Apply must not run the
  // confirm + write twice, and the second tap must not replace the "Done" note.
  const applyingRef = useRef(false)

  useEffect(() => {
    fetchCities()
  }, [])

  // "Done - applied to all 3 cities" is only true for the cities that existed
  // then; drop it as soon as a city is added or removed.
  useEffect(() => { setBulkNote('') }, [selectedCities.length])

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
    // Drop its tick too, so re-adding the city later doesn't come back pre-ticked.
    setPicked(prev => {
      if (!prev.has(cityId)) return prev
      const next = new Set(prev); next.delete(cityId); return next
    })
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

  // Phase 331 — apply the filled bulk boxes to ALL cities in ONE onChange
  // (a loop of updateEntry() would each read the same stale selectedCities and
  // only the last write would survive). Same rules as the per-row inputs:
  // total = rate x screens x months (calcTotal), duration clamped 1-12,
  // slots/day != 100 needs a reason. Slot seconds / slots-per-day stay metadata.
  // Ticked ids that still exist in the quote (a removed city drops out silently).
  const pickedCount = selectedCities.filter(sc => picked.has(sc.city.id)).length
  const bulkAll = pickedCount === 0
  const bulkCount = bulkAll ? selectedCities.length : pickedCount

  function togglePicked(cityId) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(cityId)) next.delete(cityId); else next.add(cityId)
      return next
    })
    setBulkNote('')
  }

  async function applyBulk() {
    if (applyingRef.current) return
    const hasRate  = bulk.offered_rate !== ''
    const hasDur   = bulk.duration_months !== ''
    const hasSec   = bulk.slot_seconds !== ''
    const hasSlots = bulk.slots_per_day !== ''
    if (!hasRate && !hasDur && !hasSec && !hasSlots) {
      setBulkNote('Fill at least one box first.')
      return
    }
    const rate = hasRate ? Math.max(0, Number(bulk.offered_rate)) : null
    let dur = hasDur ? Math.round(Number(bulk.duration_months)) : null
    if (dur !== null) dur = Math.max(MIN_MONTHS, Math.min(MAX_MONTHS, dur))
    const sec = hasSec ? Number(bulk.slot_seconds) : null
    // 0 / blank / junk -> the default 100, exactly like the per-row Slots/day box.
    const slots = hasSlots ? (Math.round(Number(bulk.slots_per_day)) || DEFAULT_SLOTS_PER_DAY) : null
    if (slots !== null && slots < 1) {
      setBulkNote('Slots/day must be 1 or more.')
      return
    }
    if ([rate, dur, sec, slots].some(v => v !== null && !Number.isFinite(v))) {
      setBulkNote('One of the boxes is not a valid number.')
      return
    }
    const reason = bulk.reason.trim()
    if (slots !== null && slots !== DEFAULT_SLOTS_PER_DAY && !reason) {
      setBulkNote(`Give a reason — slots/day is not ${DEFAULT_SLOTS_PER_DAY}.`)
      return
    }
    const n = bulkCount
    const scopeWord = bulkAll ? `all ${n}` : `the ${n} selected`
    // Rate / duration / slots overwrite what the rep may have set city by city
    // (rate + duration also change every total) -> ask first. No undo in the wizard.
    applyingRef.current = true
    try {
    if (rate !== null || dur !== null || slots !== null) {
      const parts = []
      if (rate !== null) parts.push(`offered rate ${formatCurrency(rate)}`)
      if (dur !== null) parts.push(`${dur} month${dur === 1 ? '' : 's'}`)
      if (slots !== null) parts.push(`${slots} slots/day`)
      const ok = await confirmDialog({
        title: `Change ${scopeWord} ${n === 1 ? 'city' : 'cities'}?`,
        message: `Set ${parts.join(' and ')} on ${scopeWord} ${n === 1 ? 'city' : 'cities'}. This replaces each city's current value${(rate !== null || dur !== null) ? ' and recalculates every total' : ''}.`,
        confirmLabel: bulkAll ? 'Apply to all' : 'Apply to selected',
        cancelLabel: 'Cancel',
      })
      if (!ok) return
    }
    onChange(
      selectedCities.map(sc => {
        // Only the targeted cities change; the rest are returned untouched.
        if (!bulkAll && !picked.has(sc.city.id)) return sc
        const u = { ...sc }
        if (rate !== null)  u.offered_rate = rate
        if (dur !== null)   u.duration_months = dur
        if (sec !== null)   u.slot_seconds = sec
        if (slots !== null) {
          u.slots_per_day = slots
          u.slots_override_reason = slots === DEFAULT_SLOTS_PER_DAY ? '' : reason
        }
        if (rate !== null || dur !== null) {
          u.campaign_total = calcTotal(u.offered_rate, u.screens, u.duration_months)
        }
        return u
      })
    )
    setBulk({ offered_rate: '', duration_months: '', slot_seconds: '', slots_per_day: '', reason: '' })
    setError('')
    setBulkNote(`Done — applied to ${scopeWord} ${n === 1 ? 'city' : 'cities'}.`)
    } finally {
      applyingRef.current = false
    }
  }

  const subtotal = selectedCities.reduce((s, c) => s + c.campaign_total, 0)

  function handleNext() {
    if (!selectedCities.length) {
      setError('Add at least one city to continue.')
      return
    }
    // Slot-count overrides tracked separately so admin review knows WHY a
    // rep cut the daily spot commitment below 100 — common negotiation lever.
    // Rate changes no longer prompt for a reason (owner directive).
    for (const sc of selectedCities) {
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
          {/* Phase 331 — bulk edit (2+ cities). Collapsed by default so the
              normal per-city rows stay the main thing on screen. */}
          {selectedCities.length > 1 && (
            <div className="campaign-city-row">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setBulkOpen(o => !o)}
                aria-expanded={bulkOpen}
              >
                <Layers size={14} />
                Bulk edit all {selectedCities.length} cities
                <ChevronDown size={14} style={{ transform: bulkOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
              </button>

              {bulkOpen && (
                <>
                  <p className="ccr-station" style={{ margin: 0 }}>
                    Fill only the boxes you want to change. Empty boxes stay as they are.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
                    <strong style={{ color: bulkAll ? 'var(--text)' : 'var(--accent)' }}>
                      {bulkAll
                        ? `Applies to ALL ${selectedCities.length} cities`
                        : `Applies to ${pickedCount} selected ${pickedCount === 1 ? 'city' : 'cities'}`}
                    </strong>
                    <span style={{ color: 'var(--text-muted)' }}>· tick cities below to pick only some</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setPicked(new Set(selectedCities.map(sc => sc.city.id))); setBulkNote('') }}
                    >
                      Select all
                    </button>
                    {pickedCount > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setPicked(new Set()); setBulkNote('') }}
                      >
                        Clear ticks
                      </button>
                    )}
                  </div>
                  <div className="campaign-city-controls">
                    <div className="ccr-field">
                      <label className="ccr-label ccr-label--accent">Offered (₹)</label>
                      <input
                        type="number"
                        min="0"
                        className="ccr-input ccr-input--accent"
                        placeholder="no change"
                        value={bulk.offered_rate}
                        onChange={e => { setBulk(b => ({ ...b, offered_rate: e.target.value })); setBulkNote('') }}
                      />
                    </div>

                    <div className="ccr-field">
                      <label className="ccr-label">Duration (months)</label>
                      <input
                        type="number"
                        min={MIN_MONTHS}
                        max={MAX_MONTHS}
                        step="1"
                        className="ccr-input"
                        placeholder="no change"
                        value={bulk.duration_months}
                        onChange={e => { setBulk(b => ({ ...b, duration_months: e.target.value })); setBulkNote('') }}
                      />
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {QUICK_DURATIONS.map(m => {
                          const active = Number(bulk.duration_months) === m
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => { setBulk(b => ({ ...b, duration_months: String(m) })); setBulkNote('') }}
                              style={{
                                fontSize: 10, padding: '2px 8px', borderRadius: 999, cursor: 'pointer', fontWeight: 600,
                                border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                                background: active ? 'var(--accent-soft)' : 'transparent',
                                color: active ? 'var(--accent)' : 'var(--text-muted)',
                              }}
                            >
                              {m}mo
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="ccr-field">
                      <label className="ccr-label">Slot Sec</label>
                      <select
                        className="ccr-select"
                        value={bulk.slot_seconds}
                        onChange={e => { setBulk(b => ({ ...b, slot_seconds: e.target.value })); setBulkNote('') }}
                      >
                        <option value="">no change</option>
                        {SLOT_SECONDS_OPTIONS.map(s => (
                          <option key={s} value={s}>{s}s</option>
                        ))}
                      </select>
                    </div>

                    <div className="ccr-field">
                      <label className="ccr-label">Slots/day</label>
                      <input
                        type="number"
                        min="1"
                        className="ccr-input"
                        placeholder="no change"
                        value={bulk.slots_per_day}
                        onChange={e => { setBulk(b => ({ ...b, slots_per_day: e.target.value })); setBulkNote('') }}
                      />
                    </div>

                    {bulk.slots_per_day !== '' && Number(bulk.slots_per_day) !== DEFAULT_SLOTS_PER_DAY && (
                      <div className="ccr-field" style={{ flex: '1 1 220px' }}>
                        <label className="ccr-label" style={{ color: 'var(--warning)' }}>
                          Reason for Slots Override * (used on all cities)
                        </label>
                        <input
                          type="text"
                          className="ccr-input"
                          style={{ width: '100%' }}
                          placeholder={`Why not ${DEFAULT_SLOTS_PER_DAY} slots/day?`}
                          value={bulk.reason}
                          onChange={e => { setBulk(b => ({ ...b, reason: e.target.value })); setBulkNote('') }}
                        />
                      </div>
                    )}

                    <button type="button" className="btn btn-y btn-sm" onClick={applyBulk}>
                      {bulkAll ? `Apply to all ${selectedCities.length}` : `Apply to ${pickedCount} selected`}
                    </button>
                  </div>
                  {bulkNote && (
                    <p role="status" className="ccr-station" style={{ margin: 0, color: bulkNote.startsWith('Done') ? 'var(--success)' : 'var(--warning)' }}>
                      {bulkNote}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {selectedCities.map(sc => {
            const slotsOverridden = (Number(sc.slots_per_day) || DEFAULT_SLOTS_PER_DAY) !== DEFAULT_SLOTS_PER_DAY
            return (
              <div key={sc.city.id} className="campaign-city-row">
                <div className="campaign-city-name">
                  {/* Bulk panel open: the whole name area is one tap target that
                      ticks/unticks the city (an 18px box alone is too small on a phone). */}
                  <label
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      cursor: bulkOpen && selectedCities.length > 1 ? 'pointer' : 'default',
                      padding: bulkOpen && selectedCities.length > 1 ? '6px 0' : 0,
                    }}
                  >
                    {bulkOpen && selectedCities.length > 1 && (
                      <input
                        type="checkbox"
                        checked={picked.has(sc.city.id)}
                        onChange={() => togglePicked(sc.city.id)}
                        aria-label={`Select ${sc.city.name} for bulk edit`}
                        title="Tick to include in bulk edit"
                        style={{ width: 18, height: 18, accentColor: 'var(--accent)', cursor: 'pointer', flex: '0 0 auto' }}
                      />
                    )}
                    <Monitor size={13} />
                    <div>
                      <p className="ccr-name">{sc.city.name}</p>
                      {sc.city.station_name && (
                        <p className="ccr-station">{sc.city.station_name}</p>
                      )}
                    </div>
                  </label>
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

                  {/* Offered (₹) — primary editable field per row.
                      Styled with accent border + tinted fill + bold
                      value so it pops against the locked LISTED
                      input sitting next to it. Field discovery was
                      the #1 sales-team complaint on mobile. */}
                  <div className="ccr-field">
                    <label className="ccr-label ccr-label--accent">Offered (₹)</label>
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
