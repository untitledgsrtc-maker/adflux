// src/pages/v2/LeadsV2.jsx
//
// Phase 16 commit 2 — Lead list, ported in-place from owner's
// Claude Design output (_design_reference/Leads/lead-admin.jsx ·
// AdminLeadList). Same /leads route, new UI.
//
// Per-role visibility (RLS does the work):
//   admin / co_owner    → all leads, can reassign anyone, can upload CSV
//   government_partner  → all GOVERNMENT segment leads
//   sales_manager       → leads in their team chain
//   sales / agency      → assigned_to = me
//   telecaller          → telecaller_id = me OR assigned_to = me
//
// Design rules (from _design_reference/Leads/lead-styles.css):
//   • Wrap content in .lead-root for Space Grotesk + JetBrains Mono helpers.
//   • Stage chips, heat dots, segment chips, avatars from LeadShared.
//   • 5-tab pill row: All · Open · Qualified · Won · Lost.
//     (QuoteSent + Negotiating stages reachable via "All" or the Stage
//      modal; we don't expose an "In Progress" tab in the rep-facing UI
//      per the approved design.)
//   • AI briefing card content is computed from real lead data, not mocked.
//   • Bulk action bar is a sticky bottom pill that appears when ≥1 row
//     is checked (privileged users only).
//
// Per CLAUDE.md: lucide-react only; no #facc15 anywhere; brand yellow
// is #FFE600 from tokens.css.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, X, Upload, Users as UsersIcon, AlertTriangle,
  Sparkles, ArrowRight,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useLeads, STAGE_GROUPS as ALL_STAGE_GROUPS } from '../../hooks/useLeads'
import { formatCurrency, formatRelative } from '../../utils/formatters'
import {
  StageChip, HeatDot, SegChip, LeadAvatar,
} from '../../components/leads/LeadShared'

/* The 5 tabs from the design — All + 4 groups. We re-use the
   underlying STAGE_GROUPS from useLeads but drop "in_progress"
   so QuoteSent/Negotiating only appear under "All". */
const VISIBLE_GROUPS = ALL_STAGE_GROUPS.filter(g => g.key !== 'in_progress')

