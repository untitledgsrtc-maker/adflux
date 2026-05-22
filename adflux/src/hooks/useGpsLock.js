// src/hooks/useGpsLock.js
//
// Phase 76 — single source of truth for "is the rep's GPS toggle
// currently on" + "what tracking events have happened today".
//
// Web/PWA: detects GPS state by attempting `getCurrentPosition` with
//   a short timeout. If permission denied or settings off, code
//   PERMISSION_DENIED (1) or POSITION_UNAVAILABLE (2) tells us.
//   This is best-effort; the browser cannot detect a system-level
//   GPS toggle as cleanly as the native plugin can.
//
// Native APK: the Phase 76.2 TrackingPlugin exposes
//   window.UntitledTracking.{isGpsOn, requestEnableGps, addListener}
//   The plugin's LocationManager.MODE_CHANGED_ACTION receiver gives
//   us an exact yes/no without round-tripping geolocation.
//
// Falls back to web probe when the native bridge isn't present.

import { useCallback, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

const NATIVE_BRIDGE_NAME = 'UntitledTracking'

function readNativePlugin() {
  if (typeof window === 'undefined') return null
  // Phase 76.2 plugin registers itself on window. Defensive check —
  // the plugin may not be loaded in dev/web builds.
  const plug = window?.UntitledTracking
  return plug && typeof plug.isGpsOn === 'function' ? plug : null
}

async function probeWebGps() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => { if (!settled) { settled = true; resolve(ok) } }
    try {
      navigator.geolocation.getCurrentPosition(
        () => finish(true),
        (err) => {
          // err.code: 1=denied, 2=unavailable, 3=timeout
          // 1 + 2 = GPS off / no permission → false
          // 3 (timeout) = signal weak but service on → true
          finish(err?.code === 3)
        },
        { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 },
      )
    } catch {
      finish(false)
    }
  })
}

/**
 * @returns {{
 *   gpsOn: boolean | null,    // null until first probe completes
 *   loading: boolean,
 *   requestEnable: () => Promise<boolean>,
 *   refresh: () => Promise<void>,
 *   isNative: boolean,
 * }}
 */
export default function useGpsLock() {
  const [gpsOn, setGpsOn] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isNative] = useState(() => Capacitor?.isNativePlatform?.() || false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const plug = readNativePlugin()
      if (plug) {
        const { value } = await plug.isGpsOn()
        setGpsOn(!!value)
      } else {
        setGpsOn(await probeWebGps())
      }
    } catch {
      setGpsOn(false)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Trigger the system "Turn on Location" dialog. On native, the
   * plugin invokes SettingsClient.checkLocationSettings which shows
   * a one-tap-enable prompt without leaving the app. On web, the
   * browser will re-prompt for geolocation permission; if the OS
   * toggle is off, the browser cannot fix that — rep must go to
   * Settings. Returns true if GPS appears on after the request.
   */
  const requestEnable = useCallback(async () => {
    const plug = readNativePlugin()
    if (plug && typeof plug.requestEnableGps === 'function') {
      try {
        await plug.requestEnableGps()
      } catch (e) {
        console.warn('[useGpsLock] requestEnableGps failed:', e?.message || e)
      }
    } else {
      // Web fallback — re-probe (the browser may show a permission
      // sheet on first call after denial).
      await probeWebGps()
    }
    await refresh()
    return !!gpsOn
  }, [refresh, gpsOn])

  useEffect(() => {
    refresh()
    // Re-probe when the app becomes visible (tab resume).
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    // Native plugin event subscription — re-render the instant the
    // rep flips Location off/on without waiting for a probe.
    let listenerHandle = null
    const plug = readNativePlugin()
    if (plug && typeof plug.addListener === 'function') {
      try {
        listenerHandle = plug.addListener('gpsStateChanged', (evt) => {
          setGpsOn(!!evt?.enabled)
        })
      } catch (e) {
        console.warn('[useGpsLock] addListener failed:', e?.message || e)
      }
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      try { listenerHandle && listenerHandle.remove && listenerHandle.remove() } catch {}
    }
  }, [refresh])

  return { gpsOn, loading, requestEnable, refresh, isNative }
}
