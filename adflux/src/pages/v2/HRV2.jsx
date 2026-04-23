// src/pages/v2/HRV2.jsx
//
// Admin HR page — list of hr_offers with search/filter + send-offer
// modal + offer-detail modal. Data flow mirrors pages/HR.jsx exactly;
// only the chrome is rebuilt in v2.
//
// Modals (SendOfferModal, OfferDetailModal) are rendered as-is — their
// overlays use fixed positioning so they layer above V2AppShell without
// issue. The overlay bridge CSS in v2.css adapts legacy form controls to
// the dark theme.

import { useEffect, useState, useMemo } from 'react'
import {
  UserPlus, Search, Briefcase, Clock, CheckCircle2, Users,
} from 'lucide-react'
import { useOffers, STATUS_META } from '../../hooks/useOffers'
import { SendOfferModal }   from '../../components/hr/SendOfferModal'
import { OfferDetailModal } from '../../components/hr/OfferDetailModal'
import { formatCurrency } from '../../utils/formatters'

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

export default function HRV2() {
  const { offers, loading, fetchOffers } = useOffers()
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')
  const [sendOpen, setSendOpen] = useState(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => { fetchOffers() }, [fetchOffers])

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
    <div className="v2d-hr">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Hiring</div>
          <h1 className="v2d-page-title">HR — Offer Letters</h1>
          <div className="v2d-page-sub">
            Send pre-hire offers, collect personal details, and convert
            accepted candidates into sales users.
          </div>
        </div>
        <button className="v2d-cta" onClick={() => setSendOpen(true)}>
          <UserPlus size={15} />
          <span>Send Offer</span>
        </button>
      </div>

      {/* Stats */}
      <div className="v2d-hr-stats">
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l"><Briefcase size={12} /> Total offers</div>
          <div className="v2d-stat-v">{stats.total}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l"><Clock size={12} /> Open invites</div>
          <div className="v2d-stat-v v2d-stat-v--accent">{stats.open}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l"><CheckCircle2 size={12} /> Accepted</div>
          <div className="v2d-stat-v v2d-stat-v--ok">{stats.accepted}</div>
        </div>
        <div className="v2d-panel v2d-stat">
          <div className="v2d-stat-l"><Users size={12} /> Converted</div>
          <div className="v2d-stat-v v2d-stat-v--muted">{stats.converted}</div>
        </div>
      </div>

      {/* Filters + search */}
      <div className="v2d-hr-toolbar">
        <div className="v2d-tab-row">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`v2d-tab-pill${filter === f.key ? ' is-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="v2d-search v2d-search--inline">
          <Search size={14} />
          <input
            placeholder="Search name, email, position, territory…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="v2d-panel v2d-table-wrap">
        <table className="v2d-qt v2d-qt--click">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Position</th>
              <th>Territory</th>
              <th>Salary</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="v2d-muted" style={{ textAlign: 'center', padding: 30 }}>
                Loading offers…
              </td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={6} className="v2d-muted" style={{ textAlign: 'center', padding: 30 }}>
                {offers.length === 0
                  ? 'No offers yet. Click "Send Offer" to create your first.'
                  : 'No offers match your filters.'}
              </td></tr>
            ) : (
              visible.map(o => {
                const meta = STATUS_META[o.status] || STATUS_META.draft
                const lastTouched = o.updated_at || o.created_at
                return (
                  <tr key={o.id} onClick={() => setSelected(o)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.candidate_name}</div>
                      <div className="v2d-muted" style={{ fontSize: 12 }}>{o.candidate_email}</div>
                    </td>
                    <td>{o.position || '—'}</td>
                    <td>{o.territory || '—'}</td>
                    <td>
                      {o.fixed_salary_monthly
                        ? formatCurrency(o.fixed_salary_monthly)
                        : '—'}
                    </td>
                    <td>
                      <span className="st st--hr" style={{ background: meta.color }}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="v2d-muted" style={{ fontSize: 12 }}>
                      {lastTouched ? new Date(lastTouched).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      }) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="v2d-hr-cards">
        {!loading && visible.map(o => {
          const meta = STATUS_META[o.status] || STATUS_META.draft
          return (
            <div
              key={o.id}
              className="v2d-panel v2d-hr-card"
              onClick={() => setSelected(o)}
            >
              <div className="v2d-hr-card-top">
                <div className="v2d-hr-card-name">{o.candidate_name}</div>
                <span className="st st--hr" style={{ background: meta.color }}>
                  {meta.label}
                </span>
              </div>
              <div className="v2d-hr-card-meta">
                {o.candidate_email}
              </div>
              <div className="v2d-hr-card-sub">
                {o.position || '—'}{o.territory ? ` · ${o.territory}` : ''}
                {o.fixed_salary_monthly
                  ? ` · ${formatCurrency(o.fixed_salary_monthly)}`
                  : ''}
              </div>
            </div>
          )
        })}
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
