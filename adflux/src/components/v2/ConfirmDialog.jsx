// src/components/v2/ConfirmDialog.jsx
//
// Phase 34e — promise-based confirmation dialog for v2 pages.
//
// Replaces browser confirm() for destructive bulk operations (delete
// leads, bulk stage change, etc). Browser confirm() blocks the JS
// thread, looks operating-system-ugly, and breaks the v2 visual
// language. This component renders a centered modal with the same
// tokens as the rest of the app and resolves a promise on the user's
// choice.
//
// Usage (no React context needed):
//   import { confirmDialog } from '../components/v2/ConfirmDialog'
//   if (!(await confirmDialog({
//     title: 'Delete leads?',
//     message: `Delete ${n} leads permanently? This cannot be undone.`,
//     confirmLabel: 'Delete',
//     danger: true,
//   }))) return
//
// Mounted once via <ConfirmDialogViewport /> inside V2AppShell.

import { useEffect } from 'react'
import { create } from 'zustand'
import { AlertTriangle, X } from 'lucide-react'

let resolver = null

const useConfirmStore = create((set) => ({
  state: null,
  open: (opts) => new Promise((resolve) => {
    resolver = resolve
    set({ state: opts })
  }),
  close: (value) => {
    const r = resolver
    resolver = null
    set({ state: null })
    r?.(value)
  },
}))

export function confirmDialog(opts = {}) {
  return useConfirmStore.getState().open({
    title: opts.title || 'Are you sure?',
    message: opts.message || '',
    confirmLabel: opts.confirmLabel || 'OK',
    cancelLabel: opts.cancelLabel || 'Cancel',
    danger: !!opts.danger,
  })
}

export function ConfirmDialogViewport() {
  const state = useConfirmStore((s) => s.state)
  const close = useConfirmStore((s) => s.close)

  // Esc closes (cancel), Enter confirms.
  useEffect(() => {
    if (!state) return
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      else if (e.key === 'Enter') { e.preventDefault(); close(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, close])

  if (!state) return null

  const accent = state.danger ? '#f43f5e' : '#FFE600'
  const accentFg = state.danger ? '#fff' : '#0b1220'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => { if (e.target === e.currentTarget) close(false) }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(5, 8, 16, 0.62)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        fontFamily: 'var(--v2-sans, "DM Sans", system-ui, sans-serif)',
      }}
    >
      <div
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--v2-bg-1, #111a2e)',
          borderRadius: 'var(--v2-r, 14px)',
          border: '1px solid var(--v2-line, #1f2b47)',
          boxShadow: 'var(--v2-shadow-pop, 0 10px 30px rgba(0,0,0,.45))',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--v2-line, #1f2b47)',
        }}>
          <div id="confirm-title" style={{
            display: 'flex', alignItems: 'center', gap: 10,
            color: 'var(--v2-ink-0, #f5f7fb)',
            fontSize: 15,
            fontWeight: 600,
          }}>
            {state.danger && <AlertTriangle size={16} strokeWidth={1.6} color={accent} />}
            <span>{state.title}</span>
          </div>
          <button
            type="button"
            onClick={() => close(false)}
            aria-label="Cancel"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--v2-ink-1, #a9b3c7)', padding: 4, display: 'flex',
            }}
          >
            <X size={16} strokeWidth={1.6} />
          </button>
        </div>

        {state.message && (
          <div style={{
            padding: '16px 16px 8px',
            color: 'var(--v2-ink-1, #a9b3c7)',
            fontSize: 13,
            lineHeight: 1.5,
          }}>
            {state.message}
          </div>
        )}

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '14px 16px',
        }}>
          <button
            type="button"
            onClick={() => close(false)}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--v2-r-sm, 10px)',
              background: 'transparent',
              border: '1px solid var(--v2-line, #1f2b47)',
              color: 'var(--v2-ink-0, #f5f7fb)',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {state.cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            autoFocus
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--v2-r-sm, 10px)',
              background: accent,
              border: `1px solid ${accent}`,
              color: accentFg,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
