// src/pages/v2/TeamManagerAssignV2.jsx
//
// Phase 61 (19 May 2026) — admin reassign-manager page.
//
// Owner directive: "admin can reassign team to manager".
//
// What this page does:
//   - Lists every active sales / telecaller rep.
//   - For each row, shows a dropdown of available managers
//     (users.team_role='sales_manager', filtered to the rep's
//     own role family — sales reps pair with sales heads,
//     telecallers pair with TC heads).
//   - Saves on dropdown change via UPDATE users.manager_id.
//
// Why a dedicated page instead of editing TeamMemberModal:
//   - TeamMemberModal is the per-rep edit modal; bulk reassign
//     across 10+ reps would mean 10+ modal opens. A single table
//     with inline dropdowns is faster for admin daily ops.
//   - Doesn't touch any frozen file (per CLAUDE.md §28). Modal +
//     team list are owner-touchy components.
//
// Auth: admin / co_owner only. Bounces non-admins on mount.

import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Loader2, UserCheck, ArrowRight } from 'lucide-react'
import { pushToast, toastError } from '../../components/v2/Toast'

// Phase 61 — `embedded` prop suppresses own page-head when mounted
// inside PeopleV2 (which renders the shared "People" head once).
// Matches the §30 pattern used by TeamV2 / IncentivesV2 / SalaryAdminV2.
export default function TeamManagerAssignV2({ embedded = false }) {
  const navigate = useNavigate()
  const { isPrivileged } = useAuth()

  const [reps, setReps]         = useState([])
  const [managers, setManagers] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState({})   // userId → boolean
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')

  useEffect(() => {
    if (!isPrivileged) {
      navigate('/dashboard', { replace: true })
    }
  }, [isPrivileged, navigate])

  useEffect(() => {
    if (!isPrivileged) return
    ;(async () => {
      setLoading(true); setError('')
      try {
        const { data: allRows, error: e1 } = await supabase
          .from('users')
          .select('id, name, role, team_role, manager_id, designation, city, is_active')
          .eq('is_active', true)
          .order('role', { ascending: true })
          .order('name', { ascending: true })
        if (e1) throw e1

        const m = (allRows || []).filter(u => u.team_role === 'sales_manager')
        // Reps = sales + telecaller who are NOT themselves managers.
        // sales_manager users are excluded as their own reps (they
        // can't be a direct report of themselves).
        const r = (allRows || []).filter(u =>
          (u.role === 'sales' || u.role === 'telecaller')
          && u.team_role !== 'sales_manager'
        )
        setManagers(m)
        setReps(r)
      } catch (e) {
        setError(e?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [isPrivileged])

  const filteredReps = useMemo(() => {
    if (!search.trim()) return reps
    const q = search.toLowerCase()
    return reps.filter(r => (r.name || '').toLowerCase().includes(q))
  }, [reps, search])

  // For each rep, which managers are eligible?
  // Sales rep → sales heads (manager.role='sales' + team_role='sales_manager')
  // TC rep    → TC heads    (manager.role='telecaller' + team_role='sales_manager')
  const eligibleManagers = (rep) => managers.filter(m => m.role === rep.role)

  async function setManager(rep, newManagerId) {
    setSaving(s => ({ ...s, [rep.id]: true }))
    try {
      const { error: e } = await supabase
        .from('users')
        .update({ manager_id: newManagerId || null })
        .eq('id', rep.id)
      if (e) throw e
      setReps(prev => prev.map(r =>
        r.id === rep.id ? { ...r, manager_id: newManagerId || null } : r
      ))
      const mgr = managers.find(m => m.id === newManagerId)
      pushToast(
        newManagerId
          ? `${rep.name} now reports to ${mgr?.name || 'manager'}`
          : `${rep.name} unassigned from manager`,
        'success',
      )
    } catch (e) {
      toastError(e, `Could not reassign ${rep.name}.`)
    } finally {
      setSaving(s => ({ ...s, [rep.id]: false }))
    }
  }

  if (!isPrivileged) return null

  return (
    <div
      className={embedded ? '' : 'v2'}
      style={{
        padding:   embedded ? 0 : '24px 20px',
        maxWidth:  embedded ? '100%' : 1024,
        margin:    embedded ? 0 : '0 auto',
      }}
    >
      {!embedded && (
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontFamily: 'var(--v2-display, "Space Grotesk")',
            fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--v2-ink-2, #94a3b8)',
          }}>
            People · Manager assignment
          </div>
          <h1 style={{
            fontFamily: 'var(--v2-display, "Space Grotesk")',
            fontSize: 28, fontWeight: 700,
            margin: '6px 0 0',
            color: 'var(--v2-ink-0, #f1f5f9)',
          }}>
            Reassign reps to manager
          </h1>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>
            Sales reps pair with sales heads. Telecallers pair with TC heads.
          </div>
        </div>
      )}
      {embedded && (
        <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>
          Sales reps pair with sales heads. Telecallers pair with TC heads. Saves on dropdown change.
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search rep name…"
        style={{
          width:        '100%',
          padding:      '10px 14px',
          fontSize:     14,
          border:       '1px solid var(--v2-line, #334155)',
          borderRadius: 'var(--v2-r-sm, 10px)',
          background:   'var(--v2-bg-1, #1e293b)',
          color:        'var(--v2-ink-0, #f1f5f9)',
          marginBottom: 12,
          fontFamily:   'inherit',
        }}
      />

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--v2-ink-2, #94a3b8)', padding: 20 }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          Loading…
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: 14, borderRadius: 14, background: 'rgba(239,68,68,0.10)', color: 'var(--v2-rose, #EF4444)' }}>
          {error}
        </div>
      )}

      {!loading && !error && managers.length === 0 && (
        <div style={{
          padding: 20, borderRadius: 14,
          background: 'var(--v2-bg-1, #1e293b)',
          border: '1px dashed var(--v2-line, #334155)',
          color: 'var(--v2-ink-2, #94a3b8)',
          textAlign: 'center',
        }}>
          No managers yet. Set <code>users.team_role = 'sales_manager'</code> on a user first.
        </div>
      )}

      {!loading && !error && managers.length > 0 && (
        <div style={{
          background:   'var(--v2-bg-1, #1e293b)',
          border:       '1px solid var(--v2-line, #334155)',
          borderRadius: 'var(--v2-r, 14px)',
          overflow:     'hidden',
        }}>
          {filteredReps.map((rep, idx) => {
            const pool = eligibleManagers(rep)
            const currentMgr = managers.find(m => m.id === rep.manager_id)
            const isSaving = !!saving[rep.id]
            return (
              <div
                key={rep.id}
                style={{
                  display:    'grid',
                  gridTemplateColumns: '1fr 200px 220px',
                  alignItems: 'center',
                  gap:        12,
                  padding:    '12px 16px',
                  borderTop:  idx === 0 ? 'none' : '1px solid var(--v2-line, #334155)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--v2-ink-0, #f1f5f9)' }}>
                    {rep.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>
                    {rep.role}{rep.city ? ` · ${rep.city}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>
                  <UserCheck size={14} />
                  {currentMgr?.name || <em style={{ opacity: 0.7 }}>unassigned</em>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowRight size={14} style={{ color: 'var(--v2-ink-2, #94a3b8)' }} />
                  <select
                    disabled={isSaving || pool.length === 0}
                    value={rep.manager_id || ''}
                    onChange={(e) => setManager(rep, e.target.value)}
                    style={{
                      flex:         1,
                      padding:      '8px 10px',
                      borderRadius: 'var(--v2-r-sm, 10px)',
                      border:       '1px solid var(--v2-line, #334155)',
                      background:   'var(--v2-bg-2, #0f172a)',
                      color:        'var(--v2-ink-0, #f1f5f9)',
                      fontSize:     13,
                      fontFamily:   'inherit',
                    }}
                  >
                    <option value="">— unassigned —</option>
                    {pool.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  {isSaving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--v2-ink-2, #94a3b8)' }} />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
