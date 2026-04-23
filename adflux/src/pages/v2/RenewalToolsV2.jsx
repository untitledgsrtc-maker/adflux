// src/pages/v2/RenewalToolsV2.jsx
//
// Shared admin + sales page. Admin sees every won quote ending in the
// next 60 days; sales sees only their own. The 3-bucket colour code
// (<7 red, <30 amber, else green) is preserved because the user's team
// uses it at a glance — breaking the convention would be noise.
//
// Rendered inside V2AppShell so this file only paints the body.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, ArrowUpRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatDate, formatCurrency, todayISO, addDaysISO } from '../../utils/formatters'

export default function RenewalToolsV2() {
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  const today = todayISO()
  const future60 = addDaysISO(60)

  useEffect(() => {
    if (profile?.id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function bucketFor(days) {
    if (days < 7)  return 'hot'
    if (days < 30) return 'warm'
    return 'cool'
  }

  const bucketStats = {
    hot:  quotes.filter(q => daysRemaining(q.campaign_end_date) < 7).length,
    warm: quotes.filter(q => {
      const d = daysRemaining(q.campaign_end_date)
      return d >= 7 && d < 30
    }).length,
    cool: quotes.filter(q => daysRemaining(q.campaign_end_date) >= 30).length,
  }

  return (
    <div className="v2d-rt">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Keep revenue recurring</div>
          <h1 className="v2d-page-title">Renewal Tools</h1>
          <div className="v2d-page-sub">
            {isAdmin
              ? 'Campaigns ending in the next 60 days across all reps.'
              : 'Your campaigns ending in the next 60 days.'}
          </div>
        </div>
      </div>

      {/* Bucket KPIs */}
      <div className="v2d-rt-kpis">
        <div className="v2d-panel v2d-rt-kpi v2d-rt-kpi--hot">
          <div className="v2d-rt-kpi-l">Under 7 days</div>
          <div className="v2d-rt-kpi-v">{bucketStats.hot}</div>
          <div className="v2d-rt-kpi-s">call today</div>
        </div>
        <div className="v2d-panel v2d-rt-kpi v2d-rt-kpi--warm">
          <div className="v2d-rt-kpi-l">7 – 30 days</div>
          <div className="v2d-rt-kpi-v">{bucketStats.warm}</div>
          <div className="v2d-rt-kpi-s">start renewal convo</div>
        </div>
        <div className="v2d-panel v2d-rt-kpi v2d-rt-kpi--cool">
          <div className="v2d-rt-kpi-l">30 – 60 days</div>
          <div className="v2d-rt-kpi-v">{bucketStats.cool}</div>
          <div className="v2d-rt-kpi-s">queue up</div>
        </div>
      </div>

      {loading ? (
        <div className="v2d-loading"><div className="v2d-spinner" />Loading…</div>
      ) : quotes.length === 0 ? (
        <div className="v2d-panel v2d-empty-card">
          <div className="v2d-empty-ic"><Calendar size={32} /></div>
          <div className="v2d-empty-t">Nothing due</div>
          <div className="v2d-empty-s">
            {isAdmin
              ? 'No campaigns ending in the next 60 days.'
              : 'None of your clients have campaigns ending in the next 60 days.'}
          </div>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="v2d-panel v2d-table-wrap">
            <table className="v2d-qt">
              <thead>
                <tr>
                  <th>Quote #</th>
                  <th>Client</th>
                  {isAdmin && <th>Sales Person</th>}
                  <th>Value</th>
                  <th>End Date</th>
                  <th>Remaining</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => {
                  const days = daysRemaining(q.campaign_end_date)
                  const bucket = bucketFor(days)
                  return (
                    <tr key={q.id}>
                      <td><strong>{q.quote_number}</strong></td>
                      <td>{q.client_name}</td>
                      {isAdmin && <td className="v2d-muted">{q.users?.name || '—'}</td>}
                      <td>{q.total_amount ? formatCurrency(q.total_amount) : '—'}</td>
                      <td>{formatDate(q.campaign_end_date)}</td>
                      <td>
                        <span className={`v2d-rt-days v2d-rt-days--${bucket}`}>
                          {days} day{days !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td>
                        <button
                          className="v2d-btn v2d-btn--primary v2d-btn--sm"
                          onClick={() => navigate(`/quotes/new?renewalOf=${q.id}`)}
                        >
                          <Plus size={13} /><span>Renew</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="v2d-rt-list">
            {quotes.map(q => {
              const days = daysRemaining(q.campaign_end_date)
              const bucket = bucketFor(days)
              return (
                <div key={q.id} className="v2d-panel v2d-rt-card">
                  <div className="v2d-rt-card-top">
                    <div className="v2d-rt-card-client">{q.client_name}</div>
                    <span className={`v2d-rt-days v2d-rt-days--${bucket}`}>
                      {days}d
                    </span>
                  </div>
                  <div className="v2d-rt-card-meta">
                    <span>{q.quote_number}</span>
                    <span>· Ends {formatDate(q.campaign_end_date)}</span>
                    {q.total_amount && <span>· {formatCurrency(q.total_amount)}</span>}
                  </div>
                  {isAdmin && (
                    <div className="v2d-rt-card-sub">Rep: {q.users?.name || '—'}</div>
                  )}
                  <button
                    className="v2d-btn v2d-btn--primary v2d-rt-card-cta"
                    onClick={() => navigate(`/quotes/new?renewalOf=${q.id}`)}
                  >
                    <Plus size={13} /><span>Create Renewal</span>
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
