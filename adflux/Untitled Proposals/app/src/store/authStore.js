// =====================================================================
// Auth store (Zustand)
// Holds the current Supabase session + the app-level user row from
// public.users (which has the role: owner | co_owner | admin | user).
//
// We keep these as separate fields because:
//   - session is the JWT (Supabase Auth domain)
//   - profile is OUR row (with role) — needed for guards
// React subscribes to either independently to avoid pointless re-renders.
// =====================================================================

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export const useAuthStore = create((set, get) => ({
  // Loading flag for initial bootstrap — UI shows a splash until this clears.
  loading: true,
  session: null,
  profile: null,        // row from public.users
  error: null,

  // Step-up MFA marker: timestamp when user passed TOTP for sensitive
  // surfaces (P&L, admin expenses). Lives in memory only; never persisted.
  // Cleared on tab refresh by design.
  totpVerifiedAt: null,

  /** Boot: hydrate session from localStorage + subscribe to changes. */
  async init() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      await get()._setSession(data.session);

      supabase.auth.onAuthStateChange((_event, session) => {
        get()._setSession(session);
      });
    } catch (err) {
      set({ error: err, loading: false });
    }
  },

  async _setSession(session) {
    if (!session) {
      set({ session: null, profile: null, loading: false, totpVerifiedAt: null });
      return;
    }
    set({ session });

    // Pull the app-level profile (role lives here)
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, phone, avatar_url, totp_enrolled, last_login_at, is_active')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error) {
      set({ error, loading: false });
      return;
    }

    set({ profile: data, loading: false, error: null });
  },

  async signIn({ email, password }) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  async signOut() {
    await supabase.auth.signOut();
    set({ session: null, profile: null, totpVerifiedAt: null });
  },

  /** Mark that the user just passed step-up MFA (called after TOTP success). */
  markTotpVerified() {
    set({ totpVerifiedAt: new Date() });
  },

  // ----- Convenient role helpers (read-only — derived) ----------------
  is(role) {
    const r = get().profile?.role;
    if (!r) return false;
    if (Array.isArray(role)) return role.includes(r);
    return r === role;
  },
  isOwner()        { return get().is('owner'); },
  isCoOwner()      { return get().is('co_owner'); },
  isAdmin()        { return get().is('admin'); },
  isOwnerOrCo()    { return get().is(['owner', 'co_owner']); },
  isAdminOrOwner() { return get().is(['owner', 'co_owner', 'admin']); },
}));
