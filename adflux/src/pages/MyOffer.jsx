// src/pages/MyOffer.jsx
//
// Sales-side "My Offer Letter" page. Shows the logged-in user's own
// accepted offer letter (if they were converted from the HR flow).
// RLS policy hr_offers_sales_own restricts this to a single row.

import { useEffect, useState } from 'react'
import { Download, FileText, AlertCircle } from 'lucide-react'
import { useOffers } from '../hooks/useOffers'
import { formatCurrency } from '../utils/formatters'
import '../styles/team.css'

export default function MyOffer() {
  const { fetchMyOffer } = useOffers()
  const [offer, setOffer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const { data, error } = await fetchMyOffer()
      if (cancelled) return
      if (error) setError(error.message || 'Failed to load')
      setOffer(data || null)
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [fetchMyOffer])

  if (loading) {
    return (
      <div className="page">
        <div style={{ padding: 30, color: 'var(--gray)' }}>Loading…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div style={{ padding: 20, color: 'var(--red)' }}>{error}</div>
      </div>
    )
  }

  if (!offer) {
    return (
      <div className="page">
        <div className="team-header">
          <div className="team-header-left">
            <h1>My Offer Letter</h1>
            <p>Your joining paperwork</p>
          </div>
        </div>
        <div className="card" style={{
          padding: 30, textAlign: 'center', color: 'var(--gray)',
        }}>
          <AlertCircle size={32} style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            No offer letter on file
          </div>
          <div style={{ fontSize: '.88rem' }}>
            Your account was not created through the HR offer-letter flow.
            If you think this is a mistake, contact your admin.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="team-header">
        <div className="team-header-left">
          <h1>My Offer Letter</h1>
          <p>Your joining paperwork — accepted and on file.</p>
        </div>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          paddingBottom: 14, borderBottom: '1px solid var(--brd)',
          marginBottom: 16,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 8,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              {offer.position || 'Sales Person'}
            </div>
            <div style={{ fontSize: '.82rem', color: 'var(--gray)' }}>
              Accepted on{' '}
              {offer.accepted_terms_at
                ? new Date(offer.accepted_terms_at).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })
                : '—'}
            </div>
          </div>
          {offer.offer_pdf_url && (
            <a
              className="btn btn-y"
              href={offer.offer_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={15} style={{ marginRight: 6 }} />
              Download PDF
            </a>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Item label="Candidate Name" value={offer.full_legal_name || offer.candidate_name} />
          <Item label="Position" value={offer.position} />
          <Item label="Territory" value={offer.territory} />
          <Item label="Joining Date" value={offer.joining_date} />
          <Item label="Fixed Salary" value={offer.fixed_salary_monthly
            ? `${formatCurrency(offer.fixed_salary_monthly)} / month`
            : null} />
          <Item label="Place" value={offer.place} />
        </div>

        {offer.incentive_text && (
          <div style={{ marginTop: 14 }}>
            <Item label="Performance Incentive" value={offer.incentive_text} />
          </div>
        )}
      </div>
    </div>
  )
}

function Item({ label, value }) {
  return (
    <div>
      <div style={{
        fontSize: '.72rem', color: 'var(--gray)',
        textTransform: 'uppercase', letterSpacing: '.08em',
        fontWeight: 600, marginBottom: 3,
      }}>
        {label}
      </div>
      <div style={{ fontSize: '.9rem', color: 'var(--fg)' }}>
        {value || '—'}
      </div>
    </div>
  )
}
