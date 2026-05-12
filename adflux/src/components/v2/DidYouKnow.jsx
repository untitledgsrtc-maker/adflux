// src/components/v2/DidYouKnow.jsx
//
// Phase 34.9 — discoverability sweep.
//
// The May 13 Sales-module audit found that ~85% of features reps
// asked for were already built — the gap was not "missing features"
// but "discoverability." Reps don't know that /voice/evening exists,
// don't know TA auto-fills from GPS, don't know Cmd+K opens
// Co-Pilot.
//
// This component is a small dismissible tip card that surfaces a
// single helpful nudge on a page. The user dismisses with the X
// button; the dismissal persists in localStorage keyed on `id`, so
// the same tip never reappears on that browser. A tip is therefore
// shown roughly once per rep per device.
//
// Usage:
//   <DidYouKnow id="work-voice-plan" title="Try voice planning">
//     Tap the mic above to speak today's plan. AI parses to tasks.
//   </DidYouKnow>
//
// Place near the top of a page (inside the v2 scope) so it sits in
// the rep's visual field without obstructing the work area.

import { useState, useEffect } from 'react'
import { Lightbulb, X } from 'lucide-react'

const STORAGE_PREFIX = 'dyk:'

export function DidYouKnow({ id, title, children }) {
  if (!id) {
    // eslint-disable-next-line no-console
    console.warn('DidYouKnow: missing required `id` prop — tip will not persist dismiss state.')
  }

  // Default to true so SSR / first-render does not flash the tip
  // before localStorage has been checked.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || !id) {
      setDismissed(false)
      return
    }
    try {
      setDismissed(window.localStorage.getItem(STORAGE_PREFIX + id) === '1')
    } catch {
      // localStorage blocked (private mode etc.) — show the tip but
      // don't try to persist; rep can still dismiss for the session.
      setDismissed(false)
    }
  }, [id])

  if (dismissed) return null

  function close() {
    if (id) {
      try { window.localStorage.setItem(STORAGE_PREFIX + id, '1') } catch { /* ignore */ }
    }
    setDismissed(true)
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        background: 'var(--v2-bg-1, #111a2e)',
        border: '1px solid var(--v2-yellow, #FFE600)',
        borderLeft: '3px solid var(--v2-yellow, #FFE600)',
        borderRadius: 'var(--v2-r, 14px)',
        color: 'var(--v2-ink-0, #f5f7fb)',
        fontFamily: 'var(--v2-sans, "DM Sans", system-ui, sans-serif)',
        fontSize: 13,
        lineHeight: 1.4,
        marginBottom: 12,
      }}
    >
      <Lightbulb
        size={16}
        strokeWidth={1.6}
        color="var(--v2-yellow, #FFE600)"
        style={{ flexShrink: 0, marginTop: 1 }}
      />
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
        )}
        <div style={{ color: 'var(--v2-ink-1, #a9b3c7)' }}>{children}</div>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss tip"
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
}

/**
 * Reset all dismissed tips on this device. Useful for an admin
 * "show me all tips again" button (not wired anywhere yet but
 * exported for future use).
 */
export function resetAllTips() {
  if (typeof window === 'undefined') return
  try {
    const keys = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    // ignore
  }
}
