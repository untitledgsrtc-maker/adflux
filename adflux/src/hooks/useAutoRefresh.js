// src/hooks/useAutoRefresh.js
//
// Phase 34Z.59 — shared auto-refresh hook.
//
// Owner reported (15 May 2026): "auto refresh not working properly,
// when I punch anything it's not update until I switch to another
// tab." Root cause: most pages only refetch on initial mount + on
// the in-page realtime channel. They didn't refetch when the rep
// returns to the tab from the dialer / WhatsApp / lock screen.
// LeadsV2 + WorkV2 had partial coverage (location.key), but
// LeadDetailV2, FollowUpsV2, QuotesV2, MyPerformanceV2 had none.
//
// Three triggers fire the refetch:
//   1. document.visibilitychange — fires when the browser tab moves
//      from background to foreground (typical Android Chrome flow
//      after returning from a tel:/wa.me: handoff).
//   2. window focus — covers desktop / iPad / split-view edge cases
//      where visibilitychange doesn't fire.
//   3. Optional polling interval (default 0 = off).
//
// Debounce: 800ms so the focus + visibilitychange double-fire only
// triggers one refetch.

import { useEffect, useRef } from 'react'

export default function useAutoRefresh(loadFn, {
  enabled = true,
  pollSeconds = 0,
} = {}) {
  const fnRef     = useRef(loadFn)
  const lastRunRef = useRef(0)

  // Keep the latest loadFn closure without re-binding the listener.
  useEffect(() => { fnRef.current = loadFn }, [loadFn])

  useEffect(() => {
    if (!enabled || typeof fnRef.current !== 'function') return
    const DEBOUNCE_MS = 800

    function fire() {
      const now = Date.now()
      if (now - lastRunRef.current < DEBOUNCE_MS) return
      lastRunRef.current = now
      try { fnRef.current?.() } catch { /* swallow */ }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') fire()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', fire)

    let pollId = null
    if (pollSeconds && pollSeconds > 0) {
      pollId = setInterval(fire, pollSeconds * 1000)
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', fire)
      if (pollId) clearInterval(pollId)
    }
  }, [enabled, pollSeconds])
}
