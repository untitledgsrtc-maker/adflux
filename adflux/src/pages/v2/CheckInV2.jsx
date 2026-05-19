// src/pages/v2/CheckInV2.jsx
//
// Phase 60 (19 May 2026) — full-screen check-in landing.
//
// Layout (mobile-first, ~390 x 844 viewport target):
//
//   [ Untitled OS logo + name greeting ]
//   [ status chip — On time / Late / Half-day window ]
//   [ today plan: meetings + follow-ups + scheduled calls ]
//   [ SwipeToCheckIn pill ]
//   [ status row: GPS · Internet · Push permission ]
//
// On successful swipe:
//   1. Capture current GPS (Geolocation API, 5s timeout, low accuracy
//      is fine — we just need the city block).
//   2. POST record_checkin(lat, lng) RPC.
//   3. Show "Checked in" state for 800 ms (animated check icon).
//   4. Navigate to /work (or back to the page that triggered the
//      redirect, via location.state.from).
//
// If GPS fails (denied / timeout / unsupported), still record the
// check-in with NULL lat/lng. Rep can fix permission later.

import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useCheckinStatus } from '../../hooks/useCheckinStatus'
import SwipeToCheckIn from '../../components/v2/SwipeToCheckIn'
import { Clock, MapPin, Wifi, Bell, ChevronRight, Calendar, PhoneCall } from 'lucide-react'
import { pushToast, toastError } from '../../components/v2/Toast'

const fmtTimeIST = (d = new Date()) =>
  d.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Kolkata',
  })

const getCurrentPosition = () =>
  new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()    => resolve(null),
      { timeout: 5000, maximumAge: 60000, enableHighAccuracy: false },
    )
  })

// IST hh:mm → minutes-since-midnight (used to label the status chip
// before check-in actually fires). Server clock is authoritative
// once the row exists.
const istMinutes = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(new Date()).split(':')
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
}

export default function CheckInV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const { name, checkedIn, isWorkday, refetch } = useCheckinStatus(profile?.id)

  const [now, setNow]               = useState(new Date())
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]             = useState(false)
  const [plan, setPlan]             = useState({ meetings: 0, followups: 0, calls: 0 })

  // Tick the clock once a minute for the time chip.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Bounce away if already checked in (e.g. navigated here manually
  // after a successful swipe in another tab).
  useEffect(() => {
    if (checkedIn) {
      const back = location.state?.from?.pathname || '/work'
      navigate(back, { replace: true })
    }
  }, [checkedIn, navigate, location.state])

  // Load today's plan preview — open follow-ups + meetings counts.
  useEffect(() => {
    if (!profile?.id) return
    const today = new Date().toISOString().slice(0, 10)
    ;(async () => {
      const [{ count: fuCount }, { count: meetCount }] = await Promise.all([
        supabase.from('follow_ups')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', profile.id)
          .eq('is_done', false)
          .lte('follow_up_date', today),
        supabase.from('lead_activities')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('activity_type', 'meeting')
          .gte('created_at', today + 'T00:00:00.000Z'),
      ])
      setPlan({
        meetings:  meetCount  || 0,
        followups: fuCount    || 0,
        calls:     0,
      })
    })()
  }, [profile?.id])

  const minutesNow = istMinutes()
  const onTimeCutoff  = 9 * 60 + 30    // 9:30
  const halfDayCutoff = 11 * 60 + 30   // 11:30

  let statusLabel, statusColor, statusBg
  if (minutesNow <= onTimeCutoff) {
    statusLabel = 'On time'
    statusColor = 'var(--v2-green, #10B981)'
    statusBg    = 'rgba(16,185,129,0.12)'
  } else if (minutesNow <= halfDayCutoff) {
    const late = minutesNow - onTimeCutoff
    statusLabel = `${late} min late`
    statusColor = 'var(--v2-amber, #F59E0B)'
    statusBg    = 'rgba(245,158,11,0.14)'
  } else {
    statusLabel = 'Half-day window'
    statusColor = 'var(--v2-rose, #EF4444)'
    statusBg    = 'rgba(239,68,68,0.14)'
  }

  const onConfirm = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const pos = await getCurrentPosition()
      const { data, error } = await supabase.rpc('record_checkin', {
        p_lat: pos?.lat ?? null,
        p_lng: pos?.lng ?? null,
      })
      if (error) throw error
      setDone(true)
      const niceStatus = (data?.status === 'on_time')
        ? 'On time'
        : (data?.status === 'late' ? `Late by ${data?.late_minutes ?? '?'} min` : 'Half-day')
      pushToast(`Checked in — ${niceStatus}. Have a good day.`, 'success')
      // Tiny pause so the user sees the checkmark before route change.
      setTimeout(async () => {
        await refetch()
        const back = location.state?.from?.pathname || '/work'
        navigate(back, { replace: true })
      }, 800)
    } catch (e) {
      toastError(e, 'Could not save check-in. Try once more.')
      setSubmitting(false)
    }
  }, [submitting, location.state, navigate, refetch])

  // First name from the RPC (fallback profile.name first word).
  const firstName = name || (profile?.name || 'there').split(' ')[0]

  return (
    <div
      className="v2"
      style={{
        minHeight:     '100vh',
        background:    'var(--v2-bg-0, #0f172a)',
        color:         'var(--v2-ink-0, #f1f5f9)',
        display:       'flex',
        flexDirection: 'column',
        padding:       '32px 20px',
        fontFamily:    'var(--font-sans, "DM Sans", "Inter", system-ui)',
      }}
    >
      {/* Top: brand + greeting */}
      <div style={{ marginTop: 12 }}>
        <div style={{
          fontFamily: 'var(--v2-display, "Space Grotesk")',
          fontSize:   13,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color:      'var(--v2-ink-2, #94a3b8)',
        }}>
          Untitled OS
        </div>
        <h1 style={{
          fontFamily: 'var(--v2-display, "Space Grotesk")',
          fontSize:   28,
          fontWeight: 700,
          margin:     '6px 0 0',
          color:      'var(--v2-ink-0, #f1f5f9)',
        }}>
          Good morning, {firstName}
        </h1>
        <div style={{
          marginTop:  6,
          color:      'var(--v2-ink-2, #94a3b8)',
          fontSize:   14,
        }}>
          {fmtTimeIST(now)} IST · {now.toLocaleDateString('en-IN', {
            weekday: 'long', day: 'numeric', month: 'short',
            timeZone: 'Asia/Kolkata',
          })}
        </div>
      </div>

      {/* Status chip */}
      <div style={{
        marginTop: 24,
        display:   'inline-flex',
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap:        8,
        padding:    '8px 14px',
        borderRadius: 999,
        background: statusBg,
        color:      statusColor,
        fontSize:   13,
        fontWeight: 600,
      }}>
        <Clock size={14} strokeWidth={2} />
        {statusLabel}
      </div>

      {/* Today plan preview */}
      <div style={{
        marginTop:    28,
        display:      'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap:          10,
      }}>
        <PlanTile icon={<Calendar size={16} />}  label="Meetings"  value={plan.meetings} />
        <PlanTile icon={<PhoneCall size={16} />} label="Follow-ups" value={plan.followups} />
        <PlanTile icon={<ChevronRight size={16} />} label="Open tasks" value={'—'} />
      </div>

      {/* Spacer so the swipe pill sits ~60% down the viewport */}
      <div style={{ flex: 1 }} />

      {/* Swipe to check-in */}
      <SwipeToCheckIn
        label={done ? 'Checked in' : (submitting ? 'Saving…' : 'Swipe to check-in')}
        onConfirm={onConfirm}
        loading={submitting && !done}
        done={done}
      />

      <div style={{
        marginTop: 12,
        textAlign: 'center',
        fontSize:  12,
        color:     'var(--v2-ink-2, #94a3b8)',
      }}>
        Drag the yellow circle to the right. We care about your productivity.
      </div>

      {/* Status row */}
      <AttendanceStatusRow />
    </div>
  )
}

