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
//   - GPS    : Phase 103.D.2 (2026-05-31) — on the Android wrapper,
//              reads the REAL Location switch via the native
//              TrackingPlugin.isGpsOn() (LocationManager), polled every
//              30s + re-probed on app resume. The old `gpsOn` prop (web
//              geolocation permission) reported 'granted' even after the
//              user switched Location OFF, so the pill showed GPS ON
//              while Location was OFF (owner screenshot 2026-05-31:
//              Samsung Location toggle off, app pill green). The native
//              switch check is the only reliable source on the APK. On
//              web (probe returns null) the pill falls back to the
//              `gpsOn` prop, so web behavior is unchanged.
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
import { probeGpsState } from '../../utils/nativeTracking'

export default function RepStatusPills({ gpsOn }) {
  const profile = useAuthStore(s => s.profile)
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [pushOn, setPushOn] = useState(null)
  // Phase 103.D.2 — native Location-switch state. null = web / unknown
  // (fall back to the gpsOn prop); boolean = the real Android switch.
  const [nativeGps, setNativeGps] = useState(null)

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

  // Phase 103.D.2 — GPS pill from the native Location switch. Polls
  // every 30s + re-probes the instant the app resumes (rep flips
  // Location in settings, returns to the app → pill flips immediately).
  // probeGpsState() returns null on web, so this is a no-op there and
  // the pill keeps using the gpsOn prop.
  useEffect(() => {
    let cancelled = false
    let resumeHandle = null
    const probe = async () => {
      const v = await probeGpsState()
      if (!cancelled) setNativeGps(v)
    }
    probe()
    const interval = setInterval(probe, 30000)
    // Re-probe on app resume (Capacitor). Lazy import keeps the web
    // bundle from hard-depending on the native plugin; on web the
    // listener is harmless / absent.
    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        const h = await App.addListener('resume', probe)
        if (cancelled) h.remove(); else resumeHandle = h
      } catch { /* web — @capacitor/app resume not available; ignore */ }
    })()
    return () => {
      cancelled = true
      clearInterval(interval)
      if (resumeHandle) resumeHandle.remove()
    }
  }, [])

  // Native switch is ground truth on the APK; fall back to the prop on
  // web (where probeGpsState returns null).
  const gpsStatus = nativeGps != null ? nativeGps : gpsOn

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8,
      justifyContent: 'center',
      padding: '16px 12px 24px',
    }}>
      <Pill label="GPS"    status={gpsStatus} />
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
