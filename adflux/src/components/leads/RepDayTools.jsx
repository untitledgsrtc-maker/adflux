// src/components/leads/RepDayTools.jsx
//
// Phase 33Q — rep-side day-management tools for /work.
//
// Three pieces folded into one mountable component:
//   1. MissedDaysBanner    — warning when 3+ consecutive missed days
//      (variable salary at risk). Dismissible per-day via localStorage.
//   2. OvernightToggle      — rep flags "I stayed overnight here"
//      → work_sessions.overnight_stay = true → admin sees on /admin/ta-payouts.
//   3. RequestLeaveModal    — rep submits a pending leave for a future
//      date. Admin sees in /admin/leaves and approves.
//
// Owner directives covered:
//   #12 — apply leave (rep side)
//   #13 — TA hotel toggle (rep side; admin still types the amount)
//   #16 — 3-day-miss popup with salary warning

import { useEffect, useState } from 'react'
import {
  AlertTriangle, Hotel, CalendarPlus, X, Check, BellRing, BellOff,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import {
  sendPushToRep, registerServiceWorker, subscribeForPush,
} from '../../utils/pushNotifications'

const LEAVE_TYPES = [
  { key: 'sick',         label: 'Sick'        },
  { key: 'personal',     label: 'Personal'    },
  { key: 'vacation',     label: 'Vacation'    },
  { key: 'bereavement',  label: 'Bereavement' },
  { key: 'other',        label: 'Other'       },
]

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ─── 1. MissedDaysBanner ────────────────────────────────────────
function MissedDaysBanner({ userId }) {
  const [missed, setMissed] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!userId) return
    // Suppress for the rest of the day if dismissed.
    const stamp = localStorage.getItem(`missed_dismissed_${userId}`)
    if (stamp === todayISO()) { setDismissed(true); return }

    ;(async () => {
      const { data } = await supabase.rpc('consecutive_missed_days', {
        p_user_id: userId,
      })
      setMissed(Number(data) || 0)
    })()
  }, [userId])

  if (dismissed || missed < 3) return null

  function dismiss() {
    localStorage.setItem(`missed_dismissed_${userId}`, todayISO())
    setDismissed(true)
  }

  return (
    <div style={{
      background: 'rgba(239,68,68,.10)',
      border: '1px solid var(--danger, #EF4444)',
      borderRadius: 12, padding: 14, marginBottom: 12,
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <AlertTriangle size={20} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>
          {missed} days below 50% — variable salary at risk
        </div>
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.45 }}>
          You've missed your daily target for {missed} working days in a row.
          Hit your meeting target today to pull the average back. If the month
          ends below 50% your variable salary drops to zero.
        </div>
      </div>
      <button
        onClick={dismiss}
        title="Dismiss for today"
        style={{
          background: 'none', border: 0, color: 'var(--text-muted)',
          cursor: 'pointer', padding: 2,
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ─── 2. OvernightToggle ─────────────────────────────────────────
function OvernightToggle({ userId, workDate }) {
  const [on, setOn] = useState(null)  // null = loading, true/false = real
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId) return
    ;(async () => {
      const { data } = await supabase.from('work_sessions')
        .select('overnight_stay')
        .eq('user_id', userId).eq('work_date', workDate)
        .maybeSingle()
      setOn(Boolean(data?.overnight_stay))
    })()
  }, [userId, workDate])

  async function toggle() {
    if (on === null) return
    setBusy(true)
    const next = !on
    const { error } = await supabase.from('work_sessions')
      .update({ overnight_stay: next })
      .eq('user_id', userId).eq('work_date', workDate)
    setBusy(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setOn(next)
  }

  if (on === null) return null

  return (
    <button
      onClick={toggle}
      disabled={busy}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, width: '100%',
        padding: '12px 14px', borderRadius: 10,
        background: on ? 'rgba(255,230,0,.10)' : 'var(--surface-2)',
        border: `1px solid ${on ? 'var(--accent, #FFE600)' : 'var(--border)'}`,
        color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Hotel size={16} style={{ color: on ? 'var(--accent)' : 'var(--text-muted)' }} />
        {on ? 'Staying overnight here — flagged' : 'I am staying overnight here'}
      </span>
      {on && (
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
          padding: '2px 8px', borderRadius: 999,
          background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
          textTransform: 'uppercase',
        }}>
          ON
        </span>
      )}
    </button>
  )
}

