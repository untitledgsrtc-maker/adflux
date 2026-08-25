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

    // Phase 88.6 — Realtime channels on lead_activities + follow_ups.
    // Phase 318 — own-rows filter when userId is set (rep call pages).
    //
    // Phase 323 (audit M7) — REJOIN ON ERROR. Previously `.subscribe()` had no
    // status callback, so a channel that hit CHANNEL_ERROR / TIMED_OUT (routine
    // on flaky 4G) was never re-joined → reps silently stopped seeing live
    // updates until a tab-focus. Now we rebuild the channel with exponential
    // backoff on error, and refetch once after a genuine RECONNECT (to catch
    // events missed while the socket was down). The visibility/focus/poll
    // fallbacks stay as the safety net; a `disposed` guard prevents any rejoin
    // firing after unmount, and the backoff prevents a resubscribe loop.
    const laF = userId ? { filter: `created_by=eq.${userId}` } : {}
    const fuF = userId ? { filter: `assigned_to=eq.${userId}` } : {}
    let channel = null
    let retryId = null
    let attempt = 0
    let disposed = false
    let everErrored = false

    function subscribe() {
      channel = supabase
        .channel(`auto-refresh-${Math.random().toString(36).slice(2, 10)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_activities', ...laF }, fire)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lead_activities', ...laF }, fire)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'follow_ups', ...fuF }, fire)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'follow_ups', ...fuF }, fire)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            attempt = 0
            if (everErrored) { everErrored = false; fire() } // catch up after a reconnect
          } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !disposed) {
            everErrored = true
            scheduleRejoin()
          }
          // 'CLOSED' fires on our own teardown too — the disposed guard covers it.
        })
    }

    function scheduleRejoin() {
      if (disposed || retryId) return
      const delay = Math.min(30000, 1000 * 2 ** attempt) // 1,2,4,8,16,30s cap
      attempt += 1
      retryId = setTimeout(() => {
        retryId = null
        if (disposed) return
        try { if (channel) supabase.removeChannel(channel) } catch { /* */ }
        subscribe()
      }, delay)
    }

    subscribe()

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', fire)
      if (pollId) clearInterval(pollId)
      if (retryId) clearTimeout(retryId)
      try { if (channel) supabase.removeChannel(channel) } catch { /* */ }
    }
  }, [enabled, pollSeconds, userId])
}
