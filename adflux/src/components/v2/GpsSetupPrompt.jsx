import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { Satellite, X } from 'lucide-react'
import { requestBatteryUnrestricted, openLocationSettings } from '../../utils/nativeTracking'

// ─────────────────────────────────────────────────────────────────────────────
// Phase 180 — one-time GPS-capture onboarding (§73 #1). Native-only.
//
// Phase 250 — now serves TELECALLERS too, in `battery` mode. The battery half
// was always the important part for them: an app that Android is free to kill
// loses the post-call outcome AND the follow-up when the dialer takes the
// foreground (§250). Telecallers were excluded from this prompt entirely, so
// the very reps reporting "the app reloaded and the outcome never came" had
// never once been asked to whitelist it. GPS wording is wrong for them, hence
// the mode. Closes the dark-window km undercount by walking the rep to the
// two phone settings Android won't let an app set silently:
//   Location = "Allow all the time"  +  Battery = Unrestricted.
//
// Gated to APK build >= 96014 — the native deep-link methods ship in that build,
// so a current-APK (96013) rep never sees a dead "Set up" button. Web = no-op.
// Dismissible + remembered (per device). Tap "Set up" → battery dialog, then the
// app's location-settings screen.
// ─────────────────────────────────────────────────────────────────────────────

const DONE_KEY_BY_MODE = { gps: 'gps_setup_prompt_done', battery: 'battery_setup_prompt_done' }
const MIN_BUILD = 96014

export default function GpsSetupPrompt({ enabled = false, mode = 'gps' }) {
  const DONE_KEY = DONE_KEY_BY_MODE[mode] || DONE_KEY_BY_MODE.gps
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      if (!Capacitor?.isNativePlatform?.()) return
      let build = 0
      try {
        const { App } = await import('@capacitor/app')
        const i = await App.getInfo()
        build = Number(i?.build) || 0
      } catch {
        return   // can't read version → don't nag
      }
      if (build < MIN_BUILD) return   // native deep-links not in this APK yet
      let done = null
      try { done = localStorage.getItem(DONE_KEY) } catch { /* private mode */ }
      if (done) return
      if (!cancelled) setShow(true)
    })()
    return () => { cancelled = true }
  }, [enabled])

  if (!show) return null

  async function setUp() {
    if (busy) return
    setBusy(true)
    try {
      // Battery first (a quick allow/deny dialog), then the app's location
      // settings screen where the rep picks "Allow all the time".
      await requestBatteryUnrestricted()
      // Location is meaningless for a telecaller — battery is the whole point.
      if (mode !== 'battery') await openLocationSettings()
    } catch { /* deep-links are best-effort */ }
    finally {
      setBusy(false)
      try { localStorage.setItem(DONE_KEY, '1') } catch { /* ignore */ }
      setShow(false)
    }
  }

  function dismiss() {
    try { localStorage.setItem(DONE_KEY, '1') } catch { /* ignore */ }
    setShow(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', marginBottom: 12,
      background: 'var(--v2-bg-2, #1e293b)', color: 'var(--v2-ink-1, #cbd5e1)',
      border: '1px solid var(--v2-line, #334155)',
      borderRadius: 'var(--v2-r, 14px)', fontSize: 13,
    }}>
      <Satellite size={18} strokeWidth={1.6} />
      <span style={{ flex: 1 }}>
        {mode === 'battery'
          ? 'Set Battery to Unrestricted so the app is not closed during a call — otherwise the outcome popup is lost.'
          : 'Turn on accurate GPS — set Location to "Allow all the time" + Battery to Unrestricted so your km counts.'}
      </span>
      <button
        onClick={setUp}
        disabled={busy}
        style={{
          border: 'none', cursor: busy ? 'default' : 'pointer',
          background: 'var(--v2-yellow, #FFE600)', color: 'var(--v2-ink-0, #0f172a)',
          padding: '6px 14px', borderRadius: 'var(--v2-r-sm, 10px)',
          fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Opening…' : 'Set up'}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--v2-ink-2, #94a3b8)', display: 'flex', padding: 2 }}
      >
        <X size={16} strokeWidth={1.6} />
      </button>
    </div>
  )
}
