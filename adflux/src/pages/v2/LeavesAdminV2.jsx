// src/pages/v2/LeavesAdminV2.jsx
//
// Phase 33G.8 (item 82) — admin Leaves page.
//
// Lets admin / co_owner mark a rep as on approved leave for a date.
// The performance score function (compute_daily_score) reads the
// `leaves` table FIRST when deciding whether to exclude a day from
// the monthly score. Sundays and active holidays are also excluded
// automatically; the rep doesn't need a leave row for those.
//
// Sales / agency / telecaller hit /admin/leaves → bounce home.
//
// Minimal UI by design:
//   • Add form at top: rep dropdown + date + type + reason + Save
//   • Last 60 days of leaves listed below, newest first
//   • Delete button per row (admin-only — RLS enforces same on DB)
//
// No approval workflow, no pending state surface yet — the SQL
// supports it but the v1 UI inserts rows as 'approved' directly so
// the score function picks them up immediately. Add a pending tab
// later if owner needs request → approve flow for reps.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Plus, Trash2, Calendar, AlertTriangle, Check, X as XIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const LEAVE_TYPES = [
  { key: 'sick',         label: 'Sick'        },
  { key: 'personal',     label: 'Personal'    },
  { key: 'vacation',     label: 'Vacation'    },
  { key: 'bereavement',  label: 'Bereavement' },
  { key: 'other',        label: 'Other'       },
]

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch { return iso }
}

