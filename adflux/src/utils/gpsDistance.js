// src/utils/gpsDistance.js
//
// Phase 34Z.6 — shared GPS distance utility.
//
// Pulled out of GpsTrackV2 so /work can show the rep their own
// distance traveled today without duplicating the filtering logic
// (which has been tuned over Phase 34I / 34U). One source of truth
// for "how many km did this person drive today".
//
// Owner's mental model (14 May 2026):
//   "from a to b distance plus b to c distance plus c to d distance
//    plus d to e... like that. So all the total kilometer will be
//    counted."
//
// That's exactly what `summariseTrack` does — straight-line haversine
// between each consecutive ping, summed, with a few sanity filters so
// stationary GPS drift doesn't inflate the number.

// Straight-line km between two lat/lng pairs.
export function haversineKm(a, b) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// Filtering rules — kept in sync with GpsTrackV2's `stats` memo.
// Tweak in ONE place from now on.
export const MIN_SEG_KM       = 0.03           // 30 m — drift floor
export const MAX_SEG_KM_PER_S = 200 / 3600     // 200 km/h ceiling
export const MAX_DAILY_KM     = 600            // sanity cap
export const MAX_ACC_M        = 100            // accuracy filter

// Input: pings array sorted by captured_at ASC, each with
// { lat, lng, captured_at, accuracy_m }.
// Output: { km, kmRaw, pings, usablePings, droppedSegs, capped }.
//
// Behaviour mirrors the loosened accuracy gate from Phase 34U: if
// applying the 100m accuracy filter would discard more than half the
// pings, fall back to using ALL pings (the day had patchy signal,
// dropping everything would show a false zero).
export function summariseTrack(pings) {
  if (!Array.isArray(pings) || pings.length === 0) {
    return { km: '0.0', kmRaw: '0.0', pings: 0, usablePings: 0, droppedSegs: 0, capped: false }
  }

  const usableStrict = pings.filter((p) => {
    const acc = Number(p.accuracy_m)
    return !Number.isFinite(acc) || acc <= MAX_ACC_M
  })
  const tooMuchDropped = pings.length > 0
    && usableStrict.length < Math.floor(pings.length * 0.5)
  const usable = tooMuchDropped ? pings.slice() : usableStrict

  let kmRaw = 0
  let kmKept = 0
  let dropped = 0

  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1]
    const b = usable[i]
    const seg = haversineKm(
      { lat: Number(a.lat), lng: Number(a.lng) },
      { lat: Number(b.lat), lng: Number(b.lng) },
    )
    kmRaw += seg
    const dtMs = new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    const dtSec = Math.max(1, dtMs / 1000)
    const speed = seg / dtSec
    if (seg < MIN_SEG_KM)         { dropped++; continue }
    if (speed > MAX_SEG_KM_PER_S) { dropped++; continue }
    kmKept += seg
  }

  const kmCapped = Math.min(kmKept, MAX_DAILY_KM)

  return {
    km:           kmCapped.toFixed(1),
    kmRaw:        kmRaw.toFixed(1),
    pings:        pings.length,
    usablePings:  usable.length,
    droppedSegs:  dropped,
    capped:       kmKept > MAX_DAILY_KM,
  }
}
