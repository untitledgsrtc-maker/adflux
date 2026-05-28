// src/pages/v2/PushDebugV2.jsx
//
// Phase 34Z.55 — push notification diagnostic page.
//
// Owner reported (15 May 2026): "whenever the task or call, whatever
// the notification or upcoming notification are there, but in the
// notification tab, post notification not coming in the application."
//
// Web Push has six independent gates. If any one fails silently, the
// rep never sees a notification. This page surfaces each gate's state
// and offers a one-tap fix where possible.
//
// Gates:
//   1. Browser supports Notification API
//   2. Browser supports Push API (PushManager + Service Worker)
//   3. VITE_VAPID_PUBLIC_KEY is set in the build env
//   4. Service Worker registered + active
//   5. Notification.permission === 'granted'
//   6. push_subscriptions has at least one row for this user
//
// Plus: a "Send test push" button that invokes notify-rep with a
// dummy payload so the rep can verify the OS-level alert appears.
//
// Common iOS PWA gotchas the page calls out inline:
//   • Safari requires iOS 16.4+ AND the app installed to the home
//     screen ("Add to Home Screen"). In-browser Safari blocks Push.
//   • Notifications must be re-granted per device — granting on
//     desktop Chrome doesn't propagate to the phone.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Send, Bell, Smartphone, Wifi, Phone as PhoneIcon,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  registerServiceWorker, requestPermission,
  subscribeForPush, sendPushToRep,
} from '../../utils/pushNotifications'
import { checkCallLogPermission, requestCallLogPermission } from '../../utils/callLogReader'
import { forceIngestRecentCalls } from '../../utils/callHistoryIngest'
import { toastError, toastSuccess } from '../../components/v2/Toast'

const CallLogReader = registerPlugin('CallLogReader')

function Status({ ok, warn, label, detail, action }) {
  const tone = ok ? 'success' : warn ? 'warning' : 'danger'
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle
  const color = ok ? 'var(--success, #10B981)'
    : warn ? 'var(--warning, #F59E0B)'
    : 'var(--danger, #EF4444)'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px',
      border: '1px solid var(--border, #334155)',
      borderRadius: 10,
      background: 'var(--surface, #1e293b)',
      marginBottom: 8,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: `${color}22`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={16} strokeWidth={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {label}
        </div>
        {detail && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            {detail}
          </div>
        )}
        {action && <div style={{ marginTop: 8 }}>{action}</div>}
      </div>
    </div>
  )
}

