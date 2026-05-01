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
import { Plus, Search, X, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { useQuotes } from '../../hooks/useQuotes'
import { useAuthStore } from '../../store/authStore'
import { QUOTE_STATUSES, STATUS_LABELS } from '../../utils/constants'
import { formatCurrency, formatDate, truncate } from '../../utils/formatters'

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
  const isAdmin = ['admin', 'owner', 'co_owner'].includes(profile?.role)

  const { quotes, filters, setFilters, resetFilters, fetchQuotes } = useQuotes()
  const [loading, setLoading] = useState(true)
  const [searchDraft, setSearchDraft] = useState(filters.search || '')
  const [sortField, setSortField] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  // Admin-only sales-rep filter — derived from the quotes already
  // loaded so no extra fetch is needed. 'all' shows everyone.
  const [repFilter, setRepFilter] = useState('all')

  useEffect(() => {
    setLoading(true)
    fetchQuotes().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

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

  // Rep-scoped quote pool — used by tab counts so when admin scopes
  // to one rep, the tabs show that rep's status breakdown (otherwise
  // "Won 7" lies when the table only renders 3 of theirs).
  const repScoped = useMemo(() => {
    if (!isAdmin || repFilter === 'all') return quotes
    return quotes.filter(q => q.created_by === repFilter)
  }, [quotes, isAdmin, repFilter])

  const counts = useMemo(() => (
    QUOTE_STATUSES.reduce((acc, s) => {
      acc[s] = repScoped.filter(q => q.status === s).length
      return acc
    }, {})
  ), [repScoped])

  const sorted = useMemo(() => {
    return [...quotes].sort((a, b) => {
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
  }, [quotes, sortField, sortDir])

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

      {/* ─── Filters row ──────────────────────────────── */}
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

        <div className="v2d-date-group">
          <input
            type="date"
            className="v2d-date"
            value={filters.dateFrom || ''}
            onChange={e => setFilters({ dateFrom: e.target.value })}
            title="From date"
          />
          <span className="v2d-date-sep">to</span>
          <input
            type="date"
            className="v2d-date"
            value={filters.dateTo || ''}
            onChange={e => setFilters({ dateTo: e.target.value })}
            title="To date"
          />
        </div>

        {/* Admin-only sales-rep filter — scope the table + totals
            strip to one rep. Hidden for sales role since RLS already
            limits them to their own quotes. */}
        {isAdmin && repOptions.length > 0 && (
          <select
            value={repFilter}
            onChange={e => setRepFilter(e.target.value)}
            className="v2d-date"
            style={{ minWidth: 160, cursor: 'pointer' }}
          >
            <option value="all">All sales reps</option>
            {repOptions.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}

        {(hasActiveFilters || (isAdmin && repFilter !== 'all')) && (
          <button className="v2d-ghost" onClick={() => { handleReset(); setRepFilter('all') }}>
            <X size={13} />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Totals strip — count, total amount, total outstanding for the
          currently displayed (filtered) set. Reflects status tab,
          search, date range, AND rep filter so admin can scope to one
          rep and read their book at a glance. */}
      <div
        className="v2d-totals-strip"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
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
        <div className="v2d-panel v2d-empty-card">
          <div className="v2d-empty-ic">📄</div>
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
                    <td>{q.quote_number}</td>
                    {/* Company is the primary identifier (B2B context —
                        a contact is just a person at the company).
                        Falls back to '—' when company missing. Contact
                        column shows the named individual. */}
                    <td style={{ fontWeight: 600 }}>{truncate(q.client_company || '—', 24)}</td>
                    <td>{q.client_name}</td>
                    {isAdmin && <td>{q.sales_person_name || '—'}</td>}
                    <td className="num">{formatCurrency(q.total_amount)}</td>
                    <td><StatusChip status={q.status} /></td>
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
                      {q.follow_up_date ? (
                        <FollowUpChip q={q} />
                      ) : (
                        <span className="v2d-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list (visible <860px via CSS) */}
          <div className="v2d-qlist">
            {displayed.map(q => {
              const b = computeBalance(q)
              return (
                <button
                  key={q.id}
                  className="v2d-qcard"
                  onClick={() => navigate(
                    q.segment === 'GOVERNMENT' ? `/proposal/${q.id}` : `/quotes/${q.id}`
                  )}
                >
                  <div className="v2d-qcard-top">
                    <div className="v2d-qcard-num">{q.quote_number}</div>
                    <StatusChip status={q.status} />
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
                </button>
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
function StatusChip({ status }) {
  return (
    <span className={`st st--${status}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

/* ─── Follow-up chip ─── */
function FollowUpChip({ q }) {
  const overdue = !q.follow_up_done && new Date(q.follow_up_date) <= new Date()
  let cls = 'v2d-fu'
  if (q.follow_up_done) cls += ' v2d-fu--done'
  else if (overdue)     cls += ' v2d-fu--overdue'
  return (
    <span className={cls}>
      {q.follow_up_done ? '✓ Done' : formatDate(q.follow_up_date)}
    </span>
  )
}

/* ─── Totals strip card — count or money. `warn` flips the value
       color to the rose accent (used for Outstanding so it reads as
       attention-needed instead of neutral). ─── */
function TotalCard({ label, value, kind, warn }) {
  const display = kind === 'money'
    ? `₹${new Intl.NumberFormat('en-IN').format(Math.round(Number(value) || 0))}`
    : (Number(value) || 0).toLocaleString('en-IN')
  return (
    <div
      className="v2d-panel"
      style={{
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--v2-ink-2)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--v2-display)',
          fontSize: 22,
          fontWeight: 700,
          color: warn ? 'var(--v2-amber)' : 'var(--v2-ink-0)',
          lineHeight: 1.1,
        }}
      >
        {display}
      </div>
    </div>
  )
}