function PlanTile({ icon, label, value }) {
  return (
    <div style={{
      padding:      12,
      borderRadius: 'var(--v2-r, 14px)',
      background:   'var(--v2-bg-1, #1e293b)',
      border:       '1px solid var(--v2-line, #334155)',
    }}>
      <div style={{ color: 'var(--v2-ink-2, #94a3b8)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <span style={{ fontSize: 12 }}>{label}</span>
      </div>
      <div style={{
        marginTop:  4,
        fontFamily: 'var(--v2-display, "Space Grotesk")',
        fontSize:   22,
        fontWeight: 600,
        color:      'var(--v2-ink-0, #f1f5f9)',
      }}>
        {value}
      </div>
    </div>
  )
}

// Bottom row — quick visual on GPS / Internet / Push state. Read-only.
function AttendanceStatusRow() {
  const [gps, setGps]       = useState('checking')   // 'on' | 'off' | 'checking'
  const [online, setOnline] = useState(navigator.onLine)
  const [push, setPush]     = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )

  useEffect(() => {
    // GPS sniff — one quick getCurrentPosition. If denied → 'off'.
    if (!('geolocation' in navigator)) { setGps('off'); return }
    const t = setTimeout(() => setGps('off'), 4000)
    navigator.geolocation.getCurrentPosition(
      () => { clearTimeout(t); setGps('on') },
      () => { clearTimeout(t); setGps('off') },
      { timeout: 3500, maximumAge: 60000 },
    )
  }, [])

  useEffect(() => {
    const u = () => setOnline(navigator.onLine)
    window.addEventListener('online',  u)
    window.addEventListener('offline', u)
    return () => {
      window.removeEventListener('online', u)
      window.removeEventListener('offline', u)
    }
  }, [])

  return (
    <div style={{
      marginTop:  20,
      display:    'flex',
      gap:        8,
      flexWrap:   'wrap',
      justifyContent: 'center',
    }}>
      <StatusPill icon={<MapPin size={12} />} label={gps === 'on' ? 'GPS on' : gps === 'off' ? 'GPS off' : 'GPS…'}
                  ok={gps === 'on'} />
      <StatusPill icon={<Wifi size={12} />}   label={online ? 'Online' : 'Offline'} ok={online} />
      <StatusPill icon={<Bell size={12} />}   label={push === 'granted' ? 'Push on' : 'Push off'} ok={push === 'granted'} />
    </div>
  )
}

function StatusPill({ icon, label, ok }) {
  const color = ok ? 'var(--v2-green, #10B981)' : 'var(--v2-ink-2, #94a3b8)'
  const bg    = ok ? 'rgba(16,185,129,0.10)' : 'rgba(148,163,184,0.10)'
  return (
    <div style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          6,
      padding:      '6px 10px',
      borderRadius: 999,
      background:   bg,
      color:        color,
      fontSize:     12,
      fontWeight:   500,
    }}>
      {icon}
      {label}
    </div>
  )
}
