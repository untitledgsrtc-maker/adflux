// src/components/work/NearbyLeadsCard.jsx
//
// Phase 91c — Nearby leads proximity card.
//
// Owner directive (24 May 2026):
//   "Rep in field, GPS already on, 'lead 800m away — drop in' →
//    directions. Real driving-time saved."
//
// Rules:
//   • Reads navigator.geolocation low-accuracy (60s cache) — same
//     pattern WorkV2.captureGps uses.
//   • Calls supabase.rpc('nearby_leads_for_user', { p_user, p_lat,
//     p_lng, p_radius_m: 2000 }) — SQL Phase 91c.
//   • Exception-rendered: hides when 0 results OR GPS denied OR
//     coords unavailable. No banner, no error toast.
//   • Per row: heat dot + name + company subtitle + distance pill +
//     Directions button (Google Maps URL scheme) + Call button.
//   • Call button reuses parent's onCallLead (same quickLogCall
//     chain — tel: → 1.5s → outcome modal).
//   • Refetch on parent refreshKey bump + visibility-resume.

import React, { useEffect, useState, useCallback } from 'react'
import { Compass, Navigation, Phone } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const RADIUS_M = 2000

function distanceLabel(meters) {
  if (meters == null || !Number.isFinite(meters)) return ''
  if (meters < 1000) return `${meters} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function heatDotColor(heat) {
  const h = (heat || '').toLowerCase()
  if (h === 'hot') return 'var(--danger, #EF4444)'
  if (h === 'warm') return 'var(--warning, #F59E0B)'
  if (h === 'cold') return 'var(--blue, #3B82F6)'
  return 'var(--text-muted, #94a3b8)'
}

function getCurrentPos() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    )
  })
}

/**
 * @param {object} props
 * @param {string}   props.userId      — rep's auth uid
 * @param {function} props.onCallLead  — (lead, taskId|null) → fires
 *                                       parent's quickLogCall chain
 * @param {number}   [props.refreshKey] — parent bumps to force refetch
 */
export default function NearbyLeadsCard({ userId, onCallLead, refreshKey }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const pos = await getCurrentPos()
    if (!pos) {
      // GPS denied or unavailable — exception-render hides the card.
      setRows([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase.rpc('nearby_leads_for_user', {
      p_user:     userId,
      p_lat:      pos.lat,
      p_lng:      pos.lng,
      p_radius_m: RADIUS_M,
    })
    if (error) {
      console.warn('[NearbyLeadsCard] rpc failed:', error.message)
      setRows([])
      setLoading(false)
      return
    }
    setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshKey])

  // Visibility-resume refetch — rep arrived at a new location and
  // brought the app back to the foreground. Mirrors WorkV2 Phase 34Z.7
  // visibility-resume GPS ping pattern.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load])

  // Exception-render: hide while loading OR when no results.
  if (loading || rows.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--v2-bg-1, #1e293b)',
        border: '1px solid var(--v2-line, #334155)',
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 10,
        }}
      >
        <span style={{ color: 'var(--v2-yellow, #FFE600)', display: 'inline-flex' }}>
          <Compass size={16} strokeWidth={1.6} />
        </span>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Nearby leads</div>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 11, fontWeight: 600,
            color: 'var(--v2-ink-2, #94a3b8)',
            background: 'var(--v2-bg-0, rgba(15,19,32,0.6))',
            padding: '3px 9px', borderRadius: 999,
          }}
        >
          within {RADIUS_M / 1000} km
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(row => {
          const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`
          return (
            <div
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: 'var(--v2-bg-0, rgba(15,19,32,0.6))',
                border: '1px solid var(--v2-line, #334155)',
                borderRadius: 10,
              }}
            >
              <span
                style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: heatDotColor(row.heat),
                  flexShrink: 0,
                }}
                aria-label={`heat ${row.heat || 'unknown'}`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13, fontWeight: 600,
                    color: 'var(--v2-ink-0, #f1f5f9)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {row.name || row.company || 'Lead'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--v2-ink-2, #94a3b8)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {distanceLabel(row.distance_m)}
                  {row.company && row.name ? ` · ${row.company}` : ''}
                  {row.city ? ` · ${row.city}` : ''}
                </div>
              </div>
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '9px 11px', borderRadius: 10,
                  minHeight: 36,
                  background: 'transparent',
                  color: 'var(--v2-yellow, #FFE600)',
                  border: '1px solid var(--v2-yellow, #FFE600)',
                  fontWeight: 600, fontSize: 11,
                  textDecoration: 'none',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                }}
                aria-label="Open directions in Google Maps"
              >
                <Navigation size={14} strokeWidth={1.6} />
                Go
              </a>
              <button
                type="button"
                onClick={() => onCallLead?.({
                  id: row.id,
                  phone: row.phone,
                  name: row.name,
                  company: row.company,
                  stage: row.stage,
                }, null)}
                disabled={!onCallLead || !row.phone}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '9px 11px', borderRadius: 10,
                  minHeight: 36,
                  background: 'var(--v2-yellow, #FFE600)',
                  color: 'var(--accent-fg, #0f172a)',
                  border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: 11,
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  opacity: (!onCallLead || !row.phone) ? 0.5 : 1,
                }}
                aria-label="Call this lead"
              >
                <Phone size={14} strokeWidth={1.6} />
                Call
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
