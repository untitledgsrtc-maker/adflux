// src/pages/v2/CitiesV2.jsx
//
// Admin city manager — keeps the battle-tested CityGrid + CityModal +
// BulkRateModal components (they already handle the LED-inventory fields,
// grade/rate matrix, and the Cronberry-integration hooks). We rebuild
// the page header, KPI row, filters and toast in v2 style.

import { useEffect, useState, useMemo } from 'react'
import { Plus, Search, Zap, X } from 'lucide-react'
import { useCities } from '../../hooks/useCities'
import { CityGrid } from '../../components/cities/CityGrid'
import { CityModal } from '../../components/cities/CityModal'
import { BulkRateModal } from '../../components/cities/BulkRateModal'
import { formatNumber } from '../../utils/formatters'

const GRADES = ['A', 'B', 'C']

export default function CitiesV2() {
  const {
    cities, fetchCities, createCity, updateCity, deleteCity, bulkUpdateRates,
  } = useCities()

  const [search, setSearch]           = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [cityModal, setCityModal]     = useState(null)
  const [bulkModal, setBulkModal]     = useState(false)
  const [savingCity, setSavingCity]   = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [toast, setToast]             = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => { fetchCities(showInactive) }, [showInactive])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const filtered = useMemo(() => cities.filter(c => {
    if (!showInactive && !c.is_active) return false
    if (gradeFilter && c.grade !== gradeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        c.name?.toLowerCase().includes(q) ||
        c.station_name?.toLowerCase().includes(q)
      )
    }
    return true
  }), [cities, search, gradeFilter, showInactive])

  // KPI roll-ups off the full active set (stable while searching).
  const kpis = useMemo(() => {
    const live = cities.filter(c => c.is_active)
    return {
      cityCount: live.length,
      screenSum: live.reduce((s, c) => s + (Number(c.screens) || 0), 0),
      imprSum:   live.reduce((s, c) => s + (Number(c.impressions_day) || 0), 0),
    }
  }, [cities])

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(c => c.id)))
  }

  async function handleSaveCity(formData) {
    setSavingCity(true)
    if (cityModal && cityModal.id) {
      const { error } = await updateCity(cityModal.id, formData)
      if (error) showToast(error.message, 'error')
      else { showToast('City updated'); setCityModal(null) }
    } else {
      const { error } = await createCity(formData)
      if (error) showToast(error.message, 'error')
      else { showToast('City added'); setCityModal(null) }
    }
    setSavingCity(false)
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    const { error } = await deleteCity(deleteConfirm.id)
    if (error) showToast(error.message, 'error')
    else showToast(`${deleteConfirm.name} deactivated`)
    setSelectedIds(prev => { const n = new Set(prev); n.delete(deleteConfirm.id); return n })
    setDeleteConfirm(null)
  }

  async function handleBulkUpdate(rateField, value) {
    setBulkLoading(true)
    const { error } = await bulkUpdateRates([...selectedIds], rateField, value)
    if (error) showToast(error.message, 'error')
    else { showToast(`Updated ${selectedIds.size} cities`); setBulkModal(false); setSelectedIds(new Set()) }
    setBulkLoading(false)
  }

  return (
    <div className="v2d-cities">
      {/* Toast */}
      {toast && (
        <div className={`v2d-toast v2d-toast--${toast.type}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">LED inventory</div>
          <h1 className="v2d-page-title">City Manager</h1>
          <div className="v2d-page-sub">
            {filtered.length} location{filtered.length !== 1 ? 's' : ''}
            {showInactive ? ' (incl. inactive)' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedIds.size > 0 && (
            <button className="v2d-btn v2d-btn--secondary" onClick={() => setBulkModal(true)}>
              <Zap size={14} /><span>Bulk Rates ({selectedIds.size})</span>
            </button>
          )}
          <button className="v2d-cta" onClick={() => setCityModal('new')}>
            <Plus size={15} /><span>Add City</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="v2d-cities-kpis">
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Cities</div>
          <div className="v2d-stat-v">{kpis.cityCount}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Screens</div>
          <div className="v2d-stat-v">{formatNumber(kpis.screenSum)}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Daily Impressions</div>
          <div className="v2d-stat-v">{formatNumber(kpis.imprSum)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="v2d-cities-toolbar">
        <div className="v2d-search v2d-search--inline">
          <Search size={14} />
          <input
            placeholder="Search cities…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="v2d-search-clear" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>

        <div className="v2d-tab-row">
          <button
            className={`v2d-tab-pill${gradeFilter === '' ? ' is-active' : ''}`}
            onClick={() => setGradeFilter('')}
          >All</button>
          {GRADES.map(g => (
            <button
              key={g}
              className={`v2d-tab-pill${gradeFilter === g ? ' is-active' : ''}`}
              onClick={() => setGradeFilter(g === gradeFilter ? '' : g)}
            >Grade {g}</button>
          ))}
        </div>

        <div className="v2d-cities-toolbar-r">
          {filtered.length > 0 && (
            <button className="v2d-ghost v2d-ghost--btn" onClick={selectAll}>
              {selectedIds.size === filtered.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          <label className="v2d-toggle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
            />
            <span>Show inactive</span>
          </label>
        </div>
      </div>

      {/* Grid (legacy component — bridge-styled via v2.css) */}
      <div className="v2d-cities-body">
        <CityGrid
          cities={filtered}
          selectedIds={selectedIds}
          onSelect={toggleSelect}
          onEdit={(city) => setCityModal(city)}
          onDelete={(city) => setDeleteConfirm(city)}
        />
      </div>

      {cityModal !== null && (
        <CityModal
          city={cityModal === 'new' ? null : cityModal}
          onClose={() => setCityModal(null)}
          onSave={handleSaveCity}
          loading={savingCity}
        />
      )}
      {bulkModal && (
        <BulkRateModal
          count={selectedIds.size}
          onClose={() => setBulkModal(false)}
          onApply={handleBulkUpdate}
          loading={bulkLoading}
        />
      )}
      {deleteConfirm && (
        <div className="v2d-modal-ov" onClick={(e) => e.target === e.currentTarget && setDeleteConfirm(null)}>
          <div className="v2d-modal" style={{ maxWidth: 380 }}>
            <div className="v2d-modal-h">
              <div className="v2d-modal-t">Deactivate City</div>
              <button className="v2d-modal-x" onClick={() => setDeleteConfirm(null)}><X size={17} /></button>
            </div>
            <div className="v2d-modal-b">
              Deactivate <strong>{deleteConfirm.name}</strong>?
              It will be hidden from quotes but existing data is preserved.
            </div>
            <div className="v2d-modal-f">
              <button className="v2d-ghost v2d-ghost--btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="v2d-btn v2d-btn--danger" onClick={confirmDelete}>Deactivate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
