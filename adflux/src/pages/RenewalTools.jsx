// src/pages/RenewalTools.jsx
//
// Accessible by both admin and sales. Admin sees every won quote whose
// campaign ends in the next 60 days; sales only sees their own clients.
// The scope switch is implicit — we read `isAdmin` from useAuth and
// filter by `created_by` for non-admins. The "Sales Person" column is
// hidden for sales users (it's always them, so the column would be
// noise).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { formatDate, todayISO, addDaysISO } from '../utils/formatters'

export default function RenewalTools() {
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  const today = todayISO()
  const future60 = addDaysISO(60)

  useEffect(() => {
    if (profile?.id) load()
  }, [profile?.id, isAdmin])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('quotes')
      .select('id, quote_number, client_name, campaign_end_date, created_by, users(name), total_amount')
      .eq('status', 'won')
      .gte('campaign_end_date', today)
      .lte('campaign_end_date', future60)
      .order('campaign_end_date', { ascending: true })

    // Non-admin users see only their own clients. Admin sees everyone.
    if (!isAdmin) q = q.eq('created_by', profile.id)

    const { data, error } = await q
    if (!error) setQuotes(data || [])
    setLoading(false)
  }

  function daysRemaining(endDate) {
    const end = new Date(endDate)
    const now = new Date(today)
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
  }

  function getDaysColor(days) {
    if (days < 7) return '#ef9a9a'
    if (days < 30) return '#ffb74d'
    return '#81c784'
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', marginBottom: 4 }}>Renewal Tools</h1>
          <p style={{ fontSize: '.9rem', color: 'var(--gray)' }}>
            {isAdmin
              ? 'Quotes ending in next 60 days — all sales reps'
              : 'Your clients ending in next 60 days'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen" style={{ minHeight: 300 }}>
          <div className="spinner" />
        </div>
      ) : quotes.length === 0 ? (
        <div className="empty-state">
          <Calendar size={40} />
          <p>
            {isAdmin
              ? 'No campaigns ending in the next 60 days'
              : 'None of your clients have campaigns ending in the next 60 days'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Quote #</th>
                  <th>Client</th>
                  {isAdmin && <th>Sales Person</th>}
                  <th style={{ textAlign: 'center' }}>End Date</th>
                  <th style={{ textAlign: 'center' }}>Days Remaining</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => {
                  const days = daysRemaining(q.campaign_end_date)
                  return (
                    <tr key={q.id}>
                      <td style={{ fontWeight: 600, color: 'var(--y)' }}>{q.quote_number}</td>
                      <td>{q.client_name}</td>
                      {isAdmin && <td>{q.users?.name || '—'}</td>}
                      <td style={{ textAlign: 'center', fontSize: '.9rem' }}>
                        {formatDate(q.campaign_end_date)}
                      </td>
                      <td style={{ textAlign: 'center', color: getDaysColor(days), fontWeight: 600 }}>
                        {days} day{days !== 1 ? 's' : ''}
                      </td>
                      <td>
                        <button
                          className="btn btn-y btn-sm"
                          onClick={() => navigate(`/quotes/new?renewalOf=${q.id}`)}
                        >
                          <Plus size={13} /> Create Renewal
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
