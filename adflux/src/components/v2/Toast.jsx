// src/components/v2/Toast.jsx
//
// Phase 34a — global v2 toast/banner system.
//
// Why this file exists:
//   Until Sprint A there was no project-wide way to surface an error
//   without using browser alert() or a per-page inline banner. That
//   meant ~17 empty catch blocks and ~25 Supabase writes that
//   ignored the `error` field — the rep saw a working UI while the
//   database said no. This module fixes that by giving every code
//   path one import to call when an operation succeeds or fails.
//
// Usage (anywhere — page, modal, hook, store):
//   import { pushToast } from '../components/v2/Toast'
//   pushToast('Lead saved.', 'success')
//   pushToast('Could not save lead — try again.', 'danger')
//   pushToast('Imported 450 / 500 leads (50 failed).', 'warning')
//   pushToast('Profile updated.', 'info')           // default
//
// Mounted once via <ToastViewport /> inside V2AppShell. Toasts queue
// in the bottom-right corner and auto-dismiss after 5s (8s for
// danger). The user can dismiss any toast manually via the close
// button. Pass { ttl: 0 } to keep a toast on screen until dismissed.
//
// Styling sits inline so the component works whether or not the
// `.v2` token scope is on the ancestor — v2 tokens are used with
// hex fallbacks so renderings inside V1 / wizard pages still look
// right.

import { create } from 'zustand'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'

let nextId = 0

const useToastStore = create((set, get) => ({
  toasts: [],
  push: (message, type = 'info', opts = {}) => {
    const id = ++nextId
    const ttl = opts.ttl ?? (type === 'danger' ? 8000 : 5000)
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    if (ttl > 0) {
      setTimeout(() => get().dismiss(id), ttl)
    }
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  clear:   () => set({ toasts: [] }),
}))

// Imperative API — call from anywhere, no React context needed.
export function pushToast(message, type = 'info', opts) {
  return useToastStore.getState().push(message, type, opts)
}

export function dismissToast(id) {
  return useToastStore.getState().dismiss(id)
}

export function clearToasts() {
  return useToastStore.getState().clear()
}

// Convenience helpers for the two most common cases.
export function toastError(error, fallback = 'Something went wrong.') {
  const msg = (error && (error.message || error.error_description || error.details)) || fallback
  return pushToast(msg, 'danger')
}

export function toastSuccess(message) {
  return pushToast(message, 'success')
}

const ICON = {
  success: CheckCircle2,
  danger:  AlertCircle,
  warning: AlertTriangle,
  info:    Info,
}

// Tints chosen to match v2.css tokens (--v2-green, --v2-rose, etc.)
// with hex fallbacks so the toast renders correctly outside .v2.
const TINT = {
  success: { bd: '#22c55e', bg: 'rgba(34, 197, 94, 0.14)'  },
  danger:  { bd: '#f43f5e', bg: 'rgba(244, 63, 94, 0.14)'  },
  warning: { bd: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' },
  info:    { bd: '#60a5fa', bg: 'rgba(96, 165, 250, 0.14)' },
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!toasts.length) return null

  return (
    // Phase 34Z (13 May 2026) — `bottom` was 16 px + safe-area only,
    // which on mobile placed the toast UNDER the .v2d-mnav (mobile
    // bottom nav, height 64 + safe-area; visible <860 px in v2.css).
    // Reps never saw the "Lead saved." or "Could not save" messages
    // on phones. Bumping the bottom offset on mobile to clear the
    // 64-px nav + safe-area. Desktop stays 16 + safe-area.
    <div
      role="status"
      aria-live="polite"
      className="v2-toast-viewport"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'max(16px, calc(env(safe-area-inset-bottom, 0px) + 16px))',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(420px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const Icon = ICON[t.type] || ICON.info
        const tint = TINT[t.type] || TINT.info
        return (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              background: 'var(--v2-bg-1, #111a2e)',
              borderLeft: `3px solid ${tint.bd}`,
              borderTop: `1px solid ${tint.bd}33`,
              borderRight: `1px solid ${tint.bd}33`,
              borderBottom: `1px solid ${tint.bd}33`,
              backgroundImage: `linear-gradient(0deg, ${tint.bg}, ${tint.bg})`,
              borderRadius: 'var(--v2-r, 14px)',
              boxShadow: 'var(--v2-shadow-pop, 0 10px 30px rgba(0,0,0,.45))',
              color: 'var(--v2-ink-0, #f5f7fb)',
              fontFamily: 'var(--v2-sans, "DM Sans", system-ui, sans-serif)',
              fontSize: 13,
              lineHeight: 1.4,
              pointerEvents: 'auto',
            }}
          >
            <Icon size={16} strokeWidth={1.6} color={tint.bd} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, wordBreak: 'break-word' }}>{t.message}</div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--v2-ink-1, #a9b3c7)',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <X size={14} strokeWidth={1.6} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export { useToastStore }
