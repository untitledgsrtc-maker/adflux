// src/pages/Login.jsx
//
// v2-styled login. Standalone page (NOT inside V2AppShell) so the
// sidebar/topbar/bottom-nav chrome doesn't render while the user is
// unauthenticated. Preserves the original data flow — useAuth().signIn
// then navigate('/') on success — only the visual is new.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import '../styles/v2.css'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="v2d v2d-login">
      <div className="v2d-login-card">
        {/* Brand */}
        {/* Phase 31U — owner directive (10 May 2026): user-facing brand
            is "Untitled OS", not "Untitled Adflux". The legal entity
            name (Untitled Adflux Pvt Ltd) still appears on PDFs / quotes
            for the PRIVATE segment per CLAUDE.md §4 — that's correct
            and untouched. The login mark "UA" stays (Untitled Advertising
            company logo). */}
        <div className="v2d-login-brand">
          <div className="v2d-login-mark">UA</div>
          <div>
            <div className="v2d-login-b-t">Untitled OS</div>
            <div className="v2d-login-b-s">Internal Sales Platform</div>
          </div>
        </div>

        <div className="v2d-login-h">Welcome back</div>
        <div className="v2d-login-s">
          GSRTC LED Screen Network · Gujarat
        </div>

        <form onSubmit={handleSubmit}>
          <div className="v2d-login-fg">
            <label className="v2d-login-l" htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              className="v2d-login-in"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@untitledad.in"
              required
              autoFocus
            />
          </div>

          <div className="v2d-login-fg">
            <label className="v2d-login-l" htmlFor="login-pw">Password</label>
            <input
              id="login-pw"
              className="v2d-login-in"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="v2d-login-err">{error}</div>}

          <button type="submit" className="v2d-login-sub" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="v2d-login-foot">
          Need access? Contact your admin
        </div>
      </div>
    </div>
  )
}
