// src/pages/v2/QuotesV2.jsx
//
// v2 of the Quotes list. Rendered inside V2AppShell (so the
// sidebar/topbar/mobile-nav are already on screen). This file
// only paints the body of the page.
//
// Data flow mirrors pages/Quotes.jsx exactly (same useQuotes
// hook, same filters store, same status tabs, same QuoteTable).
// The only thing we change is the chrome.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, X, ChevronDown, ChevronUp, ChevronsUpDown, Pencil, Trash2, FileText } from 'lucide-react'
import { useQuotes } from '../../hooks/useQuotes'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import DateRangeFilter, { presetToRange } from '../../components/v2/DateRangeFilter'
import FilterDrawer, { ActiveFilterChips } from '../../components/v2/FilterDrawer'
import { useAuthStore } from '../../store/authStore'
import { QUOTE_STATUSES, STATUS_LABELS } from '../../utils/constants'
import { formatCurrency, formatDate, truncate } from '../../utils/formatters'
import { supabase } from '../../lib/supabase'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import V2Hero from '../../components/v2/V2Hero'

/* ─── Local helpers ────────────────────────────────── */
function computeBalance(q) {
  if (q.status === 'lost') return { kind: 'none' }
  const paid = (q.payments || [])
    .filter(p => p.approval_status === 'approved')
    .reduce((s, p) => s + Number(p.amount_received || 0), 0)
  if (paid === 0 && q.status !== 'won') return { kind: 'none' }
  const total = Number(q.total_amount || 0)
  const balance = Math.max(0, total - paid)
  if (balance === 0 && paid > 0) return { kind: 'paid' }
  return { kind: 'due', amount: balance }
}

