// src/components/native/NativeOnboarding.jsx
//
// Phase 56f — first-launch permission walkthrough for the Capacitor
// Android wrapper.
//
// Owner directive (18 May 2026):
//   "i want all day background fetched data with call n any other
//    requirement without any big setup on time setup"
//
// On day one, every rep's phone needs four things to be set ONCE:
//   1. Location permission — including background (Allow all the time)
//   2. Call log permission (READ_CALL_LOG)
//   3. Notification permission (POST_NOTIFICATIONS)
//   4. Battery optimisation exclusion (manufacturer settings —
//      cannot be flipped programmatically; we open Settings and
//      walk the rep through it)
//
// This component renders only when:
//   - Capacitor.isNativePlatform() is true (the Android wrapper)
//   - the rep is signed in (profile.id present)
//   - the onboarding-done flag is NOT set in Capacitor Preferences
//
// Once dismissed (either fully completed or "Skip for now"), the
// flag is persisted and the overlay never reappears for this
// account on this device.

import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Geolocation } from '@capacitor/geolocation'
import { PushNotifications } from '@capacitor/push-notifications'
import { MapPin, PhoneCall, Bell, BatteryCharging, CheckCircle2, X, ArrowRight } from 'lucide-react'
import {
  checkCallLogPermission,
  requestCallLogPermission,
} from '../../utils/callLogReader'

const DONE_KEY = 'native-onboarding-done'

