// src/components/v2/primitives/Banner.jsx
//
// Phase 35 PR 1 — canonical inline banner.
//
// Replaces:
//   • MasterV2 copy-paste status banner (6 sites, identical inline styles)
//   • QuoteDetail / OfferForm / PendingApprovals / LeadUpload inline
//     setError + div pattern
//
// Distinct from <Toast>: Banner is in-flow (sits where it's mounted),
// Toast is fixed-position bottom-right (transient).

import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react'

const TONE = {
  success: { fg: 'var(--success)', bg: 'var(--success-soft)', icon: CheckCircle2 },
  warning: { fg: 'var(--warning)', bg: 'var(--warning-soft)', icon: AlertTriangle },
  danger:  { fg: 'var(--danger)',  bg: 'var(--danger-soft)',  icon: AlertCircle },
  info:    { fg: 'var(--blue)',    bg: 'var(--blue-soft)',    icon: Info },
}

/**
 * @param {object} props
 * @param {'success'|'warning'|'danger'|'info'} props.tone
 * @param {React.ReactNode} props.children
 * @param {() => void} [props.onDismiss] — when set, renders an X button
 */
export default function Banner({ tone, children, onDismiss }) {
  const t = TONE[tone] || TONE.info
  const Icon = t.icon
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        background: t.bg,
        border: `1px solid ${t.fg}`,
        borderRadius: 10,
        color: 'var(--text)',
        fontSize: 13,
        lineHeight: 1.4,
        marginBottom: 12,
      }}
    >
      <Icon size={16} strokeWidth={1.6} style={{ color: t.fg, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: 2,
            flexShrink: 0,
          }}
        >
          <X size={14} strokeWidth={1.6} />
        </button>
      )}
    </div>
  )
}
