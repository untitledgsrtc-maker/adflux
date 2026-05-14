// src/components/v2/primitives/StatusBadge.jsx
//
// Phase 35 PR 1 — single status chip primitive.
//
// Replaces 38 --tint-* token sites PLUS ~80 hardcoded rgba duplicates
// across CockpitWidgets, GovtProposalDetailV2, MasterV2,
// AdminDashboardDesktop.
//
// Visual: pill, background = --tint-{name}-bg, border = --tint-{name}-bd,
// text colour matches the tint hue. Tokens defined in v2.css Phase 34R.

const TINT_PALETTE = {
  success: { fg: 'var(--success, #10B981)', bg: 'var(--tint-success-bg, rgba(16,185,129,.10))',  bd: 'var(--tint-success-bd, rgba(16,185,129,.28))' },
  warning: { fg: 'var(--warning, #F59E0B)', bg: 'var(--tint-warning-bg, rgba(245,158,11,.10))',  bd: 'var(--tint-warning-bd, rgba(245,158,11,.28))' },
  danger:  { fg: 'var(--danger, #EF4444)',  bg: 'var(--tint-danger-bg, rgba(239,68,68,.10))',    bd: 'var(--tint-danger-bd, rgba(239,68,68,.28))' },
  blue:    { fg: 'var(--blue, #3B82F6)',    bg: 'var(--tint-blue-bg, rgba(59,130,246,.10))',     bd: 'var(--tint-blue-bd, rgba(59,130,246,.28))' },
  purple:  { fg: 'var(--purple, #A78BFA)',  bg: 'var(--tint-purple-bg, rgba(167,139,250,.10))',  bd: 'var(--tint-purple-bd, rgba(167,139,250,.28))' },
  yellow:  { fg: 'var(--accent, #FFE600)',  bg: 'var(--accent-soft, rgba(255,230,0,.14))',       bd: 'rgba(255,230,0,.34)' },
  orange:  { fg: 'var(--orange, #F97316)',  bg: 'var(--orange-soft, rgba(249,115,22,.12))',      bd: 'rgba(249,115,22,.30)' },
  neutral: { fg: 'var(--text-muted)',       bg: 'var(--surface-2)',                                bd: 'var(--border)' },
}

/**
 * @param {object} props
 * @param {keyof typeof TINT_PALETTE} props.tint
 * @param {React.ComponentType<any>} [props.icon] — Lucide icon component, NOT element
 * @param {'sm'|'md'} [props.size='md']
 * @param {React.ReactNode} props.children
 */
export default function StatusBadge({
  tint,
  icon: Icon,
  size = 'md',
  children,
}) {
  const t = TINT_PALETTE[tint] || TINT_PALETTE.neutral
  const isSm = size === 'sm'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: isSm ? '2px 7px' : '3px 9px',
      borderRadius: 999,
      background: t.bg,
      border: `1px solid ${t.bd}`,
      color: t.fg,
      fontSize: isSm ? 10 : 11,
      fontWeight: 600,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
    }}>
      {Icon && <Icon size={isSm ? 10 : 12} strokeWidth={1.6} />}
      {children}
    </span>
  )
}
