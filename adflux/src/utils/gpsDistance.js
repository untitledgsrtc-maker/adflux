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


// Phase 61.3 (19 May 2026) — owner-reported issue: rep day track
// map showed all 394 raw pings + every drift point connected by a
// polyline, so the visualization looked like clusters of dots
// instead of a clean route. cleanTrack returns the filtered ping
// sequence used for polyline rendering. Same accuracy + drift +
// speed thresholds as summariseTrack so the line on the map agrees
// with the km number.
export function cleanTrack(pings) {
  if (!Array.isArray(pings) || pings.length === 0) return []

  // Accuracy filter (matches summariseTrack).
  const usableStrict = pings.filter((p) => {
    const acc = Number(p.accuracy_m)
    return !Number.isFinite(acc) || acc <= MAX_ACC_M
  })
  const tooMuchDropped = pings.length > 0
    && usableStrict.length < Math.floor(pings.length * 0.5)
  const usable = tooMuchDropped ? pings.slice() : usableStrict
  if (usable.length === 0) return []

  // Drop drift (sub-30m) + speed-spike segments. Walk forward,
  // keeping only pings that represent real movement.
  const out = [usable[0]]
  for (let i = 1; i < usable.length; i++) {
    const a = out[out.length - 1]
    const b = usable[i]
    const seg = haversineKm(
      { lat: Number(a.lat), lng: Number(a.lng) },
      { lat: Number(b.lat), lng: Number(b.lng) },
    )
    const dtMs  = new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    const dtSec = Math.max(1, dtMs / 1000)
    const speed = seg / dtSec
    if (seg < MIN_SEG_KM)         continue   // drift
    if (speed > MAX_SEG_KM_PER_S) continue   // spike
    out.push(b)
  }
  return out
}


// Phase 61.3 — detect "stops" where the rep stayed within a small
// radius for at least minMinutes. A stop is a sequence of pings
// where consecutive points are < radiusM apart AND the total dwell
// time spans >= minMinutes.
//
// Returns: [{ id, lat, lng, started_at, ended_at, minutes }]
// id starts at 1 so markers can show "1", "2", "3" like the
// owner's reference UI.
//
// Heuristic — naive but good enough for a 1-day track. Greedy:
//   1. Start a candidate at ping[0].
//   2. Extend while next ping is within radiusM of the candidate
//      centroid AND time gap < 30 min (so a parked phone we lost
//      doesn't merge with the next morning).
//   3. If dwell >= minMinutes, emit a stop centered on the
//      candidate's mean lat/lng.
//   4. Otherwise discard the candidate and seek the next start.
export function detectStops(pings, opts = {}) {
  const radiusM     = opts.radiusM     ?? 80      // 80 m clustering radius
  const minMinutes  = opts.minMinutes  ?? 10      // 10 min dwell threshold
  const maxGapMins  = opts.maxGapMins  ?? 30      // break if data missing >30 min
  if (!Array.isArray(pings) || pings.length === 0) return []

  // Use the same accuracy filter as the polyline so noise doesn't
  // create phantom stops.
  const filtered = pings.filter((p) => {
    const acc = Number(p.accuracy_m)
    return !Number.isFinite(acc) || acc <= MAX_ACC_M
  })
  if (filtered.length === 0) return []

  const stops = []
  let cluster = [filtered[0]]
  const mean = (rows) => {
    let lat = 0, lng = 0
    for (const r of rows) { lat += Number(r.lat); lng += Number(r.lng) }
    return { lat: lat / rows.length, lng: lng / rows.length }
  }
  const finalise = () => {
    if (cluster.length < 2) return
    const start = new Date(cluster[0].captured_at).getTime()
    const end   = new Date(cluster[cluster.length - 1].captured_at).getTime()
    const mins  = (end - start) / 60000
    if (mins < minMinutes) return
    const c = mean(cluster)
    stops.push({
      id:         stops.length + 1,
      lat:        c.lat,
      lng:        c.lng,
      started_at: cluster[0].captured_at,
      ended_at:   cluster[cluster.length - 1].captured_at,
      minutes:    Math.round(mins),
    })
  }
  for (let i = 1; i < filtered.length; i++) {
    const p = filtered[i]
    const c = mean(cluster)
    const distKm = haversineKm(c, { lat: Number(p.lat), lng: Number(p.lng) })
    const prev = cluster[cluster.length - 1]
    const gapM = (new Date(p.captured_at).getTime() - new Date(prev.captured_at).getTime()) / 60000
    if (distKm * 1000 <= radiusM && gapM <= maxGapMins) {
      cluster.push(p)
    } else {
      finalise()
      cluster = [p]
    }
  }
  finalise()
  return stops
}
