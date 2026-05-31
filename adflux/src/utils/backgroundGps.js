// src/utils/backgroundGps.js
//
// Phase 56b — background GPS tracking for the Capacitor Android wrapper.
// Phase 103.D.1 (2026-05-31) — dead-watcher self-heal (re-arm).
//
// Owner directive (18 May 2026): "main point is i want map route
// accurate with runs". Owner report (31 May 2026): km under-counts
// (8 km logged vs ~32 km actually driven) + admin "live" goes stale.
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
//   (default 10m), the plugin fires a callback with lat/lng/accuracy.
//   We write each event into `gps_pings` with source='interval' (the
//   existing enum value the rest of the codebase already understands).
//
// THE 103.D.1 CHANGE (why a re-arm layer was needed):
//   The plugin's watcher fires ONLY on movement. Two failure modes
//   produced the under-count:
//     1. If Location was OFF when addWatcher() ran (rep launched the
//        app with GPS off, common), the watcher errors once
//        ("Location services disabled") and NEVER re-arms — dead for
//        the whole day → zero movement pings → km massively under-
//        counts. This was the dominant cause.
//     2. An OEM battery-saver can silently kill the foreground service
//        mid-day; the watcher dies and never restarts.
//
//   Fix = make the watcher self-healing, two ways, both idempotent +
//   debounced against Android's 2-3x MODE_CHANGED multi-fire:
//     - Event-driven: when the native MODE_CHANGED receiver reports
//       GPS came back ON (nativeTracking.handleGpsStateChanged,
//       enabled=true), it calls rearmBackgroundGps() → the watcher is
//       torn down + re-added → movement pings resume immediately.
//     - Watchdog backstop: a 2-min interval. If the watcher is dead
//       (addWatcher threw at start), re-arm — with backoff so a
//       persistently-off GPS doesn't hammer addWatcher. Catches the
//       case where the GPS-on event was missed while backgrounded.
//
//   This is JS only — it runs on the live-update bundle (server.url →
//   Vercel per §38), so NO APK rebuild is needed.
//
//   It does NOT change the Phase 68 compute_daily_ta formula. The only
//   payout effect is INDIRECT and correct: a re-armed watcher records
//   the movement pings that were previously lost, so km reads closer to
//   the true distance driven (data completeness, not a formula change).
//
//   It does NOT add stationary keep-alive pings (those would track a
//   rep at home after checkout unless window-bounded to check-in →
//   checkout). That, plus full GPS/ONLINE pill parity + TADA window-
//   bounding, rides the native background service in 103.D proper.
//
// What it does NOT do here:
//   - No-op when running in a normal browser (web app). The web app
//     keeps using its existing foreground-only `logGpsPing` path in
//     WorkV2.
//   - No clustering, route snapping, or polyline rendering — those are
//     presentation-layer concerns. This file only writes raw pings.
//
// Usage:
//   import { startBackgroundGps, stopBackgroundGps, rearmBackgroundGps }
//     from './utils/backgroundGps'
//   startBackgroundGps(profile.id)  // on app mount when signed in
//   rearmBackgroundGps(profile.id)  // when GPS returns (nativeTracking)
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
let activeDistanceFilter = 10
let lastFixAt       = null   // ms epoch of the last ping we wrote
let watchdogTimer   = null
let rearming        = false  // debounce against MODE_CHANGED 2-3x multi-fire
let watchdogSkips   = 0      // ticks to skip before the next watchdog re-arm
let watchdogBackoff = 0      // grows on consecutive failed re-arms (GPS off)

// Phase 103.D.1 cadences
const WATCHDOG_MS    = 120000  // 2 min — how often the watchdog checks liveness
const MAX_BACKOFF    = 8       // cap: ~16 min between re-arm tries while GPS off

/**
 * Build the watcher option object. requestPermissions is true on the
 * first start (prompt the user once) and false on every re-arm (perms
 * already granted — don't re-prompt).
 */
function watcherOptions(distanceFilter, requestPermissions) {
  return {
    // Foreground-service notification (Android 8+ requirement for
    // long-running background work). Keeps the watcher alive when the
    // phone is locked / app backgrounded. Owner directive 2026-05-23:
    // stripped to a single short line; Android requires it visible.
    backgroundMessage: 'Active',
    backgroundTitle:   'Untitled OS',
    requestPermissions,
    // Don't surface stale cached fixes — they break the polyline.
    stale: false,
    // metres of movement before next callback. Lower = denser pings
    // (more accurate route) but more battery. Phase 57c set 10m to
    // catch GPS jitter even when the phone is roughly still.
    distanceFilter,
  }
}

/**
 * The watcher callback. Writes each fix as a ping and stamps lastFixAt
 * so the watchdog knows the watcher is alive.
 */
function onWatcherEvent(userId, location, error) {
  if (error) {
    // Permission denial, location services off, etc. Don't throw — the
    // watchdog will re-arm once GPS returns, and the native MODE_CHANGED
    // receiver also drives an event-based re-arm.
    console.warn('[bg-gps] watcher error:', error.message || error)
    return
  }
  if (!location) return
  lastFixAt = Date.now()
  writePing(userId, location).catch((e) =>
    console.warn('[bg-gps] write failed:', e?.message || e)
  )
}

async function addWatcherFor(userId, distanceFilter, requestPermissions) {
  return BackgroundGeolocation.addWatcher(
    watcherOptions(distanceFilter, requestPermissions),
    (location, error) => onWatcherEvent(userId, location, error),
  )
}

/**
 * Start the background watcher. Idempotent — calling twice with the
 * same userId is a no-op.
 *
 * @param {string} userId — auth.uid of the rep
 * @param {object} [opts]
 * @param {number} [opts.distanceFilter=10]  metres between pings while moving
 * @param {boolean} [opts.requestPermissions=true]  prompt user the first time
 */
