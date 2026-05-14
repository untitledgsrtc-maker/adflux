// src/pages/v2/SettingsV2.jsx
//
// Phase 35 PR 1 — Settings page with Day / Night theme toggle.
//
// The theme attribute is also re-applied on V2AppShell mount so a
// hard refresh keeps the rep's preference. Storage is localStorage
// only — theme is per-browser, not per-user-row.

import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { PageHeader, ActionButton, Banner } from '../../components/v2/primitives'

function ThemeToggleSection() {
  const [theme, setTheme] = useState('night')
  useEffect(() => {
    try { setTheme(localStorage.getItem('theme') || 'night') } catch {}
  }, [])
  function apply(next) {
    setTheme(next)
    try { localStorage.setItem('theme', next) } catch {}
    document.documentElement.setAttribute('data-theme', next)
  }
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Appearance</h2>
      <div style={{ display: 'flex', gap: 8 }}>
        <ActionButton
          variant={theme === 'night' ? 'primary' : 'ghost'}
          size="sm"
          iconLeft={Moon}
          onClick={() => apply('night')}
        >
          Night
        </ActionButton>
        <ActionButton
          variant={theme === 'day' ? 'primary' : 'ghost'}
          size="sm"
          iconLeft={Sun}
          onClick={() => apply('day')}
        >
          Day
        </ActionButton>
      </div>
      <Banner tone="info">Theme stored per browser; sales reps can choose independently.</Banner>
    </div>
  )
}

export default function SettingsV2() {
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <PageHeader title="Settings" />
      <ThemeToggleSection />
    </div>
  )
}
