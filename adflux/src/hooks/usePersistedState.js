// src/hooks/usePersistedState.js
//
// Phase 268 — a drop-in replacement for useState that REMEMBERS the value in
// sessionStorage, keyed by a stable string. Why: list pages (LeadsV2, QuotesV2)
// keep their filters/tabs in component state, so opening a lead/quote then
// tapping the browser Back button REMOUNTS the page → every filter reset to
// default ("we filter, go back, all filters gone"). Backing the filter state
// with sessionStorage restores it on remount.
//
// sessionStorage (NOT localStorage) on purpose: the filters persist through
// navigation + Back within the working session, but clear when the tab/app is
// closed — so a stale filter never sticks across days (which would re-create the
// §136 "why can't I see all my leads" confusion). Same API as useState, incl.
// the lazy-initial form. try/catch everywhere so private-mode / disabled storage
// silently degrades to plain in-memory state (never throws).

import { useState, useEffect } from 'react'

export function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw != null) return JSON.parse(raw)
    } catch { /* storage blocked / bad JSON → fall through to initial */ }
    return typeof initial === 'function' ? initial() : initial
  })

  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
  }, [key, value])

  return [value, setValue]
}
