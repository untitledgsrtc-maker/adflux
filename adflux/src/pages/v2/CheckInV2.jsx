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
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useCheckinStatus } from '../../hooks/useCheckinStatus'
import SwipeToCheckIn from '../../components/v2/SwipeToCheckIn'
import { Clock, MapPin, Wifi, Bell, Calendar, PhoneCall, Flame, FileText, X } from 'lucide-react'
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
  const profile = useAuthStore((s) => s.profile)
  const { name, checkedIn, isWorkday, refetch } = useCheckinStatus(profile?.id)

  const [now, setNow]               = useState(new Date())
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]             = useState(false)
  // Phase 60.2 — richer Today's plan card.
  //   followups: full list (top 5 rendered), each with name + time
  //   meetings:  count today
  //   hotLeads:  count of leads.heat = 'hot' owned by rep
  //   openQuotes: count of quotes not Won/Lost owned by rep
  const [plan, setPlan]             = useState({
    followups: [],
    meetings:  0,
    hotLeads:  0,
    openQuotes: 0,
  })
  // Phase 60.2 — late-reason modal state.
  // Opens after a successful swipe when status is 'late' or 'half_day'.
  // Rep can enter a one-line reason or skip; both paths persist the
  // check-in (the row is already saved by the time the modal opens).
  const [reasonOpen,   setReasonOpen]   = useState(false)
  const [reasonStatus, setReasonStatus] = useState(null)   // 'late' | 'half_day'
  const [reasonText,   setReasonText]   = useState('')
  const [reasonSaving, setReasonSaving] = useState(false)

  // Tick the clock once a minute for the time chip.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Bounce away if already checked in.
  // Phase 60.3 (19 May 2026) — owner directive: every rep lands on
  // /work after check-in, regardless of role. Telecallers can still
  // reach /telecaller from their sidebar — but the morning landing
  // is uniform /work to match the daily-plan muscle memory.
  useEffect(() => {
    if (checkedIn) {
      navigate('/work', { replace: true })
    }
  }, [checkedIn, navigate])

  // Phase 60.2 — load today's plan: follow-ups list + meeting count
  // + hot leads count + open quotes count. Single effect, four
  // queries in parallel. Heavy enough that we cap the follow-ups
  // result to 5 rows for the card; "+ N more" pill if there's
  // overflow.
  useEffect(() => {
    if (!profile?.id) return
    const today = new Date().toISOString().slice(0, 10)
    let cancelled = false
    ;(async () => {
      try {
        const [fuRes, meetRes, hotRes, openRes] = await Promise.all([
          // Follow-ups due today or earlier (overdue).
          supabase.from('follow_ups')
            .select('id, follow_up_date, follow_up_time, note, lead_id, leads!inner(name, company)')
            .eq('assigned_to', profile.id)
            .eq('is_done', false)
            .lte('follow_up_date', today)
            .order('follow_up_date', { ascending: true })
            .order('follow_up_time', { ascending: true, nullsFirst: true })
            .limit(6),
          // Meetings logged today.
          supabase.from('lead_activities')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('activity_type', 'meeting')
            .gte('created_at', today + 'T00:00:00.000Z'),
          // Hot leads owned by rep (regardless of date).
          supabase.from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_to', profile.id)
            .eq('heat', 'hot')
            .not('stage', 'in', '(Won,Lost)'),
          // Open quotes (not Won/Lost).
          supabase.from('quotes')
            .select('id', { count: 'exact', head: true })
            .eq('created_by', profile.id)
            .not('status', 'in', '(won,lost)'),
        ])
        if (cancelled) return
        setPlan({
          followups:  fuRes.data || [],
          meetings:   meetRes.count || 0,
          hotLeads:   hotRes.count  || 0,
          openQuotes: openRes.count || 0,
        })
      } catch (e) {
        // Defensive: bad RLS / FK shape shouldn't block the swipe.
        console.warn('[checkin] plan load failed:', e?.message || e)
      }
    })()
    return () => { cancelled = true }
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
        p_lat:    pos?.lat ?? null,
        p_lng:    pos?.lng ?? null,
        p_reason: null,
      })
      if (error) throw error
      setDone(true)
      const niceStatus = (data?.status === 'on_time')
        ? 'On time'
        : (data?.status === 'late' ? `Late by ${data?.late_minutes ?? '?'} min` : 'Half-day')
      pushToast(`Checked in — ${niceStatus}. Have a good day.`, 'success')

      // Phase 60.2 — open reason modal if rep is late or half-day.
      // The check-in is already saved; the modal just patches the
      // reason field. If the rep dismisses, the row keeps reason=null.
      if (data?.status === 'late' || data?.status === 'half_day') {
        setReasonStatus(data.status)
        setReasonOpen(true)
        // DO NOT navigate yet — modal owns the navigation on close.
        return
      }

      // On-time → straight home via RootRedirect.
      setTimeout(async () => {
        await refetch()
        navigate('/work', { replace: true })
      }, 800)
    } catch (e) {
      toastError(e, 'Could not save check-in. Try once more.')
      setSubmitting(false)
    }
  }, [submitting, navigate, refetch])

  // Phase 60.2 — save late reason. Idempotent UPDATE on today's row
  // (the row already exists from the swipe). On either save or skip
  // we navigate home via RootRedirect.
  const closeReasonAndGo = useCallback(async (reason) => {
    if (reasonSaving) return
    setReasonSaving(true)
    try {
      if (reason && reason.trim().length > 0) {
        // Idempotent: rep can re-submit reason via /check-in if
        // they accidentally skip. UPDATE is keyed on (user_id, work_date).
        const { error } = await supabase
          .from('work_sessions')
          .update({ late_reason: reason.trim().slice(0, 240) })
          .eq('user_id', profile.id)
          .eq('work_date', new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))
        if (error) throw error
      }
      setReasonOpen(false)
      await refetch()
      navigate('/work', { replace: true })
    } catch (e) {
      toastError(e, 'Could not save reason. Try once more.')
    } finally {
      setReasonSaving(false)
    }
  }, [reasonSaving, profile?.id, navigate, refetch])

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

      {/* Phase 60.2 — Today's plan card */}
      <div style={{
        marginTop:    24,
        padding:      14,
        borderRadius: 'var(--v2-r, 14px)',
        background:   'var(--v2-bg-1, #1e293b)',
        border:       '1px solid var(--v2-line, #334155)',
      }}>
        <div style={{
          fontFamily:    'var(--v2-display, "Space Grotesk")',
          fontSize:      13,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color:         'var(--v2-ink-2, #94a3b8)',
          marginBottom:  10,
        }}>
          Today's plan
        </div>

        {/* Four KPI chips */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:     8,
          marginBottom: plan.followups.length > 0 ? 12 : 0,
        }}>
          <KpiChip icon={<PhoneCall size={14} />} value={plan.followups.length}  label="Follow-ups" />
          <KpiChip icon={<Calendar  size={14} />} value={plan.meetings}          label="Meetings"  />
          <KpiChip icon={<Flame     size={14} />} value={plan.hotLeads}          label="Hot"        accent />
          <KpiChip icon={<FileText  size={14} />} value={plan.openQuotes}        label="Quotes"     />
        </div>

        {/* Follow-up list (top 5) */}
        {plan.followups.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {plan.followups.slice(0, 5).map(fu => {
              const lead = fu.leads || {}
              const label = lead.name || lead.company || 'lead'
              return (
                <div
                  key={fu.id}
                  onClick={() => navigate(`/leads/${fu.lead_id}`)}
                  style={{
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'space-between',
                    padding:        '8px 10px',
                    borderRadius:   'var(--v2-r-sm, 10px)',
                    background:     'var(--v2-bg-2, #0f172a)',
                    border:         '1px solid var(--v2-line, #334155)',
                    cursor:         'pointer',
                  }}
                >
                  <div style={{
                    fontSize:     13,
                    color:        'var(--v2-ink-0, #f1f5f9)',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                    paddingRight: 10,
                  }}>
                    {label}
                  </div>
                  <div style={{
                    fontSize:   11,
                    fontFamily: 'var(--v2-display, "Space Grotesk")',
                    color:      'var(--v2-ink-2, #94a3b8)',
                    whiteSpace: 'nowrap',
                  }}>
                    {fu.follow_up_time
                      ? String(fu.follow_up_time).slice(0, 5)
                      : (fu.follow_up_date || '')}
                  </div>
                </div>
              )
            })}
            {plan.followups.length > 5 && (
              <div style={{
                marginTop:   2,
                fontSize:    11,
                color:       'var(--v2-ink-2, #94a3b8)',
                textAlign:   'center',
              }}>
                + {plan.followups.length - 5} more on /follow-ups
              </div>
            )}
          </div>
        )}

        {plan.followups.length === 0 && plan.meetings === 0 && plan.hotLeads === 0 && plan.openQuotes === 0 && (
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginTop: 4 }}>
            Clear day — set new follow-ups from leads after check-in.
          </div>
        )}
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

      {/* Phase 60.2 — late-reason modal. Opens after a successful
          swipe when status is late / half-day. Skip persists the
          check-in with reason=null; save patches the row. */}
      <LateReasonModal
        open={reasonOpen}
        status={reasonStatus}
        saving={reasonSaving}
        onSave={(r) => closeReasonAndGo(r)}
        onSkip={() => closeReasonAndGo(null)}
      />
    </div>
  )
}

