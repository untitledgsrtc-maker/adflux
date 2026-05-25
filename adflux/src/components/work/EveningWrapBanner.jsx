// src/components/work/EveningWrapBanner.jsx
//
// Phase 93 — In-app evening wrap-up banner.
//
// Owner directive (24 May 2026):
//   "In-app banner catches reps who open app after 19:00 — no push
//    dependency. Combine with 92c hard-close for full coverage."
//
// Behavior:
//   • Renders ONLY when ALL of:
//       - role is sales / agency / telecaller / sales_manager
//       - current IST hour >= 19
//       - rep has check_in_at today
//       - rep has NOT shared summary (evening_summary_sent_at is null)
//       - rep has NOT checked out (check_out_at is null)
//       - rep hasn't dismissed it this session (sessionStorage flag)
//   • Tap = smooth-scrolls to DaySummaryCard (#day-summary-card anchor)
//     where the rep taps Share. Phase 92a chains auto-checkout.
//   • Dismiss = stores `eveningBannerDismissedYYYY-MM-DD` in
//     sessionStorage so the banner doesn't re-appear after manual
//     dismiss until next IST day.
//   • Mounts at the top of /work + /telecaller. Exception-rendered
//     (returns null) when any gate fails.

import React, { useEffect, useMemo, useState } from 'react'
import { Sunset, X, ArrowDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istTodayISO } from '../../utils/istDate'

const ELIGIBLE_ROLES = new Set(['sales', 'agency', 'telecaller', 'sales_manager'])
const TARGET_ANCHOR  = 'day-summary-card'

function istHourNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const hh = parts.find(p => p.type === 'hour')?.value || '00'
  return parseInt(hh, 10)
}

function isDismissedToday() {
  try {
    const key = `eveningBannerDismissed${istTodayISO()}`
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    sessionStorage.setItem(`eveningBannerDismissed${istTodayISO()}`, '1')
  } catch {}
}

export default function EveningWrapBanner() {
  const profile = useAuthStore(s => s.profile)
  const [session, setSession] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [dismissed, setDismissed] = useState(() => isDismissedToday())
  const [tick, setTick] = useState(0)

  // Re-check the time gate every 5 min in case the rep keeps the app
  // open across the 19:00 boundary.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // Load today's work_session for gating.
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('work_sessions')
        .select('check_in_at, check_out_at, evening_summary_sent_at')
        .eq('user_id', profile.id)
        .eq('work_date', istTodayISO())
        .maybeSingle()
      if (!cancelled) {
        setSession(data || null)
        setLoaded(true)
      }
    })()
    return () => { cancelled = true }
    // Re-fetch when the rep returns to the tab (handles share-then-
    // return path so the banner self-hides without page reload).
  }, [profile?.id, tick])

  // Visibility-resume refetch — covers the case where rep tapped Share,
  // returned from WhatsApp, and the banner needs to disappear.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setTick(t => t + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  const hourNow = useMemo(() => istHourNow(), [tick])

  // Eligibility gates.
  const role = (profile?.role || '').toLowerCase()
  if (!ELIGIBLE_ROLES.has(role)) return null
  if (!loaded) return null
  if (dismissed) return null
  if (hourNow < 19) return null

  // Session-state gates.
  if (!session?.check_in_at) return null
  if (session?.check_out_at) return null
  if (session?.evening_summary_sent_at) return null

  function handleTap() {
    const el = document.getElementById(TARGET_ANCHOR)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      // Card not mounted yet (rare — TC role on rare layouts). Best-
      // effort: just scroll to top of page where summary should land.
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  function handleDismiss(e) {
    e.stopPropagation()
    markDismissed()
    setDismissed(true)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleTap}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTap() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 14px',
        marginBottom: 14,
        background: 'var(--warning-soft, rgba(245,158,11,0.12))',
        border: '1px solid var(--warning, #F59E0B)',
        borderRadius: 10,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ color: 'var(--warning, #F59E0B)', display: 'inline-flex' }}>
        <Sunset size={16} strokeWidth={1.6} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13, fontWeight: 700,
            color: 'var(--warning, #F59E0B)',
          }}
        >
          Time to wrap up
        </div>
        <div
          style={{
            fontSize: 11.5, marginTop: 2,
            color: 'var(--v2-ink-2, #94a3b8)',
          }}
        >
          Share your day summary — closes the day automatically.
        </div>
      </div>
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 600,
          color: 'var(--warning, #F59E0B)',
          flexShrink: 0,
        }}
      >
        <ArrowDown size={14} strokeWidth={1.6} />
        Share
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss until tomorrow"
        title="Dismiss until tomorrow"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 36, height: 36, borderRadius: 10,
          background: 'transparent',
          color: 'var(--v2-ink-2, #94a3b8)',
          border: 0, cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={14} strokeWidth={1.6} />
      </button>
    </div>
  )
}
