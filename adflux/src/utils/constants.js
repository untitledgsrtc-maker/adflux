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
