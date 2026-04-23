// src/pages/v2/TeamV2.jsx
//
// Admin team page. Keeps the existing TeamList + TeamMemberModal
// components — those already handle deactivate/reactivate, role chips,
// and the incentive-profile sub-row. We only rebuild the outer chrome
// (header, stats, filters) in v2 style.

import { useEffect, useState, useMemo } from 'react'
import { UserPlus, Search } from 'lucide-react'
import { useTeam } from '../../hooks/useTeam'
import { useIncentive } from '../../hooks/useIncentive'
import { TeamList } from '../../components/team/TeamList'
import { TeamMemberModal } from '../../components/team/TeamMemberModal'
import '../../styles/team.css'

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'active',   label: 'Active' },
  { key: 'sales',    label: 'Sales' },
  { key: 'admin',    label: 'Admin' },
  { key: 'inactive', label: 'Inactive' },
]

export default function TeamV2() {
  const { members, loading, fetchMembers, deactivateMember, reactivateMember } = useTeam()
  const { settings, fetchSettings } = useIncentive()
  const [filter,  setFilter]   = useState('all')
  const [search,  setSearch]   = useState('')
  const [addOpen, setAddOpen]  = useState(false)

  useEffect(() => { fetchMembers(); fetchSettings() }, [])

  const visible = useMemo(() => members.filter(m => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      m.name?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    )
  }), [members, search])

  const stats = useMemo(() => ({
    total:       members.length,
    active:      members.filter(m => m.is_active).length,
    salesCount:  members.filter(m => m.role === 'sales' && m.is_active).length,
    adminCount:  members.filter(m => m.role === 'admin' && m.is_active).length,
  }), [members])

  return (
    <div className="v2d-team">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Your people</div>
          <h1 className="v2d-page-title">Team</h1>
          <div className="v2d-page-sub">
            Manage your sales team, roles, and incentive profiles.
          </div>
        </div>
        <button className="v2d-cta" onClick={() => setAddOpen(true)}>
          <UserPlus size={15} />
          <span>Add Member</span>
        </button>
      </div>

      <div className="v2d-hr-stats">
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Total members</div>
          <div className="v2d-stat-v">{stats.total}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Active</div>
          <div className="v2d-stat-v v2d-stat-v--ok">{stats.active}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Sales</div>
          <div className="v2d-stat-v v2d-stat-v--accent">{stats.salesCount}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l">Admin</div>
          <div className="v2d-stat-v v2d-stat-v--muted">{stats.adminCount}</div>
        </div>
      </div>

      <div className="v2d-hr-toolbar">
        <div className="v2d-tab-row">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`v2d-tab-pill${filter === f.key ? ' is-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="v2d-search v2d-search--inline">
          <Search size={14} />
          <input
            placeholder="Search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="v2d-loading"><div className="v2d-spinner" />Loading team…</div>
      ) : (
        <div className="v2d-team-body">
          <TeamList
            members={visible}
            settings={settings}
            filter={filter}
            onDeactivate={deactivateMember}
            onReactivate={reactivateMember}
          />
        </div>
      )}

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
