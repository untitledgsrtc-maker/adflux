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

// Bootstrap auth listener a single time, before render.
initAuth()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
