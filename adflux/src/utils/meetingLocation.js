// Meeting location rule: a counted meeting must be logged within 100 m of the client.
//
//   - The client's location is the Google listing pin saved on the lead when the rep picks the
//     listing (leads.lat / lng with geocode_source = 'google_place'). Other coordinates on old
//     leads are city-level lookups and are NOT trusted.
//   - Blocked only when (distance - GPS accuracy) is over 100 m, so a weak fix does not block a
//     rep who is really there.
//   - No trusted pin (no listing picked, old lead) = allowed, "unverified".
//   - A blocked rep can request admin approval; one approval covers the same rep + same pin for
//     12 hours (Phase 535, meeting_location_requests).

import { supabase } from '../lib/supabase'

export const MEETING_RADIUS_M = 100
const APPROVAL_VALID_MS = 12 * 60 * 60 * 1000
const SAME_PIN_M = 5

export function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

// pin: { lat, lng } or null. gps: { lat, lng, acc }.
// -> { status: 'unverified' | 'ok' | 'blocked', distanceM, effectiveM }
export function evaluateMeetingLocation(pin, gps) {
  if (!pin || !Number.isFinite(Number(pin.lat)) || !Number.isFinite(Number(pin.lng))) return { status: 'unverified' }
  if (!gps || !Number.isFinite(Number(gps.lat)) || !Number.isFinite(Number(gps.lng))) return { status: 'unverified' }
  const d = distanceM(Number(gps.lat), Number(gps.lng), Number(pin.lat), Number(pin.lng))
  // Credit the rep's GPS accuracy, but never more than 150 m: a coarse cell-tower fix (km) must not make a far-away meeting pass.
  const eff = Math.max(0, d - Math.min(Number(gps.acc) || 0, 150))
  return { status: eff > MEETING_RADIUS_M ? 'blocked' : 'ok', distanceM: d, effectiveM: eff }
}

// Pin + context of an existing lead for the follow-up path. The pin is dropped (= not checked) for
// GOVERNMENT leads and when the typed company is not the lead's company (a phone match can be a
// different branch of the same chain).
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
export async function getFollowUpPin(leadId, typedCompany) {
  if (!leadId) return null
  const { data, error } = await supabase.from('leads')
    .select('lat, lng, geocode_source, segment, company').eq('id', leadId).maybeSingle()
  if (error || !data) return null
  if (data.geocode_source !== 'google_place' || data.lat == null || data.lng == null) return null
  if (data.segment === 'GOVERNMENT') return null
  const a = norm(data.company), b = norm(typedCompany)
  if (a.length < 4 || b.length < 4 || !(a.includes(b) || b.includes(a))) return null
  return { lat: Number(data.lat), lng: Number(data.lng) }
}

// Latest request by this rep for this pin in the last 12 h: 'approved' | 'pending' | 'rejected' | null.
export async function findRequestStatus(userId, pin) {
  const since = new Date(Date.now() - APPROVAL_VALID_MS).toISOString()
  const { data } = await supabase.from('meeting_location_requests')
    .select('id, status, pin_lat, pin_lng, created_at')
    .eq('user_id', userId).gte('created_at', since)
    .order('created_at', { ascending: false })
  const same = (data || []).filter(r => distanceM(Number(r.pin_lat), Number(r.pin_lng), pin.lat, pin.lng) <= SAME_PIN_M)
  if (!same.length) return null
  if (same.some(r => r.status === 'approved')) return 'approved'
  return same[0].status
}

export async function requestLocationApproval({ userId, leadId, company, pin, gps, distanceMeters, reason }) {
  const { error } = await supabase.from('meeting_location_requests').insert([{
    user_id: userId,
    lead_id: leadId || null,
    company: company || null,
    pin_lat: pin.lat,
    pin_lng: pin.lng,
    rep_lat: gps.lat,
    rep_lng: gps.lng,
    rep_accuracy_m: gps.acc ?? null,
    distance_m: distanceMeters,
    reason: reason.trim(),
  }])
  return { error }
}

// One call for the save handlers: { allow: true, unverified?: true } or
// { allow: false, distanceM, requestStatus: 'pending' | 'rejected' | null }.
export async function checkMeetingLocation({ userId, pin, gps }) {
  const ev = evaluateMeetingLocation(pin, gps)
  if (ev.status === 'unverified') return { allow: true, unverified: true }
  if (ev.status === 'ok') return { allow: true }
  const req = await findRequestStatus(userId, pin)
  if (req === 'approved') return { allow: true, approved: true }
  return { allow: false, distanceM: ev.distanceM, requestStatus: req }
}
