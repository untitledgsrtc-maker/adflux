// src/utils/nativeTracking.js
//
// Phase 76.2 — JS shim for the UntitledTracking Capacitor plugin
// (android/app/src/main/java/in/untitledad/app/TrackingPlugin.java).
// Phase 76.2.2 — Tier A + B hardening (23 May 2026 evening):
//   - Cache user ID + auth-state-change listener (was fetching on
//     every event, dropped events on flaky network).
//   - Await Tracking.addListener so registration failures surface.
//   - Recover openGpsOffRowId / openNetOffRowId from Supabase on
//     init so page reload doesn't orphan open events.
//   - Offline queue (Capacitor Preferences) for events when
//     Supabase insert fails — drained on next online event.
//   - Verbose console logs replacing silent catch blocks.
//
// Events handled
//   gpsStateChanged   { enabled, atMs }  → upsert gps_off_events
//   networkStateChanged { online, atMs } → upsert network_off_events
//   forceStopDetected { lastSeenMs, relaunchMs, gapMs }
//                                          → insert force_stop_events
//
// Web build: every call is a silent no-op. Capacitor.isNativePlatform()
// false on browser. init() early-returns.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { supabase } from '../lib/supabase'

const Tracking = registerPlugin('UntitledTracking')

const QUEUE_KEY = 'untitled_tracking_queue_v1'

let initialised = false
let heartbeatId = null
let cachedUserId = null
let openGpsOffRowId = null
let openNetOffRowId = null
let listenerHandles = []
let authSub = null

/**
 * Bootstrap once at app start. Idempotent — safe to call multiple
 * times. No-op on web.
 */
export async function initNativeTracking() {
  if (initialised) return
  if (!Capacitor.isNativePlatform()) {
    console.debug('[tracking] web build — init no-op')
    return
  }
  initialised = true
  console.debug('[tracking] init begin')

  // ─── Cache user ID + watch auth state ─────────────────────────
  try {
    const { data } = await supabase.auth.getUser()
    cachedUserId = data?.user?.id || null
  } catch (e) {
    console.warn('[tracking] initial auth fetch failed:', e?.message || e)
  }
  try {
    authSub = supabase.auth.onAuthStateChange((_event, session) => {
      cachedUserId = session?.user?.id || null
      console.debug('[tracking] auth state changed, userId=' + cachedUserId)
    })
  } catch (e) {
    console.warn('[tracking] auth subscribe failed:', e?.message || e)
  }

  // ─── Recover open event row IDs from Supabase ────────────────
  // Page reload would otherwise drop in-memory row IDs and leave
  // open events orphaned forever.
  if (cachedUserId) {
    try {
      const { data: openGps } = await supabase
        .from('gps_off_events')
        .select('id')
        .eq('user_id', cachedUserId)
        .is('toggled_on_at', null)
        .order('toggled_off_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openGps?.id) {
        openGpsOffRowId = openGps.id
        console.debug('[tracking] recovered openGpsOffRowId=' + openGpsOffRowId)
      }
      const { data: openNet } = await supabase
        .from('network_off_events')
        .select('id')
        .eq('user_id', cachedUserId)
        .is('regained_at', null)
        .order('lost_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openNet?.id) {
        openNetOffRowId = openNet.id
        console.debug('[tracking] recovered openNetOffRowId=' + openNetOffRowId)
      }
    } catch (e) {
      console.warn('[tracking] open row recovery failed:', e?.message || e)
    }
  }

  // ─── Drain any queued events from a previous offline session ──
  drainQueue().catch(e =>
    console.warn('[tracking] drain queue failed:', e?.message || e))

  // ─── 60-second JS heartbeat (Java mirrors via Activity.onResume) ──
  heartbeatId = setInterval(() => {
    Tracking.bumpHeartbeat?.()
      .catch(e => console.warn('[tracking] heartbeat failed:', e?.message || e))
  }, 60 * 1000)
  Tracking.bumpHeartbeat?.()
    .catch(e => console.warn('[tracking] heartbeat (initial) failed:', e?.message || e))

  // ─── Subscribe to native events (await so failures surface) ──
  try {
    listenerHandles.push(
      await Tracking.addListener('gpsStateChanged', handleGpsStateChanged)
    )
    console.debug('[tracking] gpsStateChanged listener registered')
  } catch (e) {
    console.error('[tracking] gpsStateChanged subscribe failed:', e?.message || e)
  }
  try {
    listenerHandles.push(
      await Tracking.addListener('networkStateChanged', handleNetworkStateChanged)
    )
    console.debug('[tracking] networkStateChanged listener registered')
  } catch (e) {
    console.error('[tracking] networkStateChanged subscribe failed:', e?.message || e)
  }
  try {
    listenerHandles.push(
      await Tracking.addListener('forceStopDetected', handleForceStopDetected)
    )
    console.debug('[tracking] forceStopDetected listener registered')
  } catch (e) {
    console.error('[tracking] forceStopDetected subscribe failed:', e?.message || e)
  }

  console.debug('[tracking] init complete')
}

