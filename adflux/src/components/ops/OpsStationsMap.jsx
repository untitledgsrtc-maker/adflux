// src/components/ops/OpsStationsMap.jsx
//
// Small "my stations" map for the operation-executive home (§251.2 / ui-ux-pro-max
// wiring, 2026-08-27). Plots the tech's assigned depots as circle pins — green
// when every screen is up, red when the station has ≥1 down screen. Tap a pin →
// station name + status.
//
// Same Google-Maps loader options as LiveFieldMap / GpsTrackV2 / TeamDashboardV2
// (VITE_GOOGLE_ROADS_KEY, libraries:['geometry']) so the js-api-loader singleton
// settles clean (§70.6.1). SELF-CONTAINED + GRACEFUL: renders NOTHING (returns
// null) when there is no map key OR no station has coordinates — so it can never
// show a broken grey box on the field tech's primary screen. Brand tokens only.
//
// Props:
//   stations : [{ id, name, lat, lng, down }]   — down = has ≥1 offline screen
//   height   : map height px (default 190)

import { useEffect, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2129' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2129' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#f1f5f9' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#475569' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
]

const escStr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export default function OpsStationsMap({ stations = [], height = 190 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const [ready, setReady] = useState(false)

  const MAPS_KEY = import.meta.env.VITE_GOOGLE_ROADS_KEY || ''
  const withLoc = stations.filter(s => s && s.lat != null && s.lng != null)

  // mount once
  useEffect(() => {
    if (mapRef.current || !MAPS_KEY || withLoc.length === 0 || !containerRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const loader = new Loader({ apiKey: MAPS_KEY, version: 'weekly', libraries: ['geometry'] })
        const google = await loader.load()
        if (cancelled || !containerRef.current || mapRef.current) return
        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 22.3, lng: 72.6 }, zoom: 7, styles: DARK_MAP_STYLE,
          disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false,
        })
        map.__google = google
        mapRef.current = map
        setReady(true)
        // repaint so tiles paint inside a flex/card container without a manual resize
        const repaint = () => { try { google.maps.event.trigger(map, 'resize') } catch { /* */ } }
        setTimeout(repaint, 250); setTimeout(repaint, 800)
      } catch { /* no map — the section just stays hidden */ }
    })()
    return () => { cancelled = true; mapRef.current = null; markersRef.current = []; setReady(false) }
  }, [MAPS_KEY, withLoc.length])

  // place / refresh markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const google = map.__google
    if (!google) return
    try {
      markersRef.current.forEach(m => { try { m.setMap(null) } catch { /* */ } })
      markersRef.current = []
      const bounds = new google.maps.LatLngBounds()
      withLoc.forEach(s => {
        const color = s.down ? '#EF4444' : '#10B981'
        const pos = { lat: Number(s.lat), lng: Number(s.lng) }
        bounds.extend(pos)
        const m = new google.maps.Marker({
          position: pos, map, title: s.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 7,
            fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2,
          },
        })
        const iw = new google.maps.InfoWindow({
          content: `<div style="font-family:'DM Sans','Inter',sans-serif;min-width:120px;">`
            + `<div style="font-weight:700;font-size:13px;color:#0f172a;">${escStr(s.name)}</div>`
            + `<div style="font-size:11px;color:${s.down ? '#b91c1c' : '#047857'};margin-top:2px;">${s.down ? 'Screens down' : 'All up'}</div></div>`,
        })
        m.addListener('click', () => iw.open({ anchor: m, map }))
        markersRef.current.push(m)
      })
      if (withLoc.length === 1) { map.setCenter(bounds.getCenter()); map.setZoom(11) }
      else { map.fitBounds(bounds, 40) }
    } catch { /* */ }
  }, [ready, JSON.stringify(withLoc.map(s => [s.id, s.lat, s.lng, s.down]))])

  if (!MAPS_KEY || withLoc.length === 0) return null

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Map of your assigned stations"
      style={{ width: '100%', height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}
    />
  )
}
