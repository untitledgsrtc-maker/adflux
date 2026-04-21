// src/hooks/useAuth.js
//
// FIXED v2 — eliminates redundant Supabase user fetches.
//
// BEFORE: every component that called useAuth() registered its own
// auth listener + fetched the user profile on mount. With ~13 components
// calling useAuth per page, this caused 13 identical SELECT queries on
// every navigation.
//
// AFTER: auth initialisation happens exactly ONCE via initAuth() called
// from src/main.jsx. The hook itself just reads from the zustand store
// using granular selectors so components only re-render when their slice
// changes. Role helpers are derived here, not stored, so they stay in
// sync with `profile`.

import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'

// -----------------------------------------------------------------------------
// One-time initialisation. Call this ONCE at app startup (main.jsx).
// -----------------------------------------------------------------------------

let _initialised = false

export function initAuth() {
  if (_initialised) return
  _initialised = true

  const store = useAuthStore.getState()

  // 1. Hydrate from existing session (if any)
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      store.setUser(session.user)
      store.fetchProfile(session.user.id).finally(() => {
        useAuthStore.setState({ loading: false })
      })
    } else {
      useAuthStore.setState({ loading: false })
    }
  })

  // 2. Listen for future login / logout events
  supabase.auth.onAuthStateChange((_event, session) => {
    const s = useAuthStore.getState()
    if (session?.user) {
      // Skip redundant fetches if same user
      if (s.user?.id === session.user.id && s.profile) return
      s.setUser(session.user)
      s.fetchProfile(session.user.id)
    } else {
      s.setUser(null)
      s.setProfile(null)
      useAuthStore.setState({ loading: false })
    }
  })
}

// -----------------------------------------------------------------------------
// Hook for components. Reads from the store — no side-effects.
// -----------------------------------------------------------------------------

export function useAuth() {
  const user     = useAuthStore(s => s.user)
  const profile  = useAuthStore(s => s.profile)
  const loading  = useAuthStore(s => s.loading)
  const signIn   = useAuthStore(s => s.signIn)
  const signOut  = useAuthStore(s => s.signOut)

  return {
    user,
    profile,
    loading,
    isAdmin: profile?.role === 'admin',
    isSales: profile?.role === 'sales',
    signIn,
    signOut,
  }
}
