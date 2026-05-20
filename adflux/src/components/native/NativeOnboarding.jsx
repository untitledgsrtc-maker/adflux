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
import { MapPin, PhoneCall, Bell, BatteryCharging, CheckCircle2, X, ArrowRight, ShieldCheck, Loader2 } from 'lucide-react'
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
    try {
      const res = await Geolocation.requestPermissions()
      setLocState(res?.location === 'granted' ? 'granted' : 'denied')
    } catch {
      setLocState('denied')
    }
  }

  async function askCallLog() {
    try {
      const r = await requestCallLogPermission()
      setCallState(r === 'granted' ? 'granted' : 'denied')
    } catch {
      setCallState('denied')
    }
  }

  async function askPush() {
    try {
      const r = await PushNotifications.requestPermissions()
      setPushState(r?.receive === 'granted' ? 'granted' : 'denied')
    } catch {
      setPushState('denied')
    }
  }

  // Phase 57e — fire all 3 permission prompts back-to-back. Android
  // OS rule forces a separate dialog per category (Google audit
  // requirement), but the prompts auto-chain in 8-10 seconds. Each
  // requestPermissions resolves only after the user taps Allow /
  // Deny, then the next one fires.
  async function grantAllAccess() {
    setBusy(true)
    try {
      await askLocation()
      await askCallLog()
      await askPush()
    } finally {
      setBusy(false)
    }
  }

  const allThreeGranted = locState === 'granted' && callState === 'granted' && pushState === 'granted'
  const anyAttempted    = locState !== 'unknown' || callState !== 'unknown' || pushState !== 'unknown'

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

        {/* Step 0 — single "Allow all access" CTA chains 3 prompts.
            Phase 57e (19 May 2026): owner asked "can we override all
            permission in one allow". Android OS forces separate
            dialogs per category, but they auto-chain so user taps
            Allow 3× in ~10 seconds instead of stepping through 3
            onboarding screens. */}
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Permission status pills — surface what's granted so far. */}
            {anyAttempted && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6,
                fontSize: 11, color: 'var(--text-muted)',
              }}>
                <PermPill icon={<MapPin size={10} strokeWidth={1.6} />} label="Location" state={locState} />
                <PermPill icon={<PhoneCall size={10} strokeWidth={1.6} />} label="Call log" state={callState} />
                <PermPill icon={<Bell size={10} strokeWidth={1.6} />} label="Notifications" state={pushState} />
              </div>
            )}
            {allThreeGranted ? (
              <div style={grantedRow}>
                <CheckCircle2 size={16} strokeWidth={1.6} />
                <span>All 3 permissions granted</span>
              </div>
            ) : (
              <button style={primaryBtn} onClick={grantAllAccess} disabled={busy}>
                {busy
                  ? <><Loader2 size={14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} /> Granting…</>
                  : <><ShieldCheck size={14} strokeWidth={1.6} /> Allow all access</>}
              </button>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              You'll see 3 Android prompts in sequence — tap <b>Allow</b> on each.
              For Location, pick <b>"Allow all the time"</b> so tracking continues when the screen is off.
            </div>
          </div>
        )}

        {/* Step 1 — battery settings (manual; Android won't let
            apps flip this). */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={battNote}>
              Phone settings can&apos;t be flipped from inside the app.
              Open Settings, find <b>Untitled OS</b>, set battery to
              <b> Unrestricted</b>. Without this, Samsung / Xiaomi /
              OnePlus phones stop GPS tracking when the screen turns
              off.
            </div>
            <button
              style={primaryBtn}
              onClick={() => {
                // Phase 66 (21 May 2026) — owner reported "tap → nothing
                // happens". Earlier the button only flipped state. Now
                // we fire an Android intent that launches the system
                // battery-optimization settings page directly. WebView
                // honours `intent://` URIs natively.
                //   - APPLICATION_DETAILS_SETTINGS lands on this app's
                //     info page (one tap to Battery → Unrestricted).
                //   - Falls back to IGNORE_BATTERY_OPTIMIZATION_SETTINGS
                //     (system-wide list) if package URI fails.
                try {
                  const pkg = 'in.untitledad.app'
                  const intentUrl =
                    `intent://#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;` +
                    `package=${pkg};data=package:${pkg};end`
                  window.location.href = intentUrl
                } catch (e) {
                  // Fallback: system-wide battery-optimization list.
                  try {
                    window.location.href =
                      'intent://#Intent;action=android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS;end'
                  } catch (_) { /* swallow — user can navigate manually */ }
                }
                setBattOpened(true)
              }}
            >
              {battOpened
                ? <><CheckCircle2 size={14} strokeWidth={1.6} /> Battery settings opened</>
                : <>Open battery settings</>}
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

function PermPill({ icon, label, state }) {
  const color = state === 'granted' ? 'var(--success, #10B981)'
              : state === 'denied'  ? 'var(--danger, #EF4444)'
              :                       'var(--text-muted, #94a3b8)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999,
      border: `1px solid ${color}`, color,
      fontSize: 10, fontWeight: 600,
    }}>
      {icon} {label}{state === 'granted' ? ' ✓' : state === 'denied' ? ' ✗' : ''}
    </span>
  )
}

/* ─── Per-account onboarding flag ─────────────────────────────── */
function doneKeyFor(userId) {
  // Per-user so switching accounts on a shared device re-prompts.
  return `${DONE_KEY}-${userId}`
}

/* ─── Step config ─────────────────────────────────────────────── */
/* Phase 57e — collapsed from 4 steps to 2. Step 1 chains the 3
   runtime permission prompts in one tap; step 2 is the manual
   battery exclusion (Android forces Settings navigation; can't be
   programmatic). */
const STEPS = [
  {
    Icon: ShieldCheck,
    title: 'Allow access',
    body:
      'Untitled OS needs 3 phone permissions: location (for route tracking), ' +
      'call log (for duration), and notifications. Tap the button below — ' +
      'Android will show 3 prompts one after another. Tap Allow on each.',
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
