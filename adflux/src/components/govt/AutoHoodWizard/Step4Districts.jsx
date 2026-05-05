// src/components/govt/AutoHoodWizard/Step4Districts.jsx
//
// Wizard Step 4 — district picker with LIVE % distribution preview.
//
// All 33 districts checked by default. Unchecking any district
// re-normalizes the remaining selected districts' % shares so they
// still sum to 100% within the subset, then re-allocates the total
// quantity.
//
// We compute the allocation client-side every render (cheap — 33
// rows). On Save, the per-district allocations get persisted as
// quote_cities rows with ref_kind='DISTRICT'.

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useAutoMasters } from '../../../hooks/useGovtMasters'
import { distributeAutoHoodQuantity } from '../../../utils/distributeQuantity'
import { formatINREnglish } from '../../../utils/gujaratiNumber'

export function Step4Districts({ data, onChange }) {
  const { districts, loading } = useAutoMasters()
  const selected = data.selected_district_ids || []
  const qty      = Number(data.auto_total_quantity) || 0
  // Phase 11k — search across English + Gujarati district names.
  // 33 districts is too many to scroll when the rep just needs
  // Ahmedabad or Surat.
  const [search, setSearch] = useState('')

  const filteredDistricts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return districts
    return districts.filter(d => {
      const en = (d.district_name_en || '').toLowerCase()
      const gu = (d.district_name_gu || '').toLowerCase()
      return en.includes(q) || gu.includes(q)
    })
  }, [districts, search])

  /* If selected_district_ids is unset (first time on this step) we
     default to "all districts checked". The parent owns this state
     so we mutate via onChange. */
  if (!loading && !data.selected_district_ids && districts.length) {
    onChange({ selected_district_ids: districts.map(d => d.id) })
  }

  const checkedDistricts = useMemo(
    () => districts.filter(d => selected.includes(d.id)),
    [districts, selected],
  )

  const allocated = useMemo(
    () => distributeAutoHoodQuantity(qty, checkedDistricts),
    [qty, checkedDistricts],
  )

  // Phase 11j — per-district manual qty override.
  // The auto-distribution by share_pct is the default, but the rep
  // sometimes needs to bump or trim a specific district (e.g. owner
  // approves an exception for Ahmedabad). Stored as a map keyed by
  // district id; only districts the rep actually touched have entries.
  // `effectiveQty(id)` falls back to the share-pct allocation.
  const overrides = data.district_qty_overrides || {}
  function effectiveQty(id) {
    if (overrides[id] !== undefined && overrides[id] !== null && overrides[id] !== '') {
      return Number(overrides[id]) || 0
    }
    return allocated.find(a => a.id === id)?.allocated_qty || 0
  }
  function setOverride(id, raw) {
    const next = { ...overrides }
    if (raw === '' || raw === null) {
      delete next[id]
    } else {
      next[id] = Math.max(0, Number(raw) || 0)
    }
    onChange({ district_qty_overrides: next })
  }

  const sumPctSelected = checkedDistricts.reduce((s, d) => s + Number(d.share_pct), 0)
  const sumQtyAllocated = checkedDistricts.reduce(
    (s, d) => s + effectiveQty(d.id),
    0,
  )

  function toggle(id) {
    const has = selected.includes(id)
    onChange({
      selected_district_ids: has ? selected.filter(x => x !== id) : [...selected, id],
    })
  }

  function selectAll() {
    onChange({ selected_district_ids: districts.map(d => d.id) })
  }

  function selectNone() {
    onChange({ selected_district_ids: [] })
  }

  if (loading) return <div className="govt-field__hint">Loading districts…</div>

  return (
    <div>
      <h2 className="govt-step__title">Districts &amp; Distribution</h2>
      <p className="govt-step__sub">
        Pick which districts to include. {checkedDistricts.length} of {districts.length}{' '}
        selected (combined share {sumPctSelected.toFixed(2)}% — re-normalized to 100% across selected).
        Allocated total: <strong>{formatINREnglish(sumQtyAllocated)}</strong> of {formatINREnglish(qty)}.
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
              placeholder="Search district (English or Gujarati)"
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
        <div className="govt-list__row govt-list__row--head">
          <span></span>
          <span>District</span>
          <span style={{ textAlign: 'right' }}>Share %</span>
          <span style={{ textAlign: 'right' }}>Qty</span>
        </div>
        {filteredDistricts.length === 0 && (
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
            No districts match "{search}". Clear the search to see all.
          </div>
        )}
        {filteredDistricts.map(d => {
          const isChecked = selected.includes(d.id)
          const isOver    = overrides[d.id] !== undefined && overrides[d.id] !== ''
          // Phase 11j — wrap the row in a div instead of <label> so
          // clicking the qty input doesn't toggle the row checkbox.
          // The checkbox itself still works because we attach the
          // toggle handler directly to it.
          return (
            <div key={d.id} className="govt-list__row" style={{ cursor: 'default' }}>
              <span className="govt-list__check">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(d.id)}
                  style={{ cursor: 'pointer' }}
                />
              </span>
              <span
                className="govt-list__name"
                onClick={() => toggle(d.id)}
                style={{ cursor: 'pointer' }}
              >
                {d.district_name_en}
                <span className="govt-list__name-gu">{d.district_name_gu}</span>
              </span>
              <span className="govt-list__pct">{Number(d.share_pct).toFixed(2)}%</span>
              <span className="govt-list__qty">
                {isChecked ? (
                  <input
                    type="number"
                    min="0"
                    value={overrides[d.id] !== undefined ? overrides[d.id] : (allocated.find(a => a.id === d.id)?.allocated_qty || 0)}
                    onChange={e => setOverride(d.id, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: 80,
                      textAlign: 'right',
                      background: isOver ? 'rgba(255,193,7,.08)' : 'var(--surface-2)',
                      border: `1px solid ${isOver ? 'rgba(255,193,7,.4)' : 'var(--surface-3)'}`,
                      color: isOver ? '#ffc107' : 'var(--text)',
                      borderRadius: 4,
                      padding: '3px 6px',
                      fontFamily: 'inherit',
                      fontSize: 13,
                    }}
                    title={isOver ? 'Manual override (click qty cell to clear)' : 'Auto-allocated by share %'}
                  />
                ) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function validateStep4(data) {
  if (!data.selected_district_ids?.length) return 'Pick at least one district.'
  return null
}
