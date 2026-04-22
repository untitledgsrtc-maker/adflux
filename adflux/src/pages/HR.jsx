// src/pages/HR.jsx
//
// Admin-only HR landing page. Lists all hr_offers rows with status
// chips, a search filter, a simple status filter, and a "Send Offer"
// button that opens SendOfferModal. Clicking a row opens
// OfferDetailModal (share link, download PDF, convert to user).

import { useEffect, useState, useMemo } from 'react'
import { UserPlus, Search, Briefcase, Clock, CheckCircle2, Users } from 'lucide-react'
import { useOffers, STATUS_META } from '../hooks/useOffers'
import { SendOfferModal }   from '../components/hr/SendOfferModal'
import { OfferDetailModal } from '../components/hr/OfferDetailModal'
import { formatCurrency } from '../utils/formatters'
import '../styles/team.css'

const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'open',      label: 'Open invites' },
  { key: 'accepted',  label: 'Accepted' },
  { key: 'converted', label: 'Converted' },
  { key: 'cancelled', label: 'Cancelled' },
]

function matchesFilter(offer, key) {
  if (key === 'all') return true
  if (key === 'open')       return ['draft','sent','filled'].includes(offer.status)
  if (key === 'accepted')   return offer.status === 'accepted'
  if (key === 'converted')  return offer.status === 'converted_to_user'
  if (key === 'cancelled')  return offer.status === 'cancelled'
  return true
}

function OfferRow({ offer, onClick }) {
  const meta = STATUS_META[offer.status] || STATUS_META.draft
  const lastTouched = offer.updated_at || offer.created_at
  return (
    <tr onClick={onClick} style={{ cursor: 'pointer' }}>
      <td>
        <div style={{ fontWeight: 600 }}>{offer.candidate_name}</div>
        <div style={{ fontSize: '.75rem', color: 'var(--gray)' }}>{offer.candidate_email}</div>
      </td>
      <td>{offer.position || '—'}</td>
      <td>{offer.territory || '—'}</td>
      <td>
        {offer.fixed_salary_monthly
          ? formatCurrency(offer.fixed_salary_monthly)
          : '—'}
      </td>
      <td>
        <span style={{
          display: 'inline-block',
          fontSize: '.68rem',
          fontWeight: 700,
          padding: '3px 8px',
          borderRadius: 10,
          background: meta.color,
          color: '#fff',
          textTransform: 'uppercase',
          letterSpacing: '.08em',
        }}>
          {meta.label}
        </span>
      </td>
      <td style={{ fontSize: '.78rem', color: 'var(--gray)' }}>
        {lastTouched ? new Date(lastTouched).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
        }) : '—'}
      </td>
    </tr>
  )
}

export default function HR() {
  const { offers, loading, fetchOffers } = useOffers()
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')
  const [sendOpen, setSendOpen] = useState(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetchOffers()
  }, [fetchOffers])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return offers.filter(o => {
      if (!matchesFilter(o, filter)) return false
      if (!q) return true
      return (
        o.candidate_name?.toLowerCase().includes(q) ||
        o.candidate_email?.toLowerCase().includes(q) ||
        o.position?.toLowerCase().includes(q) ||
        o.territory?.toLowerCase().includes(q)
      )
    })
  }, [offers, filter, search])

  const stats = useMemo(() => ({
    total:     offers.length,
    open:      offers.filter(o => ['draft','sent','filled'].includes(o.status)).length,
    accepted:  offers.filter(o => o.status === 'accepted').length,
    converted: offers.filter(o => o.status === 'converted_to_user').length,
  }), [offers])

  return (
    <div className="page">
      {/* Header */}
      <div className="team-header">
        <div className="team-header-left">
          <h1>HR — Offer Letters</h1>
          <p>Send pre-hire offers, collect personal details, and convert accepted candidates into sales users.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setSendOpen(true)}>
          <UserPlus size={15} style={{ marginRight: 6 }} />
          Send Offer
        </button>
      </div>

      {/* Stats */}
      <div className="team-stats">
        <div className="team-stat-card">
          <div className="team-stat-label"><Briefcase size={12} style={{ marginRight: 4 }} />Total Offers</div>
          <div className="team-stat-value">{stats.total}</div>
        </div>
        <div className="team-stat-card">
          <div className="team-stat-label"><Clock size={12} style={{ marginRight: 4 }} />Open Invites</div>
          <div className="team-stat-value accent">{stats.open}</div>
        </div>
        <div className="team-stat-card">
          <div className="team-stat-label"><CheckCircle2 size={12} style={{ marginRight: 4 }} />Accepted</div>
          <div className="team-stat-value success">{stats.accepted}</div>
        </div>
        <div className="team-stat-card">
          <div className="team-stat-label"><Users size={12} style={{ marginRight: 4 }} />Converted</div>
          <div className="team-stat-value muted">{stats.converted}</div>
        </div>
      </div>

      {/* Filters + search */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 18,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={'btn ' + (filter === f.key ? 'btn-y' : 'btn-ghost')}
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={14} style={{
            position: 'absolute', left: 10, top: '50%',
            transform: 'translateY(-50%)', color: 'var(--gray)',
          }} />
          <input
            placeholder="Search name, email, position, territory…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 30 }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--subtle)' }}>
              <th style={{ textAlign: 'left', padding: '10px 14px' }}>Candidate</th>
              <th style={{ textAlign: 'left', padding: '10px 14px' }}>Position</th>
              <th style={{ textAlign: 'left', padding: '10px 14px' }}>Territory</th>
              <th style={{ textAlign: 'left', padding: '10px 14px' }}>Salary</th>
              <th style={{ textAlign: 'left', padding: '10px 14px' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '10px 14px' }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>
                Loading offers…
              </td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>
                {offers.length === 0
                  ? 'No offers yet. Click "Send Offer" to create your first.'
                  : 'No offers match your filters.'}
              </td></tr>
            ) : (
              visible.map(o => (
                <OfferRow key={o.id} offer={o} onClick={() => setSelected(o)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {sendOpen && (
        <SendOfferModal
          onClose={() => setSendOpen(false)}
          onCreated={fetchOffers}
        />
      )}
      {selected && (
        <OfferDetailModal
          offer={selected}
          onClose={() => setSelected(null)}
          onChanged={fetchOffers}
        />
      )}
    </div>
  )
}
