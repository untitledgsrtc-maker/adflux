// src/utils/geocode.js
//
// Phase 34G — geocode lead addresses to lat/lng so the /work map
// view can plot pins. Uses Nominatim (OpenStreetMap) — free, no API
// key, but rate-limited to ~1 request per second per their TOS.
//
// We also keep a localStorage cache keyed on the address text so
// repeated lookups (rep opens map every day) don't hammer the
// service. Cache TTL = 30 days — addresses don't move.
//
// On success we call the Supabase RPC `set_lead_geocode` to persist
// the lat/lng to the row, so future loads bypass the geocoder
// entirely.
//
// Usage:
//   import { geocodeAddress } from '../utils/geocode'
//   const { lat, lng, source } = await geocodeAddress('Sayajigunj, Vadodara, Gujarat')
//
//   import { geocodeAndPersistLead } from '../utils/geocode'
//   await geocodeAndPersistLead({ id, address: '...', city: '...' })

import { supabase } from '../lib/supabase'

const CACHE_PREFIX = 'geocode:'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days
const USER_AGENT = 'UntitledOS-AdFlux/1.0 (https://untitledad.in)'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

// Throttle to one outgoing request at a time per Nominatim TOS
// (1 req/sec). Subsequent calls wait via a queued promise chain.
let lastRequestAt = 0
const MIN_GAP_MS = 1100

async function throttle() {
  const now = Date.now()
  const wait = Math.max(0, MIN_GAP_MS - (now - lastRequestAt))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

function cacheKey(query) {
  return CACHE_PREFIX + query.toLowerCase().trim()
}

function readCache(query) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(cacheKey(query))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.ts) return null
    if (Date.now() - parsed.ts > CACHE_TTL_MS) {
      window.localStorage.removeItem(cacheKey(query))
      return null
    }
    return parsed.value  // {lat, lng} or null (negative cache)
  } catch {
    return null
  }
}

function writeCache(query, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(cacheKey(query), JSON.stringify({ ts: Date.now(), value }))
  } catch { /* quota / blocked — ignore */ }
}

/**
 * Geocode a free-text address. Returns null if Nominatim found no
 * result. Throws on network error so caller can decide to retry.
 *
 * @param {string} address
 * @returns {Promise<{lat: number, lng: number, source: string} | null>}
 */
export async function geocodeAddress(address) {
  const query = (address || '').trim()
  if (!query) return null

  // Cache hit (positive or negative)
  const cached = readCache(query)
  if (cached !== null) return cached  // may be null for negative cache

  await throttle()

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    countrycodes: 'in',  // bias to India
    addressdetails: '0',
  })

  let json
  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
    })
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)
    json = await res.json()
  } catch (e) {
    // Network failure — DO NOT negative-cache; allow retry.
    throw e
  }

  if (!Array.isArray(json) || json.length === 0) {
    writeCache(query, null)  // negative cache: don't re-ask soon
    return null
  }

  const hit = json[0]
  const value = {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    source: 'nominatim',
  }
  writeCache(query, value)
  return value
}

/**
 * Build a single address string from lead fields. Caller passes a
 * lead row; we assemble city + address + country for Nominatim.
 */
export function leadAddressLine(lead) {
  if (!lead) return ''
  const parts = []
  if (lead.address && lead.address.trim()) parts.push(lead.address.trim())
  if (lead.city    && lead.city.trim())    parts.push(lead.city.trim())
  if (parts.length === 0) return ''
  parts.push('Gujarat, India')
  return parts.join(', ')
}

/**
 * Geocode a lead + persist via the Supabase RPC. Returns the same
 * shape as geocodeAddress, or null on no-match. Does NOT throw on
 * persist failure — geocoding succeeded, persistence is best-effort.
 */
export async function geocodeAndPersistLead(lead) {
  const line = leadAddressLine(lead)
  if (!line) return null
  const result = await geocodeAddress(line)
  if (!result) return null
  try {
    await supabase.rpc('set_lead_geocode', {
      p_lead_id: lead.id,
      p_lat:     result.lat,
      p_lng:     result.lng,
      p_source:  result.source,
    })
  } catch { /* persist failure non-fatal — map will still show pin */ }
  return result
}