// ─── Event handlers ────────────────────────────────────────────

async function handleGpsStateChanged({ enabled, atMs }) {
  console.debug('[tracking] gpsStateChanged enabled=' + enabled)
  const userId = await safeUserId()
  if (!userId) {
    console.warn('[tracking] no userId — queueing gps event')
    await enqueue({ type: 'gps', enabled, atMs })
    return
  }
  if (!enabled) {
    const inserted = await insertGpsOff(userId, atMs)
    if (inserted?.id) openGpsOffRowId = inserted.id
  } else if (openGpsOffRowId) {
    await closeGpsOff(openGpsOffRowId, atMs)
    openGpsOffRowId = null
  }
}

async function handleNetworkStateChanged({ online, atMs }) {
  console.debug('[tracking] networkStateChanged online=' + online)
  const userId = await safeUserId()
  if (!userId) {
    await enqueue({ type: 'network', online, atMs })
    return
  }
  if (!online) {
    const inserted = await insertNetOff(userId, atMs)
    if (inserted?.id) openNetOffRowId = inserted.id
  } else if (openNetOffRowId) {
    await closeNetOff(openNetOffRowId, atMs)
    openNetOffRowId = null
  }
}

async function handleForceStopDetected({ lastSeenMs, relaunchMs, gapMs }) {
  console.debug('[tracking] forceStopDetected gap=' + gapMs + 'ms')
  const userId = await safeUserId()
  if (!userId) {
    await enqueue({ type: 'force_stop', lastSeenMs, relaunchMs, gapMs })
    return
  }
  await insertForceStop(userId, lastSeenMs, relaunchMs, gapMs)
}

// ─── Supabase writers (return inserted row or null on error) ──

async function insertGpsOff(userId, atMs) {
  try {
    const { data, error } = await supabase
      .from('gps_off_events')
      .insert([{
        user_id: userId,
        toggled_off_at: new Date(atMs).toISOString(),
      }])
      .select()
      .single()
    if (error) {
      console.warn('[tracking] gps_off insert error:', error.message)
      await enqueue({ type: 'gps', enabled: false, atMs })
      return null
    }
    return data
  } catch (e) {
    console.warn('[tracking] gps_off insert threw:', e?.message || e)
    await enqueue({ type: 'gps', enabled: false, atMs })
    return null
  }
}

async function closeGpsOff(rowId, atMs) {
  try {
    const { error } = await supabase
      .from('gps_off_events')
      .update({ toggled_on_at: new Date(atMs).toISOString() })
      .eq('id', rowId)
    if (error) {
      console.warn('[tracking] gps_off close error:', error.message)
      await enqueue({ type: 'gps_close', rowId, atMs })
    }
  } catch (e) {
    console.warn('[tracking] gps_off close threw:', e?.message || e)
    await enqueue({ type: 'gps_close', rowId, atMs })
  }
}

async function insertNetOff(userId, atMs) {
  try {
    const { data, error } = await supabase
      .from('network_off_events')
      .insert([{
        user_id: userId,
        lost_at: new Date(atMs).toISOString(),
      }])
      .select()
      .single()
    if (error) {
      console.warn('[tracking] net_off insert error:', error.message)
      await enqueue({ type: 'network', online: false, atMs })
      return null
    }
    return data
  } catch (e) {
    console.warn('[tracking] net_off insert threw:', e?.message || e)
    await enqueue({ type: 'network', online: false, atMs })
    return null
  }
}

