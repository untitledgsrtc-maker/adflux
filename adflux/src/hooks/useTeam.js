import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useTeamStore } from '../store/teamStore'
import { useAuthStore } from '../store/authStore'

export function useTeam() {
  const store = useTeamStore()

  const fetchMembers = useCallback(async () => {
    store.setLoading(true)
    const { data, error } = await supabase
      .from('users')
      .select('*, staff_incentive_profiles(*)')
      .order('created_at', { ascending: false })
    if (!error) store.setMembers(data || [])
    store.setLoading(false)
    return { data, error }
  }, [])

  const updateMember = async (id, updates) => {
    const { data, error } = await supabase
      .from('users').update(updates).eq('id', id)
      .select('*, staff_incentive_profiles(*)').single()
    if (!error) store.upsertMember(data)
    return { data, error }
  }

  // Phase 667 - HR has read-only access to users, so for HR the switch goes through the
  // set_user_active function (admin keeps the direct update it always used).
  const setActive = async (id, active) => {
    if (useAuthStore.getState().profile?.role !== 'hr') return updateMember(id, { is_active: active })
    const { error } = await supabase.rpc('set_user_active', { p_user_id: id, p_active: active })
    if (error) return { data: null, error }
    const { data, error: readErr } = await supabase
      .from('users').select('*, staff_incentive_profiles(*)').eq('id', id).single()
    if (!readErr) store.upsertMember(data)
    return { data, error: readErr }
  }
  // Phase 680 - HR edits everyday details through hr_update_member, then re-reads the row.
  const hrUpdateMember = async (id, w) => {
    const { error } = await supabase.rpc('hr_update_member', {
      p_user_id: id, p_name: w.name, p_designation: w.designation,
      p_whatsapp_number: w.whatsapp_number, p_signature_mobile: w.signature_mobile,
      p_city: w.city, p_wa_business: w.wa_business,
    })
    if (error) return { data: null, error }
    const { data, error: readErr } = await supabase
      .from('users').select('*, staff_incentive_profiles(*)').eq('id', id).single()
    if (!readErr) store.upsertMember(data)
    return { data, error: readErr }
  }
  const deactivateMember = (id) => setActive(id, false)
  const reactivateMember = (id) => setActive(id, true)

  // Phase 11l — admin can permanently delete a team member from
  // public.users. Safety: refuse if the user owns any quotes/payments
  // (would orphan rows). Note: the auth.users row remains; admin must
  // remove that from Supabase Studio → Authentication → Users for full
  // cleanup. We can't touch auth.users from the frontend without the
  // service_role key.
  const deleteMember = async (id) => {
    // Block if any quotes exist for this user.
    const { count: qCount, error: qErr } = await supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', id)
    if (qErr) return { error: qErr }
    if ((qCount || 0) > 0) {
      return {
        error: {
          message:
            `Cannot delete: this user owns ${qCount} quote${qCount === 1 ? '' : 's'}. ` +
            `Deactivate them instead, or reassign their quotes first.`,
        },
      }
    }
    // Hard delete. staff_incentive_profiles cascades via FK.
    const { error } = await supabase.from('users').delete().eq('id', id)
    if (!error) {
      // Drop from local store.
      store.setMembers(store.members.filter(m => m.id !== id))
    }
    return { error }
  }

  return {
    ...store,
    activeMembers: store.members.filter(m => m.is_active),
    fetchMembers,
    updateMember,
    hrUpdateMember,
    deactivateMember,
    reactivateMember,
    deleteMember,
  }
}
