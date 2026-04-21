// src/main.jsx
//
// App entry point. Most importantly: initAuth() is called ONCE here,
// before React mounts, so there's no per-component auth listener.

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initAuth } from './hooks/useAuth'
import './styles/globals.css'

// Bootstrap auth listener a single time, before render.
initAuth()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
