// src/pages/v2/LeadsV2.jsx
//
// Phase 12 (M1 + M7) — Lead pipeline list. Replaces Cronberry.
//
// Per role visibility (RLS-enforced; UI just shows what comes back):
//   admin               → all leads, can reassign anyone
//   government_partner  → all GOVERNMENT segment leads regardless of city
//   sales_manager       → leads where assigned_to / telecaller_id is in
//                         (me + my direct reports via manager_id)
//   sales / agency      → assigned_to = me
//   telecaller          → telecaller_id = me OR assigned_to = me
//
// Stage transitions live in /leads/:id (built next). This page is
// list + filter + bulk-reassign + Excel upload entry point.
//
// Design tokens from UI_DESIGN_SYSTEM.md. Reuses v2.css `.v2d-*`
// classes for chrome consistency with QuotesV2 / ClientsV2.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, X, Upload, Users as UsersIcon, Filter, ChevronDown,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import {
  useLeads, LEAD_STAGES, STAGE_LABELS, STAGE_TINT,
} from '../../hooks/useLeads'
import { formatCurrency, formatDate } from '../../utils/formatters'

/* ─── Stage chip — uses UI Design System §4.4 ─── */
function StageChip({ stage }) {
  const tint = STAGE_TINT[stage] || 'blue'
  const styleByTint = {
    blue:   { bg: 'var(--tint-blue-bg, rgba(96,165,250,.12))',  bd: 'var(--tint-blue-bd, rgba(96,165,250,.30))',  fg: 'var(--blue, #60a5fa)' },
    green:  { bg: 'var(--tint-green-bg, rgba(74,222,128,.10))', bd: 'var(--tint-green-bd, rgba(74,222,128,.28))', fg: 'var(--green, #4ade80)' },
    amber:  { bg: 'var(--tint-amber-bg, rgba(251,191,36,.10))', bd: 'var(--tint-amber-bd, rgba(251,191,36,.28))', fg: 'var(--amber, #fbbf24)' },
    red:    { bg: 'var(--tint-red-bg, rgba(248,113,113,.10))',  bd: 'var(--tint-red-bd, rgba(248,113,113,.28))',  fg: 'var(--red, #f87171)' },
    purple: { bg: 'var(--tint-purple-bg, rgba(192,132,252,.12))', bd: 'rgba(192,132,252,.30)',                    fg: 'var(--purple, #c084fc)' },
  }
  const s = styleByTint[tint]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 9px', borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: s.bg, border: `1px solid ${s.bd}`, color: s.fg,
      whiteSpace: 'nowrap',
    }}>
      {STAGE_LABELS[stage] || stage}
    </span>
  )
}

/* ─── Heat dot ─── */
function HeatDot({ heat }) {
  const color = heat === 'hot' ? 'var(--red, #f87171)'
              : heat === 'warm' ? 'var(--amber, #fbbf24)'
              : 'var(--text-3, rgba(255,255,255,.40))'
  return (
    <span title={heat} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, flexShrink: 0,
    }} />
  )
}

