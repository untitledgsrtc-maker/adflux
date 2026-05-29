// src/components/v2/RepStatusPills.jsx
//
// Phase 102.E (2026-05-29) — 3 status pills at the bottom of /work.
//
// Owner directive: every sales rep should see a quick at-a-glance row
// of their device health — GPS state, network connectivity, push
// permission. Mirrors the green-dot pill spec from the design
// reference. Mounted at the bottom of WorkV2 (sales-only, gated by
// the same predicate as the GPS-off banner in Phase 102.D).
//
// Sources:
//   - GPS    : `gpsOn` prop from useGpsLock() in the parent (avoids a
//              double-mount of the geolocation probe).
//   - ONLINE : navigator.onLine + online/offline window listeners.
//   - PUSH   : Notification.permission === 'granted'. Polled every 5s
//              so the rep sees the state flip after they grant from
//              system settings without needing to reload the app.
//
// Brand: brand-token inline styles only. No new CSS class. Pills use
// the .lead-modal pattern of a colored 1px border + matching dot +
// matching label text. Green = ON, red = OFF, muted = unknown / loading.

import { useEffect, useState } from 'react'

export default function RepStatusPills({ gpsOn }) {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [pushOn, setPushOn] = useState(null)

  // navigator.onLine state — listen for connectivity flips.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const goOnline  = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Notification permission state. The Permissions API doesn't reliably
  // fire `change` events on Android WebView, so we poll every 5s. Cheap
  // (sync property read, no network) and reflects the rep flipping the
  // toggle in Android Settings without an app reload.
  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPushOn(false)
      return
    }
    const read = () => setPushOn(Notification.permission === 'granted')
    read()
    const interval = setInterval(read, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8,
      justifyContent: 'center',
      padding: '16px 12px 24px',
    }}>
      <Pill label="GPS"    status={gpsOn} />
      <Pill label="ONLINE" status={online} />
      <Pill label="PUSH"   status={pushOn} />
    </div>
  )
}

function Pill({ label, status }) {
  const isOn  = status === true
  const isOff = status === false
  const color = isOn  ? 'var(--success, #10B981)'
              : isOff ? 'var(--danger, #EF4444)'
              :         'var(--v2-ink-2)'
  const stateText = isOn ? 'ON' : isOff ? 'OFF' : '…'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 14px',
      border: `1px solid ${color}`,
      borderRadius: 999,
      fontSize: 11, fontWeight: 700,
      color,
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      background: 'transparent',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 999,
        background: color,
        display: 'inline-block',
      }} />
      {label} {stateText}
    </span>
  )
}
