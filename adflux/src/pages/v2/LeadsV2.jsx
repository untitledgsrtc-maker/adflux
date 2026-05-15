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
import { useNavigate, useLocation } from 'react-router-dom'
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
import { StageAgeChip } from '../../components/leads/StageAgeChip'
import { toastError } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import V2Hero from '../../components/v2/V2Hero'
import DateRangeFilter, { presetToRange } from '../../components/v2/DateRangeFilter'
import FilterDrawer, { ActiveFilterChips } from '../../components/v2/FilterDrawer'

/* The 5 tabs from the design — All + 4 groups. We re-use the
   underlying STAGE_GROUPS from useLeads but drop "in_progress"
   so QuoteSent/Negotiating only appear under "All". */
const VISIBLE_GROUPS = ALL_STAGE_GROUPS.filter(g => g.key !== 'in_progress')

export default function LeadsV2() {
  const navigate = useNavigate()
  // Phase 34Z.43 — refresh leads list on every navigation back so
  // newly-created rows show without manual reload.
  const location = useLocation()
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
  // Phase 34Z.13 — unified DateRangeFilter (Phase 34Z.11's two raw
  // <input type=date> replaced). Default preset = This month per owner.
  const [dateRange, setDateRange] = useState(() => presetToRange('this_month'))
  const dateFrom = dateRange?.from || ''
  const dateTo   = dateRange?.to   || ''

  /* ─── Bulk select state ─── */
  const [selected, setSelected] = useState(new Set())

  /* ─── Reassign modal ─── */
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassignTarget, setReassignTarget] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)
  const [reassignErr, setReassignErr] = useState('')
  const [assignableUsers, setAssignableUsers] = useState([])

  useEffect(() => { fetchLeads() /* eslint-disable-next-line */ }, [fetchLeads, location.key])

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

  // Phase 32N — owner reported (11 May 2026) Open queue button on the
  // AI Briefing card did nothing. The handler cleared filters but
  // never narrowed the list to the hot-idle leads the card was
  // pointing at. Fix: store the IDs of the hot-idle leads at click
  // time, then apply that ID set as a filter until the user clears
  // it. A small chip shows "Queue: N leads × clear" so the rep
  // knows why the list is narrowed.
  const [queueIds, setQueueIds] = useState(null)   // null = no queue filter

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Phase 34Z.11 — date-range filter on lead.created_at (YYYY-MM-DD
    // slice). Empty string means no bound on that end.
    const fromIso = dateFrom ? dateFrom : null
    const toIso   = dateTo   ? dateTo   : null
    return leads.filter(l => {
      if (queueIds && !queueIds.has(l.id)) return false
      if (stagesInGroup && !stagesInGroup.includes(l.stage)) return false
      if (segmentFilter  !== 'all' && l.segment  !== segmentFilter)  return false
      if (sourceFilter   !== 'all' && l.source   !== sourceFilter)   return false
      if (cityFilter     !== 'all' && l.city     !== cityFilter)     return false
      if (industryFilter !== 'all' && l.industry !== industryFilter) return false
      if (repFilter      !== 'all' && l.assigned?.id !== repFilter)  return false
      if (fromIso || toIso) {
        const created = (l.created_at || '').slice(0, 10)
        if (fromIso && created < fromIso) return false
        if (toIso   && created > toIso)   return false
      }
      if (!q) return true
      return (
        (l.name     || '').toLowerCase().includes(q) ||
        (l.company  || '').toLowerCase().includes(q) ||
        (l.phone    || '').toLowerCase().includes(q) ||
        (l.email    || '').toLowerCase().includes(q) ||
        (l.industry || '').toLowerCase().includes(q)
      )
    })
  }, [leads, queueIds, search, stagesInGroup, segmentFilter, sourceFilter, cityFilter, industryFilter, repFilter, dateFrom, dateTo])

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

  /* Phase 34Z.14 — schema array consumed by FilterDrawer + the
     ActiveFilterChips row. Defaults match each filter's "all/any" state
     so chips only appear once the rep narrows something. */
  const filterFields = useMemo(() => {
    const fields = [
      {
        key: 'segment',
        label: 'Segment',
        value: segmentFilter,
        onChange: setSegmentFilter,
        defaultValue: 'all',
        dotColor: 'var(--accent, #FFE600)',
        options: [
          { value: 'all',        label: 'All' },
          { value: 'PRIVATE',    label: 'Private' },
          { value: 'GOVERNMENT', label: 'Govt' },
        ],
      },
    ]
    if (distinctSources.length > 0) {
      fields.push({
        key: 'source',
        label: 'Source',
        value: sourceFilter,
        onChange: setSourceFilter,
        defaultValue: 'all',
        dotColor: 'var(--success, #10B981)',
        options: [{ value: 'all', label: 'Any' }, ...distinctSources.map(s => ({ value: s, label: s }))],
      })
    }
    if (distinctCities.length > 0) {
      fields.push({
        key: 'city',
        label: 'City',
        value: cityFilter,
        onChange: setCityFilter,
        defaultValue: 'all',
        dotColor: 'var(--blue, #3B82F6)',
        options: [{ value: 'all', label: 'All' }, ...distinctCities.map(c => ({ value: c, label: c }))],
      })
    }
    if (isPrivileged) {
      fields.push({
        key: 'industry',
        label: 'Industry',
        value: industryFilter,
        onChange: setIndustryFilter,
        defaultValue: 'all',
        dotColor: 'var(--warning, #F59E0B)',
        options: [
          { value: 'all', label: distinctIndustries.length === 0 ? '—' : 'All' },
          ...distinctIndustries.map(i => ({ value: i, label: i })),
        ],
      })
    }
    if (isPrivileged && distinctReps.length > 0) {
      fields.push({
        key: 'rep',
        label: 'Assigned',
        value: repFilter,
        onChange: setRepFilter,
        defaultValue: 'all',
        dotColor: 'var(--danger, #EF4444)',
        options: [{ value: 'all', label: 'Anyone' }, ...distinctReps.map(r => ({ value: r.id, label: r.name }))],
      })
    }
    return fields
  }, [
    segmentFilter, sourceFilter, cityFilter, industryFilter, repFilter,
    distinctSources, distinctCities, distinctIndustries, distinctReps,
    isPrivileged,
  ])

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
    repFilter !== 'all' ||
    (dateRange?.preset && dateRange.preset !== 'all')

  return (
    <div className="lead-root">
      {/* Phase 34Z.4 — V2Hero strip on /leads for cross-page consistency
          (same teal hero as /work, /quotes, /follow-ups). Value = total
          expected pipeline; chip = won/lost split; right = win-rate. */}
      {leads.length > 0 && (
        <V2Hero
          eyebrow={isAdmin ? 'Team pipeline' : 'My pipeline'}
          value={formatCurrency(totals.value)}
          label={`${totals.total} lead${totals.total === 1 ? '' : 's'}${winRate != null ? ` · ${winRate}% win rate` : ''}`}
          chip={`${totals.wonCount} won · ${totals.lostCount} lost`}
        />
      )}

      {/* Phase 33F (C2) — dropped the "Your pipeline" eyebrow above
          the "My Leads" title. Redundant filler that pushed content
          down. */}
      <div className="lead-page-head">
        <div>
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
            // Phase 32N — was a no-op (cleared filters but never
            // narrowed to the hot-idle set the card was advertising).
            // Now: collect hot-idle + SLA-breach IDs from the same
            // briefing object the card is rendering, store them as
            // a Set, and the filter useMemo above respects it. Other
            // filters clear so the queue view isn't double-scoped.
            const queueSet = new Set([
              ...aiBriefing.hotIdle.map(l => l.id),
              ...aiBriefing.slaBreaches.map(l => l.id),
            ])
            if (queueSet.size === 0) return
            setQueueIds(queueSet)
            setStageFilter('all')
            setSegmentFilter('all')
            setSourceFilter('all')
            setCityFilter('all')
            setIndustryFilter('all')
            setRepFilter('all')
            setSearch('')
            // Scroll the lead table into view so the rep can see
            // the narrowed list without hunting.
            requestAnimationFrame(() => {
              const tbl = document.querySelector('.lead-table-wrap')
              if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
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
      {/* Phase 34Z.13 — 4-chip stats row retired. Counts now live as
          badges inside each stage tab pill (e.g. "New 1 · Follow-up 1
          · Won 0"). Owner directive 14 May 2026: "move into tab pills
          as count badges". V2Hero strip already shows total pipeline. */}

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

        {/* Phase 32N — Queue mode pill. Visible only when the Open
            queue button has scoped the list to a subset of leads. Tap
            X to clear and restore full list. */}
        {queueIds && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', marginBottom: 10,
            background: 'var(--accent-soft, rgba(255,230,0,0.14))',
            border: '1px solid var(--accent, #FFE600)',
            borderRadius: 999, fontSize: 12,
            width: 'fit-content',
          }}>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>
              Queue · {queueIds.size} lead{queueIds.size !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => setQueueIds(null)}
              style={{
                background: 'transparent', border: 0, padding: 0,
                color: 'var(--text-muted)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
              title="Show all leads"
            >
              <X size={11} /> clear
            </button>
          </div>
        )}

        <div className="lead-filter-tabs">
          <span
            className={`lead-filter-tab ${stageFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStageFilter('all')}
          >
            All
            <span className="lead-filter-tab-badge">{totals.total}</span>
          </span>
          {VISIBLE_GROUPS.map(g => {
            // Phase 34Z.13 — inline count badge per tab (owner: "move
            // into tab pills as count badges"). Won uses the totals
            // wonCount; Lost uses lostCount; the rest read from
            // groupCounts keyed by tab.key.
            const n = g.key === 'won'  ? totals.wonCount
                    : g.key === 'lost' ? totals.lostCount
                    : (totals.groupCounts[g.key] || 0)
            return (
              <span
                key={g.key}
                className={`lead-filter-tab ${stageFilter === g.key ? 'active' : ''}`}
                onClick={() => setStageFilter(stageFilter === g.key ? 'all' : g.key)}
              >
                {g.label}
                <span className="lead-filter-tab-badge">{n}</span>
              </span>
            )
          })}
        </div>

        {/* Phase 34Z.14 — date pill stays inline (most-used filter);
            everything else folds into the gear popover so the default
            state is just [search] [tabs] [date] [⚙ count]. */}
        <DateRangeFilter value={dateRange} onChange={setDateRange} />

        <FilterDrawer fields={filterFields} />

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
              setDateRange(presetToRange('all'))
            }}
          >
            <X size={11} />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Phase 34Z.14 — removable chips below the filter row, one per
          active dropdown. Empty until rep narrows something. */}
      <ActiveFilterChips fields={filterFields} />

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
              ? 'Tap below to add your first lead.'
              : 'Try clearing filters or searching differently.'}
          </div>
          {/* Phase 33D — empty-state CTA. Owner directive: never a
              dead empty page; always show the next action. */}
          {leads.length === 0 && (
            <button
              className="lead-btn lead-btn-primary"
              onClick={() => navigate('/leads/new')}
              style={{ marginTop: 16 }}
            >
              <Plus size={14} /> Add first lead
            </button>
          )}
          {leads.length > 0 && (
            <button
              className="lead-btn"
              onClick={() => {
                setStageFilter('all'); setSegmentFilter('all'); setSourceFilter('all')
                setCityFilter('all'); setIndustryFilter('all'); setRepFilter('all')
                setSearch(''); setQueueIds(null)
              }}
              style={{ marginTop: 16 }}
            >
              Clear all filters
            </button>
          )}
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
                {/* Phase 33F (C4) — heat dot column removed; heat now
                    lives inside the Lead cell next to the days-dot. */}
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
              {filtered.map(l => {
                // Phase 33B — color-coded row tint + days-since-contact dot.
                // Owner directive: reps scan the list by color, not text.
                //   Green: won OR contacted within 3 days
                //   Yellow: needs follow-up this week (active stage)
                //   Red: active stage, last contact > 7 days
                //   Gray (default): nurture / lost / no activity
                const days = l.last_contact_at
                  ? Math.floor((Date.now() - new Date(l.last_contact_at).getTime()) / 86400000)
                  : null
                let rowTone = 'default'
                if (l.stage === 'Won') rowTone = 'green'
                else if (['Nurture','Lost'].includes(l.stage)) rowTone = 'default'
                else if (days === null) rowTone = 'yellow'
                else if (days <= 3) rowTone = 'green'
                else if (days <= 7) rowTone = 'yellow'
                else rowTone = 'red'

                const dotTone = days === null ? 'red'
                  : days <= 3 ? 'green'
                  : days <= 7 ? 'yellow'
                  : 'red'

                return (
                <tr
                  key={l.id}
                  className={`lead-row lead-row-${rowTone}`}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
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
                  {/* Phase 33F (C4) — heat dot moved INTO the name cell
                      next to the days-dot, with a small separator, so
                      the two coloured dots stop looking like one big
                      red/yellow smear. Heat dot first (rep's lead
                      "temperature"), then a thin divider, then the
                      days-dot (how stale). */}
                  <td>
                    <div className="name-cell" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <HeatDot heat={l.heat} />
                      <span style={{
                        width: 1, height: 14,
                        background: 'var(--border)',
                        display: 'inline-block',
                      }} />
                      <span
                        className={`days-dot days-dot-${dotTone}`}
                        title={days === null ? 'No contact yet' : `Last contact: ${days}d ago`}
                      />
                      <div>
                        <div className="name">{l.name}</div>
                        <div className="company">{l.company || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {l.phone ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{l.phone}</span>
                        <a
                          href={`tel:${String(l.phone).replace(/\s/g, '')}`}
                          title="Call"
                          onClick={async () => {
                            // Phase 35Z (14 May 2026) — auto-log on /leads row
                            // tap, same pattern as /follow-ups + lead detail.
                            try {
                              const { data: { user } } = await supabase.auth.getUser()
                              if (!user?.id) return
                              supabase.from('lead_activities').insert([{
                                lead_id: l.id,
                                activity_type: 'call',
                                outcome: 'neutral',
                                notes: `Call from leads list · ${l.name || ''}`.trim(),
                                created_by: user.id,
                              }]).then(() => {}, () => {})
                            } catch { /* ignore */ }
                          }}
                          style={{
                            color: 'var(--accent)',
                            textDecoration: 'none',
                            padding: '2px 6px',
                            borderRadius: 999,
                            border: '1px solid var(--border)',
                            fontSize: 11,
                          }}
                        >Call</a>
                        <a
                          href={`https://wa.me/${String(l.phone).replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="WhatsApp"
                          onClick={async () => {
                            try {
                              const { data: { user } } = await supabase.auth.getUser()
                              if (!user?.id) return
                              supabase.from('lead_activities').insert([{
                                lead_id: l.id,
                                activity_type: 'whatsapp',
                                outcome: 'neutral',
                                notes: `WhatsApp from leads list · ${l.name || ''}`.trim(),
                                created_by: user.id,
                              }]).then(() => {}, () => {})
                            } catch { /* ignore */ }
                          }}
                          style={{
                            color: 'var(--success)',
                            textDecoration: 'none',
                            padding: '2px 6px',
                            borderRadius: 999,
                            border: '1px solid var(--border)',
                            fontSize: 11,
                          }}
                        >WA</a>
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <StageChip stage={l.stage} />
                      {/* Phase 34L — age in current stage. Hidden for
                          Won/Lost (terminal). Red after 5d, amber after 3d. */}
                      <StageAgeChip stage={l.stage} stageChangedAt={l.stage_changed_at} />
                    </div>
                  </td>
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
              )})}
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
            style={{ height: 36, padding: '0 10px', fontSize: 12, width: 'auto' }}
            defaultValue=""
            onChange={async (e) => {
              const stage = e.target.value
              e.target.value = ''
              if (!stage) return
              // Phase 34e — replaced browser confirm() with inline
              // dialog so the look matches the rest of the app.
              const ok = await confirmDialog({
                title: 'Move stage?',
                message: `Move ${selected.size} lead${selected.size === 1 ? '' : 's'} to ${stage}?`,
                confirmLabel: 'Move',
              })
              if (!ok) return
              const { error: err } = await stageBulk(Array.from(selected), stage)
              if (err) { toastError(err, 'Bulk stage change failed.'); return }
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
              // Phase 34e — replaced browser confirm() + alert() with
              // inline dialog + toast.
              const ok = await confirmDialog({
                title: 'Delete leads?',
                message: `Delete ${selected.size} lead${selected.size === 1 ? '' : 's'} permanently? This cannot be undone.`,
                confirmLabel: 'Delete',
                danger: true,
              })
              if (!ok) return
              const { error: err } = await deleteBulk(Array.from(selected))
              if (err) { toastError(err, 'Bulk delete failed.'); return }
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
                <b>{slaBreaches.length}</b> lead{slaBreaches.length !== 1 ? 's' : ''} past 24h handoff SLA
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
