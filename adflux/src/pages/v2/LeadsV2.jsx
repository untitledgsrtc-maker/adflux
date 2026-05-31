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
// Phase 100.B — inline lane helpers + RPC humanizer below the
// imports. Mirror the SQL logic from Phase 100.A so the picker UX
// matches what reassign_lead / reassign_leads_bulk enforce. Per
// owner override 2026-05-29: "no new utility file" — duplicated
// here and in ReassignModal.jsx by design.

function callerLane(profile) {
  if (!profile) return 'other'
  if (profile.role === 'telecaller' && profile.team_role === 'sales_manager') return 'sales'
  if (profile.role === 'telecaller')                                          return 'tc'
  if (['sales', 'agency'].includes(profile.role))                             return 'sales'
  if (['admin', 'co_owner'].includes(profile.role))                           return 'admin'
  return 'other'
}

function targetLane(rep) {
  if (!rep) return 'other'
  if (rep.role === 'telecaller' && rep.team_role === 'sales_manager') return 'sales'
  if (rep.role === 'telecaller')                                      return 'tc'
  if (['sales', 'agency'].includes(rep.role))                         return 'sales'
  if (['admin', 'co_owner'].includes(rep.role))                       return 'admin'
  return 'other'
}

function eligibleTargets(reps, profile) {
  if (!profile) return []
  return (reps || []).filter(r => r.id !== profile.id)
}

function isCrossTeam(profile, rep) {
  if (!profile || !rep) return false
  const c = callerLane(profile)
  const t = targetLane(rep)
  return (c === 'tc' && t === 'sales') || (c === 'sales' && t === 'tc')
}