/* ─── Component ────────────────────────────────────── */
export default function QuotesV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  // Privileged set (admin / owner / co_owner) gets the full admin UI
  // (sales-rep filter column, all-rows view). Phase 5 added the new
  // owner / co_owner roles.
  // Phase 11i — owner role removed; admin + co_owner is the privileged set.
  const isAdmin = ['admin', 'co_owner'].includes(profile?.role)

  const { quotes, filters, setFilters, resetFilters, fetchQuotes } = useQuotes()
  const [loading, setLoading] = useState(true)

  // Phase 29c — inline Edit / Delete from the list row. Saves a click
  // for cleanup workflows. Each handler stops row-click propagation
  // so the row's onClick (open detail) doesn't also fire.
  function editQuote(e, q) {
    e.stopPropagation()
    if (q.segment === 'GOVERNMENT') {
      const path = q.media_type === 'AUTO_HOOD'
        ? '/quotes/new/government/auto-hood'
        : '/quotes/new/government/gsrtc-led'
      navigate(path, { state: { editingId: q.id } })
    } else if (q.media_type === 'OTHER_MEDIA') {
      navigate('/quotes/new/private/other-media', { state: { editingId: q.id } })
    } else {
      // Phase 32C — was '/quotes/new?editOf=' but that's the segment
      // chooser, which silently drops editOf. Use the actual Private
      // LED wizard route. Same bug fix applied in QuoteDetail.jsx.
      navigate(`/quotes/new/private?editOf=${q.id}`)
    }
  }
  async function deleteQuote(e, q) {
    e.stopPropagation()
    const ok = await confirmDialog({
      title: 'Delete draft quote?',
      message: `Delete draft ${q.quote_number || q.ref_number || ''} permanently? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    const { error: delErr } = await supabase.from('quotes').delete().eq('id', q.id)
    if (delErr) {
      toastError(delErr, 'Could not delete quote.')
      return
    }
    toastSuccess('Quote deleted.')
    fetchQuotes()
  }
  const [searchDraft, setSearchDraft] = useState(filters.search || '')
  const [sortField, setSortField] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  // Admin-only sales-rep filter — derived from the quotes already
  // loaded so no extra fetch is needed. 'all' shows everyone.
  const [repFilter, setRepFilter] = useState('all')
  // Phase B segment filter — slices the list by Private vs Government.
  // 'all' (default) keeps the historical mixed view. Pre-Phase 4 rows
  // have segment=null, so 'private' must match both 'PRIVATE' and null.
  const [segmentFilter, setSegmentFilter] = useState('all')
  // Sub-filter for govt quotes — Auto Hood vs GSRTC LED. Only visible
  // when segmentFilter === 'government'. Mirrors the segment pill UI.
  const [mediaFilter, setMediaFilter] = useState('all')

  useEffect(() => {
    setLoading(true)
    fetchQuotes().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  // Phase 34Z.59 — refetch on tab-resume / window focus so newly
  // created or won quotes show up without a manual reload.
  useAutoRefresh(fetchQuotes)

  // Keep the in-page search draft in sync with the store — the topbar
  // quick-search in V2AppShell also writes to filters.search, and
  // without this the in-page input would drift out of step.
  useEffect(() => {
    setSearchDraft(filters.search || '')
  }, [filters.search])

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter') setFilters({ search: searchDraft })
    if (e.key === 'Escape') { setSearchDraft(''); setFilters({ search: '' }) }
  }

  function handleReset() {
    setSearchDraft('')
    resetFilters()
  }

  function handleSort(field) {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortDir('desc') }
  }

  const hasActiveFilters =
    filters.status || filters.search || filters.dateFrom || filters.dateTo

  // Apply segment filter to the underlying quote pool — every downstream
  // memo (repScoped → counts, sorted → displayed → totals) reads from
  // segmentScoped, so the pill correctly slices status tab counts and
  // totals together.
  const segmentScoped = useMemo(() => {
    let pool = quotes
    if (segmentFilter === 'government') {
      pool = quotes.filter(q => q.segment === 'GOVERNMENT')
      // Govt-only sub-filter on media_type. 'all' keeps both AUTO + GSRTC.
      if (mediaFilter !== 'all') {
        pool = pool.filter(q => q.media_type === mediaFilter)
      }
    } else if (segmentFilter !== 'all') {
      pool = quotes.filter(q => q.segment !== 'GOVERNMENT')
    }
    return pool
  }, [quotes, segmentFilter, mediaFilter])

  // Rep-scoped quote pool — used by tab counts so when admin scopes
  // to one rep, the tabs show that rep's status breakdown (otherwise
  // "Won 7" lies when the table only renders 3 of theirs).
  const repScoped = useMemo(() => {
    if (!isAdmin || repFilter === 'all') return segmentScoped
    return segmentScoped.filter(q => q.created_by === repFilter)
  }, [segmentScoped, isAdmin, repFilter])

  const counts = useMemo(() => (
    QUOTE_STATUSES.reduce((acc, s) => {
      acc[s] = repScoped.filter(q => q.status === s).length
      return acc
    }, {})
  ), [repScoped])

  const sorted = useMemo(() => {
    return [...segmentScoped].sort((a, b) => {
      let va = a[sortField]
      let vb = b[sortField]
      if (sortField === 'total_amount' || sortField === 'subtotal') {
        va = Number(va) || 0
        vb = Number(vb) || 0
      } else {
        va = String(va || '').toLowerCase()
        vb = String(vb || '').toLowerCase()
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [segmentScoped, sortField, sortDir])

  // Build the rep dropdown options from quotes already on screen —
  // saves an extra users fetch and keeps the list in sync with what
  // admin can actually see (RLS scoped). Sorted by name for stable UI.
  const repOptions = useMemo(() => {
    const seen = new Map()
    quotes.forEach(q => {
      if (q.created_by && !seen.has(q.created_by)) {
        seen.set(q.created_by, q.sales_person_name || '—')
      }
    })
    return Array.from(seen, ([id, name]) => ({ id, name }))
                .sort((a, b) => a.name.localeCompare(b.name))
  }, [quotes])

  // Apply the rep filter on top of the sort (sales role doesn't need
  // this — RLS limits them to their own rows already, so the filter
  // is admin-only).
  const displayed = useMemo(() => {
    if (!isAdmin || repFilter === 'all') return sorted
    return sorted.filter(q => q.created_by === repFilter)
  }, [sorted, isAdmin, repFilter])

  // Totals strip — recomputed against the displayed (filtered) set so
  // when admin scopes to one rep they see that rep's totals only.
  const totals = useMemo(() => {
    let amount = 0
    let outstanding = 0
    displayed.forEach(q => {
      amount += Number(q.total_amount) || 0
      const b = computeBalance(q)
      if (b.kind === 'due') outstanding += b.amount || 0
    })
    return { count: displayed.length, amount, outstanding }
  }, [displayed])

  return (
    <div className="v2d-quotes">
      {/* Phase 34Z.4 — V2Hero strip for cross-page consistency
          (same teal hero as /work, /leads, /follow-ups). Value =
          total quoted amount in the current filter scope; chip =
          outstanding balance from approved partial payments. */}
      {displayed.length > 0 && (
        <V2Hero
          eyebrow={isAdmin ? 'Team quotes' : 'Your pipeline'}
          value={formatCurrency(totals.amount)}
          label={`${totals.count} quote${totals.count === 1 ? '' : 's'}${(hasActiveFilters || (isAdmin && repFilter !== 'all')) ? ' · filtered' : ''}`}
          chip={totals.outstanding > 0 ? `${formatCurrency(totals.outstanding)} outstanding` : 'All collected'}
        />
      )}

      {/* ─── Page header ──────────────────────────────── */}
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">
            {isAdmin ? 'All team quotes' : 'Your pipeline'}
          </div>
          <h1 className="v2d-page-title">
            {isAdmin ? 'Quotes' : 'My Quotes'}
          </h1>
          <div className="v2d-page-sub">
            {repScoped.length} quote{repScoped.length !== 1 ? 's' : ''}
            {(hasActiveFilters || (isAdmin && repFilter !== 'all')) ? ' · filtered' : ''}
          </div>
        </div>
        <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
          <Plus size={15} />
          <span>New Quote</span>
        </button>
      </div>

      {/* ─── Status tabs (pill row) ───────────────────── */}
      <div className="v2d-tab-row">
        <button
          className={`v2d-tab-pill${!filters.status ? ' is-active' : ''}`}
          onClick={() => setFilters({ status: '' })}
        >
          All
          <span className="v2d-tab-count">{repScoped.length}</span>
        </button>
        {QUOTE_STATUSES.map(s => (
          <button
            key={s}
            className={`v2d-tab-pill v2d-tab-pill--${s}${filters.status === s ? ' is-active' : ''}`}
            onClick={() => setFilters({ status: filters.status === s ? '' : s })}
          >
            {STATUS_LABELS[s]}
            <span className="v2d-tab-count">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {/* ─── Filters row ──────────────────────────────────────────
          Phase 34Z.68 — owner directive (15 May 2026): "Want same
          filter UI from leads, in quote tab in sales mobile view."
          Reordered to the LeadsV2 pattern: search → tabs (already
          rendered above) → date range → gear popover → reset.
          Segment / Media / Rep moved into the FilterDrawer fields
          array so the inline bar stays single-line on phones. */}
      <div className="v2d-filter-row">
        <div className="v2d-search v2d-search--inline">
          <Search size={14} />
          <input
            placeholder="Search client, company, quote #…"
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onBlur={() => setFilters({ search: searchDraft })}
          />
          {searchDraft && (
            <button
              className="v2d-search-clear"
              onClick={() => { setSearchDraft(''); setFilters({ search: '' }) }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Phase 34Z.68 — DateRangeFilter (same component LeadsV2 uses)
            replaces the two raw <input type="date"> tags. Single pill
            with month-cursor + presets popover. */}
        <DateRangeFilter
          value={
            filters.dateFrom || filters.dateTo
              ? {
                  preset: 'custom',
                  from:   filters.dateFrom || '',
                  to:     filters.dateTo   || '',
                  label:  'Custom',
                }
              : presetToRange('all')
          }
          onChange={(next) => setFilters({
            dateFrom: next.from || '',
            dateTo:   next.to   || '',
          })}
        />

        {/* Phase 34Z.68 — gear-button popover for Segment / Media /
            Rep. ActiveFilterChips below the row surfaces active
            filters as removable chips, matching LeadsV2. */}
        <FilterDrawer fields={[
          {
            key: 'segment',
            label: 'Segment',
            value: segmentFilter,
            defaultValue: 'all',
            options: [
              { value: 'all',        label: 'All segments' },
              { value: 'private',    label: 'Private' },
              { value: 'government', label: 'Government' },
            ],
            onChange: (v) => {
              setSegmentFilter(v)
              if (v !== 'government') setMediaFilter('all')
            },
          },
          // Media sub-filter only shows when segment = government.
          ...(segmentFilter === 'government' ? [{
            key: 'media',
            label: 'Media',
            value: mediaFilter,
            defaultValue: 'all',
            options: [
              { value: 'all',       label: 'All media' },
              { value: 'AUTO_HOOD', label: 'Auto Hood' },
              { value: 'GSRTC_LED', label: 'GSRTC LED' },
            ],
            onChange: setMediaFilter,
          }] : []),
          // Admin-only rep filter.
          ...(isAdmin && repOptions.length > 0 ? [{
            key: 'rep',
            label: 'Sales rep',
            value: repFilter,
            defaultValue: 'all',
            options: [
              { value: 'all', label: 'All sales reps' },
              ...repOptions.map(r => ({ value: r.id, label: r.name })),
            ],
            onChange: setRepFilter,
          }] : []),
        ]} />

        {(hasActiveFilters || (isAdmin && repFilter !== 'all') || segmentFilter !== 'all' || mediaFilter !== 'all') && (
          <button className="v2d-ghost" onClick={() => {
            handleReset(); setRepFilter('all'); setSegmentFilter('all'); setMediaFilter('all')
          }}>
            <X size={13} />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Phase 34Z.68 — chips below the filter row, one per active
          filter. Same pattern as LeadsV2. */}
      <ActiveFilterChips fields={[
        {
          key: 'segment', label: 'Segment',
          value: segmentFilter, defaultValue: 'all',
          options: [
            { value: 'private',    label: 'Private' },
            { value: 'government', label: 'Government' },
          ],
          onChange: (v) => {
            setSegmentFilter(v)
            if (v !== 'government') setMediaFilter('all')
          },
        },
        ...(segmentFilter === 'government' ? [{
          key: 'media', label: 'Media',
          value: mediaFilter, defaultValue: 'all',
          options: [
            { value: 'AUTO_HOOD', label: 'Auto Hood' },
            { value: 'GSRTC_LED', label: 'GSRTC LED' },
          ],
          onChange: setMediaFilter,
        }] : []),
        ...(isAdmin && repOptions.length > 0 ? [{
          key: 'rep', label: 'Sales rep',
          value: repFilter, defaultValue: 'all',
          options: repOptions.map(r => ({ value: r.id, label: r.name })),
          onChange: setRepFilter,
        }] : []),
      ]} />

      {/* Phase 34Z.11 — totals strip retired. V2Hero above already
          shows total amount + outstanding + filter scope. Mobile
          screens clipped the 3-col grid (`₹5,52,24…` truncated, hero
          duplicated the same number). Single source of truth now. */}
      <div
        className="v2d-totals-strip"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
          margin: '0 0 14px',
        }}
      >
        <TotalCard label="Total quotes" value={totals.count} kind="count" />
        <TotalCard label="Total amount" value={totals.amount} kind="money" />
        <TotalCard label="Outstanding" value={totals.outstanding} kind="money" warn />
      </div>

      {/* ─── Body ─────────────────────────────────────── */}
      {loading ? (
        <div className="v2d-loading">
          <div className="v2d-spinner" />
          Loading quotes…
        </div>
      ) : displayed.length === 0 ? (
        // Phase 33G — replaced emoji icon with Lucide FileText (CLAUDE.md
        // §7: lucide-react only). CTA still primary path out of empty.
        <div className="v2d-panel v2d-empty-card">
          <div className="v2d-empty-ic">
            <FileText size={28} strokeWidth={1.6} />
          </div>
          <div className="v2d-empty-t">No quotes found</div>
          <div className="v2d-empty-s">
            {hasActiveFilters
              ? 'Try clearing your filters or switching tabs.'
              : 'You haven\'t created a quote yet.'}
          </div>
          {!hasActiveFilters && (
            <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
              <Plus size={15} />
              <span>Create your first quote</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: full table */}
          <div className="v2d-panel v2d-table-wrap">
            <table className="v2d-qt v2d-qt--click">
              <thead>
                <tr>
                  <Th field="quote_number" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Quote #</Th>
                  <Th field="client_company" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Company</Th>
                  <Th field="client_name"  sortField={sortField} sortDir={sortDir} onSort={handleSort}>Contact</Th>
                  {isAdmin && (
                    <Th field="sales_person_name" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Sales Rep</Th>
                  )}
                  <Th field="total_amount" sortField={sortField} sortDir={sortDir} onSort={handleSort} right>Amount</Th>
                  <Th field="status"       sortField={sortField} sortDir={sortDir} onSort={handleSort}>Status</Th>
                  <th>Outstanding</th>
                  <Th field="created_at"   sortField={sortField} sortDir={sortDir} onSort={handleSort}>Date</Th>
                  <th>Follow up</th>
                  {/* Phase 29c — inline Edit + Delete on draft rows. */}
                  <th style={{ width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(q => (
                  <tr
                    key={q.id}
                    onClick={() => navigate(
                      q.segment === 'GOVERNMENT' ? `/proposal/${q.id}` : `/quotes/${q.id}`
                    )}
                  >
                    <td>
                      {q.quote_number || q.ref_number}
                      {q.segment === 'GOVERNMENT' && (
                        <span style={{
                          marginLeft: 6, padding: '1px 7px', borderRadius: 999,
                          background: 'var(--blue-soft, rgba(59,130,246,0.12))', color: 'var(--blue, #3B82F6)',
                          fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
                          textTransform: 'uppercase',
                        }}>Govt</span>
                      )}
                    </td>
                    {/* Company is the primary identifier (B2B context —
                        a contact is just a person at the company).
                        Falls back to '—' when company missing. Contact
                        column shows the named individual. */}
                    <td style={{ fontWeight: 600 }}>{truncate(q.client_company || '—', 24)}</td>
                    <td>{q.client_name}</td>
                    {isAdmin && <td>{q.sales_person_name || '—'}</td>}
                    <td className="num">{formatCurrency(q.total_amount)}</td>
                    <td><StatusChip status={q.status} quote={q} /></td>
                    <td>
                      {(() => {
                        const b = computeBalance(q)
                        if (b.kind === 'none') return <span className="v2d-muted">—</span>
                        if (b.kind === 'paid') return <span className="v2d-ok">Paid</span>
                        return <span className="v2d-warn">{formatCurrency(b.amount)}</span>
                      })()}
                    </td>
                    <td>{formatDate(q.created_at)}</td>
                    <td>
                      {(() => {
                        const fu = nextFollowUp(q)
                        return fu
                          ? <FollowUpChip date={fu.date} done={fu.done} />
                          : <span className="v2d-muted">—</span>
                      })()}
                    </td>
                    {/* Phase 29c — Edit always available except on lost.
                        Delete only on drafts (Phase 11b trigger blocks
                        non-draft hard-deletes). Stop row-click propagation
                        so these don't double-fire navigate. */}
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {q.status !== 'lost' && (
                          <button
                            type="button"
                            className="v2d-ghost"
                            title="Edit"
                            onClick={e => editQuote(e, q)}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {q.status === 'draft' && (
                          <button
                            type="button"
                            className="v2d-ghost"
                            style={{ color: 'var(--red)' }}
                            title="Delete draft"
                            onClick={e => deleteQuote(e, q)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list (visible <860px via CSS).
              Phase 29c — wrapper changed from <button> to <div role="button">
              so we can nest Edit/Delete <button>s inside without invalid
              HTML. Tap target behaviour preserved via role + tabIndex. */}
          <div className="v2d-qlist">
            {displayed.map(q => {
              const b = computeBalance(q)
              return (
                <div
                  key={q.id}
                  role="button"
                  tabIndex={0}
                  className="v2d-qcard"
                  onClick={() => navigate(
                    q.segment === 'GOVERNMENT' ? `/proposal/${q.id}` : `/quotes/${q.id}`
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(q.segment === 'GOVERNMENT' ? `/proposal/${q.id}` : `/quotes/${q.id}`)
                    }
                  }}
                >
                  <div className="v2d-qcard-top">
                    <div className="v2d-qcard-num">
                      {q.quote_number || q.ref_number}
                      {q.segment === 'GOVERNMENT' && (
                        <span style={{
                          marginLeft: 6, padding: '1px 7px', borderRadius: 999,
                          background: 'var(--blue-soft, rgba(59,130,246,0.12))', color: 'var(--blue, #3B82F6)',
                          fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
                          textTransform: 'uppercase',
                        }}>Govt</span>
                      )}
                    </div>
                    <StatusChip status={q.status} quote={q} />
                  </div>
                  <div className="v2d-qcard-mid">
                    {/* Company first (primary), contact name as subtitle.
                        If no company, fall back to showing the contact
                        name as the primary so the card never reads "—". */}
                    <div className="v2d-qcard-client">
                      {truncate(q.client_company || q.client_name || '—', 30)}
                    </div>
                    <div className="v2d-qcard-company">
                      {q.client_company ? q.client_name : ''}
                    </div>
                  </div>
                  <div className="v2d-qcard-foot">
                    <div>
                      <div className="v2d-qcard-k">Amount</div>
                      <div className="v2d-qcard-v">{formatCurrency(q.total_amount)}</div>
                    </div>
                    <div>
                      <div className="v2d-qcard-k">Outstanding</div>
                      <div className="v2d-qcard-v">
                        {b.kind === 'none' ? '—'
                          : b.kind === 'paid' ? <span className="v2d-ok">Paid</span>
                          : <span className="v2d-warn">{formatCurrency(b.amount)}</span>}
                      </div>
                    </div>
                    <div>
                      <div className="v2d-qcard-k">Date</div>
                      <div className="v2d-qcard-v">{formatDate(q.created_at)}</div>
                    </div>
                  </div>
                  {/* Phase 29c — mobile inline actions. Same gating as
                      desktop. Edit hidden on lost; Delete only on draft. */}
                  {(q.status !== 'lost' || q.status === 'draft') && (
                    <div style={{
                      display: 'flex', gap: 8, marginTop: 10,
                      borderTop: '1px solid var(--v2-line, #1f2741)',
                      paddingTop: 10,
                    }}>
                      {q.status !== 'lost' && (
                        <button
                          type="button"
                          className="v2d-ghost"
                          style={{ flex: 1, padding: '8px 12px' }}
                          onClick={e => editQuote(e, q)}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                      )}
                      {q.status === 'draft' && (
                        <button
                          type="button"
                          className="v2d-ghost"
                          style={{ flex: 1, padding: '8px 12px', color: 'var(--red)' }}
                          onClick={e => deleteQuote(e, q)}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Sortable header cell ─── */
function Th({ field, sortField, sortDir, onSort, children, right }) {
  const Icon = sortField !== field ? ChevronsUpDown
              : sortDir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        cursor: 'pointer', userSelect: 'none',
        textAlign: right ? 'right' : 'left',
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        opacity: sortField === field ? 1 : 0.75,
      }}>
        {children}
        <Icon size={12} style={{ opacity: sortField === field ? 1 : 0.4 }} />
      </span>
    </th>
  )
}

/* ─── Status chip (matches v2d-qt pattern) ─── */
/* Phase 33J (F8 fix) — derived PARTIAL_PAID / PAID surfaces on Won
   quotes. PAID = any approved payment exists and total - paid <= 0.
   PARTIAL_PAID = some approved payment but not fully cleared.
   Pure status passthrough for non-Won rows. */
function StatusChip({ status, quote }) {
  if (status === 'won' && quote) {
    const total = Number(quote.total_amount) || 0
    const paid = (quote.payments || [])
      .filter(p => p.approval_status === 'approved')
      .reduce((s, p) => s + (Number(p.amount_received) || 0), 0)
    if (paid > 0) {
      const fullyPaid = total > 0 && paid >= total
      return (
        <span className={`st st--won`} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          Won
          <span style={{
            padding: '1px 6px', borderRadius: 999,
            fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
            textTransform: 'uppercase',
            background: fullyPaid ? 'rgba(16,185,129,.18)' : 'rgba(59,130,246,.18)',
            color:      fullyPaid ? 'var(--success, #10B981)' : '#60A5FA',
          }}>
            {fullyPaid ? 'Paid' : 'Partial'}
          </span>
        </span>
      )
    }
  }
  return (
    <span className={`st st--${status}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

/* ─── Follow-up helpers ───────────────────────────────────────────
   The denormalized quotes.follow_up_date column has no sync trigger
   (auto_create_followup writes only to follow_ups), so it's null on
   every row. We compute the next-pending date from the embedded
   follow_ups array in useQuotes() instead. Returns null when the
   quote has no follow-ups at all. */
export function nextFollowUp(q) {
  const list = Array.isArray(q?.follow_ups) ? q.follow_ups : []
  if (!list.length) return null

  const pending = list
    .filter(f => f && !f.is_done && f.follow_up_date)
    .sort((a, b) => String(a.follow_up_date).localeCompare(String(b.follow_up_date)))
  if (pending.length) {
    return { date: pending[0].follow_up_date, done: false }
  }

  // No pending — show the latest done one as "✓ Done" so the column
  // doesn't read empty for quotes that have been worked through.
  const done = list
    .filter(f => f && f.is_done && f.follow_up_date)
    .sort((a, b) => String(b.follow_up_date).localeCompare(String(a.follow_up_date)))
  if (done.length) {
    return { date: done[0].follow_up_date, done: true }
  }
  return null
}

/* ─── Follow-up chip ─── */
function FollowUpChip({ date, done }) {
  const overdue = !done && new Date(date) <= new Date()
  let cls = 'v2d-fu'
  if (done)         cls += ' v2d-fu--done'
  else if (overdue) cls += ' v2d-fu--overdue'
  return (
    <span className={cls}>
      {done ? '✓ Done' : formatDate(date)}
    </span>
  )
}

/* ─── Totals strip card — count or money. `warn` flips the value
       color to the rose accent (used for Outstanding so it reads as
       attention-needed instead of neutral). ─── */
function TotalCard({ label, value, kind, warn }) {
  // Phase 34Z.40 — reverted Phase 34Z.11 lakh/crore compact-money.
  // DESIGN_SYSTEM.md §3.3 is explicit: "Never truncate to lakh/crore
  // (no `₹1.5L`, no `₹2.3Cr`). The full number IS the design."
  // Mobile clip is fixed by smaller font + tabular-nums + flexible
  // grid; numbers stay full.
  const display = kind === 'money'
    ? '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(value) || 0))
    : (Number(value) || 0).toLocaleString('en-IN')
  return (
    <div
      className="v2d-panel"
      style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--v2-ink-2)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--v2-display)',
          /* Phase 34Z.40 — full Indian-locale numbers can hit 10+
             chars (₹1,01,03,750). Smaller font keeps them readable
             without truncation. Display-700 still per §3.2. */
          fontSize: 17,
          fontWeight: 700,
          color: warn ? 'var(--v2-amber)' : 'var(--v2-ink-0)',
          lineHeight: 1.1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
      </div>
    </div>
  )
}
