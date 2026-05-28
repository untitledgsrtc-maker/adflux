import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,

  setUser:    (user)    => set({ user }),
  setProfile: (profile) => set({ profile }),
  setLoading: (loading) => set({ loading }),

  fetchProfile: async (userId) => {
    // Try by ID first — happy path. auth.uid() matches public.users.id.
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (!error && data) {
      set({ profile: data, loading: false })
      return data
    }

    // Phase 97.D (2026-05-28, F-002) — read-only fallback. The legacy
    // code path here used to SILENTLY UPDATE the users row's primary
    // key + email to match auth.uid() whenever a case-insensitive
    // email lookup found a different row. That was:
    //   (a) a profile-hijack vector before Phase 97.1 column-pin RLS
    //       (any rep could trigger a rewrite of another rep's PK);
    //   (b) silently broken after Phase 97.1 (RLS denied the UPDATE
    //       but the JS proceeded as if it succeeded, leaving the
    //       session inconsistent — every subsequent query 42501).
    // Both modes are footguns. D-warn: keep the email match for
    // diagnostics + logging only. NEVER write. Admin runs the audit
    // query (CLAUDE.md §40 mismatch SELECT) + repairs manually.
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser?.email) {
      // .maybeSingle() returns null instead of erroring on 0 rows.
      const { data: byEmail } = await supabase
        .from('users')
        .select('id, email, name, role, team_role')
        .ilike('email', authUser.email)
        .maybeSingle()

      if (byEmail) {
        // Email matched but the row's PK differs from auth.uid().
        // Log the diagnostic so admin can pin down the bad row.
        // Do NOT mutate. Do NOT set a fake profile. Return null.
        console.error(
          '[authStore] F-002 mismatch: auth.uid does not match users.id ' +
          'for the email-matched row. Admin must repair via Supabase Studio.',
          {
            auth_uid: userId,
            users_id: byEmail.id,
            email: authUser.email,
            name: byEmail.name,
            role: byEmail.role,
            team_role: byEmail.team_role,
          }
        )
        set({ loading: false })
        return null
      }
    }

    console.error('[authStore] no matching user found', error)
    set({ loading: false })
    return null
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null })
  },

  // Role helpers — Phase 11i: owner role removed (was identical to
  // admin in every check). isPrivileged is the full-access set used
  // for sidebar gating, RLS-equivalent checks, and master-data pages.
  isAdmin:      () => get().profile?.role === 'admin',
  isSales:      () => get().profile?.role === 'sales',
  isCoOwner:    () => get().profile?.role === 'co_owner',
  isPrivileged: () => ['admin', 'co_owner'].includes(get().profile?.role),

  // Segment scope — drives wizard segment lock + quotes list filter.
  // Returns 'ALL' for non-sales/telecaller roles since the DB column
  // backfills them to ALL anyway.
  segmentAccess: () => get().profile?.segment_access || 'ALL',

  // True if this user can sign Government proposals (Brijesh + Vishal
  // currently). Used to populate signer dropdowns in the wizard.
  isSigner: () => !!get().profile?.signing_authority,
}))