// ─── 3. RequestLeaveModal ───────────────────────────────────────
// Phase 34Z.71 — exported so MyOfferV2 can mount it directly under
// the offer letter. Same component the /work RepDayTools drawer
// uses; one source of truth.
export function RequestLeaveModal({ userId, onClose, onSaved }) {
  const [fDate, setFDate] = useState(todayISO())
  const [fType, setFType] = useState('personal')
  const [fReason, setFReason] = useState('')
  // Phase 36.1 — half-day support on rep-side leave request. Matches
  // the admin LeavesAdminV2 checkbox. Salary RPC counts it as 0.5 day
  // against the annual paid quota.
  const [fHalfDay, setFHalfDay] = useState(false)
  // Phase 36.10 — rep chooses Paid or Unpaid. Paid option only
  // enabled when tenure ≥ 9 months from staff_incentive_profiles
  // .join_date. Default Paid when eligible, else forced to Unpaid.
  const [fIsPaid, setFIsPaid] = useState(true)
  const [paidEligible, setPaidEligible] = useState(false)
  const [eligLoading, setEligLoading] = useState(true)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setEligLoading(true)
    supabase.rpc('eligible_for_paid_leave', { p_user_id: userId })
      .then(({ data }) => {
        if (cancelled) return
        const ok = !!data
        setPaidEligible(ok)
        setFIsPaid(ok)  // Default Paid only if eligible.
        setEligLoading(false)
      })
    return () => { cancelled = true }
  }, [userId])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!fDate) { setErr('Pick a date.'); return }
    setSaving(true); setErr('')
    const { error } = await supabase.from('leaves').insert({
      user_id: userId,
      leave_date: fDate,
      leave_type: fType,
      reason: (fReason || '').trim() || null,
      status: 'pending',
      is_half_day: fHalfDay,
      // Phase 36.10 — paid/unpaid choice. Server-side
      // eligible_for_paid_leave() is the policy source of truth; the
      // UI just nudges the rep. If tenure < 9 months, client forces
      // false; server can still validate via RLS / trigger if needed
      // in a future phase.
      is_paid_request: paidEligible ? fIsPaid : false,
      created_by: userId,
    })
    setSaving(false)
    if (error) {
      setErr(error.code === '23505'
        ? 'You already have a leave on that date.'
        : (error.message || 'Submit failed.'))
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div
      onClick={() => !saving && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14, padding: 18,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            Request leave
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Goes to admin as a pending request. Once approved it's excluded
          from your monthly performance score.
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Date
          </label>
          <input
            type="date"
            value={fDate}
            onChange={e => setFDate(e.target.value)}
            style={{
              width: '100%', marginTop: 4,
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 14,
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Type
          </label>
          <select
            value={fType}
            onChange={e => setFType(e.target.value)}
            style={{
              width: '100%', marginTop: 4,
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 14,
            }}
          >
            {LEAVE_TYPES.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Reason (optional)
          </label>
          <input
            type="text"
            value={fReason}
            onChange={e => setFReason(e.target.value)}
            placeholder="Family wedding · medical · etc."
            style={{
              width: '100%', marginTop: 4,
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 14,
            }}
          />
        </div>
        {/* Phase 36.1 — half-day toggle. */}
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: 'var(--text)', cursor: 'pointer',
          padding: '8px 0', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={fHalfDay}
            onChange={e => setFHalfDay(e.target.checked)}
            style={{
              width: 18, height: 18,
              accentColor: 'var(--accent, #FFE600)',
              cursor: 'pointer',
            }}
          />
          <span>Half-day only (counts as 0.5)</span>
        </label>

        {/* Phase 36.10 — Paid / Unpaid toggle. Paid disabled when
            tenure < 9 months. */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Pay status
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {[
              { key: true,  label: 'Paid leave',   disabled: !paidEligible },
              { key: false, label: 'Unpaid leave', disabled: false },
            ].map(opt => {
              const on = fIsPaid === opt.key
              return (
                <button
                  key={String(opt.key)}
                  type="button"
                  onClick={() => !opt.disabled && setFIsPaid(opt.key)}
                  disabled={opt.disabled || eligLoading}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 10,
                    border: `1px solid ${on ? 'var(--accent, #FFE600)' : 'var(--border)'}`,
                    background: on ? 'rgba(255,230,0,.14)' : 'var(--surface-2)',
                    color: opt.disabled
                      ? 'var(--text-subtle)'
                      : on ? 'var(--accent, #FFE600)' : 'var(--text)',
                    fontSize: 13, fontWeight: 600,
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    opacity: opt.disabled ? 0.55 : 1,
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          {!eligLoading && !paidEligible && (
            <div style={{
              marginTop: 6, fontSize: 11, color: 'var(--text-muted)',
              padding: '6px 10px', background: 'rgba(255,230,0,.08)',
              border: '1px dashed var(--accent, #FFE600)', borderRadius: 8,
            }}>
              Paid leave is available after 9 months from your joining date.
              For now your request will be submitted as unpaid.
            </div>
          )}
        </div>
        {err && (
          <div style={{ color: 'var(--danger)', fontSize: 12 }}>
            <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {err}
          </div>
        )}
        <button
          onClick={submit}
          disabled={saving}
          style={{
            width: '100%', padding: '12px',
            background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
            border: 0, borderRadius: 10,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          <Check size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {saving ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </div>
  )
}

// ─── EnableNotificationsButton (Phase 33V) ──────────────────────
// Owner-reported issue: auto-subscribe on /work mount silently fails
// on iOS Safari and sometimes on Chrome. iOS often requires the
// subscribe call to come from a direct user gesture, not from a
// useEffect. This button does the whole flow on tap with verbose
// error reporting so we can see exactly where it fails.
function EnableNotificationsButton({ userId }) {
  const [state, setState] = useState('idle')  // idle | working | enabled | failed
  const [msg, setMsg] = useState('')
  const [isSubscribed, setIsSubscribed] = useState(null)

  // Check current state on mount.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setIsSubscribed(false)
      return
    }
    ;(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      // Also check that a Supabase row exists for THIS endpoint.
      if (sub) {
        const { count } = await supabase.from('push_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('endpoint', sub.endpoint)
        setIsSubscribed((count || 0) > 0)
      } else {
        setIsSubscribed(false)
      }
    })()
  }, [userId])

  async function enable() {
    setState('working'); setMsg('')
    try {
      // Step 1 — service worker.
      const reg = await registerServiceWorker()
      if (!reg) { setMsg('Service worker not supported in this browser'); setState('failed'); return }

      // Step 2 — permission. iOS REQUIRES this to run on a user gesture.
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setMsg(perm === 'denied'
          ? 'Permission denied. Re-enable in Settings → ' + (navigator.userAgent.includes('iPhone') ? 'Untitled' : 'this site') + ' → Notifications.'
          : 'Permission not granted. Tap Allow when prompted.')
        setState('failed')
        return
      }

      // Step 3 — subscribe (uses VITE_VAPID_PUBLIC_KEY).
      const sub = await subscribeForPush(userId)
      if (!sub) {
        setMsg('Subscribe failed. Check VITE_VAPID_PUBLIC_KEY is set in Vercel.')
        setState('failed')
        return
      }

      // Step 4 — verify the row landed in Supabase.
      const { count, error } = await supabase.from('push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('endpoint', sub.endpoint)
      if (error) {
        setMsg('Row check failed: ' + error.message)
        setState('failed')
        return
      }
      if (!count) {
        setMsg('Subscribed but row not saved. RLS issue.')
        setState('failed')
        return
      }

      setState('enabled')
      setMsg('Notifications enabled. Tap "Send test push" below to verify.')
      setIsSubscribed(true)
    } catch (e) {
      setState('failed')
      setMsg('Error: ' + (e?.message || String(e)))
    }
  }

  if (isSubscribed === null) return null

  // Already subscribed — show calm green confirmation.
  if (isSubscribed && state !== 'failed') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', borderRadius: 10,
        background: 'rgba(16,185,129,.08)',
        border: '1px solid var(--success, #10B981)',
        color: 'var(--success)', fontSize: 12, fontWeight: 600,
      }}>
        <Check size={14} />
        Notifications enabled on this device
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={enable}
        disabled={state === 'working'}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 14px', borderRadius: 10,
          background: state === 'failed' ? 'rgba(239,68,68,.10)' : 'var(--accent, #FFE600)',
          border: state === 'failed' ? '1px solid var(--danger)' : 0,
          color: state === 'failed' ? 'var(--danger)' : 'var(--accent-fg, #0f172a)',
          cursor: 'pointer', fontSize: 14, fontWeight: 700,
          width: '100%', textAlign: 'left',
        }}
      >
        {state === 'failed' ? <BellOff size={16} /> : <BellRing size={16} />}
        {state === 'working' ? 'Enabling…'
          : state === 'failed' ? 'Try again'
          : 'Enable notifications'}
      </button>
      {msg && (
        <div style={{
          fontSize: 11, lineHeight: 1.4,
          color: state === 'failed' ? 'var(--danger)' : 'var(--text-muted)',
          marginTop: 6, paddingLeft: 4,
        }}>
          {msg}
        </div>
      )}
    </div>
  )
}

// ─── TestPushButton (Phase 33S smoke test) ─────────────────────
// Owner-only. Sends a self-targeted push so we can verify the
// VAPID + Edge Function + service worker chain works without
// waiting for a real trigger.
function TestPushButton({ userId }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function go() {
    setBusy(true); setMsg('')
    const res = await sendPushToRep({
      userId,
      title: 'Test push from Untitled OS',
      body: 'If you see this, push is working end-to-end.',
      tag: 'test-push',
      url: '/work',
    })
    setBusy(false)
    if (!res) { setMsg('Call failed — see console'); return }
    if (res.sent > 0) {
      setMsg(`Sent to ${res.sent} device${res.sent > 1 ? 's' : ''}`)
    } else {
      setMsg(res.reason || 'No subscriptions (allow notifications first)')
    }
  }
  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', borderRadius: 10,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'left',
        }}
      >
        <BellRing size={14} />
        {busy ? 'Sending test push…' : 'Send test push to my device'}
      </button>
      {msg && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 4 }}>
          {msg}
        </div>
      )}
    </div>
  )
}

