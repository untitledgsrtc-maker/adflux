import { create } from 'zustand'

export const useTeamStore = create((set) => ({
  members: [],
  loading: false,
  error: null,

  setMembers: (members) => set({ members }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  upsertMember: (member) => set((s) => {
    const idx = s.members.findIndex(m => m.id === member.id)
    if (idx >= 0) {
      const updated = [...s.members]
      updated[idx] = member
      return { members: updated }
    }
    return { members: [member, ...s.members] }
  }),

  removeMember: (id) => set((s) => ({
    members: s.members.filter(m => m.id !== id),
  })),
}))
