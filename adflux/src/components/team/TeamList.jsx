import { useState } from 'react'
import {
  ChevronDown, ChevronUp, MoreVertical,
  Edit2, UserX, UserCheck, Mail
} from 'lucide-react'
import { initials } from '../../utils/formatters'
import { MemberStatsCard } from './MemberStatsCard'
import { TeamMemberModal } from './TeamMemberModal'

function ConfirmDialog({ title, body, variant = 'danger', onConfirm, onCancel, loading }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog">
        <div className={`confirm-icon confirm-icon--${variant}`}>
          {variant === 'danger'
            ? <UserX size={22} />
            : <UserCheck size={22} />}
        </div>
        <div className="confirm-title">{title}</div>
        <div className="confirm-body">{body}</div>
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
          <button
            className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Processing…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MemberCard({ member, settings, onDeactivate, onReactivate, onEdit }) {
  const [expanded, setExpanded]   = useState(false)
  const [menuOpen, setMenuOpen]   = useState(false)
  const [confirm, setConfirm]     = useState(null)  // null | 'deactivate' | 'reactivate'
  const [acting, setActing]       = useState(false)
  const [editOpen, setEditOpen]   = useState(false)

  const profile = member.staff_incentive_profiles?.[0]
  const isAdmin = member.role === 'admin'

  async function handleConfirm() {
    setActing(true)
    if (confirm === 'deactivate') await onDeactivate(member.id)
    else await onReactivate(member.id)
    setActing(false)
    setConfirm(null)
  }

  return (
    <>
      <div className={`member-card ${!member.is_active ? 'member-card--inactive' : ''}`}>
        {/* Avatar */}
        <div className={`member-avatar ${isAdmin ? 'member-avatar--admin' : ''}`}>
          {initials(member.name)}
        </div>

        {/* Info */}
        <div className="member-info">
          <div className="member-name">
            {member.name}
            <span className={`role-badge role-badge--${member.role}`}>{member.role}</span>
            {!member.is_active && (
              <span className="badge badge-inactive" style={{ fontSize: 10 }}>Inactive</span>
            )}
          </div>
          <div className="member-email">{member.email}</div>

          <div className="member-meta">
            {profile?.monthly_salary ? (
              <div className="member-meta-item">
                <span className="member-meta-label">Salary</span>
                <span className="member-meta-value">
                  ₹{Number(profile.monthly_salary).toLocaleString('en-IN')}
                </span>
              </div>
            ) : null}
            {profile?.join_date ? (
              <div className="member-meta-item">
                <span className="member-meta-label">Joined</span>
                <span className="member-meta-value">
                  {new Date(profile.join_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions */}
        <div className="member-actions">
          <button
            className="btn btn-ghost btn-icon"
            title="View stats"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setMenuOpen(m => !m)}
            >
              <MoreVertical size={16} />
            </button>

            {menuOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 9 }}
                  onClick={() => setMenuOpen(false)}
                />
                <div style={{
                  position: 'absolute', right: 0, top: '110%',
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  minWidth: 160,
                  zIndex: 10,
                  overflow: 'hidden',
                }}>
                  <button
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px',
                      background: 'none', border: 'none',
                      color: 'var(--text)', fontSize: 13, cursor: 'pointer',
                    }}
                    onClick={() => { setMenuOpen(false); setEditOpen(true) }}
                  >
                    <Edit2 size={14} /> Edit Details
                  </button>

                  <a
                    href={`mailto:${member.email}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px',
                      color: 'var(--text)', fontSize: 13, textDecoration: 'none',
                    }}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Mail size={14} /> Send Email
                  </a>

                  <div style={{ borderTop: '1px solid var(--border)' }} />

                  {member.is_active ? (
                    <button
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '10px 14px',
                        background: 'none', border: 'none',
                        color: 'var(--danger)', fontSize: 13, cursor: 'pointer',
                      }}
                      onClick={() => { setMenuOpen(false); setConfirm('deactivate') }}
                    >
                      <UserX size={14} /> Deactivate
                    </button>
                  ) : (
                    <button
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '10px 14px',
                        background: 'none', border: 'none',
                        color: 'var(--success)', fontSize: 13, cursor: 'pointer',
                      }}
                      onClick={() => { setMenuOpen(false); setConfirm('reactivate') }}
                    >
                      <UserCheck size={14} /> Reactivate
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expanded stats */}
      {expanded && (
        <MemberStatsCard member={member} settings={settings} />
      )}

      {/* Edit modal */}
      {editOpen && (
        <TeamMemberModal
          mode="edit"
          member={member}
          onClose={() => setEditOpen(false)}
          onSuccess={() => {}}
        />
      )}

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          variant={confirm === 'deactivate' ? 'danger' : 'warning'}
          title={confirm === 'deactivate' ? 'Deactivate Member?' : 'Reactivate Member?'}
          body={
            confirm === 'deactivate'
              ? `${member.name} will lose access to the app. Their quotes and data are preserved.`
              : `${member.name} will regain full access based on their role.`
          }
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
          loading={acting}
        />
      )}
    </>
  )
}

export function TeamList({ members, settings, filter, onDeactivate, onReactivate }) {
  const filtered = members.filter(m => {
    if (filter === 'active')   return m.is_active
    if (filter === 'inactive') return !m.is_active
    if (filter === 'admin')    return m.role === 'admin'
    if (filter === 'sales')    return m.role === 'sales'
    return true
  })

  if (!filtered.length) {
    return (
      <div className="team-empty">
        <div className="team-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <h3>No members found</h3>
        <p>Try a different filter, or add a new team member.</p>
      </div>
    )
  }

  return (
    <div className="team-list">
      {filtered.map(member => (
        <MemberCard
          key={member.id}
          member={member}
          settings={settings}
          onDeactivate={onDeactivate}
          onReactivate={onReactivate}
        />
      ))}
    </div>
  )
}
