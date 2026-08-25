// src/components/ops/LiveFieldMap.jsx
//
// Reusable live field map — the same Google-Maps + avatar-pin-in-freshness-ring
// widget as /team-dashboard (TeamDashboardV2), extracted so the Operation Head
// dashboard matches it exactly. Faithful copy of the TeamDashboardV2 map logic
// (Phase 70.x / 87.6) so that page stays byte-unchanged (§45). TeamDashboardV2
// can adopt this in a later pass.
//
// Props:
//   users      : [{ id, name, profile_image_url, meta? }]
//   pingByUser : { [userId]: { lat, lng, captured_at } }  — latest ping per user
//   activeIds  : Set<userId> | null — only pin these (e.g. checked-in). null = all with a ping.
//   height     : map height px (default 360)
//
// Uses VITE_GOOGLE_ROADS_KEY + libraries:['geometry'] — the SAME Loader options
// as GpsTrackV2/TeamDashboardV2 so the js-api-loader singleton settles clean
// (§70.6.1). Silently renders an empty box if no map key.

import { useEffect, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'

const AVATAR_MARKER_SIZE = 52

function drawInitialsOnCanvas(ctx, name, size) {
  ctx.fillStyle = '#FFE600'
  ctx.fillRect(5, 5, size - 10, size - 10)
  ctx.fillStyle = '#0f172a'
  ctx.font = '700 18px "DM Sans", "Inter", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const initials = (name || 'U').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  ctx.fillText(initials, size / 2, size / 2 + 1)
}

function buildAvatarMarkerIcon(google, name, profileUrl, color, imageCache) {
  const SIZE = AVATAR_MARKER_SIZE
  const cv = document.createElement('canvas')
  cv.width = SIZE * 2; cv.height = SIZE * 2
  const ctx = cv.getContext('2d')
  ctx.scale(2, 2)
  ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
  ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill()
  ctx.save(); ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 7, 0, Math.PI * 2); ctx.clip()
  const img = profileUrl ? imageCache[profileUrl] : null
  if (img && img.complete && img.naturalWidth) {
    try { ctx.drawImage(img, 7, 7, SIZE - 14, SIZE - 14) } catch { drawInitialsOnCanvas(ctx, name, SIZE) }
  } else { drawInitialsOnCanvas(ctx, name, SIZE) }
  ctx.restore()
  let url
  try { url = cv.toDataURL('image/png') } catch {
    const cv2 = document.createElement('canvas'); cv2.width = SIZE * 2; cv2.height = SIZE * 2
    const c2 = cv2.getContext('2d'); c2.scale(2, 2)
    c2.beginPath(); c2.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2); c2.fillStyle = color; c2.fill()
    c2.beginPath(); c2.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 5, 0, Math.PI * 2); c2.fillStyle = '#ffffff'; c2.fill()
    c2.save(); c2.beginPath(); c2.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 7, 0, Math.PI * 2); c2.clip()
    drawInitialsOnCanvas(c2, name, SIZE); c2.restore()
    url = cv2.toDataURL('image/png')
  }
  return { url, scaledSize: new google.maps.Size(SIZE, SIZE), anchor: new google.maps.Point(SIZE / 2, SIZE / 2) }
}

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2129' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2129' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#f1f5f9' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#64748b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#475569' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#94a3b8' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#64748b' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#475569' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#475569' }] },
]

