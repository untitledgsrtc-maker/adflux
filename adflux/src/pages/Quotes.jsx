// src/pages/Quotes.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, X, Filter } from 'lucide-react'
import { useQuotes } from '../hooks/useQuotes'
import { useAuthStore } from '../store/authStore'
import { QuoteTable } from '../components/quotes/QuoteTable'
import { QUOTE_STATUSES, STATUS_LABELS } from '../utils/constants'

export default function Quotes() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'

  const { quotes, filters, setFilters, resetFilters, fetchQuotes } = useQuotes()
  const [loading, setLoading] = useState(true)
  const [searchDraft, setSearchDraft] = useState(filters.search || '')

  useEffect(() => {
    setLoading(true)
    fetchQuotes().finally(() => setLoading(false))
  }, [filters])

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter') setFilters({ search: searchDraft })
    if (e.key === 'Escape') { setSearchDraft(''); setFilters({ search: '' }) }
  }

  function handleReset() {
    setSearchDraft('')
    resetFilters()
  }

  const hasActiveFilters =
    filters.status || filters.search || filters.dateFrom || filters.dateTo

  // Stats bar counts
  const counts = QUOTE_STATUSES.reduce((acc, s) => {
    acc[s] = quotes.filter(q => q.status === s).length
    return acc
  }, {})

  return (
    <div className="page">
      {/* ── Header ───────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{isAdmin ? 'All Quotes' : 'My Quotes'}</h1>
          <p className="page-subtitle">
            {quotes.length} quote{quotes.length !== 1 ? 's' : ''}{hasActiveFilters ? ' (filtered)' : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/quotes/new')}>
          <Plus size={15} />
          New Quote
        </button>
      </div>

      {/* ── Status Tabs ──────────────────────────── */}
      <div className="quotes-status-tabs">
        <button
          className={`status-tab${!filters.status ? ' status-tab--active' : ''}`}
          onClick={() => setFilters({ status: '' })}
        >
          All
          <span className="status-tab-count">{quotes.length}</span>
        </button>
        {QUOTE_STATUSES.map(s => (
          <button
            key={s}
            className={`status-tab status-tab--${s}${filters.status === s ? ' status-tab--active' : ''}`}
            onClick={() => setFilters({ status: filters.status === s ? '' : s })}
          >
            {STATUS_LABELS[s]}
            <span className="status-tab-count">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {/* ── Filters Bar ──────────────────────────── */}
      <div className="quotes-filters">
        <div className="quotes-search">
          <Search size={14} className="quotes-search-icon" />
          <input
            className="input quotes-search-input"
            placeholder="Search client, company, quote #…"
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onBlur={() => setFilters({ search: searchDraft })}
          />
          {searchDraft && (
            <button
              className="quotes-search-clear"
              onClick={() => { setSearchDraft(''); setFilters({ search: '' }) }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="quotes-date-filters">
          <input
            type="date"
            className="input"
            style={{ width: 150 }}
            value={filters.dateFrom || ''}
            onChange={e => setFilters({ dateFrom: e.target.value })}
            title="From date"
          />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
          <input
            type="date"
            className="input"
            style={{ width: 150 }}
            value={filters.dateTo || ''}
            onChange={e => setFilters({ dateTo: e.target.value })}
            title="To date"
          />
        </div>

        {hasActiveFilters && (
          <button className="btn btn-ghost" onClick={handleReset} style={{ gap: 6 }}>
            <X size={13} />
            Clear
          </button>
        )}
      </div>

      {/* ── Table ────────────────────────────────── */}
      {loading ? (
        <div className="quotes-loading">
          <div className="spinner" />
          <span>Loading quotes…</span>
        </div>
      ) : (
        <QuoteTable quotes={quotes} isAdmin={isAdmin} />
      )}
    </div>
  )
}
