// src/hooks/useIsDesktop.js
//
// Viewport hook for the v2 dashboard switcher.
//
// Why 860px:
// - Below 860 the .v2d desktop shell collapses (sidebar hides, KPI grid
//   wraps to 1-col). That's when we want the mobile-first .v2 sales
//   component or the stacked AdminDashboardMobile component to render
//   instead.
// - Matches the @media (max-width: 860px) breakpoints already baked into
//   v2.css so the JS switch and the CSS collapse happen at the same width.
//
// SSR-safe: returns `false` on the server (no window), then syncs on mount.

import { useEffect, useState } from 'react'

const DESKTOP_BP = 860

function read() {
  if (typeof window === 'undefined') return false
  return window.innerWidth >= DESKTOP_BP
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(read)

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BP}px)`)
    const onChange = (e) => setIsDesktop(e.matches)

    // Sync once on mount in case the initial value was stale (SSR, zoom).
    setIsDesktop(mq.matches)

    // `addEventListener` is the modern API; fall back for Safari < 14.
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)

    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  return isDesktop
}
