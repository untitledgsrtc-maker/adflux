import { useState } from 'react'
import { X, Zap } from 'lucide-react'

export function BulkRateModal({ count, onClose, onApply, loading }) {
  const [rateField, setRateField] = useState('offer_rate')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!value || isNaN(Number(value)) || Number(value) < 0) {
      setError('Enter a valid rate')
      return
    }
    onApply(rateField, Number(value))
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
              Updating <strong style={{ color: 'var(--text)' }}>{count} cities</strong>. This will overwrite existing rates.
            </p>

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