export default function NativeOnboarding({ userId, onClose }) {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  // Permission status per step. 'unknown' → not asked yet, 'granted'
  // → done, 'denied' → asked and refused, 'skipped' → user moved on.
  const [locState,  setLocState]  = useState('unknown')
  const [callState, setCallState] = useState('unknown')
  const [pushState, setPushState] = useState('unknown')
  const [battOpened, setBattOpened] = useState(false)

  // Decide on mount whether to show. Web build = never show.
  useEffect(() => {
    if (!userId) return
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    ;(async () => {
      try {
        const { value } = await Preferences.get({ key: doneKeyFor(userId) })
        if (cancelled) return
        if (value === '1') {
          setVisible(false)
          return
        }
        // Refresh current permission states so the UI shows ticks
        // for the ones already granted (e.g. rep re-opened the app
        // mid-onboarding).
        await refreshStates()
        if (!cancelled) setVisible(true)
      } catch {
        // Preferences plugin missing or Android storage error —
        // play safe, do nothing.
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function refreshStates() {
    try {
      const loc = await Geolocation.checkPermissions().catch(() => null)
      if (loc) {
        // loc.location: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
        setLocState(loc.location === 'granted' ? 'granted'
                  : loc.location === 'denied'  ? 'denied'
                  : 'unknown')
      }
    } catch { /* ignore */ }
    try {
      const c = await checkCallLogPermission()
      setCallState(c === 'granted' ? 'granted' : c === 'denied' ? 'denied' : 'unknown')
    } catch { /* ignore */ }
    try {
      const p = await PushNotifications.checkPermissions().catch(() => null)
      if (p) {
        setPushState(p.receive === 'granted' ? 'granted'
                   : p.receive === 'denied'  ? 'denied'
                   : 'unknown')
      }
    } catch { /* ignore */ }
  }

  async function askLocation() {
    setBusy(true)
    try {
      const res = await Geolocation.requestPermissions()
      setLocState(res?.location === 'granted' ? 'granted' : 'denied')
    } catch {
      setLocState('denied')
    } finally {
      setBusy(false)
    }
  }

  async function askCallLog() {
    setBusy(true)
    try {
      const r = await requestCallLogPermission()
      setCallState(r === 'granted' ? 'granted' : 'denied')
    } finally {
      setBusy(false)
    }
  }

  async function askPush() {
    setBusy(true)
    try {
      const r = await PushNotifications.requestPermissions()
      setPushState(r?.receive === 'granted' ? 'granted' : 'denied')
    } catch {
      setPushState('denied')
    } finally {
      setBusy(false)
    }
  }

  async function markDone() {
    try {
      await Preferences.set({ key: doneKeyFor(userId), value: '1' })
    } catch { /* ignore */ }
    setVisible(false)
    onClose?.()
  }

  function next() { setStep(s => Math.min(s + 1, STEPS.length - 1)) }
  function skip() { markDone() }

  if (!visible) return null

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  return (
    <div style={overlay}>
      <div style={sheet}>
        <button onClick={skip} aria-label="Skip onboarding" style={skipBtn}>
          <X size={16} />
        </button>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <span key={i} style={{
              flex: 1, height: 4, borderRadius: 999,
              background: i <= step
                ? 'var(--accent, #FFE600)'
                : 'rgba(255,255,255,.10)',
            }} />
          ))}
        </div>

        {/* Step content */}
        <div style={iconWrap}>
          <current.Icon size={28} strokeWidth={1.6} color="var(--accent, #FFE600)" />
        </div>
        <div style={{
          fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase',
          color: 'var(--text-muted)', marginTop: 14, marginBottom: 4,
        }}>
          Step {step + 1} of {STEPS.length}
        </div>
        <h2 style={title}>{current.title}</h2>
        <p style={body}>{current.body}</p>

        {/* Per-step CTA */}
        {step === 0 && (
          <StepCta
            state={locState}
            grantedLabel="Location granted"
            askLabel="Allow location access"
            deniedLabel="Reopen phone settings"
            busy={busy}
            onAsk={askLocation}
          />
        )}
        {step === 1 && (
          <StepCta
            state={callState}
            grantedLabel="Call log granted"
            askLabel="Allow call log access"
            deniedLabel="Reopen phone settings"
            busy={busy}
            onAsk={askCallLog}
          />
        )}
        {step === 2 && (
          <StepCta
            state={pushState}
            grantedLabel="Notifications granted"
            askLabel="Allow notifications"
            deniedLabel="Reopen phone settings"
            busy={busy}
            onAsk={askPush}
          />
        )}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={battNote}>
              Phone settings can&apos;t be flipped from inside the app.
              Open settings, find <b>Untitled OS</b>, set battery to
              <b> Unrestricted</b>. Without this, Samsung / Xiaomi /
              OnePlus phones stop GPS tracking when the screen turns
              off.
            </div>
            <button
              style={primaryBtn}
              onClick={() => { setBattOpened(true) }}
            >
              I&apos;ve opened battery settings
            </button>
          </div>
        )}

        {/* Step nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
          <button style={ghostBtn} onClick={skip}>Skip for now</button>
          {!isLast && (
            <button
              style={primaryBtn}
              onClick={next}
              disabled={busy}
            >
              Next <ArrowRight size={14} strokeWidth={1.6} />
            </button>
          )}
          {isLast && (
            <button
              style={primaryBtn}
              onClick={markDone}
              disabled={busy || !battOpened}
            >
              Done <CheckCircle2 size={14} strokeWidth={1.6} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StepCta({ state, grantedLabel, askLabel, deniedLabel, busy, onAsk }) {
  if (state === 'granted') {
    return (
      <div style={grantedRow}>
        <CheckCircle2 size={16} strokeWidth={1.6} />
        <span>{grantedLabel}</span>
      </div>
    )
  }
  return (
    <button style={primaryBtn} onClick={onAsk} disabled={busy}>
      {state === 'denied' ? deniedLabel : askLabel}
    </button>
  )
}

/* ─── Per-account onboarding flag ─────────────────────────────── */
function doneKeyFor(userId) {
  // Per-user so switching accounts on a shared device re-prompts.
  return `${DONE_KEY}-${userId}`
}

/* ─── Step config ─────────────────────────────────────────────── */
const STEPS = [
  {
    Icon: MapPin,
    title: 'Allow location all day',
    body:
      'Untitled OS tracks your route so admin can settle TA / DA correctly. ' +
      'Pick "Allow all the time" so tracking continues when the phone screen is off.',
  },
  {
    Icon: PhoneCall,
    title: 'Read call duration',
    body:
      'After every call, the app reads the call duration from your Android call log ' +
      'so you don\'t have to type it manually. SIM choice is ignored — only the lead ' +
      'number you tapped is matched.',
  },
  {
    Icon: Bell,
    title: 'Get push notifications',
    body:
      'New leads, callback reminders, and admin pings arrive as real notifications, ' +
      'not in-app banners.',
  },
  {
    Icon: BatteryCharging,
    title: 'Exclude from battery saver',
    body:
      'Samsung / Xiaomi / OnePlus phones aggressively kill background apps. ' +
      'Open Settings, find Untitled OS, set the battery option to Unrestricted ' +
      '(or "No restrictions" / "Don\'t optimise" depending on phone make).',
  },
]

/* ─── Styles (inline; matches v2 dark theme) ──────────────────── */
const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.92)',
  // §29 frozen z-index landscape: 9000 (Modal), 9999 (Toast),
  // 10000 (ConfirmDialog). No 9500 tier exists. Use 9000 (Modal
  // tier) so onboarding stays a peer of PostCallOutcomeModal —
  // the V2AppShell renders <NativeOnboarding /> AFTER
  // <ConfirmDialogViewport /> in JSX order, so at equal z-index
  // DOM order wins and onboarding sits above an open Modal if both
  // ever coexist on first launch (rare; onboarding is one-time per
  // device + user). Confirm + Toast still win over either.
  zIndex: 9000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}
const sheet = {
  position: 'relative',
  width: '100%',
  maxWidth: 420,
  background: 'var(--surface, #1e293b)',
  border: '1px solid var(--border, #334155)',
  borderRadius: 20,
  padding: '28px 24px 20px',
  color: 'var(--text, #f1f5f9)',
}
const skipBtn = {
  position: 'absolute', top: 12, right: 12,
  width: 32, height: 32,
  border: '1px solid var(--border, #334155)',
  background: 'transparent',
  color: 'var(--text-muted, #94a3b8)',
  borderRadius: 999,
  cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const iconWrap = {
  width: 56, height: 56,
  borderRadius: 14,
  background: 'rgba(255,230,0,.10)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const title = {
  margin: 0,
  fontFamily: 'var(--font-display, var(--font-sans))',
  fontSize: 20,
  fontWeight: 700,
  marginBottom: 8,
}
const body = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--text-muted, #94a3b8)',
  marginBottom: 16,
}
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid var(--accent, #FFE600)',
  background: 'var(--accent, #FFE600)',
  color: 'var(--accent-fg, #0f172a)',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
}
const ghostBtn = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--border, #334155)',
  background: 'transparent',
  color: 'var(--text-muted, #94a3b8)',
  fontSize: 13,
  cursor: 'pointer',
}
const grantedRow = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'var(--success-soft, rgba(16,185,129,.12))',
  color: 'var(--success, #10B981)',
  fontSize: 13,
  fontWeight: 600,
}
const battNote = {
  padding: '12px 14px',
  borderRadius: 10,
  background: 'rgba(255,255,255,.04)',
  border: '1px solid var(--border, #334155)',
  fontSize: 12,
  lineHeight: 1.55,
  color: 'var(--text, #f1f5f9)',
}
