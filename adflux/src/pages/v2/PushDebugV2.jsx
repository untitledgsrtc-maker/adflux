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
  Send, Bell, Smartphone, Wifi,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import {
  registerServiceWorker, requestPermission,
  subscribeForPush, sendPushToRep,
} from '../../utils/pushNotifications'
import { toastError, toastSuccess } from '../../components/v2/Toast'

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

  async function reload() {
    setLoading(true)
    setHasNotificationApi('Notification' in window)
    setHasPushApi('serviceWorker' in navigator && 'PushManager' in window)
    setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
    setVapidKey(import.meta.env.VITE_VAPID_PUBLIC_KEY || '')

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
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--warning-soft, rgba(245,158,11,0.12))',
            border: '1px solid var(--warning, #F59E0B)',
            marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <Smartphone size={18} color="var(--warning, #F59E0B)" />
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
              <strong>Android · {browserName}.</strong> Push works in a
              regular Chrome tab — no install needed. If the test push
              doesn't land:
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                <li>Settings → Apps → {browserName} → Battery → set to "Unrestricted" (Samsung / Xiaomi / OnePlus all kill background SW by default).</li>
                <li>Settings → Apps → {browserName} → Data usage → allow background data.</li>
                <li>Turn off Data Saver and Power Saving mode while testing.</li>
                <li>Best reliability: tap the menu → "Install app" / "Add to Home screen" → open from the new icon. Installed PWAs get a separate battery whitelist on most OEMs.</li>
              </ul>
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
          <button
            onClick={handleEnable}
            disabled={loading}
            className="lead-btn lead-btn-primary"
            style={{ flex: 1, minWidth: 160 }}
          >
            <Bell size={14} />
            <span style={{ marginLeft: 6 }}>Enable on this device</span>
          </button>
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
        </div>

        {/* Existing subscriptions */}
        {subRows.length > 0 && (
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
