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
//   - GPS    : `gpsOn` prop from useGpsLock() in the parent (device
//              probe). NOTE: full GPS pill parity with the admin
//              TeamDashboard rides Phase 103.D (native background
//              service) — pre-103.D the rep's device knows its GPS
//              state but the admin only sees pings, which stop when
//              the app backgrounds. Left on the device probe for now.
//   - ONLINE : navigator.onLine + online/offline window listeners.
//              (Admin ONLINE parity also rides 103.D.)
//   - PUSH   : Phase 103.A (2026-05-31) — switched from the web
//              `Notification.permission` API to the SAME source the
//              admin TeamDashboard reads: a row in `push_subscriptions`
//              for this user_id. On the Capacitor APK the native FCM
//              grant does NOT set web `Notification.permission` (stays
//              'default'/'denied'), so the old pill showed PUSH OFF
//              even when push was enrolled + working (Dixita case).
//              Reading the subscription row makes the rep pill match
//              the admin pill exactly: row exists = enrolled = ON.
//
// Brand: brand-token inline styles only. No new CSS class. Pills use
// the .lead-modal pattern of a colored 1px border + matching dot +
// matching label text. Green = ON, red = OFF, muted = unknown / loading.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

export default function RepStatusPills({ gpsOn }) {
  const profile = useAuthStore(s => s.profile)
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

  // Phase 103.A — PUSH state from push_subscriptions row presence (the
  // canonical "can we deliver a push to this device" signal, identical
  // to what the admin TeamDashboard reads). Web Notification.permission
  // lied on the APK. Poll every 60s so a fresh enrollment flips the
  // pill without an app reload. RLS: ps_self (user_id = auth.uid())
  // lets the rep read their own subscription rows.
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    const read = async () => {
      const { count, error } = await supabase
        .from('push_subscriptions')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
      if (cancelled) return
      if (error) {
        // Non-fatal — leave at last-known / loading rather than flip red
        // on a transient RLS/network hiccup.
        console.warn('[RepStatusPills] push read failed:', error.message)
        return
      }
      setPushOn((count || 0) > 0)
    }
    read()
    const interval = setInterval(read, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [profile?.id])

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
