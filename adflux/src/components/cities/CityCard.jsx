import { Building2, Monitor, Eye, TrendingUp, MoreVertical, Edit2, Trash2 } from 'lucide-react'
import { formatCurrency, formatNumber } from '../../utils/formatters'
import { useState, useRef, useEffect } from 'react'

const GRADE_COLORS = {
  A: { bg: 'rgba(255,230,0,0.12)', color: 'var(--accent)', label: 'Grade A' },
  B: { bg: 'rgba(59,130,246,0.12)', color: 'var(--blue)', label: 'Grade B' },
  C: { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: 'Grade C' },
}

export function CityCard({ city, selected, onSelect, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const grade = GRADE_COLORS[city.grade] || GRADE_COLORS.C

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  return (
    <div className={`city-card${selected ? ' city-card--selected' : ''}`}>
      {/* Selection checkbox */}
      <div className="city-card-select" onClick={(e) => { e.stopPropagation(); onSelect(city.id) }}>
        <div className={`city-checkbox${selected ? ' city-checkbox--checked' : ''}`}>
          {selected && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4L3.5 6.5L9 1" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </div>

      {/* Photo / placeholder */}
      <div className="city-card-photo">
        {city.photo_url ? (
          <img src={city.photo_url} alt={city.name} />
        ) : (
          <div className="city-card-photo-placeholder">
            <Building2 size={28} color="var(--border)" />
          </div>
        )}
        <div className="city-card-grade" style={{ background: grade.bg, color: grade.color }}>
          {city.grade || '—'}
        </div>
      </div>

      {/* Body */}
      <div className="city-card-body">
        <div className="city-card-header">
          <div>
            <p className="city-card-name">{city.name}</p>
            {city.station_name && (
              <p className="city-card-station">{city.station_name}</p>
            )}
          </div>
          <div className="city-card-menu" ref={menuRef}>
            <button
              className="city-card-menu-btn"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
            >
              <MoreVertical size={15} />
            </button>
            {menuOpen && (
              <div className="city-card-dropdown">
                <button onClick={() => { setMenuOpen(false); onEdit(city) }}>
                  <Edit2 size={13} /> Edit
                </button>
                <button className="danger" onClick={() => { setMenuOpen(false); onDelete(city) }}>
                  <Trash2 size={13} /> Deactivate
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="city-card-stats">
          <div className="city-stat">
            <Monitor size={12} />
            <span>{city.screens} screen{city.screens !== 1 ? 's' : ''}</span>
            {city.screen_size_inch && <span className="city-stat-sub">· {city.screen_size_inch}"</span>}
          </div>
          <div className="city-stat">
            <Eye size={12} />
            <span>{formatNumber(city.impressions_day)}/day</span>
          </div>
        </div>

        <div className="city-card-rates">
          <div className="city-rate">
            <span className="city-rate-label">Listed</span>
            <span className="city-rate-value">{formatCurrency(city.monthly_rate)}</span>
            <span className="city-rate-unit">/mo</span>
          </div>
          <div className="city-rate city-rate--offer">
            <span className="city-rate-label">Offer</span>
            <span className="city-rate-value">{formatCurrency(city.offer_rate)}</span>
            <span className="city-rate-unit">/mo</span>
          </div>
        </div>

        {city.unique_viewers > 0 && (
          <div className="city-card-viewers">
            <TrendingUp size={11} />
            <span>{formatNumber(city.unique_viewers)} unique viewers/mo</span>
          </div>
        )}
      </div>
    </div>
  )
}
