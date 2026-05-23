// src/utils/backgroundGps.js
//
// Phase 56b — background GPS tracking for the Capacitor Android
// wrapper. Owner directive (18 May 2026):
//   "main point is i want map route accurate with runs"
//
// Why this exists:
//   The web/PWA collects `gps_pings` only while the app tab is in the
//   foreground. iOS Safari kills background JS within seconds; Android
//   PWA is slightly better but still unreliable. Result: sparse pings
//   → daily_ta under-counts km AND the rep-side route map looks like
//   teleports across the city.
//
// What this does:
//   When running inside the Android wrapper (Capacitor native build),
//   register a long-running watcher on
//   @capacitor-community/background-geolocation. The plugin spawns a
//   foreground-service notification so Android's doze mode doesn't
//   kill it. Every time the phone has moved >= distanceFilter meters
//   (default 25m), the plugin fires a callback with lat/lng/accuracy.
//   We write each event into `gps_pings` with source='interval' (the
//   existing enum value the rest of the codebase already understands).
//
// What it does NOT do:
//   - No-op when running in a normal browser (web app). The web app
//     keeps using its existing foreground-only `logGpsPing` path in
//     WorkV2.
//   - No clustering, route snapping, or polyline rendering — those
//     are presentation-layer concerns. This file only writes raw
//     pings. The day-track map components already render polylines
//     from the same table; more pings → denser polyline → accurate
//     map automatically.
//
// Usage:
//   import { startBackgroundGps, stopBackgroundGps } from './utils/backgroundGps'
//   startBackgroundGps(profile.id)  // on app mount when signed in
//   stopBackgroundGps()             // on sign-out

import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabase'
// NOTE: @capacitor-community/background-geolocation has NO JS entry
// (the npm package ships only types + Android/iOS native code). It
// is wired through Capacitor's runtime bridge via `registerPlugin`.
// The web build sees an empty proxy; calls become no-ops on web,
// which is what we want — the isNativePlatform() guard double-
// protects.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

let activeWatcherId = null
let activeUserId    = null

/**
 * Start the background watcher. Idempotent — calling twice with the
 * same userId is a no-op.
 *
 * @param {string} userId — auth.uid of the rep
 * @param {object} [opts]
 * @param {number} [opts.distanceFilter=25]  metres between pings while moving
 * @param {boolean} [opts.requestPermissions=true]  prompt user the first time
 */
export async function startBackgroundGps(userId, opts = {}) {
  // Skip if not in the Android wrapper. Web app uses the foreground
  // path in WorkV2 (logGpsPing) — don't double-track.
  if (!Capacitor.isNativePlatform()) return null
  if (!userId) return null
  if (activeWatcherId && activeUserId === userId) return activeWatcherId

  // If we already have a watcher for a different user (rare — sign-
  // out then sign-in), tear it down first.
  if (activeWatcherId) await stopBackgroundGps()

  const {
    // Phase 57c (19 May 2026) — was 25m. Owner reported "again
    // gps gone of dhara" after she sat at her desk for 38 min.
    // Plugin only fires on movement >distanceFilter, so stationary
    // reps look offline in /dashboard live cards. 10m catches
    // natural GPS jitter even when the phone is still → continuous
    // pings → admin always sees live. Battery hit is negligible
    // because the foreground service was already running.
    distanceFilter   = 10,
    requestPermissions = true,
  } = opts

  try {
    activeWatcherId = await BackgroundGeolocation.addWatcher(
      {
        // Foreground-service notification (Android 8+ requirement
        // for long-running background work). Keeps the watcher
        // alive when the phone is locked / app backgrounded.
        //
        // Owner directive 2026-05-23: notification text annoying.
        // Android REQUIRES a persistent notification — we can't
        // hide it without losing background tracking. Stripped to
        // single short line. Phone-side: user can long-press the
        // notification → "Minimize" / "Silent" / "Hide on lock
        // screen" per Android's standard channel controls.
        backgroundMessage: 'Active',
        backgroundTitle:   'Untitled OS',
        requestPermissions,
        // Don't surface stale cached fixes — they break the polyline.
        stale: false,
        // metres of movement before next callback. Lower = denser
        // pings (more accurate route) but more battery.
        distanceFilter,
      },
      (location, error) => {
        if (error) {
          // Permission denial, location services off, etc. Don't
          // throw — the user will see the prompt next launch.
          console.warn('[bg-gps] watcher error:', error.message || error)
          return
        }
        if (!location) return
        writePing(userId, location).catch((e) =>
          console.warn('[bg-gps] write failed:', e?.message || e)
        )
      },
    )
    activeUserId = userId
    return activeWatcherId
  } catch (e) {
    console.warn('[bg-gps] start failed:', e?.message || e)
    activeWatcherId = null
    activeUserId    = null
    return null
  }
}

/**
 * Stop the background watcher. Safe to call repeatedly.
 */
export async function stopBackgroundGps() {
  if (!Capacitor.isNativePlatform()) return
  if (!activeWatcherId) return
  try {
    await BackgroundGeolocation.removeWatcher({ id: activeWatcherId })
  } catch (e) {
    console.warn('[bg-gps] stop failed:', e?.message || e)
  } finally {
    activeWatcherId = null
    activeUserId    = null
  }
}

/**
 * Write a single ping. Mirrors the shape used by
 * WorkV2.logGpsPing() and MeetingsMapPanel manual inserts so the
 * day-track map renderer keeps working unchanged.
 */
async function writePing(userId, location) {
  // Defensive: cap accuracy to int; round lat/lng to 7 decimals
  // (matches column precision).
  const lat = Number(location.latitude).toFixed(7)
  const lng = Number(location.longitude).toFixed(7)
  const accuracy_m = location.accuracy != null
    ? Math.round(Number(location.accuracy))
    : null

  if (!isFinite(parseFloat(lat)) || !isFinite(parseFloat(lng))) return

  const { error } = await supabase.from('gps_pings').insert([{
    user_id:    userId,
    lat,
    lng,
    accuracy_m,
    source:     'interval',   // pre-existing enum value
  }])
  if (error) throw error
}

/**
 * Return current watcher status — used for diagnostic UI.
 */
export function getBackgroundGpsStatus() {
  return {
    isNative:   Capacitor.isNativePlatform(),
    isTracking: Boolean(activeWatcherId),
    userId:     activeUserId,
  }
}
