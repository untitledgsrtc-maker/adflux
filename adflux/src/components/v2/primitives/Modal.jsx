// src/components/v2/primitives/Modal.jsx
//
// Phase 35 PR 1 — canonical modal shell.
//
// Replaces 7+ ad-hoc modal implementations across the codebase:
// ConfirmDialog, CopilotModal, WonPaymentModal, OfferDetailModal,
// LogMeetingModal, LogActivityModal, ChangeStageModal, ReassignModal,
// PaymentModal, BulkRateModal, TeamMemberModal, StaffModal.
//
// Standardises:
//   • Backdrop opacity 0.55 (was 0.4 / 0.55 / 0.7 across the variants)
//   • Close button top-right, Lucide <X size={18} />
//   • Body padding 16-18 px depending on `size`
//   • Footer pinned to bottom on mobile via dvh + sticky — survives the
//     iOS keyboard rising
//   • Body scroll lock on mount; restored on unmount
//   • Esc to close; backdrop-click respects `closeOnBackdrop` prop

import { useEffect } from 'react'
import { X } from 'lucide-react'

const SIZE_MAX_WIDTH = { sm: 380, md: 520, lg: 720, full: '100%' }

/**
 * @param {object}    props
 * @param {boolean}   props.open
 * @param {() => void} props.onClose
 * @param {string}    props.title
 * @param {'sm'|'md'|'lg'|'full'} [props.size='md']
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.footer]
 * @param {boolean}  [props.closeOnBackdrop=true]
 */
export default function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
}) {
  // Esc to close + body scroll lock while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const isFull = size === 'full'

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'rgba(2, 6, 23, 0.55)',
        display: 'flex',
        alignItems: isFull ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: isFull ? 0 : '16px',
      }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: isFull ? 0 : 14,
          width: isFull ? '100%' : `min(${SIZE_MAX_WIDTH[size]}px, calc(100% - 32px))`,
          maxHeight: isFull ? '100dvh' : 'calc(100dvh - 32px)',
          overflow: 'hidden',
          color: 'var(--text)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
            fontWeight: 700,
            fontSize: 16,
            color: 'var(--text)',
          }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              borderRadius: 8,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} strokeWidth={1.6} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: size === 'sm' ? 14 : 18,
        }}>
          {children}
        </div>

        {/* Footer — sticky bottom */}
        {footer && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