export default function PushDebugV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  // Phase 97.7 (2026-05-28, F-003) — Send test push + registered
  // devices listing are privileged-only. Route stays open so reps
  // can self-enroll (Enable + permission + SW + subscription gates)
  // and view their own 6-gate status. Admin tooling is gated below.
  const isPrivileged = profile?.role === 'admin' || profile?.role === 'co_owner'

  const [hasNotificationApi, setHasNotificationApi] = useState(false)
  const [hasPushApi,         setHasPushApi]         = useState(false)
  const [permission,         setPermission]         = useState('default')
  const [vapidKey,           setVapidKey]           = useState('')
  const [swReady,            setSwReady]            = useState(false)
  const [swScope,            setSwScope]            = useState('')
  const [pushSub,            setPushSub]            = useState(null)
  const [subRows,            setSubRows]            = useState([])
  const [loading,            setLoading]            = useState(false)
  const [testing,            setTesting]            = useState(false)
  const [isStandalone,       setIsStandalone]       = useState(false)
  const [isIOS,              setIsIOS]              = useState(false)
  const [isAndroid,          setIsAndroid]          = useState(false)
  const [browserName,        setBrowserName]        = useState('')

  // Phase 65 (20 May 2026) — call-log scan diagnostic. Phase 56l
  // shipped scanRecentCalls() in the Capacitor Java plugin but reps
  // report inbound + missed calls aren't landing in our call_logs.
  // This section exposes:
  //   - Capacitor native? (web shows N/A)
  //   - READ_CALL_LOG permission state
  //   - Manual "Scan now" button → runs scanRecentCalls with last 24h
  //     window, shows count + breakdown by type. If permission is
  //     denied, request prompt fires.
  const [callPerm,           setCallPerm]           = useState('unsupported')
  const [callScanBusy,       setCallScanBusy]       = useState(false)
  const [callScanResult,     setCallScanResult]     = useState(null)

  async function reload() {
    setLoading(true)
    setHasNotificationApi('Notification' in window)
    setHasPushApi('serviceWorker' in navigator && 'PushManager' in window)
    setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
    setVapidKey(import.meta.env.VITE_VAPID_PUBLIC_KEY || '')

    // Phase 65 — refresh READ_CALL_LOG permission state.
    try {
      const p = await checkCallLogPermission()
      setCallPerm(p)
    } catch {
      setCallPerm('unsupported')
    }

    // Detect platform. iOS Safari has the strictest gate: PWA must be
    // installed to the home screen on iOS 16.4+. Android Chrome accepts
    // Web Push from regular browser tabs AND installed PWAs — no
    // standalone requirement. Majority of the Untitled sales team is
    // on Android tablets so the iOS-only banner is suppressed there.
    const ua = navigator.userAgent || ''
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !window.MSStream)
    setIsAndroid(/Android/i.test(ua))
    // Best-effort browser sniff for diagnostic copy (only used to
    // surface battery-optimisation guidance per browser).
    if (/SamsungBrowser/i.test(ua))      setBrowserName('Samsung Internet')
    else if (/Edg\//i.test(ua))          setBrowserName('Edge')
    else if (/Firefox/i.test(ua))        setBrowserName('Firefox')
    else if (/Chrome\//i.test(ua))       setBrowserName('Chrome')
    else if (/Safari/i.test(ua))         setBrowserName('Safari')
    else                                 setBrowserName('Browser')
    setIsStandalone(
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari uses this proprietary property when launched from
      // the home screen.
      // eslint-disable-next-line no-prototype-builtins
      (window.navigator.standalone === true)
    )

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/')
        setSwReady(!!reg && !!reg.active)
        setSwScope(reg?.scope || '')
        if (reg?.pushManager) {
          const sub = await reg.pushManager.getSubscription()
          setPushSub(sub)
        }
      } catch (_) { /* ignore */ }
    }

    if (profile?.id) {
      const { data } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, user_agent, last_seen_at, created_at')
        .eq('user_id', profile.id)
        .order('last_seen_at', { ascending: false })
      setSubRows(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function handleEnable() {
    try {
      await registerServiceWorker()
      const perm = await requestPermission()
      if (perm !== 'granted') {
        toastError(
          new Error('Permission denied'),
          'Browser blocked notifications. Open Settings → Notifications → allow this site.'
        )
        await reload()
        return
      }
      const sub = await subscribeForPush(profile?.id)
      if (!sub) {
        toastError(
          new Error('Subscribe failed'),
          'Could not subscribe. Check VITE_VAPID_PUBLIC_KEY is set in Vercel env.'
        )
      } else {
        toastSuccess('Push enabled on this device.')
      }
      await reload()
    } catch (e) {
      toastError(e, 'Enable push failed.')
    }
  }

  // Phase 65 (20 May 2026) — call-log permission + manual scan.
  // Web build: button is hidden (Capacitor.isNativePlatform() = false).
  async function handleGrantCallLog() {
    try {
      const p = await requestCallLogPermission()
      setCallPerm(p)
      if (p === 'granted') toastSuccess('Call log permission granted.')
      else toastError(new Error(`Permission ${p}`), 'Could not grant call log permission.')
    } catch (e) {
      toastError(e, 'Call log permission request failed.')
    }
  }

  async function handleScanCallLog() {
    if (!Capacitor.isNativePlatform()) {
      toastError(new Error('Native only'), 'Call log scan only works inside the APK.')
      return
    }
    if (!profile?.id) return
    setCallScanBusy(true)
    setCallScanResult(null)
    try {
      // Phase 68.3 — actually INGEST into call_logs, not just preview.
      // 7-day lookback so fresh APK installs backfill a week of history
      // in one shot. Previously this button only displayed counts and
      // the periodic poller (30-min initial window) missed older calls.
      const lookbackMs = 7 * 24 * 60 * 60 * 1000
      const result = await forceIngestRecentCalls(profile.id, lookbackMs)
      setCallScanResult({
        total: result.found,
        inserted: result.inserted,
        skipped: result.skipped,
        errors: result.errors,
      })
      if ((result.errors || []).length > 0) {
        toastError(new Error(result.errors[0]), `Scan finished with ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}.`)
      } else {
        toastSuccess(
          `Scan done — ${result.found} call${result.found === 1 ? '' : 's'} found, ${result.inserted} new row${result.inserted === 1 ? '' : 's'} inserted.`
        )
      }
    } catch (e) {
      const msg = e?.message || String(e)
      setCallScanResult({ error: msg })
      toastError(e, `Scan failed: ${msg}`)
    } finally {
      setCallScanBusy(false)
    }
  }

  async function handleSendTest() {
    if (!profile?.id) return
    setTesting(true)
    const res = await sendPushToRep({
      userId: profile.id,
      title: 'Test push · Untitled OS',
      body: `If you see this, push works. ${new Date().toLocaleTimeString('en-IN', { hour12: false })}`,
      url: '/work',
      tag: 'push-debug-test',
      requireInteraction: false,
    })
    setTesting(false)
    if (!res) {
      toastError(new Error('notify-rep error'), 'Edge function call failed. Check VAPID_PRIVATE_KEY + VAPID_SUBJECT in Supabase secrets.')
    } else if (res?.sent === 0) {
      toastError(new Error('No subscriptions'), `Edge fn responded but 0 devices got the push. Subscriptions on file: ${subRows.length}.`)
    } else {
      toastSuccess(`Push sent to ${res.sent} device${res.sent === 1 ? '' : 's'}.`)
    }
  }

  async function handleUnsubscribe() {
    try {
      if (pushSub) {
        await pushSub.unsubscribe()
      }
      if (profile?.id && pushSub?.endpoint) {
        await supabase.from('push_subscriptions')
          .delete()
          .eq('user_id', profile.id)
          .eq('endpoint', pushSub.endpoint)
      }
      toastSuccess('Unsubscribed on this device. Tap Enable to re-subscribe.')
      await reload()
    } catch (e) {
      toastError(e, 'Unsubscribe failed.')
    }
  }

  // Compute the master "fully wired" verdict.
  const allGreen =
    hasNotificationApi && hasPushApi && !!vapidKey &&
    swReady && permission === 'granted' && subRows.length > 0

  return (
    <div className="lead-root">
      <div className="m-screen">
        <div
          onClick={() => navigate(-1)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 13, marginBottom: 14,
          }}
        >
          <ArrowLeft size={14} /> Back
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: '.08em', color: 'var(--text-subtle)', textTransform: 'uppercase' }}>
            Settings · diagnostics
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 6px', color: 'var(--text)' }}>
            Push notifications
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Six things must be true for OS-level notifications to fire.
            Each row below shows one of them. Green = pass. Red = fix needed.
          </div>
        </div>

        {/* Quick verdict */}
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 12,
            background: allGreen ? 'var(--success-soft, rgba(16,185,129,0.12))' : 'var(--warning-soft, rgba(245,158,11,0.12))',
            border: `1px solid ${allGreen ? 'var(--success, #10B981)' : 'var(--warning, #F59E0B)'}`,
            marginBottom: 18,
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          {allGreen
            ? <CheckCircle2 size={20} color="var(--success, #10B981)" />
            : <AlertTriangle size={20} color="var(--warning, #F59E0B)" />}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {allGreen ? 'Push is fully wired on this device.' : 'Push is not fully wired yet.'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              {allGreen
                ? 'Tap "Send test push" below to confirm an actual notification lands.'
                : 'Fix the red rows below, then tap "Send test push".'}
            </div>
          </div>
        </div>

        {/* iOS PWA banner — only shown when actually on iOS Safari in
            a non-standalone window. Android tablets (majority of the
            team) never see this. */}
        {isIOS && !isStandalone && (
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--danger-soft, rgba(239,68,68,0.12))',
            border: '1px solid var(--danger, #EF4444)',
            marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <Smartphone size={18} color="var(--danger, #EF4444)" />
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
              <strong>iOS Safari blocks Push in-browser.</strong> To get
              notifications on iPhone you MUST install this site to your
              home screen. Tap the Share icon at the bottom of Safari →
              "Add to Home Screen" → open the new icon from the home
              screen. iOS 16.4 or newer required.
            </div>
          </div>
        )}

        {/* Android tablet banner. Push works in regular Chrome tabs OR
            installed PWAs — no standalone requirement — but battery
            optimisation kills it on most Android OEM skins (Samsung,
            Xiaomi, Vivo, Oppo, OnePlus, Realme). Surface the fix the
            rep can actually act on. */}
        {isAndroid && (
          <div style={{
            padding: '14px 16px', borderRadius: 10,
            background: 'var(--warning-soft, rgba(245,158,11,0.12))',
            border: '1px solid var(--warning, #F59E0B)',
            marginBottom: 14,
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <Smartphone size={18} color="var(--warning, #F59E0B)" />
              <strong style={{ fontSize: 13, color: 'var(--text)' }}>
                Android · {browserName} — fix background notifications
              </strong>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              Web Push works, but Android battery saver kills the background
              service worker after a few minutes. Open your phone Settings
              app and walk through these once:
            </div>

            {/* Step 1 — Battery */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text)',
                textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4,
              }}>Step 1 · Battery → Unrestricted</div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                <li>Open <b>Settings</b> on your phone</li>
                <li>Tap <b>Apps</b> (or "Applications")</li>
                <li>Find <b>{browserName}</b> in the list, tap it</li>
                <li>Tap <b>Battery</b></li>
                <li>Choose <b>Unrestricted</b> (NOT "Optimised" — that's the default that kills push)</li>
              </ol>
            </div>

            {/* Step 2 — Background data */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text)',
                textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4,
              }}>Step 2 · Background data ON</div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                <li>Same Settings → Apps → <b>{browserName}</b> screen</li>
                <li>Tap <b>Mobile data &amp; Wi-Fi</b> (or "Data usage")</li>
                <li>Turn ON <b>Background data</b></li>
                <li>Turn ON <b>Unrestricted data usage</b> if you see it</li>
              </ol>
            </div>

            {/* Step 3 — Battery saver */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text)',
                textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4,
              }}>Step 3 · Battery Saver OFF</div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                <li>Open <b>Settings</b> → <b>Battery</b></li>
                <li>Tap <b>Battery saver</b></li>
                <li>Turn it <b>OFF</b> (or set "Schedule" → Never)</li>
              </ol>
            </div>

            {/* Step 4 — Samsung specific */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text)',
                textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4,
              }}>Step 4 · Samsung only — whitelist {browserName}</div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                <li>Open <b>Settings</b> → <b>Device care</b> (or "Battery and device care")</li>
                <li>Tap <b>Battery</b></li>
                <li>Tap <b>Background usage limits</b></li>
                <li>Open <b>Apps that won't be put to sleep</b></li>
                <li>Tap <b>+</b> Add → select <b>{browserName}</b></li>
              </ol>
            </div>

            {/* Step 5 — Install PWA */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text)',
                textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4,
              }}>Step 5 · Install app to home screen (recommended)</div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                <li>In {browserName}, tap the <b>⋮ menu</b> top-right</li>
                <li>Tap <b>Install app</b> or <b>Add to Home screen</b></li>
                <li>Close {browserName}, open the new icon from your home screen</li>
                <li>Re-run "Send test push" below — installed PWAs have their own battery whitelist on most phones</li>
              </ol>
            </div>
          </div>
        )}

        {/* Gates */}
        <Status
          ok={hasNotificationApi}
          label="Notification API supported"
          detail={hasNotificationApi
            ? `window.Notification present.`
            : `Browser does not expose window.Notification. Update or switch browser.`}
        />
        <Status
          ok={hasPushApi}
          label="Push API supported"
          detail={hasPushApi
            ? 'PushManager + Service Worker both available.'
            : 'PushManager or Service Worker missing. iOS Safari before 16.4 doesn\'t support Web Push.'}
        />
        <Status
          ok={!!vapidKey}
          label="VAPID public key configured"
          detail={vapidKey
            ? `Loaded: ${vapidKey.slice(0, 12)}…${vapidKey.slice(-6)} (${vapidKey.length} chars)`
            : 'VITE_VAPID_PUBLIC_KEY is empty. Owner must set it in Vercel env + redeploy.'}
        />
        <Status
          ok={swReady}
          warn={!swReady && hasPushApi}
          label="Service Worker active"
          detail={swReady
            ? `Scope: ${swScope}`
            : 'No active /sw.js registration. Tap Enable below to register.'}
        />
        <Status
          ok={permission === 'granted'}
          warn={permission === 'default'}
          label={`Browser permission · ${permission}`}
          detail={permission === 'granted'
            ? 'You have allowed notifications on this device.'
            : permission === 'denied'
              ? 'You blocked notifications. Open Settings → this site → allow notifications, then reload.'
              : 'Permission has not been requested yet. Tap Enable below.'}
        />
        <Status
          ok={subRows.length > 0}
          label={`Subscription rows on file · ${subRows.length}`}
          detail={subRows.length > 0
            ? `Most recent: ${subRows[0]?.user_agent?.slice(0, 60) || '(no UA)'}`
            : 'No push_subscriptions rows for you. Subscribing creates one.'}
        />

        {/* Actions */}
        <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Phase 76.2.2 audit (2026-05-23) — "Enable on this device"
              uses the Web Notifications API + service-worker push.
              On Capacitor APK the WebView's web-notifications stack
              returns "denied" even when the Android system-level
              POST_NOTIFICATIONS permission is granted, because the
              Web API is a separate channel from the native FCM
              channel @capacitor/push-notifications uses. Native
              builds auto-enroll via the FCM plugin at app startup;
              this button only matters on the browser PWA path. */}
          {!Capacitor.isNativePlatform() && (
            <button
              onClick={handleEnable}
              disabled={loading}
              className="lead-btn lead-btn-primary"
              style={{ flex: 1, minWidth: 160 }}
            >
              <Bell size={14} />
              <span style={{ marginLeft: 6 }}>Enable on this device</span>
            </button>
          )}
          {/* Phase 97.7 (F-003) — Send test push is admin-only.
              Reps verify by tapping Enable + seeing the 6 gates go
              green; admin runs the live OS-level test send. */}
          {isPrivileged && (
            <button
              onClick={handleSendTest}
              disabled={testing || subRows.length === 0}
              className="lead-btn"
              style={{ flex: 1, minWidth: 160 }}
              title={subRows.length === 0 ? 'Subscribe first' : 'Fire a test push'}
            >
              <Send size={14} />
              <span style={{ marginLeft: 6 }}>{testing ? 'Sending…' : 'Send test push'}</span>
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={reload} disabled={loading} className="lead-btn lead-btn-sm">
            <RefreshCw size={12} /> <span style={{ marginLeft: 4 }}>Refresh</span>
          </button>
          {pushSub && (
            <button
              onClick={handleUnsubscribe}
              className="lead-btn lead-btn-sm"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              Unsubscribe on this device
            </button>
          )}
          {/* Phase 76.2 diag — owner ran APK install but Phase 76.2
              event tables stayed empty. This button calls the plugin
              directly + toasts the result. Tells us instantly:
                "GPS plugin OK · enabled=true/false"  → plugin works
                "GPS plugin NOT REACHABLE — ..."       → plugin missing
                                                          from native side
              No persistence; pure diagnostic. */}
          <button
            onClick={async () => {
              try {
                const { Capacitor, registerPlugin } = await import('@capacitor/core')
                if (!Capacitor.isNativePlatform()) {
                  toastError(new Error('Web'), 'Web build — plugin only runs on APK.')
                  return
                }
                const Tracking = registerPlugin('UntitledTracking')
                if (!Tracking?.isGpsOn) {
                  toastError(new Error('No method'), 'GPS plugin NOT REACHABLE — isGpsOn missing.')
                  return
                }
                const r = await Tracking.isGpsOn()
                toastSuccess(`GPS plugin OK · enabled=${r?.enabled}`)
                // Also fire a manual heartbeat ping
                await Tracking.bumpHeartbeat?.()
              } catch (e) {
                toastError(e, 'GPS plugin call failed: ' + (e?.message || 'unknown'))
              }
            }}
            className="lead-btn lead-btn-sm"
          >
            Test GPS plugin
          </button>
        </div>

        {/* Phase 65 (20 May 2026) — Call log scan diagnostic.
            Visible only inside the Capacitor wrapper (APK) — web has
            no Android CallLog access. Shows READ_CALL_LOG permission
            state + a manual "Scan now" button that runs the Phase 56l
            scanRecentCalls() plugin call with a 24h look-back. Result
            breaks down by call type so admin can confirm inbound /
            missed are detected. */}
        {Capacitor.isNativePlatform() && (
          <div style={{
            marginTop: 28,
            padding: 16,
            borderRadius: 14,
            background: 'var(--v2-bg-1, #1e293b)',
            border: '1px solid var(--v2-line, #334155)',
          }}>
            <div style={{
              fontFamily: 'var(--v2-display, "Space Grotesk")',
              fontSize: 15, fontWeight: 700,
              color: 'var(--v2-ink-0, #f1f5f9)',
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 8,
            }}>
              <PhoneIcon size={16} strokeWidth={1.8} />
              Call log scan diagnostic
            </div>
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginBottom: 12 }}>
              Confirms inbound + missed calls are reaching call_logs.
              Permission must be Allowed for the periodic poller (every
              5 min) to write rows.
            </div>

            <Status
              ok={callPerm === 'granted'}
              warn={callPerm === 'prompt'}
              label={`READ_CALL_LOG: ${callPerm}`}
              detail={callPerm === 'granted'
                ? 'Plugin can query the Android system call log.'
                : callPerm === 'denied'
                  ? 'Denied. Open Settings → Apps → Untitled OS → Permissions → enable Phone / Call log.'
                  : 'Not granted yet. Tap "Request permission" below.'}
              action={callPerm !== 'granted' ? (
                <button onClick={handleGrantCallLog} className="lead-btn lead-btn-sm lead-btn-primary">
                  Request permission
                </button>
              ) : null}
            />

            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handleScanCallLog}
                disabled={callScanBusy || callPerm !== 'granted'}
                className="lead-btn lead-btn-sm lead-btn-primary"
                title="Scan last 24h of Android call log"
              >
                {callScanBusy ? 'Scanning…' : 'Scan call log now'}
              </button>
            </div>

            {callScanResult && (
              <div style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 10,
                background: 'var(--v2-bg-2, #0f172a)',
                border: '1px solid var(--v2-line, #334155)',
                fontSize: 12,
                color: 'var(--v2-ink-1, #cbd5e1)',
                fontFamily: 'inherit',
              }}>
                {callScanResult.error ? (
                  <div style={{ color: 'var(--v2-rose, #EF4444)' }}>
                    Error: {callScanResult.error}
                  </div>
                ) : (
                  <>
                    <div><b>Total calls (24h):</b> {callScanResult.total}</div>
                    <div style={{ marginTop: 4 }}>
                      <b>By type:</b>{' '}
                      {Object.keys(callScanResult.byType).length === 0
                        ? '(empty)'
                        : Object.entries(callScanResult.byType)
                            .map(([t, n]) => `${t}: ${n}`)
                            .join(' · ')}
                    </div>
                    {callScanResult.latest && (
                      <div style={{ marginTop: 4, color: 'var(--v2-ink-2, #94a3b8)' }}>
                        Latest: {callScanResult.latest.type} from {callScanResult.latest.number}
                        {' '}({callScanResult.latest.durationSeconds}s,{' '}
                        {new Date(Number(callScanResult.latest.date)).toLocaleString('en-IN')})
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Existing subscriptions
            Phase 97.7 (F-003) — endpoint fragments are raw push
            subscription identifiers (the device-level "FCM-style"
            token for Web Push). Hidden from non-privileged users;
            admins still see the rep's registered devices for
            diagnostics. */}
        {isPrivileged && subRows.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div className="lead-card-title" style={{ marginBottom: 8 }}>
              Your registered devices
            </div>
            {subRows.map(r => (
              <div key={r.id} style={{
                padding: 10,
                border: '1px solid var(--border, #334155)',
                borderRadius: 8,
                background: 'var(--surface-2, #334155)',
                marginBottom: 6,
                fontSize: 11, color: 'var(--text-muted)',
                wordBreak: 'break-word', lineHeight: 1.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Wifi size={12} />
                  <span style={{ color: 'var(--text)' }}>{r.user_agent?.slice(0, 80) || '(unknown device)'}</span>
                </div>
                <div style={{ marginTop: 4 }}>
                  endpoint …{r.endpoint?.slice(-22)}
                </div>
                <div>
                  last seen {r.last_seen_at ? new Date(r.last_seen_at).toLocaleString('en-IN') : '(never)'}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{
          marginTop: 22,
          padding: '12px 14px',
          background: 'var(--surface, #1e293b)',
          border: '1px dashed var(--border-strong, #475569)',
          borderRadius: 8,
          fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6,
        }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>
            If "Send test push" succeeds but no notification appears
          </div>
          <strong>Android (most reps):</strong><br/>
          1. Settings → Apps → Chrome/Samsung Internet → Battery → "Unrestricted" (default "Optimised" kills push within minutes).<br/>
          2. Settings → Apps → that browser → Data usage → allow background data.<br/>
          3. Data Saver / Power Saving / Battery Saver mode must be OFF while testing.<br/>
          4. On Samsung tablets: Settings → Device care → Battery → "Apps that won't be put to sleep" → add the browser.<br/>
          5. Do Not Disturb / Focus mode silences pushes — pull down the quick-settings panel and turn off.<br/>
          <br/>
          <strong>iPhone / iPad:</strong><br/>
          6. App must be opened from the home-screen icon at least once after Add to Home Screen.<br/>
          7. Focus / Do Not Disturb off; allow notifications under Settings → Notifications → this PWA.<br/>
          <br/>
          <strong>Both:</strong><br/>
          8. Test uses dedup tag <code>push-debug-test</code> — only one notification per tag can show at a time. Dismiss the old one before re-testing.
        </div>
      </div>
    </div>
  )
}
