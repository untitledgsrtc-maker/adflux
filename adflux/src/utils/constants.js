// Quote statuses
export const QUOTE_STATUSES = ['draft', 'sent', 'negotiating', 'won', 'lost']

export const STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
}

export const STATUS_COLORS = {
  draft: 'badge-draft',
  sent: 'badge-sent',
  negotiating: 'badge-negotiating',
  won: 'badge-won',
  lost: 'badge-lost',
}

// Phase 34g — inline-style colors for quote status chips, dots and
// inline badges. Use these instead of hardcoding Material Design hex
// values (#81c784, #ef9a9a, etc.) which were drifting from the brand
// palette in QuoteDetail.jsx and SalesDashboard.jsx. Falls back to
// safe defaults if a future status string isn't yet mapped here.
export const STATUS_COLOR_VARS = {
  draft:       'var(--text-muted, #94a3b8)',
  sent:        'var(--blue, #3B82F6)',
  negotiating: 'var(--warning, #F59E0B)',
  won:         'var(--success, #10B981)',
  lost:        'var(--danger, #EF4444)',
}

// City grades
export const GRADES = ['A', 'B', 'C']

// Payment modes
export const PAYMENT_MODES = ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Cash']

// Revenue types
export const REVENUE_TYPES = [
  { value: 'new', label: 'New Client' },
  { value: 'renewal', label: 'Renewal' },
]

// Roles
export const ROLES = {
  ADMIN: 'admin',
  SALES: 'sales',
}

// GST rate
export const GST_RATE = 0.18

// Duration options (months)
export const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 9, 12]

// Sidebar nav items (defined here for use across layout components)
export const ADMIN_NAV = [
  { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { path: '/quotes', label: 'Quotes', icon: 'FileText' },
  { path: '/cities', label: 'City Manager', icon: 'MapPin' },
  { path: '/team', label: 'Team', icon: 'Users' },
  { path: '/incentives', label: 'Incentives', icon: 'TrendingUp' },
]

export const SALES_NAV = [
  { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { path: '/quotes', label: 'My Quotes', icon: 'FileText' },
  { path: '/performance', label: 'My Performance', icon: 'TrendingUp' },
]
