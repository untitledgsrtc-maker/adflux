import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { ArrowUpCircle, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Phase 180 — in-app APK update banner. NATIVE-ONLY (the web/PWA build updates
// itself via Vercel, so the banner never shows there). On launch it reads the
// latest active `app_version` row, compares the installed Android versionCode,
// and if the row is newer shows a dismissible "Update available" banner.
//
// Tap "Update":
//   • APK >= the build that ships installApk → native UntitledTracking.installApk
//     downloads + opens the Android installer (2-tap: Update here, Install there).
//   • BOOTSTRAP (current APK has no installApk) → falls back to opening apk_url in
//     the browser so the rep downloads + installs the self-updating APK ONCE.
//     After that, every future release is in-app.
//
// Dismissal is per-versionCode (dismissing v96011 won't hide v96012). A row with
// mandatory=true is not dismissible. ZERO effect on the live web app.
// ─────────────────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'app_update_dismissed_code'

export default function AppUpdateBanner() {
  const [info, setInfo] = useState(null)   // { versionName, versionCode, apkUrl, mandatory } when an update exists
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Native APK only — the browser/PWA updates itself.
      if (!Capacitor?.isNativePlatform?.()) return
      let installedBuild = 0
      try {
        const { App } = await import('@capacitor/app')
        const i = await App.getInfo()
        installedBuild = Number(i?.build) || 0   // Android: build === versionCode
      } catch {
        return   // no @capacitor/app → can't compare safely → never nag
      }
      const { data, error } = await supabase
        .from('app_version')
        .select('version_code, version_name, apk_url, mandatory')
        .eq('is_active', true)
        .order('version_code', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled || error || !data) return
      if (Number(data.version_code) <= installedBuild) return   // already up to date
      if (!data.mandatory) {
        let dismissed = null
        try { dismissed = localStorage.getItem(DISMISS_KEY) } catch { /* private mode */ }
        if (dismissed === String(data.version_code)) return     // already dismissed THIS version
      }
      setInfo({
        versionName: data.version_name,
        versionCode: data.version_code,
        apkUrl: data.apk_url,
        mandatory: !!data.mandatory,
      })
    })()
    return () => { cancelled = true }
  }, [])

  if (!info) return null

  async function update() {
    if (busy) return
    setBusy(true)
    try {
      // Prefer the native installer (present from the self-updating APK onward).
      const { registerPlugin } = await import('@capacitor/core')
      const Tracking = registerPlugin('UntitledTracking')
      if (Tracking && typeof Tracking.installApk === 'function') {
        await Tracking.installApk({ url: info.apkUrl })
        return
      }
      throw new Error('installApk unavailable')
    } catch {
      // Bootstrap / no native installer → branded browser download.
      try {
        const { AppLauncher } = await import('@capacitor/app-launcher')
        await AppLauncher.openUrl({ url: info.apkUrl })
      } catch {
        try { window.open(info.apkUrl, '_blank') } catch { /* ignore */ }
      }
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(info.versionCode)) } catch { /* ignore */ }
    setInfo(null)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', marginBottom: 12,
      background: 'var(--v2-yellow, #FFE600)', color: 'var(--v2-ink-0, #0f172a)',
      borderRadius: 'var(--v2-r, 14px)', fontSize: 13, fontWeight: 600,
    }}>
      <ArrowUpCircle size={18} strokeWidth={1.6} />
      <span style={{ flex: 1 }}>
        Update available{info.versionName ? ` (${info.versionName})` : ''} — tap to get the latest app
      </span>
      <button
        onClick={update}
        disabled={busy}
        style={{
          border: 'none', cursor: busy ? 'default' : 'pointer',
          background: 'var(--v2-ink-0, #0f172a)', color: 'var(--v2-yellow, #FFE600)',
          padding: '6px 14px', borderRadius: 'var(--v2-r-sm, 10px)',
          fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Opening…' : 'Update'}
      </button>
      {!info.mandatory && (
        <button
          onClick={dismiss}
          aria-label="Dismiss update"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--v2-ink-0, #0f172a)', display: 'flex', padding: 2 }}
        >
          <X size={16} strokeWidth={1.6} />
        </button>
      )}
    </div>
  )
}