export default function LeadsV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)
  const { leads, loading, error, fetchLeads, reassignBulk } = useLeads()

  // Filter state — local to this page (no cross-page persistence).
  const [search, setSearch]         = useState('')
  const [stageFilter, setStageFilter] = useState('all')   // 'all' | LEAD_STAGES
  const [segmentFilter, setSegmentFilter] = useState('all') // 'all' | 'PRIVATE' | 'GOVERNMENT'
  const [sourceFilter, setSourceFilter]   = useState('all')
  const [cityFilter, setCityFilter]       = useState('all')
  const [repFilter, setRepFilter]         = useState('all')
  const [heatFilter, setHeatFilter]       = useState('all')

  // Bulk-select state
  const [selected, setSelected] = useState(new Set())

  // Reassign modal
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassignTarget, setReassignTarget] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)
  const [reassignErr, setReassignErr] = useState('')

  // Sales reps for reassign dropdown — admin / sales_manager / govt_partner
  const [assignableUsers, setAssignableUsers] = useState([])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  // Load assignable users (sales + agency + telecaller) for reassign UI.
  // RLS limits this to whoever the current user can see — admin sees all.
  useEffect(() => {
    if (!isPrivileged) return
    supabase
      .from('users')
      .select('id, name, team_role, city, is_active')
      .in('team_role', ['sales', 'agency', 'sales_manager', 'telecaller'])
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (!err) setAssignableUsers(data || [])
      })
  }, [isPrivileged])

  // Distinct sources / cities for filter dropdowns. Built from the
  // loaded leads so the lists are scoped to what the user can actually see.
  const distinctSources = useMemo(() => {
    const set = new Set()
    leads.forEach(l => l.source && set.add(l.source))
    return Array.from(set).sort()
  }, [leads])
  const distinctCities = useMemo(() => {
    const set = new Set()
    leads.forEach(l => l.city && set.add(l.city))
    return Array.from(set).sort()
  }, [leads])
  const distinctReps = useMemo(() => {
    const map = new Map()
    leads.forEach(l => {
      if (l.assigned?.id) map.set(l.assigned.id, l.assigned.name)
    })
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [leads])

  // Apply all filters in memory. RLS already filtered server-side; this
  // is just UI slicing. Search matches name / company / phone / email.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter(l => {
      if (stageFilter   !== 'all' && l.stage   !== stageFilter)   return false
      if (segmentFilter !== 'all' && l.segment !== segmentFilter) return false
      if (sourceFilter  !== 'all' && l.source  !== sourceFilter)  return false
      if (cityFilter    !== 'all' && l.city    !== cityFilter)    return false
      if (heatFilter    !== 'all' && l.heat    !== heatFilter)    return false
      if (repFilter     !== 'all' && l.assigned?.id !== repFilter) return false
      if (!q) return true
      return (
        (l.name    || '').toLowerCase().includes(q) ||
        (l.company || '').toLowerCase().includes(q) ||
        (l.phone   || '').toLowerCase().includes(q) ||
        (l.email   || '').toLowerCase().includes(q)
      )
    })
  }, [leads, search, stageFilter, segmentFilter, sourceFilter, cityFilter, repFilter, heatFilter])

  const totals = useMemo(() => {
    const counts = {}
    LEAD_STAGES.forEach(s => { counts[s] = 0 })
    let value = 0
    leads.forEach(l => {
      counts[l.stage] = (counts[l.stage] || 0) + 1
      value += Number(l.expected_value) || 0
    })
    return { counts, total: leads.length, value }
  }, [leads])

  function toggleSelected(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(l => l.id)))
    }
  }

  async function handleReassign() {
    if (!reassignTarget) {
      setReassignErr('Pick a person to reassign to.')
      return
    }
    setReassignBusy(true)
    setReassignErr('')
    const { error: err, data } = await reassignBulk(Array.from(selected), reassignTarget)
    setReassignBusy(false)
    if (err) {
      setReassignErr(err.message || 'Reassign failed.')
      return
    }
    setReassignOpen(false)
    setReassignTarget('')
    setSelected(new Set())
  }

  const hasActiveFilters =
    search ||
    stageFilter !== 'all' ||
    segmentFilter !== 'all' ||
    sourceFilter !== 'all' ||
    cityFilter !== 'all' ||
    repFilter !== 'all' ||
    heatFilter !== 'all'

  return (
    <div className="v2d-leads">
      {/* ─── Page header ─── */}
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">
            {isAdmin ? 'All team leads' : 'Your pipeline'}
          </div>
          <h1 className="v2d-page-title">
            {isAdmin ? 'Leads' : 'My Leads'}
          </h1>
          <div className="v2d-page-sub">
            {leads.length} lead{leads.length !== 1 ? 's' : ''}
            {hasActiveFilters ? ' · filtered' : ''}
            {leads.length > 0 && (
              <> · pipeline value <strong>{formatCurrency(totals.value)}</strong></>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isPrivileged && (
            <button
              className="v2d-ghost v2d-ghost--btn"
              onClick={() => navigate('/leads/upload')}
              title="Upload leads from Excel / Cronberry CSV"
            >
              <Upload size={14} />
              <span>Upload Excel</span>
            </button>
          )}
          <button className="v2d-cta" onClick={() => navigate('/leads/new')}>
            <Plus size={15} />
            <span>New Lead</span>
          </button>
        </div>
      </div>

      {/* ─── Stage tabs (pill row) — counts from total, not filtered ─── */}
      <div className="v2d-tab-row" style={{ flexWrap: 'wrap' }}>
        <button
          className={`v2d-tab-pill${stageFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => setStageFilter('all')}
        >
          All
          <span className="v2d-tab-count">{totals.total}</span>
        </button>
        {LEAD_STAGES.map(s => (
          <button
            key={s}
            className={`v2d-tab-pill${stageFilter === s ? ' is-active' : ''}`}
            onClick={() => setStageFilter(stageFilter === s ? 'all' : s)}
          >
            {STAGE_LABELS[s]}
            <span className="v2d-tab-count">{totals.counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {/* ─── Filters row ─── */}
      <div className="v2d-filter-row">
        <div className="v2d-search v2d-search--inline">
          <Search size={14} />
          <input
            placeholder="Search name, company, phone, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="v2d-search-clear" onClick={() => setSearch('')}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* Segment */}
        <div style={{
          display: 'inline-flex', gap: 4, padding: 3,
          background: 'var(--v2-bg-2)', borderRadius: 999,
          border: '1px solid var(--v2-border, var(--v2-line))',
        }}>
          {[
            { key: 'all',        label: 'All' },
            { key: 'PRIVATE',    label: 'Private' },
            { key: 'GOVERNMENT', label: 'Govt' },
          ].map(o => (
            <button
              key={o.key}
              onClick={() => setSegmentFilter(o.key)}
              style={{
                padding: '5px 11px', borderRadius: 999, border: 'none',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: segmentFilter === o.key ? 'var(--v2-ink-0)' : 'transparent',
                color:      segmentFilter === o.key ? 'var(--v2-bg-0)' : 'var(--v2-ink-2)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Heat */}
        <select
          value={heatFilter}
          onChange={e => setHeatFilter(e.target.value)}
          className="v2d-date"
          style={{ minWidth: 120, cursor: 'pointer' }}
          title="Lead heat"
        >
          <option value="all">All heat</option>
          <option value="hot">🔥 Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>

        {/* Source */}
        {distinctSources.length > 0 && (
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="v2d-date"
            style={{ minWidth: 140, cursor: 'pointer' }}
          >
            <option value="all">All sources</option>
            {distinctSources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {/* City */}
        {distinctCities.length > 0 && (
          <select
            value={cityFilter}
            onChange={e => setCityFilter(e.target.value)}
            className="v2d-date"
            style={{ minWidth: 130, cursor: 'pointer' }}
          >
            <option value="all">All cities</option>
            {distinctCities.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {/* Assigned rep — admin / privileged only */}
        {isPrivileged && distinctReps.length > 0 && (
          <select
            value={repFilter}
            onChange={e => setRepFilter(e.target.value)}
            className="v2d-date"
            style={{ minWidth: 160, cursor: 'pointer' }}
          >
            <option value="all">All assignees</option>
            {distinctReps.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}

        {hasActiveFilters && (
          <button
            className="v2d-ghost v2d-ghost--btn"
            onClick={() => {
              setSearch('')
              setStageFilter('all')
              setSegmentFilter('all')
              setSourceFilter('all')
              setCityFilter('all')
              setRepFilter('all')
              setHeatFilter('all')
            }}
          >
            <X size={12} />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* ─── Bulk action bar (shown only when something selected) ─── */}
      {selected.size > 0 && isPrivileged && (
        <div style={{
          background: 'rgba(255,230,0,.08)',
          border: '1px solid rgba(255,230,0,.28)',
          borderRadius: 12,
          padding: '10px 14px',
          marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 12,
          fontSize: 13,
        }}>
          <span style={{ fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <button
            className="v2d-cta"
            style={{ padding: '6px 14px', fontSize: 12 }}
            onClick={() => setReassignOpen(true)}
          >
            <UsersIcon size={13} />
            <span>Reassign</span>
          </button>
          <button
            className="v2d-ghost v2d-ghost--btn"
            onClick={() => setSelected(new Set())}
          >
            <span>Clear</span>
          </button>
        </div>
      )}

      {/* ─── Status banner: error / loading / empty / table ─── */}
      {error && (
        <div style={{
          background: 'var(--tint-red-bg, rgba(248,113,113,.10))',
          border: '1px solid var(--tint-red-bd, rgba(248,113,113,.28))',
          color: 'var(--red, #f87171)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div className="v2d-loading"><div className="v2d-spinner" />Loading leads…</div>
      ) : filtered.length === 0 ? (
        <div className="v2d-panel v2d-empty-card">
          <div className="v2d-empty-ic"><UsersIcon size={32} /></div>
          <div className="v2d-empty-t">
            {leads.length === 0 ? 'No leads yet' : 'No leads match these filters'}
          </div>
          <div className="v2d-empty-s">
            {leads.length === 0
              ? (isPrivileged
                  ? 'Click Upload Excel to import from Cronberry, or New Lead to start fresh.'
                  : 'Leads will appear here as they are assigned to you.')
              : 'Try clearing filters or searching differently.'}
          </div>
        </div>
      ) : (
        <div className="v2d-panel" style={{ overflow: 'hidden' }}>
          <table className="v2d-q-table">
            <thead>
              <tr>
                {isPrivileged && (
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                )}
                <th>Lead</th>
                <th>Company</th>
                <th>Stage</th>
                <th>Heat</th>
                <th>Source</th>
                <th>City</th>
                {isPrivileged && <th>Assigned</th>}
                <th style={{ textAlign: 'right' }}>Value</th>
                <th>Last contact</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr
                  key={l.id}
                  onClick={(e) => {
                    if (e.target.tagName === 'INPUT') return
                    navigate(`/leads/${l.id}`)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {isPrivileged && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleSelected(l.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                  )}
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    {l.phone && (
                      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontFamily: 'var(--v2-mono, monospace)', marginTop: 2 }}>
                        {l.phone}
                      </div>
                    )}
                  </td>
                  <td style={{ color: 'var(--v2-ink-1)' }}>
                    {l.company || <span style={{ color: 'var(--v2-ink-2)' }}>—</span>}
                  </td>
                  <td><StageChip stage={l.stage} /></td>
                  <td><HeatDot heat={l.heat} /></td>
                  <td style={{ fontSize: 12, color: 'var(--v2-ink-1)' }}>{l.source || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--v2-ink-1)' }}>{l.city || '—'}</td>
                  {isPrivileged && (
                    <td style={{ fontSize: 12, color: 'var(--v2-ink-1)' }}>
                      {l.assigned?.name || <span style={{ color: 'var(--v2-ink-2)' }}>Unassigned</span>}
                    </td>
                  )}
                  <td style={{ textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 600 }}>
                    {l.expected_value ? formatCurrency(l.expected_value) : '—'}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontFamily: 'var(--v2-mono, monospace)' }}>
                    {l.last_contact_at ? formatDate(l.last_contact_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Reassign modal ─── */}
      {reassignOpen && (
        <div className="mo" onClick={(e) => {
          if (e.target === e.currentTarget && !reassignBusy) setReassignOpen(false)
        }}>
          <div className="md" style={{ maxWidth: 480 }}>
            <div className="md-h">
              <div className="md-t">
                <UsersIcon size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
                Reassign {selected.size} lead{selected.size !== 1 ? 's' : ''}
              </div>
              <button className="md-x" onClick={() => setReassignOpen(false)} disabled={reassignBusy}>✕</button>
            </div>
            <div className="md-b">
              <div className="fg">
                <label>Assign to</label>
                <select
                  value={reassignTarget}
                  onChange={e => setReassignTarget(e.target.value)}
                  disabled={reassignBusy}
                  style={{ width: '100%' }}
                >
                  <option value="">— pick a person —</option>
                  {assignableUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.city ? `· ${u.city}` : ''} {u.team_role ? `· ${u.team_role}` : ''}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>
                  Reassigning replaces the current owner. The new owner will see these leads in their list immediately.
                </p>
              </div>
              {reassignErr && (
                <div style={{
                  background: 'rgba(248,113,113,.10)',
                  border: '1px solid rgba(248,113,113,.28)',
                  color: 'var(--red, #f87171)',
                  borderRadius: 8, padding: '10px 14px', fontSize: 13, marginTop: 8,
                }}>
                  {reassignErr}
                </div>
              )}
            </div>
            <div className="md-f">
              <button className="btn btn-ghost" onClick={() => setReassignOpen(false)} disabled={reassignBusy}>
                Cancel
              </button>
              <button
                className="btn btn-y"
                onClick={handleReassign}
                disabled={reassignBusy || !reassignTarget}
              >
                {reassignBusy ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