function humanizeReason(s) {
  if (!s) return 'Reassign failed.'
  if (s.includes('daily reassign limit reached')) return 'Daily limit reached (5 reassigns/day).'
  if (s.includes('bulk cap 20'))                   return 'Bulk cap is 20. Reduce your selection.'
  if (s.includes('auth.uid()'))                    return 'Session expired. Reload and sign back in.'
  switch (s) {
    case 'cannot reassign to self':                          return 'Cannot pick yourself.'
    case 'target not found':                                 return 'Target user not found.'
    case 'target not active':                                return 'Target rep is inactive.'
    case 'cannot reassign to admin':                         return 'Cannot reassign to admin. Pick a rep or telecaller.'
    case 'lead not found':                                   return 'Lead not found.'
    case 'not lead owner':                                   return "You don't own this lead. Ask admin to move it."
    case 'cannot reassign closed lead':                      return 'Won / Lost leads cannot be reassigned. Reopen first.'
    case 'target segment access mismatch':                   return "Target doesn't have access to this segment."
    case 'sales→TC only allowed on New/Working/Nurture stages':
                                                             return 'Can only send back to telecaller on New / Follow-up / Nurture.'
    case 'reason required for cross-team reassign':          return 'Reason required (≥3 chars) for cross-team reassign.'
    case 'role not allowed to reassign':                     return "Your role can't reassign leads."
    case 'target role not eligible':                         return "Target rep can't own leads."
    case 'government_partner caller cannot touch non-GOVERNMENT leads':
                                                             return 'Government Partner can only reassign GOVERNMENT leads.'
    default:                                                 return s
  }
}
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useLeads, STAGE_GROUPS as ALL_STAGE_GROUPS, LOST_REASONS } from '../../hooks/useLeads'
import { formatCurrency, formatRelative } from '../../utils/formatters'
import {
  StageChip, HeatDot, SegChip, LeadAvatar,
} from '../../components/leads/LeadShared'
import { StageAgeChip } from '../../components/leads/StageAgeChip'
import { toastError, pushToast } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import V2Hero from '../../components/v2/V2Hero'
import DateRangeFilter, { presetToRange } from '../../components/v2/DateRangeFilter'
import FilterDrawer, { ActiveFilterChips } from '../../components/v2/FilterDrawer'
// Phase 44.1 — daily leads-collected bar chart at top of /leads.
import LeadsCollectedChart from '../../components/leads/LeadsCollectedChart'

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

  // Phase 93.10 (25 May 2026) — owner: sales / TC / sales_manager
  // need bulk reassign on the leads LIST page, not just on the lead
  // detail page. Matches the canReassign rule shipped on LeadDetailV2:
  //   - admin / co_owner      → always
  //   - sales_manager         → always (DB RLS leads_manager_team)
  //   - sales / agency / TC   → only when self is assigned_to or
  //                             telecaller_id (RLS will reject otherwise)
  // Per-row check used to decide whether to render the checkbox.
  function canReassign(l) {
    if (!l || !profile) return false
    // Phase 100.B — non-admin cannot reassign Won/Lost (RPC blocks
    // it server-side; hide the checkbox so UX doesn't dangle). Admin
    // and co_owner can still flip closed leads if needed.
    if (['Won', 'Lost'].includes(l.stage) && !isPrivileged) return false
    if (isPrivileged) return true
    if (profile.team_role === 'sales_manager') return true
    return l.assigned_to === profile.id
        || l.telecaller_id === profile.id
  }
  const { leads, loading, error, fetchLeads, reassignBulk, stageBulk, deleteBulk, applyRealtimeChange } = useLeads()

  /* ─── Filter state ─── */
  const [search, setSearch]               = useState('')
  const [stageFilter, setStageFilter]     = useState('all')
  const [segmentFilter, setSegmentFilter] = useState('all')
  const [sourceFilter, setSourceFilter]   = useState('all')
  const [cityFilter, setCityFilter]       = useState('all')
  const [industryFilter, setIndustryFilter] = useState('all')   // Phase 19
  const [repFilter, setRepFilter]         = useState('all')
  // Phase 46.1 — filter by latest call outcome (positive / neutral
  // / callback / negative). Built from a one-shot subquery against
  // lead_activities (latest outcome per lead).
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [leadOutcomeMap, setLeadOutcomeMap] = useState({})
  // Phase 72.4 (21 May 2026) — owner asked for "Price problem" filter.
  // Filters to leads whose lost_reason='Price' (lost deals only, not
  // negotiating). Matches LOST_REASONS enum in useLeads.js.
  const [lostReasonFilter, setLostReasonFilter] = useState('all')
  // Phase 34Z.13 — unified DateRangeFilter (Phase 34Z.11's two raw
  // <input type=date> replaced). Default preset = This month per owner.
  const [dateRange, setDateRange] = useState(() => presetToRange('this_month'))
  const dateFrom = dateRange?.from || ''
  const dateTo   = dateRange?.to   || ''

  /* ─── Bulk select state ─── */
  const [selected, setSelected] = useState(new Set())

  // Phase 62.8 (20 May 2026) — pagination + CSV export. Owner reported
  // /leads becomes a giant unbreakable scroll once the list passes
  // ~200 rows. Paginating client-side keeps every existing filter +
  // search + sort behavior intact (no server-side change). Default
  // 50/page; rep can pick 100 / 200 / 500. Resetting any filter or
  // search drops back to page 1 via the useEffect below.
  const [pageSize, setPageSize] = useState(() => {
    const saved = parseInt(localStorage.getItem('leads_page_size') || '50', 10)
    return [50, 100, 200, 500].includes(saved) ? saved : 50
  })
  const [page, setPage] = useState(1)

  /* ─── Reassign modal ─── */
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassignTarget, setReassignTarget] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)
  const [reassignErr, setReassignErr] = useState('')
  const [assignableUsers, setAssignableUsers] = useState([])
  // Phase 100.B — bulk reason (applies to the whole batch per owner
  // override) + inline partial-failure list. failures = null means
  // no submit yet; [] means all succeeded; [{lead_id,reason},…]
  // means at least one failed (modal stays open + renders the list).
  const [reassignReason, setReassignReason] = useState('')
  const [reassignFailures, setReassignFailures] = useState(null)

  useEffect(() => { fetchLeads() /* eslint-disable-next-line */ }, [fetchLeads, location.key])

  // Phase 46.1 — latest call outcome per lead. One query: pull
  // lead_activities with outcome set, ordered desc, dedup client-
  // side (first hit per lead = latest). Cap 5000 to keep payload
  // bounded; covers ~6 months of activity for an active team.
  useEffect(() => {
    let cancelled = false
    async function loadOutcomes() {
      const { data } = await supabase
        .from('lead_activities')
        .select('lead_id, outcome, created_at')
        .not('outcome', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000)
      if (cancelled) return
      const map = {}
      for (const r of (data || [])) {
        if (!(r.lead_id in map)) map[r.lead_id] = r.outcome
      }
      setLeadOutcomeMap(map)
    }
    loadOutcomes()
    return () => { cancelled = true }
  }, [location.key])

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

  // Phase 93.10 → 100.B — reassign target list. Phase 93.10 widened
  // the bulk-bar to sales / TC / sales_manager but left this fetch
  // gated to isPrivileged, which produced an empty picker for non-
  // admin reps. Phase 100.B widens the fetch to any signed-in user
  // (sales / TC need it for their own-lead reassign rows) AND adds
  // `role` to the SELECT so the inline targetLane() helper can
  // classify TC vs sales targets for cross-team detection. RPC
  // enforces the actual write rules; this query just feeds the
  // picker. Result list is ~20 rows in steady state, cheap.
  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('users')
      .select('id, name, role, team_role, city, is_active')
      .in('team_role', ['sales', 'agency', 'sales_manager', 'telecaller'])
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (!err) setAssignableUsers(data || [])
      })
  }, [profile?.id])

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
      // Phase 46.1 — outcome filter (latest activity outcome).
      if (outcomeFilter  !== 'all' && (leadOutcomeMap[l.id] || '') !== outcomeFilter) return false
      // Phase 72.4 — lost-reason filter ("Price problem" etc.).
      if (lostReasonFilter !== 'all' && l.lost_reason !== lostReasonFilter) return false
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
  }, [leads, queueIds, search, stagesInGroup, segmentFilter, sourceFilter, cityFilter, industryFilter, repFilter, outcomeFilter, leadOutcomeMap, lostReasonFilter, dateFrom, dateTo])

  // Phase 62.8 — paginated slice. Filter computes the full set; the
  // table only renders one page worth. Reset to page 1 whenever the
  // filtered list changes (filter / search / sort / stage / segment).
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => {
    if (page > totalPages) setPage(1)
  }, [filtered.length, pageSize, totalPages, page])
  useEffect(() => { setPage(1) }, [search, stageFilter, segmentFilter, sourceFilter, cityFilter, industryFilter, repFilter, outcomeFilter, lostReasonFilter, dateFrom, dateTo, queueIds])
  useEffect(() => { localStorage.setItem('leads_page_size', String(pageSize)) }, [pageSize])
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  // Phase 62.8 — CSV export of currently selected rows. If nothing
  // selected, falls back to exporting the FILTERED set (so admin
  // can "click filter then export all"). Fields chosen to match the
  // /leads table columns the rep already sees on screen.
  function exportSelectedCsv() {
    const idsToExport = selected.size > 0 ? selected : new Set(filtered.map(l => l.id))
    const rows = filtered.filter(l => idsToExport.has(l.id))
    if (rows.length === 0) {
      pushToast('Nothing to export — no rows selected.', 'warning')
      return
    }
    const headers = ['name','company','phone','email','stage','segment','source','city','industry','assigned','heat','last_contact_at','expected_value','created_at']
    const escape = (v) => {
      if (v == null) return ''
      const s = String(v)
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const out = [headers.join(',')]
    for (const l of rows) {
      out.push([
        l.name, l.company, l.phone, l.email,
        l.stage, l.segment, l.source, l.city, l.industry,
        l.assigned?.name || '',
        l.heat || '',
        l.last_contact_at ? new Date(l.last_contact_at).toISOString() : '',
        l.expected_value || '',
        l.created_at ? new Date(l.created_at).toISOString() : '',
      ].map(escape).join(','))
    }
    const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().slice(0,10)}-${rows.length}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    pushToast(`Exported ${rows.length} lead${rows.length === 1 ? '' : 's'} to CSV.`, 'success')
  }

  /* ─── Stat strip totals ─── */
  const totals = useMemo(() => {
    const counts = {}
    let value = 0, wonCount = 0, lostCount = 0
    leads.forEach(l => {
      counts[l.stage] = (counts[l.stage] || 0) + 1
      // Phase 106 — pipeline = OPEN deals only. Won (closed revenue) +
      // Lost (dead) must NOT inflate the Team-pipeline figure — owner
      // caught the 163 Lost leads being summed into it. Matches the
      // already-correct logic in LeadDashboardV2 (filter !Won/!Lost).
      if (!['Won', 'Lost'].includes(l.stage)) {
        value += Number(l.expected_value) || 0
      }
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
    // Phase 46.1 — outcome filter (latest call outcome per lead).
    fields.push({
      key: 'outcome',
      label: 'Outcome',
      value: outcomeFilter,
      onChange: setOutcomeFilter,
      defaultValue: 'all',
      dotColor: 'var(--warning, #F59E0B)',
      options: [
        { value: 'all',      label: 'Any outcome' },
        { value: 'positive', label: 'Good' },
        { value: 'neutral',  label: 'Maybe' },
        { value: 'callback', label: 'Call later' },
        { value: 'negative', label: 'Lost' },
      ],
    })
    // Phase 72.4 — lost-reason filter ("Price problem", "Timing", etc.).
    // Owner directive: "Price problem leads filter option is not available".
    fields.push({
      key: 'lost_reason',
      label: 'Lost reason',
      value: lostReasonFilter,
      onChange: setLostReasonFilter,
      defaultValue: 'all',
      dotColor: 'var(--danger, #EF4444)',
      options: [
        { value: 'all', label: 'Any reason' },
        { value: 'Price', label: 'Price problem' },
        ...LOST_REASONS.filter(r => r !== 'Price').map(r => ({ value: r, label: r })),
      ],
    })
    return fields
  }, [
    segmentFilter, sourceFilter, cityFilter, industryFilter, repFilter, outcomeFilter, lostReasonFilter,
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

  // Phase 100.B — closing helper resets every modal-scoped piece of
  // state so the next open isn't pre-populated with stale target /
  // reason / error / failure list.
  function closeReassignModal() {
    setReassignOpen(false)
    setReassignTarget('')
    setReassignReason('')
    setReassignErr('')
    setReassignFailures(null)
  }

  async function handleReassign() {
    if (!reassignTarget) {
      setReassignErr('Pick a person to reassign to.')
      return
    }
    // Phase 100.B — cross-team reason gate. Lane comparison is
    // caller (profile) vs picked target rep; if cross-team the
    // RPC requires a reason ≥3 chars (per Phase 100.A SQL).
    const targetRep = assignableUsers.find(r => r.id === reassignTarget)
    if (isCrossTeam(profile, targetRep) && reassignReason.trim().length < 3) {
      setReassignErr('Reason required (≥3 chars) for cross-team reassign.')
      return
    }

    setReassignBusy(true)
    setReassignErr('')
    setReassignFailures(null)

    const { data, error: err } = await reassignBulk(
      Array.from(selected),
      reassignTarget,
      reassignReason.trim() || null
    )
    setReassignBusy(false)

    if (err) {
      setReassignErr(humanizeReason(err.message))
      return
    }

    // Phase 100.B — RPC returns {total, succeeded, failed, failures}.
    // Partial failure: keep modal open, render inline list so rep
    // sees exactly which leads didn't move and why. Successful leads
    // drop out of the selection so a second submit only re-tries the
    // failed ones.
    if (data?.failed > 0) {
      const fails = data.failures || []
      setReassignFailures(fails)
      setSelected(new Set(fails.map(f => f.lead_id)))
      return
    }

    // All succeeded.
    closeReassignModal()
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
    outcomeFilter !== 'all' ||
    lostReasonFilter !== 'all' ||
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
          label={`${totals.total} lead${totals.total === 1 ? '' : 's'}${winRate != null ? ` · win-rate` : ''}`}
          // Phase 35.1 — design-rule rollout: ring + footer stats
          // matching the /work hero pattern. `winRate` is already
          // computed above (0..100 or null).
          percent={typeof winRate === 'number' ? winRate : undefined}
          footerStats={[
            { label: 'won',  value: totals.wonCount,  tint: '#2BD8A0' },
            { label: 'lost', value: totals.lostCount, tint: '#FF6F61' },
          ]}
          accent={winRate != null && winRate >= 50}
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

      {/* Phase 44.1 — daily leads-collected chart.
          Phase 44.3 — clicking a bar filters the table date range
          to that single day. Rep clicks "07 May" → table shows
          only leads created 07 May. */}
      <LeadsCollectedChart
        onDayClick={(dateISO) => {
          const d = new Date(dateISO + 'T00:00:00Z')
          const label = d.toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', timeZone: 'UTC',
          })
          setDateRange({
            preset: 'custom',
            from: dateISO,
            to:   dateISO,
            label,
          })
        }}
      />

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
              setOutcomeFilter('all')          // Phase 72.4 — was missing
              setLostReasonFilter('all')       // Phase 72.4 — new
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
                setOutcomeFilter('all'); setLostReasonFilter('all')  // Phase 72.4
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
                {/* Phase 93.10 — header checkbox shows if ANY row in
                    the current filtered view can be reassigned. Same
                    rule as the per-row checkboxes below. */}
                {filtered.some(canReassign) && (
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
              {paged.map(l => {
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
                  {/* Phase 93.10 — per-row checkbox now shown to every
                      role that can reassign this lead. Sales / TC see
                      checkbox only on rows they own. Admin / co_owner /
                      sales_manager see all. */}
                  {filtered.some(canReassign) && (
                    <td className="td-check" onClick={(e) => e.stopPropagation()}>
                      {canReassign(l) ? (
                        <input
                          type="checkbox"
                          checked={selected.has(l.id)}
                          onChange={() => toggleSelected(l.id)}
                          style={{ cursor: 'pointer' }}
                          aria-label={`Select ${l.name}`}
                        />
                      ) : null}
                    </td>
                  )}
                  {/* Phase 33F (C4) — heat dot moved INTO the name cell
                      next to the days-dot, with a small separator, so
                      the two coloured dots stop looking like one big
                      red/yellow smear. Heat dot first (rep's lead
                      "temperature"), then a thin divider, then the
                      days-dot (how stale). */}
                  <td className="td-lead">
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
                    className="td-phone mono"
                    style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {l.phone ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{l.phone}</span>{/* Phase 34Z.76 */}
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
                    ) : (
                      // Phase 34Z.76 — owner directive (16 May 2026):
                      // allow govt leads to save without phone, but
                      // visually flag every row that has none so admin
                      // can chase the gap. Amber dot + "no phone" chip.
                      <span
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '2px 8px', borderRadius: 999,
                          background: 'var(--warning-soft, rgba(245,158,11,0.14))',
                          border: '1px solid var(--warning, #F59E0B)',
                          color: 'var(--warning, #F59E0B)',
                          fontSize: 10, fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: '.06em',
                        }}
                        title="No phone on file — call / WhatsApp won't work"
                      >
                        no phone
                      </span>
                    )}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {l.assigned?.name ? (
                          <>
                            <LeadAvatar name={l.assigned.name} userId={l.assigned.id} />
                            <span style={{ fontSize: 12 }}>{l.assigned.name}</span>
                          </>
                        ) : l.telecaller?.name ? (
                          /* Phase 99.C — telecaller fallback. Phase 99.B + 99.B.1
                             route TC-only imports to telecaller_id only (assigned_to
                             stays NULL by design). Without this fallback /leads
                             admin table rendered "Unassigned" for every TC-owned
                             lead — Yogi Petrol Pump + Yesha Hospital screenshot
                             2026-05-29. useLeads.SELECT_COLUMNS already embeds the
                             `telecaller:telecaller_id(id, name, team_role)` join, so
                             zero query change is needed. */
                          <>
                            <LeadAvatar name={l.telecaller.name} userId={l.telecaller.id} />
                            <span style={{ fontSize: 12 }}>{l.telecaller.name}</span>
                            <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>· TC</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Unassigned</span>
                        )}
                        {/* Phase 34Z.77 — single-lead reassign without
                            the sticky bulk bar. Owner kept losing the
                            bottom-sticky Reassign button under scroll.
                            Per-row icon: tap → select this one lead →
                            open existing ReassignModal in single-lead
                            mode. Uses same bulk-reassign code path. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected(new Set([l.id]))
                            setReassignOpen(true)
                          }}
                          title="Reassign this lead"
                          aria-label="Reassign this lead"
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-strong, var(--border))',
                            color: 'var(--text-muted)',
                            borderRadius: 999,
                            padding: '3px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <UsersIcon size={11} /> Reassign
                        </button>
                      </div>
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
          {/* Phase 62.8 (20 May 2026) — pagination + export footer.
              Sits inside the lead-card so it scrolls with the table.
              Hidden when filtered set fits in one page AND no selection
              (no point showing controls when 5 rows render). */}
          {(filtered.length > pageSize || selected.size > 0) && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12, padding: '12px 14px',
              borderTop: '1px solid var(--border)',
              flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>
                  Showing <b style={{ color: 'var(--text)' }}>
                    {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}
                  </b>–
                  <b style={{ color: 'var(--text)' }}>
                    {Math.min(page * pageSize, filtered.length)}
                  </b>{' '}of <b style={{ color: 'var(--text)' }}>{filtered.length}</b>
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span>Per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                    style={{
                      padding: '4px 8px', borderRadius: 6,
                      background: 'var(--surface)', color: 'var(--text)',
                      border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 12,
                    }}
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Phase 62.8.1 (20 May 2026) — CSV export gated to
                    admin / co_owner only per owner directive. Sales /
                    telecaller / manager / agency reps should NOT be
                    able to bulk-extract the lead list. Pagination
                    controls below remain visible to all roles. */}
                {isPrivileged && (
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm"
                    onClick={exportSelectedCsv}
                    title={selected.size > 0
                      ? `Export ${selected.size} selected to CSV`
                      : 'Export all filtered rows to CSV'}
                  >
                    Export CSV{selected.size > 0 ? ` (${selected.size})` : ''}
                  </button>
                )}
                <button
                  type="button"
                  className="lead-btn lead-btn-sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <span style={{
                  fontSize: 12, color: 'var(--text-muted)', minWidth: 56, textAlign: 'center',
                }}>
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="lead-btn lead-btn-sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Sticky bulk action bar (privileged + selection > 0) ───
          Phase 31A.5 — added bulk Stage + Delete next to existing
          bulk Reassign. Stage uses inline native <select>; Delete
          confirms before nuking. RLS gates server-side so
          non-privileged users (sales / agency) can only nuke their
          own rows even if they reach this bar via DOM tampering. */}
      {/* Phase 93.10 — bulk bar now shows for any role that can
          reassign at least one of the selected leads. Move-stage +
          Delete actions stay gated to isPrivileged (sales / TC must
          go through stage modal on the lead detail). */}
      {selected.size > 0 && (
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
          {isPrivileged && (
            <>
              <select
                className="lead-inp"
                style={{ height: 36, padding: '0 10px', fontSize: 12, width: 'auto' }}
                defaultValue=""
                onChange={async (e) => {
                  const stage = e.target.value
                  e.target.value = ''
                  if (!stage) return
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
            </>
          )}
          <button className="lead-btn lead-btn-sm" onClick={() => setSelected(new Set())}>
            Cancel
          </button>
        </div>
      )}

      {/* ─── Reassign modal ─── */}
      {reassignOpen && (() => {
        // Phase 100.B — picker derivation: filter to eligible reps
        // (self-exclude), classify the picked target's lane, decide
        // whether reason is required.
        const targets   = eligibleTargets(assignableUsers, profile)
        const targetRep = targets.find(r => r.id === reassignTarget) || null
        const cross     = isCrossTeam(profile, targetRep)
        // Lead-id → name map so failure list can show "Lead X:
        // reason" instead of raw UUIDs.
        const leadNameById = (id) => leads.find(l => l.id === id)?.name || id.slice(0, 8)
        return (
        <div
          className="lead-modal-back"
          onClick={(e) => {
            if (e.target === e.currentTarget && !reassignBusy) closeReassignModal()
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
                onClick={closeReassignModal}
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
                  {targets.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.city ? `· ${u.city}` : ''} {u.team_role ? `· ${u.team_role}` : ''}
                    </option>
                  ))}
                </select>
                {/* Phase 100.B — cross-team flag so rep sees why the
                    reason is required before they tab to it. */}
                {cross && (
                  <div
                    style={{
                      marginTop: 8,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 999,
                      background: 'var(--warning-soft, rgba(245,158,11,0.14))',
                      border: '1px solid var(--warning, #F59E0B)',
                      color: 'var(--warning, #F59E0B)',
                      fontSize: 11, fontWeight: 600,
                      letterSpacing: '.04em',
                    }}
                  >
                    <AlertTriangle size={14} />
                    Cross-team move · reason required
                  </div>
                )}
              </div>
              {/* Phase 100.B — reason textarea. Applies to the whole
                  batch per owner override. Required when cross-team
                  (RPC enforces ≥3 chars; pre-validated in handler). */}
              <div>
                <label className="lead-fld-label">
                  Reason {cross ? <span style={{ color: 'var(--danger)' }}>(required)</span> : '(optional)'}
                </label>
                <textarea
                  className="lead-inp"
                  rows={2}
                  value={reassignReason}
                  onChange={e => setReassignReason(e.target.value)}
                  placeholder={cross ? 'Why send this to the other team?' : 'Why this reassign?'}
                  disabled={reassignBusy}
                />
              </div>
              {reassignErr && (
                <div
                  style={{
                    background: 'var(--danger-soft)',
                    border: '1px solid var(--danger)',
                    color: 'var(--danger)',
                    borderRadius: 10, padding: '10px 14px', fontSize: 13,
                  }}
                >
                  {reassignErr}
                </div>
              )}
              {/* Phase 100.B — inline partial-failure list. Stays
                  inside the modal per owner override (no toast, no
                  separate UI). Lists every lead the RPC rejected
                  with a humanized reason; the surviving selection
                  is the failed set, so a second submit re-tries
                  only the failures. */}
              {reassignFailures && reassignFailures.length > 0 && (
                <div
                  style={{
                    background: 'var(--warning-soft, rgba(245,158,11,0.14))',
                    border: '1px solid var(--warning, #F59E0B)',
                    color: 'var(--text)',
                    borderRadius: 10, padding: '10px 14px', fontSize: 13,
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontWeight: 700, color: 'var(--warning, #F59E0B)',
                    marginBottom: 8,
                  }}>
                    <AlertTriangle size={14} />
                    {reassignFailures.length} lead{reassignFailures.length === 1 ? '' : 's'} could not be reassigned
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {reassignFailures.map(f => (
                      <li key={f.lead_id} style={{ fontSize: 12 }}>
                        <b>{leadNameById(f.lead_id)}</b>
                        <span style={{ color: 'var(--text-muted)' }}> — {humanizeReason(f.reason)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="lead-modal-foot">
              <button className="lead-btn" onClick={closeReassignModal} disabled={reassignBusy}>
                {reassignFailures ? 'Close' : 'Cancel'}
              </button>
              <button
                className="lead-btn lead-btn-primary"
                onClick={handleReassign}
                disabled={reassignBusy || !reassignTarget}
              >
                {reassignBusy ? 'Reassigning…' : reassignFailures ? 'Retry failed' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
        )
      })()}
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
