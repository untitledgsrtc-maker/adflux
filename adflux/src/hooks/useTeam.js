import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useTeamStore } from '../store/teamStore'

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

  const deactivateMember = (id) => updateMember(id, { is_active: false })
  const reactivateMember = (id) => updateMember(id, { is_active: true })

  return {
    ...store,
    activeMembers: store.members.filter(m => m.is_active),
    fetchMembers,
    updateMember,
    deactivateMember,
    reactivateMember,
  }
}
