// src/hooks/useAutoRefresh.js
//
// Phase 34Z.59 — shared auto-refresh hook.
// Phase 88.6 — added Supabase Realtime sub on the two highest-
// churn tables (lead_activities + follow_ups) so refresh fires
// the moment a row changes anywhere, not only on tab focus.
//
// Owner reported (15 May 2026): "auto refresh not working properly,
// when I punch anything it's not update until I switch to another
// tab." Root cause: most pages only refetch on initial mount + on
// the in-page realtime channel. They didn't refetch when the rep
// returns to the tab from the dialer / WhatsApp / lock screen.
// LeadsV2 + WorkV2 had partial coverage (location.key), but
// LeadDetailV2, FollowUpsV2, QuotesV2, MyPerformanceV2 had none.
//
// Triggers fire the refetch:
//   1. document.visibilitychange — fires when the browser tab moves
//      from background to foreground (typical Android Chrome flow
//      after returning from a tel:/wa.me: handoff).
//   2. window focus — covers desktop / iPad / split-view edge cases
//      where visibilitychange doesn't fire.
//   3. Supabase Realtime INSERT/UPDATE on lead_activities or
//      follow_ups — fires the moment ANY rep punches an activity
//      or a follow-up flips. Owner wanted 'feely done in
//      milisecons'. Phase 88.6 SQL adds both tables to the
//      supabase_realtime publication.
//   4. Optional polling interval (default 0 = off).
//
// Debounce: 800ms so the focus + visibilitychange + realtime push
// triple-fire only triggers one refetch.

import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function useAutoRefresh(loadFn, {
  enabled = true,
  pollSeconds = 0,
  // Phase 318 — when set, the Realtime sub fires ONLY on this user's rows
  // (their activities + follow-ups) instead of every rep's, so a rep's /work or
  // /telecaller page isn't yanked to refetch on every OTHER rep's punch (§57 —
  // the mid-call reload churn). Admin/all-rep pages pass no userId → global sub
  // (unchanged behaviour). Visibility + focus refresh still cover the rest.
  userId = null,
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

    // Phase 88.6 — Realtime channels on lead_activities +
    // follow_ups. Unique channel name per mount so multiple pages
    // using the hook get isolated subscriptions (Supabase merges
    // them server-side on the same connection). Failure modes:
    // - Table not in publication → silent no-op, fire() still
    //   covered by visibility/focus listeners.
    // - WebSocket disconnect → Supabase reconnects automatically.
    // Phase 318 — own-rows filter when userId is set (rep call pages).
    const laF = userId ? { filter: `created_by=eq.${userId}` } : {}
    const fuF = userId ? { filter: `assigned_to=eq.${userId}` } : {}
    const channel = supabase
      .channel(`auto-refresh-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_activities', ...laF }, fire)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lead_activities', ...laF }, fire)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'follow_ups', ...fuF }, fire)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'follow_ups', ...fuF }, fire)
      .subscribe()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', fire)
      if (pollId) clearInterval(pollId)
      try { supabase.removeChannel(channel) } catch { /* */ }
    }
  }, [enabled, pollSeconds, userId])
}