export default function LeadsV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)
  const { leads, loading, error, fetchLeads, reassignBulk, stageBulk, deleteBulk, applyRealtimeChange } = useLeads()

  /* ─── Filter state ─── */
  const [search, setSearch]               = useState('')
  const [stageFilter, setStageFilter]     = useState('all')
  const [segmentFilter, setSegmentFilter] = useState('all')
  const [sourceFilter, setSourceFilter]   = useState('all')
  const [cityFilter, setCityFilter]       = useState('all')
  const [industryFilter, setIndustryFilter] = useState('all')   // Phase 19
  const [repFilter, setRepFilter]         = useState('all')

  /* ─── Bulk select state ─── */
  const [selected, setSelected] = useState(new Set())

  /* ─── Reassign modal ─── */
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassignTarget, setReassignTarget] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)
  const [reassignErr, setReassignErr] = useState('')
  const [assignableUsers, setAssignableUsers] = useState([])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  // Phase 19 — realtime sync across tabs. Listens for any insert/update/
  // delete on leads; the hook re-fetches the single row with joins so
  // assigned_to / telecaller_id names stay populated.
  useEffect(() => {
    const ch = supabase
      .channel('leads-list-rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        applyRealtimeChange
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [applyRealtimeChange])

  // Privileged-user reassign target list. Sales / agency can't reassign,
  // so we skip the query entirely for them.
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

  /* ─── Derived: distinct dropdown values ─── */
  const distinctSources = useMemo(() => {
    const s = new Set()
    leads.forEach(l => l.source && s.add(l.source))
    return Array.from(s).sort()
  }, [leads])
  const distinctCities = useMemo(() => {
    const s = new Set()
    leads.forEach(l => l.city && s.add(l.city))
    return Array.from(s).sort()
  }, [leads])
  const distinctIndustries = useMemo(() => {
    const s = new Set()
    leads.forEach(l => l.industry && s.add(l.industry))
    return Array.from(s).sort()
  }, [leads])
  const distinctReps = useMemo(() => {
    const m = new Map()
    leads.forEach(l => {
      if (l.assigned?.id) m.set(l.assigned.id, l.assigned.name)
    })
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [leads])

  /* ─── Apply filters in memory ─── */
  const stagesInGroup = useMemo(() => {
    if (stageFilter === 'all') return null
    const g = ALL_STAGE_GROUPS.find(x => x.key === stageFilter)
    return g ? g.stages : null
  }, [stageFilter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter(l => {
      if (stagesInGroup && !stagesInGroup.includes(l.stage)) return false
      if (segmentFilter  !== 'all' && l.segment  !== segmentFilter)  return false
      if (sourceFilter   !== 'all' && l.source   !== sourceFilter)   return false
      if (cityFilter     !== 'all' && l.city     !== cityFilter)     return false
      if (industryFilter !== 'all' && l.industry !== industryFilter) return false
      if (repFilter      !== 'all' && l.assigned?.id !== repFilter)  return false
      if (!q) return true
      return (
        (l.name     || '').toLowerCase().includes(q) ||
        (l.company  || '').toLowerCase().includes(q) ||
        (l.phone    || '').toLowerCase().includes(q) ||
        (l.email    || '').toLowerCase().includes(q) ||
        (l.industry || '').toLowerCase().includes(q)
      )
    })
  }, [leads, search, stagesInGroup, segmentFilter, sourceFilter, cityFilter, industryFilter, repFilter])

  /* ─── Stat strip totals ─── */
  const totals = useMemo(() => {
    const counts = {}
    let value = 0, wonCount = 0, lostCount = 0
    leads.forEach(l => {
      counts[l.stage] = (counts[l.stage] || 0) + 1
      value += Number(l.expected_value) || 0
      if (l.stage === 'Won')  wonCount++
      if (l.stage === 'Lost') lostCount++
    })
    const groupCounts = {}
    ALL_STAGE_GROUPS.forEach(g => {
      groupCounts[g.key] = g.stages.reduce((s, st) => s + (counts[st] || 0), 0)
    })
    return { counts, groupCounts, total: leads.length, value, wonCount, lostCount }
  }, [leads])
  const winRate = useMemo(() => {
    const decided = totals.wonCount + totals.lostCount
    return decided === 0 ? null : Math.round((totals.wonCount / decided) * 100)
  }, [totals])

  /* ─── AI briefing computations (no mocks — real lead data) ─── */
  const aiBriefing = useMemo(() => {
    const now = Date.now()
    const dayAgo = now - 24 * 3600 * 1000
    const last18h = now - 18 * 3600 * 1000
    const yesterdayEvening = (() => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      d.setHours(18, 0, 0, 0)
      return d.getTime()
    })()

    const hotIdle = leads.filter(l =>
      l.heat === 'hot' &&
      !['Won','Lost'].includes(l.stage) &&
      (!l.last_contact_at || new Date(l.last_contact_at).getTime() < dayAgo)
    )
    // Phase 30A — SalesReady stage removed; SLA still keys off the
    // handoff_sla_due_at timestamp on any active (non-closed) lead.
    const slaBreaches = leads.filter(l =>
      !['Won','Lost'].includes(l.stage) &&
      l.handoff_sla_due_at &&
      new Date(l.handoff_sla_due_at).getTime() < now
    )
    const cronberryOvernight = leads.filter(l =>
      (l.source || '').toLowerCase().includes('cronberry') &&
      l.created_at && new Date(l.created_at).getTime() > yesterdayEvening
    )
    const sampleHot = hotIdle[0] || null
    return { hotIdle, slaBreaches, cronberryOvernight, sampleHot, last18h }
  }, [leads])

  function toggleSelected(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(l => l.id)))
  }

  async function handleReassign() {
    if (!reassignTarget) {
      setReassignErr('Pick a person to reassign to.')
      return
    }
    setReassignBusy(true)
    setReassignErr('')
    const { error: err } = await reassignBulk(Array.from(selected), reassignTarget)
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
    industryFilter !== 'all' ||
    repFilter !== 'all'

  return (
    <div className="lead-root">
      {/* ─── Page header ─── */}
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">
            {isAdmin ? 'Pipeline · across all sources' : 'Your pipeline'}
          </div>
          <div className="lead-page-title">
            {isAdmin ? 'Leads' : 'My Leads'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isPrivileged && (
            <button
              className="lead-btn"
              onClick={() => navigate('/leads/upload')}
              title="Upload from Cronberry / Excel"
            >
              <Upload size={14} />
              <span>Upload CSV</span>
            </button>
          )}
          <button className="lead-btn lead-btn-primary" onClick={() => navigate('/leads/new')}>
            <Plus size={15} />
            <span>New Lead</span>
          </button>
        </div>
      </div>

      {/* ─── AI briefing card (real data, not mock) ─── */}
      {leads.length > 0 && (
        <AIBriefingCard
          briefing={aiBriefing}
          onOpenQueue={() => {
            // Owner action: open the SLA-breach + hot-idle queue.
            setStageFilter('all')
            setSegmentFilter('all')
            setSourceFilter('all')
            setCityFilter('all')
            setIndustryFilter('all')
            setRepFilter('all')
            setSearch('')
            // No dedicated "queue" view yet — once the lead-detail
            // SLA card lands, this navigates to a filtered list.
          }}
        />
      )}

      {/* Phase 31R — owner audit caught these StatCards were referring
          to group keys ('open', 'qualified') that no longer exist after
          Phase 30A's stage collapse. Both rendered 0 forever. Replaced
          with the actual current groups: New count + Follow-up count.
          'New + Contacted + Nurture' meta was misleading too — Contacted
          hasn't existed since Phase 30A, and Nurture is its own column
          now (Phase 31N). */}
      {leads.length > 0 && (
        <div className="lead-stat-strip">
          <StatCard label="Total leads" num={totals.total} meta="all sources" />
          <StatCard label="New"         num={totals.groupCounts.new || 0}        meta="not yet contacted" />
          <StatCard label="Follow-up"   num={totals.groupCounts.working || 0}    meta="actively chasing" />
          <StatCard label="Won"         num={totals.wonCount}                    meta={winRate != null ? `${winRate}% win rate` : 'no decisions yet'} />
        </div>
      )}

      {/* Phase 32B — owner asked (10 May 2026) for a per-rep filter as
          one-tap chips so admin can see who owns what and bulk-reassign
          fast, without diving into the dropdown. Renders only for
          privileged users (admin / co_owner) and only when there's
          more than one rep with leads. Click a chip → filter the list
          to that rep's leads. Click the active chip again to clear. */}
      {isPrivileged && distinctReps.length > 1 && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap',
          marginBottom: 10, alignItems: 'center',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '.1em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
            marginRight: 4,
          }}>
            Filter by rep
          </span>
          <button
            type="button"
            onClick={() => setRepFilter('all')}
            className="lead-btn lead-btn-sm"
            style={{
              borderColor: repFilter === 'all' ? 'var(--accent)' : 'var(--border-strong, #475569)',
              color:       repFilter === 'all' ? 'var(--accent)' : 'var(--text)',
              background:  repFilter === 'all' ? 'var(--accent-soft)' : 'transparent',
              fontWeight:  repFilter === 'all' ? 700 : 500,
            }}
          >
            All ({leads.length})
          </button>
          {distinctReps.map(r => {
            const count = leads.filter(l => l.assigned?.id === r.id).length
            const active = repFilter === r.id
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRepFilter(active ? 'all' : r.id)}
                className="lead-btn lead-btn-sm"
                title={active ? 'Click to clear filter' : `Show only ${r.name}'s leads`}
                style={{
                  borderColor: active ? 'var(--accent)' : 'var(--border-strong, #475569)',
                  color:       active ? 'var(--accent)' : 'var(--text)',
                  background:  active ? 'var(--accent-soft)' : 'transparent',
                  fontWeight:  active ? 700 : 500,
                }}
              >
                {r.name} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* ─── Filter row (search + 5 stage tabs + segment/source/city/rep) ─── */}
      <div className="lead-filter-row">
        <div className="lead-search lead-filter-search">
          <Search size={14} />
          <input
            placeholder="Name, company, phone, email"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex' }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="lead-filter-tabs">
          <span
            className={`lead-filter-tab ${stageFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStageFilter('all')}
          >
            All
          </span>
          {VISIBLE_GROUPS.map(g => (
            <span
              key={g.key}
              className={`lead-filter-tab ${stageFilter === g.key ? 'active' : ''}`}
              onClick={() => setStageFilter(stageFilter === g.key ? 'all' : g.key)}
            >
              {g.label}
            </span>
          ))}
        </div>

        <select
          value={segmentFilter}
          onChange={e => setSegmentFilter(e.target.value)}
          className="lead-filter-select"
          style={{ minWidth: 130 }}
          title="Segment"
        >
          <option value="all">Segment: All</option>
          <option value="PRIVATE">Segment: Private</option>
          <option value="GOVERNMENT">Segment: Govt</option>
        </select>

        {distinctSources.length > 0 && (
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="lead-filter-select"
            style={{ minWidth: 140 }}
          >
            <option value="all">Source: Any</option>
            {distinctSources.map(s => (
              <option key={s} value={s}>{`Source: ${s}`}</option>
            ))}
          </select>
        )}

        {distinctCities.length > 0 && (
          <select
            value={cityFilter}
            onChange={e => setCityFilter(e.target.value)}
            className="lead-filter-select"
            style={{ minWidth: 130 }}
          >
            <option value="all">City: All</option>
            {distinctCities.map(c => (
              <option key={c} value={c}>{`City: ${c}`}</option>
            ))}
          </select>
        )}

        {/* Phase 19b — always render so the filter is visible even when
            the current lead set has no industry tags yet. The first
            option is the only one in that case, but reps can see the
            control exists. */}
        <select
          value={industryFilter}
          onChange={e => setIndustryFilter(e.target.value)}
          className="lead-filter-select"
          style={{ minWidth: 150 }}
          title="Industry"
          disabled={distinctIndustries.length === 0}
        >
          <option value="all">
            {distinctIndustries.length === 0 ? 'Industry: —' : 'Industry: All'}
          </option>
          {distinctIndustries.map(i => (
            <option key={i} value={i}>{`Industry: ${i}`}</option>
          ))}
        </select>

        {isPrivileged && distinctReps.length > 0 && (
          <select
            value={repFilter}
            onChange={e => setRepFilter(e.target.value)}
            className="lead-filter-select"
            style={{ minWidth: 160 }}
          >
            <option value="all">Assigned: Anyone</option>
            {distinctReps.map(r => (
              <option key={r.id} value={r.id}>{`Assigned: ${r.name}`}</option>
            ))}
          </select>
        )}

        {hasActiveFilters && (
          <button
            className="lead-btn lead-btn-sm"
            onClick={() => {
              setSearch('')
              setStageFilter('all')
              setSegmentFilter('all')
              setSourceFilter('all')
              setCityFilter('all')
              setIndustryFilter('all')
              setRepFilter('all')
            }}
          >
            <X size={11} />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* ─── Status / loading / empty / error / table ─── */}
      {error && (
        <div
          className="lead-card"
          style={{
            background: 'var(--danger-soft)',
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13, marginBottom: 12,
          }}
        >
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          Loading leads…
        </div>
      ) : filtered.length === 0 ? (
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 40 }}>
          <UsersIcon size={32} style={{ color: 'var(--text-subtle)', marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {leads.length === 0 ? 'No leads yet' : 'No leads match these filters'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {leads.length === 0
              ? (isPrivileged
                  ? 'Click Upload CSV to import from Cronberry, or New Lead to start fresh.'
                  : 'Leads will appear here as they are assigned to you.')
              : 'Try clearing filters or searching differently.'}
          </div>
        </div>
      ) : (
        <div className="lead-card" style={{ overflow: 'auto' }}>
          <table className="lead-table">
            <thead>
              <tr>
                {isPrivileged && (
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      style={{ cursor: 'pointer' }}
                      aria-label="Select all"
                    />
                  </th>
                )}
                <th style={{ width: 18 }}></th>
                <th>Lead</th>
                <th>Phone</th>
                <th>Stage</th>
                <th>Segment</th>
                <th>Source</th>
                {isPrivileged && <th>Assigned</th>}
                <th>Last</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr
                  key={l.id}
                  // Phase 18 — onMouseDown not onClick. Some rows nested
                  // text nodes were swallowing the click target check;
                  // mousedown fires on the row itself before the synthetic
                  // bubble. Also navigate via cursor:pointer signal.
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    // Don't navigate if the click started on an input
                    // (checkbox) or its label.
                    const tag = (e.target?.tagName || '').toUpperCase()
                    if (tag === 'INPUT' || tag === 'LABEL') return
                    navigate(`/leads/${l.id}`)
                  }}
                >
                  {isPrivileged && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleSelected(l.id)}
                        style={{ cursor: 'pointer' }}
                        aria-label={`Select ${l.name}`}
                      />
                    </td>
                  )}
                  <td><HeatDot heat={l.heat} /></td>
                  <td>
                    <div className="name-cell">
                      <div>
                        <div className="name">{l.name}</div>
                        <div className="company">{l.company || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {l.phone || '—'}
                  </td>
                  <td><StageChip stage={l.stage} /></td>
                  <td><SegChip segment={l.segment} /></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {l.source || '—'}
                  </td>
                  {isPrivileged && (
                    <td>
                      {l.assigned?.name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <LeadAvatar name={l.assigned.name} userId={l.assigned.id} />
                          <span style={{ fontSize: 12 }}>{l.assigned.name}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Unassigned</span>
                      )}
                    </td>
                  )}
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {l.last_contact_at ? formatRelative(l.last_contact_at) : '—'}
                  </td>
                  <td className="mono" style={{ fontWeight: 600, fontFamily: 'var(--font-display)', textAlign: 'right' }}>
                    {l.expected_value ? formatCurrency(l.expected_value) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Sticky bulk action bar (privileged + selection > 0) ───
          Phase 31A.5 — added bulk Stage + Delete next to existing
          bulk Reassign. Stage uses inline native <select>; Delete
          confirms before nuking. RLS gates server-side so
          non-privileged users (sales / agency) can only nuke their
          own rows even if they reach this bar via DOM tampering. */}
      {selected.size > 0 && isPrivileged && (
        <div
          style={{
            position: 'sticky', bottom: 12, marginTop: 16,
            background: 'var(--surface)',
            border: '1px solid var(--accent)',
            borderRadius: 999,
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            boxShadow: '0 8px 24px rgba(0,0,0,.30)',
          }}
        >
          <span style={{ fontWeight: 600 }}>{selected.size} selected</span>
          <div style={{ flex: 1 }} />
          <button className="lead-btn lead-btn-sm lead-btn-primary" onClick={() => setReassignOpen(true)}>
            <UsersIcon size={12} /> Reassign
          </button>
          <select
            className="lead-inp"
            style={{ height: 32, padding: '0 8px', fontSize: 12, width: 'auto' }}
            defaultValue=""
            onChange={async (e) => {
              const stage = e.target.value
              e.target.value = ''
              if (!stage) return
              if (!confirm(`Move ${selected.size} lead${selected.size === 1 ? '' : 's'} to ${stage}?`)) return
              const { error: err } = await stageBulk(Array.from(selected), stage)
              if (err) { alert('Bulk stage change failed: ' + err.message); return }
              setSelected(new Set())
            }}
          >
            <option value="" disabled>Move stage…</option>
            <option value="New">New</option>
            {/* Phase 31P — 'Working' DB value, 'Follow-up' rep label. */}
            <option value="Working">Follow-up</option>
            <option value="QuoteSent">Quote Sent</option>
            <option value="Nurture">Nurture</option>
            <option value="Won">Won</option>
            <option value="Lost">Lost</option>
          </select>
          <button
            className="lead-btn lead-btn-sm"
            style={{ borderColor: 'var(--red, #EF4444)', color: 'var(--red, #EF4444)' }}
            onClick={async () => {
              if (!confirm(`DELETE ${selected.size} lead${selected.size === 1 ? '' : 's'} permanently? This cannot be undone.`)) return
              const { error: err } = await deleteBulk(Array.from(selected))
              if (err) { alert('Bulk delete failed: ' + err.message); return }
              setSelected(new Set())
            }}
          >
            <X size={12} /> Delete
          </button>
          <button className="lead-btn lead-btn-sm" onClick={() => setSelected(new Set())}>
            Cancel
          </button>
        </div>
      )}

      {/* ─── Reassign modal ─── */}
      {reassignOpen && (
        <div
          className="lead-modal-back"
          onClick={(e) => {
            if (e.target === e.currentTarget && !reassignBusy) setReassignOpen(false)
          }}
        >
          <div className="lead-modal">
            <div className="lead-modal-head">
              <div>
                <div className="lead-modal-title">Reassign {selected.size} lead{selected.size !== 1 ? 's' : ''}</div>
                <div className="lead-card-sub">Replaces the current owner. New owner sees them immediately.</div>
              </div>
              <button
                className="lead-btn lead-btn-sm"
                onClick={() => setReassignOpen(false)}
                disabled={reassignBusy}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="lead-modal-body">
              <div>
                <label className="lead-fld-label">Pick a person</label>
                <select
                  className="lead-inp"
                  value={reassignTarget}
                  onChange={e => setReassignTarget(e.target.value)}
                  disabled={reassignBusy}
                >
                  <option value="">— pick a person —</option>
                  {assignableUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.city ? `· ${u.city}` : ''} {u.team_role ? `· ${u.team_role}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {reassignErr && (
                <div
                  style={{
                    background: 'var(--danger-soft)',
                    border: '1px solid var(--danger)',
                    color: 'var(--danger)',
                    borderRadius: 8, padding: '10px 14px', fontSize: 13,
                  }}
                >
                  {reassignErr}
                </div>
              )}
            </div>
            <div className="lead-modal-foot">
              <button className="lead-btn" onClick={() => setReassignOpen(false)} disabled={reassignBusy}>
                Cancel
              </button>
              <button
                className="lead-btn lead-btn-primary"
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

/* ──────────────────────────────────────────────────────────────────
   Sub-components
   ────────────────────────────────────────────────────────────────── */

function StatCard({ label, num, meta }) {
  return (
    <div className="lead-stat-card">
      <div className="lead-stat-eyebrow">{label}</div>
      <div className="lead-stat-num">{num}</div>
      {meta ? <div className="lead-stat-meta">{meta}</div> : null}
    </div>
  )
}

/* AI briefing card — renders only when there's something to surface
   (hot idle, SLA breaches, or overnight imports). Hidden if everything
   is calm so the page isn't noisy. */
function AIBriefingCard({ briefing, onOpenQueue }) {
  const { hotIdle, slaBreaches, cronberryOvernight, sampleHot } = briefing
  if (!hotIdle.length && !slaBreaches.length && !cronberryOvernight.length) {
    return null
  }
  return (
    <div className="lead-ai-card">
      <div className="lead-ai-icon">
        <Sparkles size={20} />
      </div>
      <div>
        <div className="lead-ai-eyebrow">
          <span className="pulse" />
          AI briefing · leads
        </div>
        <p className="lead-ai-recap">
          {hotIdle.length > 0 && (<><b>{hotIdle.length} hot lead{hotIdle.length !== 1 ? 's' : ''}</b> idle &gt; 24h</>)}
          {hotIdle.length > 0 && slaBreaches.length > 0 && ' · '}
          {slaBreaches.length > 0 && (<><b>{slaBreaches.length} SLA breach{slaBreaches.length !== 1 ? 'es' : ''}</b> on hand-offs</>)}
          {(hotIdle.length > 0 || slaBreaches.length > 0) && cronberryOvernight.length > 0 && ' · '}
          {cronberryOvernight.length > 0 && (<><b>{cronberryOvernight.length} imported</b> from Cronberry overnight</>)}
        </p>
        <div className="lead-ai-list">
          {sampleHot && (
            <div className="lead-ai-item">
              <HeatDot heat={sampleHot.heat} />
              <span>
                <b>{sampleHot.name}</b>
                {sampleHot.company ? ` · ${sampleHot.company}` : ''}
                {' · awaiting follow-up'}
              </span>
              <span className="meta">{sampleHot.assigned?.name || 'unassigned'}</span>
            </div>
          )}
          {slaBreaches.length > 0 && (
            <div className="lead-ai-item">
              <HeatDot heat="hot" />
              <span>
                <b>{slaBreaches.length} SalesReady</b> lead{slaBreaches.length !== 1 ? 's' : ''} past 24h SLA
              </span>
              <span className="meta">overdue</span>
            </div>
          )}
          {cronberryOvernight.length > 0 && (
            <div className="lead-ai-item">
              <HeatDot heat="warm" />
              <span>{cronberryOvernight.length} stale Cronberry imports tagged for review</span>
              <span className="meta">cleanup</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>now</span>
        <button className="lead-btn" onClick={onOpenQueue}>
          <span>Open queue</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}
