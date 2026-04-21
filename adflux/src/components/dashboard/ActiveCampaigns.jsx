// src/components/dashboard/ActiveCampaigns.jsx
// Admin-only view: every won quote whose campaign window is live.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../utils/formatters'

export function ActiveCampaigns() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('quotes')
      .select('id, quote_number, client_name, total_amount, campaign_start_date, campaign_end_date, sales_person_name, created_by')
      .eq('status', 'won')
      .gte('campaign_end_date', today)
      .order('campaign_end_date', { ascending: true })
    setRows(data || [])
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)

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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '.82rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--gray)', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>Client</th>
                <th style={{ padding: '8px 6px' }}>Quote</th>
                <th style={{ padding: '8px 6px' }}>Sales</th>
                <th style={{ padding: '8px 6px' }}>Start</th>
                <th style={{ padding: '8px 6px' }}>End</th>
                <th style={{ padding: '8px 6px' }}>Days Left</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const days = Math.max(0, Math.round((new Date(r.campaign_end_date) - new Date(today)) / 86400000))
                const color = days <= 3 ? '#ef5350' : days <= 7 ? '#ffb74d' : days <= 30 ? '#64b5f6' : '#81c784'
                return (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/quotes/${r.id}`)}
                    style={{ borderTop: '1px solid var(--brd)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '8px 6px', fontWeight: 600 }}>{r.client_name}</td>
                    <td style={{ padding: '8px 6px' }}>{r.quote_number}</td>
                    <td style={{ padding: '8px 6px' }}>{r.sales_person_name || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{r.campaign_start_date || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{r.campaign_end_date || '—'}</td>
                    <td style={{ padding: '8px 6px', color, fontWeight: 700 }}>{days}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--y)' }}>{formatCurrency(r.total_amount || 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
