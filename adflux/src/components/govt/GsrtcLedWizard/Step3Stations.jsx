// src/components/govt/GsrtcLedWizard/Step3Stations.jsx
//
// Wizard Step 3 — pick GSRTC stations + edit per-row overrides.
//
// Defaults: daily_spots=100, spot_duration=10s, days=30 (the standard
// GSRTC contract). Owner can override per station per proposal — useful
// when a special tender lets us run more spots/day or a 60-day campaign
// at a specific station.
//
// Monthly cost per station = screens × daily_spots × days × DAVP rate.
// Live recalc as overrides change.

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useGsrtcStations } from '../../../hooks/useGovtMasters'
import { formatINREnglish } from '../../../utils/gujaratiNumber'

const DEFAULT_DAILY = 100
const DEFAULT_DURATION = 10
const DEFAULT_DAYS = 30

/* Derive effective daily_spots / days / duration / monthly_cost
   for a single station given the current overrides for that station. */
function effectiveValues(s, override) {
  const daily    = (override?.daily_spots_override   ?? null) || DEFAULT_DAILY
  const duration = (override?.spot_duration_sec_override ?? null) || DEFAULT_DURATION
  const days     = (override?.days_override          ?? null) || DEFAULT_DAYS
  const screens  = Number(s.screens_count) || 0
  const rate     = Number(s.davp_per_slot_rate) || 0
  const monthly  = screens * daily * days * rate
  return { daily, duration, days, screens, rate, monthly }
}

