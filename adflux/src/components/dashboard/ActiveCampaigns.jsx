// src/components/dashboard/ActiveCampaigns.jsx
// Admin-only view: every won quote whose campaign window is live.
//
// Re-styled from a cramped 7-column table into the same row-card
// layout the sales dashboard uses (see SalesDashboard.jsx's "My
// Active Campaigns" block). Reason: user flagged the visual
// inconsistency — sales saw nice tone-coded cards, admin saw a
// dense table. The card style is both friendlier on narrow screens
// and makes the admin/sales experience feel like one product.
//
// Admin still needs the sales-person name (not shown in sales view),
// so it's appended into the second metadata line.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, todayISO } from '../../utils/formatters'

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24
  return Math.max(0, Math.round((new Date(a) - new Date(b)) / MS))
}

export function ActiveCampaigns() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    const today = todayISO()
    const { data } = await supabase
      .from('quotes')
      .select('id, quote_number, client_name, total_amount, campaign_start_date, campaign_end_date, sales_person_name, created_by')
      .eq('status', 'won')
      .gte('campaign_end_date', today)
      .order('campaign_end_date', { ascending: true })
    setRows(data || [])
    setLoading(false)
  }

  const today = todayISO()

  return (
    <div className="card">
      <div className="card-h">
        <div className="card-t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarDays size={14} color="var(--y)" /> Active Campaigns
          {rows.length > 0 && (
            <span style={{
              background: 'rgba(255,230,0,.15)', color: 'var(--y)',
              borderRadius: 20, padding: '2px 8px', fontSize: '.68rem', fontWeight: 700,
            }}>{rows.length}</span>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 16, color: 'var(--gray)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '16px 0', color: 'var(--gray)', fontSize: '.85rem' }}>
          No active campaigns. Won quotes with future end dates will appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => {
            const daysLeft = daysBetween(r.campaign_end_date, today)
            // Tone ladder matches SalesDashboard exactly so the cards
            // read identically on either side of the app.
            const tone =
              daysLeft <= 3  ? { bg: 'rgba(239,83,80,.1)',   bd: 'rgba(239,83,80,.3)',   fg: '#ef9a9a' } :
              daysLeft <= 7  ? { bg: 'rgba(255,152,0,.08)',  bd: 'rgba(255,152,0,.25)',  fg: '#ffb74d' } :
              daysLeft <= 30 ? { bg: 'rgba(100,181,246,.07)', bd: 'rgba(100,181,246,.2)', fg: '#64b5f6' } :
                               { bg: 'rgba(129,199,132,.07)', bd: 'rgba(129,199,132,.2)', fg: '#81c784' }
            return (
              <div
                key={r.id}
                onClick={() => navigate(`/quotes/${r.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  background: tone.bg, border: `1px solid ${tone.bd}`,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{r.client_name}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--gray)', marginTop: 2 }}>
                    {r.quote_number}
                    {r.sales_person_name && <> · {r.sales_person_name}</>}
                    {r.campaign_start_date && r.campaign_end_date && (
                      <> · {r.campaign_start_date} → {r.campaign_end_date}</>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: '.9rem', color: tone.fg }}>
                    {daysLeft} day{daysLeft === 1 ? '' : 's'} left
                  </div>
                  <div style={{ fontSize: '.7rem', color: 'var(--y)' }}>
                    {formatCurrency(r.total_amount || 0)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