export async function startBackgroundGps(userId, opts = {}) {
  // Skip if not in the Android wrapper. Web app uses the foreground
  // path in WorkV2 (logGpsPing) — don't double-track.
  if (!Capacitor.isNativePlatform()) return null
  if (!userId) return null
  if (activeWatcherId && activeUserId === userId) return activeWatcherId

  // If we already have a watcher for a different user (rare — sign-out
  // then sign-in), tear it down first.
  if (activeWatcherId) await stopBackgroundGps()

  const { distanceFilter = 10, requestPermissions = true } = opts
  activeUserId         = userId
  activeDistanceFilter = distanceFilter

  try {
    activeWatcherId = await addWatcherFor(userId, distanceFilter, requestPermissions)
  } catch (e) {
    // Common case: GPS was OFF at launch. Leave activeUserId set + the
    // watchdog running so the next re-arm (event or watchdog) recovers
    // the watcher once GPS returns — this is the 103.D.1 fix for the
    // "dead all day" km under-count.
    console.warn('[bg-gps] start failed (GPS off at launch?):', e?.message || e)
    activeWatcherId = null
  }

  // Always start the watchdog, even if the initial addWatcher failed.
  startWatchdog()
  return activeWatcherId
}

/**
 * Stop the background watcher + watchdog. Safe to call repeatedly.
 */
export async function stopBackgroundGps() {
  if (!Capacitor.isNativePlatform()) return
  stopWatchdog()
  const id = activeWatcherId
  activeWatcherId = null
  activeUserId    = null
  lastFixAt       = null
  if (!id) return
  try {
    await BackgroundGeolocation.removeWatcher({ id })
  } catch (e) {
    console.warn('[bg-gps] stop failed:', e?.message || e)
  }
}

/**
 * Phase 103.D.1 — re-arm the watcher (tear down + re-add). Called when
 * GPS comes back ON (event-driven, from nativeTracking) and by the
 * watchdog when a fix has gone stale. Debounced via the `rearming`
 * flag so Android's 2-3x MODE_CHANGED multi-fire only triggers one
 * teardown/re-add cycle.
 *
 * @param {string} userId — auth.uid of the rep
 */
export async function rearmBackgroundGps(userId) {
  if (!Capacitor.isNativePlatform()) return
  if (!userId) return
  if (rearming) return
  rearming = true
  try {
    // Remove the (possibly dead/erroring) existing watcher.
    if (activeWatcherId) {
      try { await BackgroundGeolocation.removeWatcher({ id: activeWatcherId }) }
      catch (_) { /* watcher may already be gone — ignore */ }
      activeWatcherId = null
    }
    activeUserId = userId
    // Re-add WITHOUT re-prompting for permissions (already granted on
    // the first start; a re-prompt mid-day would be noise).
    try {
      activeWatcherId = await addWatcherFor(userId, activeDistanceFilter, false)
    } catch (e) {
      // GPS still off — addWatcher errors again. Harmless; the next
      // watchdog tick or GPS-on event will try once more.
      console.warn('[bg-gps] re-arm failed (GPS still off?):', e?.message || e)
      activeWatcherId = null
    }
    // Ensure the watchdog is running (it normally already is).
    startWatchdog()
  } finally {
    rearming = false
  }
}

// ─── Watchdog ───────────────────────────────────────────────────────
// Backstop for the event-driven re-arm. It re-arms ONLY when the
// watcher is actually dead (activeWatcherId === null) — i.e. addWatcher
// threw at start because GPS was off, which is the dominant cause of
// the km under-count. It deliberately does NOT re-arm a live-but-quiet
// watcher (a stationary rep at a meeting produces no movement fixes but
// the watcher is fine) — re-arming that would needlessly tear down and
// re-post the foreground-service notification.
//
// While GPS stays off the re-arm keeps failing (activeWatcherId stays
// null); backoff grows the gap between attempts up to ~16 min so we
// don't hammer addWatcher (and flicker the notification) every 2 min.
// The instant GPS returns, the native MODE_CHANGED on-event drives an
// immediate event-based re-arm anyway — the watchdog is just the
// safety net for a missed on-event. No keep-alive pings are written
// here (privacy/window-bounding deferred to 103.D proper).

function startWatchdog() {
  if (watchdogTimer) return
  watchdogTimer = setInterval(watchdogTick, WATCHDOG_MS)
}

function stopWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null }
  watchdogSkips   = 0
  watchdogBackoff = 0
}

function watchdogTick() {
  if (!activeUserId) return
  if (activeWatcherId) return          // watcher alive — quiet ≠ dead
  if (watchdogSkips > 0) { watchdogSkips--; return }
  // Watcher is dead (failed to start, GPS was off). Try once.
  rearmBackgroundGps(activeUserId).then(() => {
    if (activeWatcherId) {
      watchdogBackoff = 0              // recovered — GPS is back
    } else {
      // still dead (GPS still off) — back off before the next attempt
      watchdogBackoff = Math.min(watchdogBackoff + 1, MAX_BACKOFF)
      watchdogSkips   = watchdogBackoff
    }
  }).catch(() => {})
}

/**
 * Write a single ping. Mirrors the shape used by WorkV2.logGpsPing()
 * and MeetingsMapPanel manual inserts so the day-track map renderer
 * keeps working unchanged.
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
    isNative:     Capacitor.isNativePlatform(),
    isTracking:   Boolean(activeWatcherId),
    userId:       activeUserId,
    watchdog:     Boolean(watchdogTimer),
    lastFixAgeMs: lastFixAt ? Date.now() - lastFixAt : null,
  }
}
