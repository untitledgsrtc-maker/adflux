// src/utils/captureGps.js
//
// Phase 93.17 (26 May 2026) — resilient GPS capture with 2-stage
// fallback. Owner reported (25 May 2026): "Could not capture GPS:
// Timeout expired" blocked Kirti on weak signal.
//
// Strategy:
//   1. Low-accuracy attempt (cell tower / wifi) — 8s timeout, allows
//      60s-cached fix. Usually resolves in <1s.
//   2. If (1) fails: high-accuracy attempt (GPS satellite) — 20s
//      timeout, fresh fix.
//   3. If both fail: query gps_pings for the rep's most recent ping
//      within the last 10 min and return that as a fallback. Caller
//      sees a `fallback: true` flag so it can warn the rep.
//   4. If no recent ping either: return { error, allowRetry: true }
//      so the UI can render a Retry button instead of a dead-end
//      "Timeout expired" banner.
//
// Six prior call sites that used raw navigator.geolocation directly
// (LeadDetailV2, LeadFormV2, LogMeetingModal × 2, LogActivityModal
// × 2) all migrate to this helper.

import { supabase } from '../lib/supabase'

const STALE_FALLBACK_MIN = 10  // gps_pings older than this not used as fallback

function getPositionOnce(opts) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation API unavailable on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, opts)
  })
}

/**
 * captureGps — 2-stage capture + DB fallback + retry-friendly error.
 *
 * @param {object} opts
 * @param {string} [opts.userId]               — rep's auth id. Only required when fallback to gps_pings should fire.
 * @param {number} [opts.lowAccuracyTimeout=8000]
 * @param {number} [opts.highAccuracyTimeout=20000]
 * @param {boolean} [opts.skipLowAccuracy=false] — for callers that need a fresh fix (e.g. "I'm here")
 * @param {boolean} [opts.allowFallback=true]   — set false to never use gps_pings fallback
 * @returns {Promise<{
 *   coords?: { lat: number, lng: number, accuracy: number | null },
 *   source?: 'low' | 'high' | 'fallback',
 *   error?: string,
 *   allowRetry?: boolean,
 *   fallbackAgeMin?: number,
 * }>}
 */
export async function captureGps(opts = {}) {
  const {
    userId,
    lowAccuracyTimeout = 8000,
    highAccuracyTimeout = 20000,
    skipLowAccuracy = false,
    allowFallback = true,
  } = opts

  // Stage 1 — low-accuracy quick fix (cell tower / wifi). Allowed for
  // most save flows; only "I'm here" passes skipLowAccuracy=true so it
  // gets a real GPS satellite reading.
  if (!skipLowAccuracy) {
    try {
      const pos = await getPositionOnce({
        enableHighAccuracy: false,
        timeout: lowAccuracyTimeout,
        maximumAge: 60000,
      })
      return {
        coords: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy) || null,
        },
        source: 'low',
      }
    } catch (_) {
      // fall through to stage 2
    }
  }

  // Stage 2 — high-accuracy attempt (GPS satellite).
  try {
    const pos = await getPositionOnce({
      enableHighAccuracy: true,
      timeout: highAccuracyTimeout,
      maximumAge: 0,
    })
    return {
      coords: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy) || null,
      },
      source: 'high',
    }
  } catch (e) {
    // Stage 3 — DB fallback if rep id available.
    if (allowFallback && userId) {
      try {
        const sinceISO = new Date(Date.now() - STALE_FALLBACK_MIN * 60 * 1000).toISOString()
        const { data } = await supabase
          .from('gps_pings')
          .select('lat, lng, accuracy_m, captured_at')
          .eq('user_id', userId)
          .gte('captured_at', sinceISO)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (data?.lat && data?.lng) {
          const ageMin = Math.floor(
            (Date.now() - new Date(data.captured_at).getTime()) / 60000,
          )
          return {
            coords: {
              lat: data.lat,
              lng: data.lng,
              accuracy: data.accuracy_m || null,
            },
            source: 'fallback',
            fallbackAgeMin: ageMin,
          }
        }
      } catch (_) {
        // ignore — proceed to error path
      }
    }
    return {
      error: e?.message || 'Location unavailable.',
      allowRetry: true,
    }
  }
}

/**
 * captureGpsLegacy — drop-in replacement for the older inline pattern
 * that returned `{ lat, lng, accuracy } | null`. Used by call sites
 * that don't need the source flag.
 */
export async function captureGpsLegacy(opts = {}) {
  const result = await captureGps(opts)
  if (result.coords) return result.coords
  return null
}
