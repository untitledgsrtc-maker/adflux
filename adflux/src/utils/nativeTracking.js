// src/utils/nativeTracking.js
//
// Phase 76.2 — JS shim for the UntitledTracking Capacitor plugin
// (android/app/src/main/java/in/untitledad/app/TrackingPlugin.java).
//
// Subscribes to native events + writes Phase 76.1 tracking event
// tables. Native side does NOT hold Supabase credentials — JS owns
// all networked work.
//
// Events handled
//   gpsStateChanged   { enabled, atMs }  → upsert gps_off_events
//   networkStateChanged { online, atMs } → upsert network_off_events
//   forceStopDetected { lastSeenMs, relaunchMs, gapMs }
//                                          → insert force_stop_events
//
// Heartbeat: a setInterval keeps the native plugin's SharedPreferences
// last_heartbeat_ms current. On next app launch, native compares to
// `now`; gap > 5 min during work-day hours = force_stop.
//
// Web build: every call is a silent no-op. Capacitor.isNativePlatform()
// false on browser. The init() function early-returns.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabase'

const Tracking = registerPlugin('UntitledTracking')

let initialised = false
let heartbeatId = null
let openGpsOffRowId = null
let openNetOffRowId = null

/**
 * Bootstrap once at app start. Idempotent — safe to call multiple
 * times. No-op on web.
 */
export function initNativeTracking(getUserId) {
  if (initialised) return
  if (!Capacitor.isNativePlatform()) return
  initialised = true

  // ─── 60-second heartbeat to native SharedPreferences ──────────
  heartbeatId = setInterval(() => {
    try { Tracking.bumpHeartbeat?.() } catch { /* */ }
  }, 60 * 1000)
  // Fire one immediately so SharedPreferences is fresh.
  try { Tracking.bumpHeartbeat?.() } catch { /* */ }

  // ─── GPS toggle ───────────────────────────────────────────────
  Tracking.addListener?.('gpsStateChanged', async ({ enabled, atMs }) => {
    const userId = await safeUserId(getUserId)
    if (!userId) return
    try {
      if (!enabled) {
        // GPS turned OFF — insert a new event row, keep id so we
        // can close it when GPS comes back.
        const { data, error } = await supabase
          .from('gps_off_events')
          .insert([{
            user_id: userId,
            toggled_off_at: new Date(atMs).toISOString(),
          }])
          .select()
          .single()
        if (!error && data) openGpsOffRowId = data.id
      } else if (openGpsOffRowId) {
        // GPS back ON — close the open row.
        const toggledOnAt = new Date(atMs)
        await supabase
          .from('gps_off_events')
          .update({
            toggled_on_at: toggledOnAt.toISOString(),
          })
          .eq('id', openGpsOffRowId)
        openGpsOffRowId = null
      }
    } catch (e) {
      console.warn('[tracking] gpsStateChanged write failed:', e?.message || e)
    }
  })

  // ─── Network state ────────────────────────────────────────────
  Tracking.addListener?.('networkStateChanged', async ({ online, atMs }) => {
    const userId = await safeUserId(getUserId)
    if (!userId) return
    try {
      if (!online) {
        const { data, error } = await supabase
          .from('network_off_events')
          .insert([{
            user_id: userId,
            lost_at: new Date(atMs).toISOString(),
          }])
          .select()
          .single()
        if (!error && data) openNetOffRowId = data.id
      } else if (openNetOffRowId) {
        await supabase
          .from('network_off_events')
          .update({
            regained_at: new Date(atMs).toISOString(),
          })
          .eq('id', openNetOffRowId)
        openNetOffRowId = null
      }
    } catch (e) {
      console.warn('[tracking] networkStateChanged write failed:', e?.message || e)
    }
  })

  // ─── Force-stop detection (fires once on app relaunch) ────────
  Tracking.addListener?.('forceStopDetected', async ({ lastSeenMs, relaunchMs, gapMs }) => {
    const userId = await safeUserId(getUserId)
    if (!userId) return
    try {
      // Compute during_work_hours flag client-side (10:00-19:00 IST).
      const relaunch = new Date(relaunchMs)
      const istHour = parseInt(
        relaunch.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }),
        10,
      )
      const duringWorkHours = istHour >= 10 && istHour < 19
      await supabase
        .from('force_stop_events')
        .insert([{
          user_id: userId,
          last_seen_at: new Date(lastSeenMs).toISOString(),
          relaunched_at: relaunch.toISOString(),
          gap_seconds: Math.round(gapMs / 1000),
          during_work_hours: duringWorkHours,
        }])
    } catch (e) {
      console.warn('[tracking] forceStopDetected write failed:', e?.message || e)
    }
  })
}

export function teardownNativeTracking() {
  if (heartbeatId) {
    clearInterval(heartbeatId)
    heartbeatId = null
  }
  initialised = false
}

async function safeUserId(getUserId) {
  try {
    if (typeof getUserId === 'function') return await getUserId()
    return null
  } catch {
    return null
  }
}
