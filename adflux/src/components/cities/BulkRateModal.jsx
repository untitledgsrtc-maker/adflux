import { useState } from 'react'
import { X, Zap } from 'lucide-react'

const GRADES = ['A', 'B', 'C']

export function BulkRateModal({ cities = [], onClose, onApply, loading }) {
  const [rateField, setRateField] = useState('offer_rate')
  const [value, setValue] = useState('')
  const [grade, setGrade] = useState('all')
  const [error, setError] = useState('')

  // Phase 165 — scope the bulk update by grade so the owner can change
  // rates grade-wise without the tab + Select-All dance. Only offer grades
  // that exist in the selected set; "all" = every selected city. The count +
  // the cities updated track the chosen grade live.
  const presentGrades = GRADES.filter(g => cities.some(c => (c.grade || '') === g))
  const target = grade === 'all' ? cities : cities.filter(c => (c.grade || '') === grade)
  const count = target.length

  function handleSubmit(e) {
    e.preventDefault()
    if (!value || isNaN(Number(value)) || Number(value) < 0) {
      setError('Enter a valid rate')
      return
    }
    if (count === 0) { setError('No cities match that grade'); return }
    onApply(rateField, Number(value), target.map(c => c.id))
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} color="var(--accent)" />
            <p className="modal-title">Bulk Update Rates</p>
          </div>
          <button className="modal-close" onClick={onClose}><X size={17} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Updating <strong style={{ color: 'var(--text)' }}>{count} cit{count === 1 ? 'y' : 'ies'}</strong>. This will overwrite existing rates.
            </p>

            <div className="form-group">
              <label className="form-label">Grade</label>
              <select
                className="form-select"
                value={grade}
                onChange={e => setGrade(e.target.value)}
              >
                <option value="all">All grades</option>
                {presentGrades.map(g => (
                  <option key={g} value={g}>Grade {g}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Which Rate</label>
              <select
                className="form-select"
                value={rateField}
                onChange={e => setRateField(e.target.value)}
              >
                <option value="offer_rate">Offer Rate</option>
                <option value="monthly_rate">Listed Rate</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">New Rate (₹ / month)</label>
              <input
                type="number"
                className={`form-input${error ? ' input-error' : ''}`}
                value={value}
                onChange={e => { setValue(e.target.value); setError('') }}
                placeholder="0"
                autoFocus
                min="0"
              />
              {error && <span className="field-error">{error}</span>}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Updating…' : `Update ${count} Cities`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
