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
// Phase 36 — Sales Operator visual vocabulary. Loaded after globals
// so v3 tokens win on name overlap. v2.css and tokens.css are still
// imported per-component where needed; v3-vocab declares NEW custom
// properties only, no color overrides.
import './styles/v3-vocab.css'

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