function KpiChip({ icon, value, label, accent = false }) {
  return (
    <div style={{
      padding:      '8px 6px',
      borderRadius: 'var(--v2-r-sm, 10px)',
      background:   accent ? 'rgba(255,230,0,0.10)' : 'var(--v2-bg-2, #0f172a)',
      border:       `1px solid ${accent ? 'rgba(255,230,0,0.25)' : 'var(--v2-line, #334155)'}`,
      textAlign:    'center',
    }}>
      <div style={{
        color:       accent ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-2, #94a3b8)',
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'center',
        gap:         4,
        marginBottom: 2,
      }}>
        {icon}
      </div>
      <div style={{
        fontFamily: 'var(--v2-display, "Space Grotesk")',
        fontSize:   18,
        fontWeight: 600,
        color:      'var(--v2-ink-0, #f1f5f9)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--v2-ink-2, #94a3b8)' }}>{label}</div>
    </div>
  )
}

// Phase 60.2 — late reason modal. Three quick chips for common
// reasons (Traffic / Family / Health) + an "Other" free-text field.
// Skip path leaves late_reason = null. Z-index 9000 per §29 modal tier.
function LateReasonModal({ open, status, saving, onSave, onSkip }) {
  const [picked, setPicked] = useState(null)   // chip key
  const [custom, setCustom] = useState('')

  if (!open) return null

  const QUICK_REASONS = [
    'Traffic',
    'Family commitment',
    'Health / sick',
    'Site visit',
  ]

  const isHalfDay = status === 'half_day'
  const finalReason = picked && picked !== 'other'
    ? picked
    : (custom.trim() || null)

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(2,6,23,0.78)',
      zIndex: 9000,
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      padding: 12,
    }}>
      <div style={{
        width:         '100%',
        maxWidth:      460,
        background:    'var(--v2-bg-1, #1e293b)',
        borderRadius:  'var(--v2-r, 14px)',
        border:        '1px solid var(--v2-line, #334155)',
        padding:       18,
        boxShadow:     '0 12px 28px rgba(0,0,0,0.45)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <div style={{
            fontFamily: 'var(--v2-display, "Space Grotesk")',
            fontSize:   17,
            fontWeight: 700,
            color:      'var(--v2-ink-0, #f1f5f9)',
          }}>
            {isHalfDay ? 'Half-day note' : 'Reason for late check-in'}
          </div>
          <button
            onClick={onSkip}
            disabled={saving}
            style={{
              background: 'transparent', border: 0, padding: 6,
              color: 'var(--v2-ink-2, #94a3b8)', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginBottom: 12 }}>
          Helps your manager understand — kept short, kept private.
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          marginBottom: 10,
        }}>
          {QUICK_REASONS.map(r => (
            <button
              key={r}
              onClick={() => { setPicked(r); setCustom('') }}
              disabled={saving}
              style={{
                padding:      '10px 12px',
                borderRadius: 'var(--v2-r-sm, 10px)',
                border:       picked === r
                  ? '1px solid var(--v2-yellow, #FFE600)'
                  : '1px solid var(--v2-line, #334155)',
                background:   picked === r
                  ? 'rgba(255,230,0,0.10)'
                  : 'var(--v2-bg-2, #0f172a)',
                color:        'var(--v2-ink-0, #f1f5f9)',
                fontFamily:   'inherit',
                fontSize:     13,
                cursor:       saving ? 'default' : 'pointer',
                textAlign:    'left',
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <button
          onClick={() => setPicked('other')}
          disabled={saving}
          style={{
            display:      'block',
            width:        '100%',
            padding:      '10px 12px',
            borderRadius: 'var(--v2-r-sm, 10px)',
            border:       picked === 'other'
              ? '1px solid var(--v2-yellow, #FFE600)'
              : '1px solid var(--v2-line, #334155)',
            background:   picked === 'other'
              ? 'rgba(255,230,0,0.10)'
              : 'var(--v2-bg-2, #0f172a)',
            color:        'var(--v2-ink-0, #f1f5f9)',
            fontFamily:   'inherit',
            fontSize:     13,
            cursor:       saving ? 'default' : 'pointer',
            textAlign:    'left',
            marginBottom: 10,
          }}
        >
          Other (type a reason)
        </button>

        {picked === 'other' && (
          <input
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            maxLength={240}
            placeholder="Type your reason…"
            style={{
              width:        '100%',
              padding:      '10px 12px',
              borderRadius: 'var(--v2-r-sm, 10px)',
              border:       '1px solid var(--v2-line, #334155)',
              background:   'var(--v2-bg-2, #0f172a)',
              color:        'var(--v2-ink-0, #f1f5f9)',
              fontSize:     13,
              fontFamily:   'inherit',
              marginBottom: 10,
            }}
          />
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onSkip}
            disabled={saving}
            style={{
              flex:         1,
              padding:      '11px 14px',
              borderRadius: 'var(--v2-r-sm, 10px)',
              border:       '1px solid var(--v2-line, #334155)',
              background:   'transparent',
              color:        'var(--v2-ink-1, #cbd5e1)',
              fontFamily:   'inherit',
              fontSize:     14,
              fontWeight:   600,
              cursor:       saving ? 'default' : 'pointer',
            }}
          >
            Skip
          </button>
          <button
            onClick={() => onSave(finalReason)}
            disabled={saving || !finalReason}
            style={{
              flex:         2,
              padding:      '11px 14px',
              borderRadius: 'var(--v2-r-sm, 10px)',
              border:       0,
              background:   finalReason && !saving
                ? 'var(--v2-yellow, #FFE600)'
                : 'rgba(255,230,0,0.3)',
              color:        'var(--accent-fg, #0f172a)',
              fontFamily:   'inherit',
              fontSize:     14,
              fontWeight:   700,
              cursor:       finalReason && !saving ? 'pointer' : 'default',
            }}
          >
            {saving ? 'Saving…' : 'Save & continue'}
          </button>
        </div>
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