const escStr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export default function LiveFieldMap({ users = [], pingByUser = {}, activeIds = null, height = 360 }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({})
  const imageCacheRef = useRef({})
  const [iconBump, setIconBump] = useState(0)
  const [mapReady, setMapReady] = useState(false)

  // pre-load profile pics (CORS-safe) so the marker canvas can draw them
  useEffect(() => {
    const cache = imageCacheRef.current
    const urls = Array.from(new Set(users.map(u => u.profile_image_url).filter(u => u && !cache[u])))
    if (!urls.length) return
    let cancelled = false
    Promise.all(urls.map(url => new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer'
      img.onload = () => resolve({ url, img }); img.onerror = () => resolve({ url, img: null })
      img.src = url
    }))).then(results => {
      if (cancelled) return
      let added = 0
      results.forEach(({ url, img }) => { if (img && img.naturalWidth > 0) { cache[url] = img; added += 1 } })
      if (added > 0) setIconBump(n => n + 1)
    })
    return () => { cancelled = true }
  }, [users])

  // mount the map once
  useEffect(() => {
    if (mapRef.current) return
    const MAPS_KEY = import.meta.env.VITE_GOOGLE_ROADS_KEY || ''
    if (!MAPS_KEY) return
    let cancelled = false
    ;(async () => {
      const loader = new Loader({ apiKey: MAPS_KEY, version: 'weekly', libraries: ['geometry'] })
      const google = await loader.load()
      if (cancelled || !mapContainerRef.current || mapRef.current) return
      const map = new google.maps.Map(mapContainerRef.current, {
        center: { lat: 22.3072, lng: 73.1812 }, zoom: 8, styles: DARK_MAP_STYLE,
        disableDefaultUI: false, mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
      })
      mapRef.current = map; map.__google = google; setMapReady(true)
      // Google Maps renders grey if the container's size settled AFTER
      // construction (card/flex layout). Trigger a resize + re-centre a beat
      // later so tiles paint on load without a manual window resize.
      const repaint = () => { try { map.setOptions({ styles: DARK_MAP_STYLE }); google.maps.event.trigger(map, 'resize'); map.setCenter({ lat: 22.3072, lng: 73.1812 }) } catch { /* */ } }
      setTimeout(repaint, 250)
      setTimeout(repaint, 800)
    })()
    return () => { cancelled = true; mapRef.current = null; markersRef.current = {}; setMapReady(false) }
  }, [])

  // place / update markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const google = map.__google
    if (!google) return
    const now = Date.now()
    const seen = new Set()
    const bounds = new google.maps.LatLngBounds()
    let anyPinned = false

    for (const u of users) {
      if (activeIds && !activeIds.has(u.id)) continue
      const ping = pingByUser[u.id]
      if (!ping || !ping.lat || !ping.lng) continue
      const ageMin = ping.captured_at ? (now - new Date(ping.captured_at).getTime()) / 60000 : Infinity
      const color = ageMin <= 5 ? '#10B981' : ageMin <= 30 ? '#F59E0B' : '#EF4444'
      seen.add(u.id)
      const pos = { lat: Number(ping.lat), lng: Number(ping.lng) }
      bounds.extend(pos); anyPinned = true
      const iconKey = `${u.id}|${u.profile_image_url || ''}|${color}`
      const popup = `<div style="font-family:'DM Sans','Inter',sans-serif;min-width:160px;">`
        + `<div style="font-weight:700;font-size:14px;color:#f5f7fb;border-bottom:2px solid #FFE600;padding-bottom:3px;display:inline-block;">${escStr(u.name)}</div>`
        + `<div style="font-size:11px;color:#98a4bf;margin-top:6px;">${escStr(u.meta || '')}</div>`
        + `<div style="font-size:11px;color:#cbd5e1;margin-top:4px;">${Number.isFinite(ageMin) ? Math.round(ageMin) + ' min ago' : 'no ping'}</div></div>`
      const existing = markersRef.current[u.id]
      if (existing) {
        existing.setPosition(pos)
        if (existing.__iconKey !== iconKey) {
          existing.setIcon(buildAvatarMarkerIcon(google, u.name, u.profile_image_url, color, imageCacheRef.current))
          existing.__iconKey = iconKey
        }
        existing.__iw?.setContent(popup)
      } else {
        const m = new google.maps.Marker({
          position: pos, map,
          icon: buildAvatarMarkerIcon(google, u.name, u.profile_image_url, color, imageCacheRef.current),
          title: u.name,
        })
        m.__iconKey = iconKey
        const iw = new google.maps.InfoWindow({ content: popup })
        m.addListener('click', () => iw.open({ anchor: m, map }))
        m.__iw = iw
        markersRef.current[u.id] = m
      }
    }
    for (const id of Object.keys(markersRef.current)) {
      if (!seen.has(id)) { try { markersRef.current[id].setMap(null) } catch { /* */ } delete markersRef.current[id] }
    }
    if (anyPinned && !map.__fitDone) {
      try { map.fitBounds(bounds, 60); map.__fitDone = true } catch { /* */ }
    }
  }, [users, pingByUser, activeIds, iconBump, mapReady])

  return <div ref={mapContainerRef} style={{ width: '100%', height }} />
}
