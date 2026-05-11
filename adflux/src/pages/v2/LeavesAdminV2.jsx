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
import { Users, Plus, Trash2, Calendar, AlertTriangle } from 'lucide-react'
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

  // Form state — defaults pick "today" so common case (rep didn't
  // come in today) is one-tap.
  const [fUser, setFUser]   = useState('')
  const [fDate, setFDate]   = useState(todayISO())
  const [fType, setFType]   = useState('personal')
  const [fReason, setFReason] = useState('')

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
        .select('id, user_id, leave_date, leave_type, reason, status, created_at')
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

      {/* ─── Last 60 days of leaves ──────────────────────── */}
      <div className="v2d-panel" style={{ overflow: 'hidden', padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
            Loading leaves…
          </div>
        ) : leaves.length === 0 ? (
          <div className="v2d-empty-card" style={{ padding: 40, textAlign: 'center' }}>
            <div className="v2d-empty-ic" style={{ marginBottom: 12 }}>
              <Calendar size={28} strokeWidth={1.6} />
            </div>
            <div className="v2d-empty-t">No leaves recorded</div>
            <div className="v2d-empty-s">
              When a rep is on approved time off, mark it here so it doesn't
              count against their monthly performance score.
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
                  <th style={thStyle}>Reason</th>
                  <th style={{ ...thStyle, width: 80, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map(row => (
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
                        {row.leave_type}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: 'var(--v2-ink-2)' }}>
                        {row.reason || '—'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button
                        onClick={() => handleDelete(row)}
                        className="v2d-ghost"
                        title="Delete leave"
                        style={{ color: 'var(--v2-rose, #EF4444)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
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
