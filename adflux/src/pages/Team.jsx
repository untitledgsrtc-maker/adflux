import { useEffect, useState } from 'react'
import { UserPlus, Users, UserCheck, ShieldCheck, Search } from 'lucide-react'
import { useTeam } from '../hooks/useTeam'
import { useIncentive } from '../hooks/useIncentive'
import { TeamList } from '../components/team/TeamList'
import { TeamMemberModal } from '../components/team/TeamMemberModal'
import '../styles/team.css'

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'active',   label: 'Active' },
  { key: 'sales',    label: 'Sales' },
  { key: 'admin',    label: 'Admin' },
  { key: 'inactive', label: 'Inactive' },
]

export default function Team() {
  const { members, loading, fetchMembers, deactivateMember, reactivateMember } = useTeam()
  const { settings, fetchSettings } = useIncentive()

  const [filter,   setFilter]   = useState('all')
  const [search,   setSearch]   = useState('')
  const [addOpen,  setAddOpen]  = useState(false)

  useEffect(() => {
    fetchMembers()
    fetchSettings()
  }, [])

  // Apply search on top of store data
  const visible = members.filter(m => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      m.name?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    )
  })

  const total    = members.length
  const active   = members.filter(m => m.is_active).length
  const salesCount  = members.filter(m => m.role === 'sales' && m.is_active).length
  const adminCount  = members.filter(m => m.role === 'admin' && m.is_active).length

  return (
    <div className="page">
      {/* Header */}
      <div className="team-header">
        <div className="team-header-left">
          <h1>Team</h1>
          <p>Manage your sales team, roles, and incentive profiles</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          <UserPlus size={15} style={{ marginRight: 6 }} />
          Add Member
        </button>
      </div>

      {/* Stats */}
      <div className="team-stats">
        <div className="team-stat-card">
          <div className="team-stat-label">Total Members</div>
          <div className="team-stat-value">{total}</div>
        </div>
        <div className="team-stat-card">
          <div className="team-stat-label">Active</div>
          <div className="team-stat-value success">{active}</div>
        </div>
        <div className="team-stat-card">
          <div className="team-stat-label">Sales</div>
          <div className="team-stat-value accent">{salesCount}</div>
        </div>
        <div className="team-stat-card">
          <div className="team-stat-label">Admin</div>
          <div className="team-stat-value muted">{adminCount}</div>
        </div>
      </div>

      {/* Filters + search */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="team-filters" style={{ marginBottom: 0 }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`team-filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Search
            size={14}
            style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            className="team-input"
            style={{ paddingLeft: 32, width: 220 }}
            placeholder="Search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading team…
        </div>
      ) : (
        <TeamList
          members={visible}
          settings={settings}
          filter={filter}
          onDeactivate={deactivateMember}
          onReactivate={reactivateMember}
        />
      )}

      {/* Add member modal */}
      {addOpen && (
        <TeamMemberModal
          mode="add"
          onClose={() => setAddOpen(false)}
          onSuccess={fetchMembers}
        />
      )}
    </div>
  )
}