// ─── Main export ────────────────────────────────────────────────
export default function RepDayTools({ workDate, checkedIn }) {
  const profile = useAuthStore(s => s.profile)
  const [leaveOpen, setLeaveOpen] = useState(false)
  if (!profile?.id) return null

  return (
    <div style={{ marginTop: 12 }}>
      <MissedDaysBanner userId={profile.id} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Overnight toggle — only when checked in (work_sessions row exists). */}
        {checkedIn && (
          <OvernightToggle userId={profile.id} workDate={workDate} />
        )}

        <button
          onClick={() => setLeaveOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            textAlign: 'left',
          }}
        >
          <CalendarPlus size={16} style={{ color: 'var(--text-muted)' }} />
          Request leave
        </button>

        {/* Phase 33V — explicit Enable button. Auto-subscribe on /work
            mount silently fails on iOS PWA + sometimes on Chrome. iOS
            requires the subscribe call to come from a real user
            gesture, not from a useEffect. This button runs the full
            flow on tap and surfaces specific errors. */}
        <EnableNotificationsButton userId={profile.id} />

        {/* Phase 33S — smoke test for the push notification chain.
            Tap → fires notify-rep with a 'test push' payload. Confirms
            VAPID keys, Edge Function, service worker, browser
            permission all working. */}
        <TestPushButton userId={profile.id} />
      </div>

      {leaveOpen && (
        <RequestLeaveModal
          userId={profile.id}
          onClose={() => setLeaveOpen(false)}
          onSaved={() => { /* admin gets it via realtime / next load */ }}
        />
      )}
    </div>
  )
}
