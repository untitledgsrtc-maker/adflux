// src/components/quotes/QuoteStatusBadge.jsx
import { STATUS_LABELS, STATUS_COLORS } from '../../utils/constants'

export function QuoteStatusBadge({ status, size = 'md' }) {
  const label = STATUS_LABELS[status] || status
  const cls = STATUS_COLORS[status] || 'badge-draft'
  return (
    <span className={`badge ${cls}${size === 'lg' ? ' badge--lg' : ''}`}>
      {label}
    </span>
  )
}