export default function LeavesAdminV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = ['admin', 'co_owner'].includes(profile?.role)

  // Role gate — only admin / co_owner see this page.
  useEffect(() => {
    if (profile && !isAdmin) navigate('/work')
  }, [profile, isAdmin, navigate])

  const [users, setUsers]       = useState([])
  const [leaves, setLeaves]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')
  // Phase 35.0 pass 11 — admin approval queue. Status filter
  // defaults to 'pending' so admin opens the page and immediately
  // sees what needs action. Rep-submitted leaves (via Phase 34Z.71
  // Request Leave on MyOfferV2) land as status='pending'; this
  // page now lets admin Approve or Reject them.
  const [statusFilter, setStatusFilter] = useState('pending')
  const [actingOn, setActingOn] = useState(null)  // row id being acted on

  // Form state — defaults pick "today" so common case (rep didn't
  // come in today) is one-tap.
  const [fUser, setFUser]   = useState('')
  const [fDate, setFDate]   = useState(todayISO())
  const [fType, setFType]   = useState('personal')
  const [fReason, setFReason] = useState('')
  // Phase 36 — half-day support. When true the leave row is saved
  // with is_half_day=true and the salary RPC counts it as 0.5.
  const [fHalfDay, setFHalfDay] = useState(false)

  async function load() {
    setLoading(true)
    // Pull team users + last 60 days of leaves in parallel.
    const since = new Date()
    since.setDate(since.getDate() - 60)
    const sinceISO = since.toISOString().slice(0, 10)

    const [uRes, lRes] = await Promise.all([
      supabase.from('users')
        .select('id, name, role')
        .in('role', ['sales', 'agency', 'telecaller', 'admin', 'co_owner'])
        .order('name', { ascending: true }),
      supabase.from('leaves')
        .select('id, user_id, leave_date, leave_type, reason, status, is_half_day, created_at')
        .gte('leave_date', sinceISO)
        .order('leave_date', { ascending: false })
        .order('created_at', { ascending: false }),
    ])
    setUsers(uRes.data || [])
    setLeaves(lRes.data || [])
    setLoading(false)
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  // Map user_id → name for the table display.
  const userMap = useMemo(() => {
    const m = {}
    users.forEach(u => { m[u.id] = u.name })
    return m
  }, [users])

  async function handleSave() {
    if (!fUser)  { setErr('Pick a team member.'); return }
    if (!fDate)  { setErr('Pick a date.'); return }
    setErr('')
    setSaving(true)
    const { error } = await supabase.from('leaves').insert({
      user_id:    fUser,
      leave_date: fDate,
      leave_type: fType,
      reason:     (fReason || '').trim() || null,
      status:     'approved',
      // Phase 36 — half-day. Column added in
      // supabase_phase36_salary_policy.sql. Defaults false at DB,
      // so existing inserts elsewhere stay compatible.
      is_half_day: fHalfDay,
      created_by: profile?.id,
    })
    setSaving(false)
    if (error) {
      // Most likely cause: unique (user_id, leave_date) collision.
      if (error.code === '23505') {
        setErr('That rep already has a leave row for that date. Delete it first if you want to change the type.')
      } else {
        setErr(error.message || 'Save failed.')
      }
      return
    }
    // Recompute that rep's daily score so the change is visible
    // immediately in /my-performance. Best-effort — function returns
    // void and we don't surface errors here.
    try {
      await supabase.rpc('compute_daily_score', {
        p_user_id: fUser, p_date: fDate,
      })
    } catch (_) { /* ignore */ }
    // Phase 33J — reset every form field so admin can immediately
    // add another leave without manually clearing. Keep fDate at
    // today since "approve another day for the same rep" is rare.
    setFUser('')
    setFDate(todayISO())
    setFType('personal')
    setFReason('')
    setFHalfDay(false)
    load()
  }

  async function handleDelete(row) {
    if (!confirm(`Delete leave for ${userMap[row.user_id] || 'this rep'} on ${fmtDate(row.leave_date)}?`)) return
    const { error } = await supabase.from('leaves').delete().eq('id', row.id)
    if (error) {
      alert('Delete failed: ' + error.message)
      return
    }
    // Re-score that day so the rep's performance flips back to
    // "counted" if it was previously excluded.
    try {
      await supabase.rpc('compute_daily_score', {
        p_user_id: row.user_id, p_date: row.leave_date,
      })
    } catch (_) { /* ignore */ }
    load()
  }

  // Phase 35.0 pass 11 — Approve / Reject handlers for pending
  // leave rows. Both flip status + recompute that rep's daily
  // score so the change is immediately reflected in /my-performance.
  async function handleApprove(row) {
    setActingOn(row.id)
    const { error } = await supabase.from('leaves')
      .update({ status: 'approved' })
      .eq('id', row.id)
    setActingOn(null)
    if (error) {
      setErr('Approve failed: ' + error.message)
      return
    }
    try {
      await supabase.rpc('compute_daily_score', {
        p_user_id: row.user_id, p_date: row.leave_date,
      })
    } catch (_) { /* ignore */ }
    load()
  }
  async function handleReject(row) {
    if (!confirm(`Reject leave for ${userMap[row.user_id] || 'this rep'} on ${fmtDate(row.leave_date)}? Rep will be marked working for that day.`)) return
    setActingOn(row.id)
    const { error } = await supabase.from('leaves')
      .update({ status: 'rejected' })
      .eq('id', row.id)
    setActingOn(null)
    if (error) {
      setErr('Reject failed: ' + error.message)
      return
    }
    // Re-score with rejected status so the day counts again.
    try {
      await supabase.rpc('compute_daily_score', {
        p_user_id: row.user_id, p_date: row.leave_date,
      })
    } catch (_) { /* ignore */ }
    load()
  }

  // Filter leaves by status tab.
  const filteredLeaves = useMemo(() => {
    if (statusFilter === 'all') return leaves
    return leaves.filter(l => (l.status || 'approved') === statusFilter)
  }, [leaves, statusFilter])

  // Count per status for tab badges.
  const statusCounts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, all: leaves.length }
    leaves.forEach(l => {
      const s = l.status || 'approved'
      if (c[s] != null) c[s] += 1
    })
    return c
  }, [leaves])

  if (!isAdmin) return null

  return (
    <div className="v2d-leaves" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─── Header ────────────────────────────────────── */}
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">HR · Time off</div>
          <h1 className="v2d-page-title">Leaves</h1>
          <div className="v2d-page-sub">
            Mark approved leave days for the team. The performance score
            excludes these days automatically — reps don't lose variable
            salary for time off.
          </div>
        </div>
      </div>

      {/* ─── Add leave form ─────────────────────────────── */}
      <div className="v2d-panel" style={{ padding: 16 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10, alignItems: 'end',
        }}>
          <div>
            <label style={labelStyle}>Team member *</label>
            <select
              value={fUser}
              onChange={e => setFUser(e.target.value)}
              style={inputStyle}
            >
              <option value="">— pick rep —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Date *</label>
            <input
              type="date"
              value={fDate}
              onChange={e => setFDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select
              value={fType}
              onChange={e => setFType(e.target.value)}
              style={inputStyle}
            >
              {LEAVE_TYPES.map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
            <label style={labelStyle}>Reason (optional)</label>
            <input
              type="text"
              value={fReason}
              onChange={e => setFReason(e.target.value)}
              placeholder="Sick · family function · etc."
              style={inputStyle}
            />
          </div>
          {/* Phase 36 — half-day checkbox. When checked, the row
              saves with is_half_day=true and the salary RPC counts
              it as 0.5 day against the rep's annual quota. */}
          <div style={{ alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 8, height: 38 }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 13, color: 'var(--v2-ink-1)', cursor: 'pointer',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={fHalfDay}
                onChange={e => setFHalfDay(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent, #FFE600)', cursor: 'pointer' }}
              />
              <span>Half-day (0.5)</span>
            </label>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="v2d-cta"
            style={{ alignSelf: 'end', height: 38 }}
          >
            <Plus size={14} /> {saving ? 'Saving…' : 'Save leave'}
          </button>
        </div>
        {err && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,.08)', color: 'var(--v2-rose, #EF4444)',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertTriangle size={14} /> {err}
          </div>
        )}
      </div>

      {/* Phase 35.0 pass 11 — status filter tabs above the table.
          Defaults to 'pending' so the admin sees the action queue
          first. Counts come from the un-filtered leaves array. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { key: 'pending',  label: 'Pending',  tint: 'var(--accent, #FFE600)' },
          { key: 'approved', label: 'Approved', tint: '#2BD8A0' },
          { key: 'rejected', label: 'Rejected', tint: '#FF6F61' },
          { key: 'all',      label: 'All',      tint: 'var(--v2-ink-2)' },
        ].map(t => {
          const active = statusFilter === t.key
          const count = statusCounts[t.key] || 0
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              style={{
                padding: '8px 14px', borderRadius: 999,
                border: `1px solid ${active ? t.tint : 'var(--v2-line)'}`,
                background: active ? `${t.tint}22` : 'transparent',
                color: active ? t.tint : 'var(--v2-ink-1)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span>{t.label}</span>
              <span style={{
                padding: '1px 7px', borderRadius: 999,
                background: active ? t.tint : 'var(--v2-bg-2)',
                color: active ? 'var(--accent-fg, #0f172a)' : 'var(--v2-ink-2)',
                fontSize: 11, fontWeight: 700,
                fontFamily: 'var(--font-mono, monospace)',
              }}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* ─── Last 60 days of leaves ──────────────────────── */}
      <div className="v2d-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
            Loading leaves…
          </div>
        ) : filteredLeaves.length === 0 ? (
          <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
            <div className="v2d-empty-ic" style={{ marginBottom: 12 }}>
              <Calendar size={28} strokeWidth={1.6} />
            </div>
            <div className="v2d-empty-t">
              {statusFilter === 'pending' && 'No pending requests'}
              {statusFilter === 'approved' && 'No approved leaves'}
              {statusFilter === 'rejected' && 'No rejected leaves'}
              {statusFilter === 'all' && 'No leaves recorded'}
            </div>
            <div className="v2d-empty-s">
              {statusFilter === 'pending'
                ? 'Reps can request leave from the My Offer page — requests land here for your approval.'
                : 'When a rep is on approved time off, mark it here so it doesn\'t count against their monthly performance score.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="v2d-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--v2-line)', color: 'var(--v2-ink-2)' }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Team member</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Reason</th>
                  <th style={{ ...thStyle, width: 160, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeaves.map(row => {
                  const status = row.status || 'approved'
                  const statusTint = status === 'pending'  ? 'var(--accent, #FFE600)'
                                   : status === 'approved' ? '#2BD8A0'
                                   : '#FF6F61'
                  const busy = actingOn === row.id
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--v2-line)' }}>
                      <td style={tdStyle}>{fmtDate(row.leave_date)}</td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: 'var(--v2-ink-0)' }}>
                          {userMap[row.user_id] || 'Unknown'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px',
                          borderRadius: 999, fontSize: 11, fontWeight: 600,
                          textTransform: 'capitalize',
                          background: 'rgba(255,255,255,.06)',
                          color: 'var(--v2-ink-1)',
                        }}>
                          {row.leave_type}{row.is_half_day ? ' · ½' : ''}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px',
                          borderRadius: 999, fontSize: 11, fontWeight: 700,
                          textTransform: 'capitalize',
                          background: `${statusTint}22`,
                          color: statusTint,
                          border: `1px solid ${statusTint}44`,
                        }}>
                          {status}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: 'var(--v2-ink-2)' }}>
                          {row.reason || '—'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                          {status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(row)}
                                disabled={busy}
                                className="v2d-ghost"
                                title="Approve leave"
                                style={{
                                  color: '#2BD8A0',
                                  borderColor: '#2BD8A044',
                                  background: 'rgba(43,216,160,.10)',
                                }}
                              >
                                <Check size={13} /> Approve
                              </button>
                              <button
                                onClick={() => handleReject(row)}
                                disabled={busy}
                                className="v2d-ghost"
                                title="Reject leave"
                                style={{
                                  color: '#FF6F61',
                                  borderColor: '#FF6F6144',
                                  background: 'rgba(255,111,97,.10)',
                                }}
                              >
                                <XIcon size={13} /> Reject
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDelete(row)}
                            className="v2d-ghost"
                            title="Delete leave"
                            style={{ color: 'var(--v2-rose, #EF4444)' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: 11, fontWeight: 600,
  color: 'var(--v2-ink-2)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
}
const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--v2-bg-2)',
  border: '1px solid var(--v2-line)',
  borderRadius: 8,
  color: 'var(--v2-ink-0)',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  height: 38,
}
const thStyle = { padding: '10px 14px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.08em' }
const tdStyle = { padding: '12px 14px', fontSize: 13, color: 'var(--v2-ink-1)', verticalAlign: 'top' }