async function closeNetOff(rowId, atMs) {
  try {
    const { error } = await supabase
      .from('network_off_events')
      .update({ regained_at: new Date(atMs).toISOString() })
      .eq('id', rowId)
    if (error) {
      console.warn('[tracking] net_off close error:', error.message)
      await enqueue({ type: 'net_close', rowId, atMs })
    }
  } catch (e) {
    console.warn('[tracking] net_off close threw:', e?.message || e)
    await enqueue({ type: 'net_close', rowId, atMs })
  }
}

async function insertForceStop(userId, lastSeenMs, relaunchMs, gapMs) {
  try {
    const relaunch = new Date(relaunchMs)
    let duringWorkHours = false
    try {
      const istHour = parseInt(
        relaunch.toLocaleString('en-GB', {
          timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
        }),
        10,
      )
      duringWorkHours = Number.isFinite(istHour) && istHour >= 10 && istHour < 19
    } catch {
      // Locale / Intl missing → leave as false (defensive).
    }
    const { error } = await supabase
      .from('force_stop_events')
      .insert([{
        user_id: userId,
        last_seen_at: new Date(lastSeenMs).toISOString(),
        relaunched_at: relaunch.toISOString(),
        gap_seconds: Math.round(gapMs / 1000),
        during_work_hours: duringWorkHours,
      }])
    if (error) {
      console.warn('[tracking] force_stop insert error:', error.message)
      await enqueue({ type: 'force_stop', lastSeenMs, relaunchMs, gapMs })
    }
  } catch (e) {
    console.warn('[tracking] force_stop insert threw:', e?.message || e)
    await enqueue({ type: 'force_stop', lastSeenMs, relaunchMs, gapMs })
  }
}

// ─── Offline queue (Capacitor Preferences) ─────────────────────
// Events failed to write → stash in Preferences. Drain on next
// init or successful event.

async function enqueue(entry) {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const cur = await Preferences.get({ key: QUEUE_KEY })
    let queue = []
    if (cur.value) {
      try { queue = JSON.parse(cur.value) } catch { queue = [] }
    }
    queue.push({ ...entry, qAt: Date.now() })
    // Cap at 500 entries — drop oldest if over.
    if (queue.length > 500) queue = queue.slice(-500)
    await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(queue) })
    console.debug('[tracking] enqueued event, queue length=' + queue.length)
  } catch (e) {
    console.warn('[tracking] enqueue failed:', e?.message || e)
  }
}

async function drainQueue() {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const cur = await Preferences.get({ key: QUEUE_KEY })
    if (!cur.value) return
    let queue = []
    try { queue = JSON.parse(cur.value) } catch { return }
    if (!queue.length) return
    console.debug('[tracking] draining queue, length=' + queue.length)
    const userId = await safeUserId()
    if (!userId) {
      console.warn('[tracking] cannot drain — no userId')
      return
    }
    const remaining = []
    for (const e of queue) {
      let ok = false
      try {
        if (e.type === 'gps' && !e.enabled) {
          const r = await insertGpsOff(userId, e.atMs)
          ok = !!r
        } else if (e.type === 'gps_close') {
          await closeGpsOff(e.rowId, e.atMs); ok = true
        } else if (e.type === 'network' && !e.online) {
          const r = await insertNetOff(userId, e.atMs)
          ok = !!r
        } else if (e.type === 'net_close') {
          await closeNetOff(e.rowId, e.atMs); ok = true
        } else if (e.type === 'force_stop') {
          await insertForceStop(userId, e.lastSeenMs, e.relaunchMs, e.gapMs); ok = true
        }
      } catch (err) {
        console.warn('[tracking] drain entry failed:', err?.message || err)
      }
      if (!ok) remaining.push(e)
    }
    await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(remaining) })
    console.debug('[tracking] drain complete, remaining=' + remaining.length)
  } catch (e) {
    console.warn('[tracking] drain failed:', e?.message || e)
  }
}

async function safeUserId() {
  if (cachedUserId) return cachedUserId
  try {
    const { data } = await supabase.auth.getUser()
    cachedUserId = data?.user?.id || null
  } catch {
    cachedUserId = null
  }
  return cachedUserId
}

export async function teardownNativeTracking() {
  if (heartbeatId) {
    clearInterval(heartbeatId)
    heartbeatId = null
  }
  for (const h of listenerHandles) {
    try { await h?.remove?.() } catch { /* */ }
  }
  listenerHandles = []
  try { authSub?.data?.subscription?.unsubscribe?.() } catch { /* */ }
  authSub = null
  initialised = false
}