export function Step3Stations({ data, onChange }) {
  const { stations, loading } = useGsrtcStations()
  const selected  = data.selected_station_ids || []
  const overrides = data.station_overrides || {}   // { station_id: { daily_spots_override, days_override, spot_duration_sec_override } }
  // Phase 11k — search filter. Owner request (5 May 2026): "need
  // serch option" for the station list so reps can find Anand,
  // Vadodara etc. without scrolling through all 20. Matches against
  // both English and Gujarati names + category. Only filters the
  // VISIBLE rows — selection state and totals stay across all stations.
  const [search, setSearch] = useState('')

  if (!loading && data.selected_station_ids === undefined && stations.length) {
    onChange({ selected_station_ids: stations.map(s => s.id) })
  }

  const filteredStations = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return stations
    return stations.filter(s => {
      const en = (s.station_name_en || '').toLowerCase()
      const gu = (s.station_name_gu || '').toLowerCase()
      const cat = (s.category || '').toLowerCase()
      return en.includes(q) || gu.includes(q) || cat.includes(q)
    })
  }, [stations, search])

  const monthlySum = useMemo(() => {
    return stations
      .filter(s => selected.includes(s.id))
      .reduce((sum, s) => sum + effectiveValues(s, overrides[s.id]).monthly, 0)
  }, [stations, selected, overrides])

  function toggle(id) {
    const has = selected.includes(id)
    onChange({
      selected_station_ids: has ? selected.filter(x => x !== id) : [...selected, id],
    })
  }
  function selectAll()  { onChange({ selected_station_ids: stations.map(s => s.id) }) }
  function selectNone() { onChange({ selected_station_ids: [] }) }

  function setOverride(stationId, field, value) {
    const num = value === '' ? null : Number(value)
    onChange({
      station_overrides: {
        ...overrides,
        [stationId]: { ...(overrides[stationId] || {}), [field]: num },
      },
    })
  }

  function resetOverrides(stationId) {
    const next = { ...overrides }
    delete next[stationId]
    onChange({ station_overrides: next })
  }

  if (loading) return <div className="govt-field__hint">Loading stations…</div>

  return (
    <div>
      <h2 className="govt-step__title">Select GSRTC Stations &amp; Adjust Per-Row</h2>
      <p className="govt-step__sub">
        Pick which stations to include. {selected.length} of {stations.length} selected.
        Combined monthly cost (1 month, before GST): <strong>₹{formatINREnglish(monthlySum)}</strong>.
        Override Daily / Duration / Days per row if this proposal differs from the standard 100&nbsp;/&nbsp;10s&nbsp;/&nbsp;30d.
      </p>

      <div className="govt-list">
        <div className="govt-list__bulk" style={{ gap: 10 }}>
          <span style={{ color: 'var(--text-muted)' }}>Bulk:</span>
          {/* Phase 11k — search input */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            flex: '1 1 auto', maxWidth: 360,
            background: 'var(--surface-2)',
            border: '1px solid var(--surface-3)',
            borderRadius: 6,
            padding: '4px 10px',
          }}>
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search station name (English or Gujarati) or category"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 13,
                padding: 0,
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title="Clear search"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button type="button" onClick={selectAll}>Select all</button>
          <button type="button" onClick={selectNone}>Select none</button>
        </div>

        {/* Header row */}
        <div
          className="govt-list__row govt-list__row--head"
          style={{ gridTemplateColumns: '24px 1fr 50px 60px 78px 78px 78px 110px' }}
        >
          <span></span>
          <span>Station</span>
          <span style={{ textAlign: 'center' }}>Cat</span>
          <span style={{ textAlign: 'right' }}>Screens</span>
          <span style={{ textAlign: 'right' }}>Daily</span>
          <span style={{ textAlign: 'right' }}>Spot (s)</span>
          <span style={{ textAlign: 'right' }}>Days</span>
          <span style={{ textAlign: 'right' }}>Monthly</span>
        </div>

        {filteredStations.length === 0 && (
          <div
            className="govt-list__row"
            style={{
              gridTemplateColumns: '1fr',
              padding: '20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
            }}
          >
            No stations match "{search}". Clear the search to see all.
          </div>
        )}
        {filteredStations.map(s => {
          const isChecked = selected.includes(s.id)
          const ov = overrides[s.id] || {}
          const v = effectiveValues(s, ov)
          const hasOverride =
            ov.daily_spots_override != null ||
            ov.spot_duration_sec_override != null ||
            ov.days_override != null
          return (
            <div
              key={s.id}
              className="govt-list__row"
              style={{
                gridTemplateColumns: '24px 1fr 50px 60px 64px 64px 64px 110px',
                opacity: isChecked ? 1 : 0.55,
              }}
            >
              <span className="govt-list__check">
                <input type="checkbox" checked={isChecked} onChange={() => toggle(s.id)} />
              </span>
              <span className="govt-list__name">
                {s.station_name_en}
                <span className="govt-list__name-gu">{s.station_name_gu}</span>
                {hasOverride && (
                  <button
                    type="button"
                    onClick={() => resetOverrides(s.id)}
                    style={{
                      marginLeft: 8,
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                    }}
                  >
                    reset
                  </button>
                )}
              </span>
              <span style={{ textAlign: 'center' }}>
                <span className={`govt-pill govt-pill--${s.category}`}>{s.category}</span>
              </span>
              <span className="govt-list__pct">{s.screens_count}</span>
              <input
                type="number"
                min="1"
                placeholder={String(DEFAULT_DAILY)}
                value={ov.daily_spots_override ?? ''}
                onChange={e => setOverride(s.id, 'daily_spots_override', e.target.value)}
                disabled={!isChecked}
                className="govt-input-cell"
                style={{ maxWidth: 70, textAlign: 'right' }}
              />
              <input
                type="number"
                min="1"
                placeholder={String(DEFAULT_DURATION)}
                value={ov.spot_duration_sec_override ?? ''}
                onChange={e => setOverride(s.id, 'spot_duration_sec_override', e.target.value)}
                disabled={!isChecked}
                className="govt-input-cell"
                style={{ maxWidth: 70, textAlign: 'right' }}
              />
              <input
                type="number"
                min="1"
                placeholder={String(DEFAULT_DAYS)}
                value={ov.days_override ?? ''}
                onChange={e => setOverride(s.id, 'days_override', e.target.value)}
                disabled={!isChecked}
                className="govt-input-cell"
                style={{ maxWidth: 70, textAlign: 'right' }}
              />
              <span className="govt-list__qty">
                {isChecked ? `₹${formatINREnglish(v.monthly)}` : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function validateStep3Gsrtc(data) {
  if (!data.selected_station_ids?.length) return 'Pick at least one station.'
  return null
}
