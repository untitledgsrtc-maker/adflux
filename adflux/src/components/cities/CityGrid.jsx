import { CityCard } from './CityCard'
import { Building2 } from 'lucide-react'

export function CityGrid({ cities, selectedIds, onSelect, onEdit, onDelete }) {
  if (!cities.length) {
    return (
      <div className="empty-state">
        <Building2 size={40} />
        <p style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>No cities yet</p>
        <p style={{ fontSize: 13 }}>Add your first city to get started.</p>
      </div>
    )
  }

  return (
    <div className="city-grid">
      {cities.map(city => (
        <CityCard
          key={city.id}
          city={city}
          selected={selectedIds.has(city.id)}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
