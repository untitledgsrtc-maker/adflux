// src/main.jsx
//
// App entry point. initAuth() is called ONCE here, before React mounts.
// NOTE: BrowserRouter lives inside App.jsx — do NOT wrap <App /> in another
// BrowserRouter here, or React Router will throw "You cannot render a
// <Router> inside another <Router>" and the whole app will white-screen.

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initAuth } from './hooks/useAuth'
import './styles/globals.css'

// Phase 34G — register the PWA service worker (vite-plugin-pwa virtual
// import). autoUpdate strategy means a new build reloads tabs once the
// SW takes over. No prompt UI needed.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // Dynamically import so dev mode (where the plugin disables the
  // virtual module) doesn't choke. The runtime check above + the
  // try/catch belt-and-braces it.
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => { /* dev mode / plugin disabled — ignore */ })
}

// Bootstrap auth listener a single time, before render.
initAuth()

// Phase 76.2 — initialise native tracking plugin (Android only).
// Web bundle: skipped entirely. Phase 76.2.2 (Tier A/B): init no
// longer takes a callback — the shim caches the user id internally
// and listens to auth state changes. Phase 76.2.2 audit fix — gate
// the dynamic import on `window.Capacitor.isNativePlatform()` so
// the browser build never downloads the ~7KB nativeTracking chunk.
if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
  import('./utils/nativeTracking').then(({ initNativeTracking }) => {
    initNativeTracking().catch(e => console.warn('[main] tracking init failed:', e?.message || e))
  }).catch(() => { /* dynamic import disabled */ })
}

// Phase 87.7 — native dialer auto-launch on Capacitor APK.
// Owner directive 22 May 2026: tap any tel:<number> link inside the
// installed app should open the OS dialer directly, no "Open with..."
// picker, no in-WebView intercept.
//
// Default Android WebView already routes tel: via Intent.ACTION_DIAL,
// but a small minority of devices show a chooser. Forcing the call
// through Capacitor App.openUrl guarantees the OS handles it.
//
// Web path is untouched — Capacitor.isNativePlatform() returns false
// in a browser, so this listener no-ops there. Programmatic
// `window.location.href = 'tel:...'` is NOT intercepted (those live in
// §28 frozen files; default WebView covers them). Only the rendered
// <a href="tel:..."> click path needs explicit handling so the
// in-page navigation doesn't take precedence over the OS intent.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    try {
      // Quick exit if we're not on a Capacitor-wrapped build. Avoid
      // importing @capacitor/core at the top level so the web bundle
      // doesn't pay the cost.
      const cap = window.Capacitor
      if (!cap?.isNativePlatform?.()) return
      const target = event.target
      const link = target?.closest?.('a[href^="tel:"]')
      if (!link) return
      const href = link.getAttribute('href')
      if (!href) return
      event.preventDefault()
      event.stopPropagation()
      // Lazy-load @capacitor/app only on native. Falls back to a plain
      // navigation if the plugin isn't available so worst-case the
      // user still gets the browser-default behaviour.
      import('@capacitor/app')
        .then(({ App }) => App.openUrl({ url: href }))
        .catch(() => { window.location.href = href })
    } catch {
      /* swallow — never break a click event */
    }
  }, true)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
