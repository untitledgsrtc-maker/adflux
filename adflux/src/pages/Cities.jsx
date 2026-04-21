import { useEffect, useState, useMemo } from 'react'
import { Plus, Search, Zap, X, Filter } from 'lucide-react'
import { useCities } from '../hooks/useCities'
import { CityGrid } from '../components/cities/CityGrid'
import { CityModal } from '../components/cities/CityModal'
import { BulkRateModal } from '../components/cities/BulkRateModal'

const GRADES = ['A', 'B', 'C']

export default function Cities() {
  const {
    cities,
    fetchCities,
    createCity,
    updateCity,
    deleteCity,
    bulkUpdateRates,
  } = useCities()

  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [cityModal, setCityModal] = useState(null) // null | 'new' | city object
  const [bulkModal, setBulkModal] = useState(false)
  const [savingCity, setSavingCity] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    fetchCities(showInactive)
  }, [showInactive])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const filtered = useMemo(() => {
    return cities.filter(c => {
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
    })
  }, [cities, search, gradeFilter, showInactive])

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)))
    }
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

  async function handleDelete(city) {
    setDeleteConfirm(city)
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
    <div className="page">
      {/* Toast */}
      {toast && (
        <div className={`toast toast--${toast.type}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">City Manager</h1>
          <p className="page-subtitle">{filtered.length} location{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedIds.size > 0 && (
            <button className="btn btn-secondary" onClick={() => setBulkModal(true)}>
              <Zap size={14} />
              Bulk Rates ({selectedIds.size})
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setCityModal('new')}>
            <Plus size={15} />
            Add City
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="city-filters">
        <div className="search-box">
          <Search size={14} className="search-icon" />
          <input
            className="form-input search-input"
            placeholder="Search cities…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>

        <div className="filter-pills">
          <button
            className={`filter-pill${gradeFilter === '' ? ' filter-pill--active' : ''}`}
            onClick={() => setGradeFilter('')}
          >All</button>
          {GRADES.map(g => (
            <button
              key={g}
              className={`filter-pill${gradeFilter === g ? ' filter-pill--active' : ''}`}
              onClick={() => setGradeFilter(g === gradeFilter ? '' : g)}
            >
              Grade {g}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Select all */}
          {filtered.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={selectAll}>
              {selectedIds.size === filtered.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
            />
            <span>Show inactive</span>
          </label>
        </div>
      </div>

      {/* Grid */}
      <CityGrid
        cities={filtered}
        selectedIds={selectedIds}
        onSelect={toggleSelect}
        onEdit={(city) => setCityModal(city)}
        onDelete={handleDelete}
      />

      {/* City Modal */}
      {cityModal !== null && (
        <CityModal
          city={cityModal === 'new' ? null : cityModal}
          onClose={() => setCityModal(null)}
          onSave={handleSaveCity}
          loading={savingCity}
        />
      )}

      {/* Bulk Rate Modal */}
      {bulkModal && (
        <BulkRateModal
          count={selectedIds.size}
          onClose={() => setBulkModal(false)}
          onApply={handleBulkUpdate}
          loading={bulkLoading}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth: 380 }}>
            <div className="modal-header">
              <p className="modal-title">Deactivate City</p>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}><X size={17} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Deactivate <strong style={{ color: 'var(--text)' }}>{deleteConfirm.name}</strong>?
                It will be hidden from quotes but existing data is preserved.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete}>Deactivate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
