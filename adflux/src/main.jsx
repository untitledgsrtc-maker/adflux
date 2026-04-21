import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initAuth } from './hooks/useAuth'
import './styles/globals.css'

initAuth()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
