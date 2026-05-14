// src/components/v2/primitives/EmptyState.jsx
//
// Phase 35 PR 1 — canonical empty-state card.
//
// Replaces 3 patterns:
//   • v2d-empty-card + v2d-empty-t/v2d-empty-s (QuotesV2, TaPayoutsAdminV2 — canonical)
//   • v2d-q-empty bare div (AdminDashboardDesktop x3)
//   • lead-card-pad inline text (LeadDetailV2)
//
// Visual: centred Lucide icon (28px), title (16px bold), sub (13px muted),
// optional action button.

/**
 * @param {object} props
 * @param {React.ComponentType<any>} props.icon — Lucide icon component
 * @param {string} props.title
 * @param {string} [props.sub]
 * @param {{ label: string; onClick: () => void }} [props.action]
 */
export default function EmptyState({ icon: Icon, title, sub, action }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '32px 18px',
      textAlign: 'center',
      color: 'var(--text)',
    }}>
      {Icon && (
        <div style={{ marginBottom: 10 }}>
          <Icon size={28} strokeWidth={1.6} style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
      <div style={{
        fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
        fontWeight: 700,
        fontSize: 16,
        marginBottom: sub ? 4 : 0,
      }}>{title}</div>
      {sub && (
        <div style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          maxWidth: 360,
          margin: '0 auto',
          lineHeight: 1.4,
        }}>{sub}</div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: 14,
            padding: '8px 16px',
            borderRadius: 999,
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: 'none',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
