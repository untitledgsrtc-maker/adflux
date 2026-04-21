// src/components/cities/CityCard.jsx
//
// Card design matches the target City Manager mock:
//   - photo with a round grade-coloured badge top-left
//   - uppercase city name
//   - details line: "N screens · SIZE" · Station name
//   - rates line: ₹offer (accent) + ₹listed (strikethrough)
//   - impressions line below
//   - inline yellow-outline "Edit" button + red X delete button at the bottom
//
// A small selection checkbox overlays the top-right corner so bulk-rate edits
// still work.

import { Pencil, X, Check } from 'lucide-react'
import { formatCurrency, formatNumber } from '../../utils/formatters'

// Match the reference mock: rectangular pills with white text on
// translucent colour backgrounds (green / orange / grey).
const GRADE_STYLES = {
  A: { bg: 'rgba(76,175,80,.92)',  color: '#fff' }, // green
  B: { bg: 'rgba(255,152,0,.92)',  color: '#fff' }, // orange
  C: { bg: 'rgba(136,136,136,.85)', color: '#fff' }, // grey
}

export function CityCard({ city, selected, onSelect, onEdit, onDelete }) {
  const g = (city.grade || 'C').toUpperCase()
  const badge = GRADE_STYLES[g] || GRADE_STYLES.C
  const hasOffer =
    city.offer_rate &&
    city.monthly_rate &&
    Number(city.offer_rate) !== Number(city.monthly_rate)

  return (
    <div className={`city-card${selected ? ' city-card--selected' : ''}`}>
      {/* Photo */}
      <div className="city-card-photo">
        {city.photo_url ? (
          <img src={city.photo_url} alt={city.name} />
        ) : (
          <div className="city-card-photo-placeholder" />
        )}

        {/* Grade badge — top-left, strong colour */}
        <div className="city-card-grade" style={{ background: badge.bg, color: badge.color }}>
          {g}
        </div>

        {/* Selection — top-right */}
        <div
          className="city-card-select"
          onClick={(e) => { e.stopPropagation(); onSelect(city.id) }}
          title={selected ? 'Deselect' : 'Select for bulk edit'}
        >
          <div className={`city-checkbox${selected ? ' city-checkbox--checked' : ''}`}>
            {selected && <Check size={12} strokeWidth={3} />}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="city-card-body">
        <p className="city-card-name">{city.name}</p>
        <p className="city-card-meta">
          {city.screens} screens
          {city.screen_size_inch ? ` · ${city.screen_size_inch}"` : ''}
          {city.station_name ? ` · ${city.station_name}` : ''}
        </p>

        <p className="city-card-rate-line">
          {hasOffer ? (
            <>
              <span className="city-rate-offer">{formatCurrency(city.offer_rate)}</span>
              <span className="city-rate-unit">/mo offer</span>
              <span className="city-rate-listed">{formatCurrency(city.monthly_rate)}</span>
            </>
          ) : (
            <>
              <span className="city-rate-offer">{formatCurrency(city.monthly_rate || city.offer_rate || 0)}</span>
              <span className="city-rate-unit">/mo</span>
            </>
          )}
        </p>

        {(city.impressions_day > 0 || city.unique_viewers > 0) && (
          <p className="city-card-impr">
            {city.impressions_day > 0 && <>{formatNumber(city.impressions_day)} impr/day</>}
            {city.impressions_day > 0 && city.unique_viewers > 0 && ' · '}
            {city.unique_viewers > 0 && <>{formatNumber(city.unique_viewers)} unique</>}
          </p>
        )}

        <div className="city-card-actions">
          <button
            className="city-edit-btn"
            onClick={() => onEdit(city)}
            type="button"
          >
            <Pencil size={13} /> Edit
          </button>
          <button
            className="city-delete-btn"
            onClick={() => onDelete(city)}
            type="button"
            title="Deactivate"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
