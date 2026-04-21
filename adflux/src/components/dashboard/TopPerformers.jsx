// src/components/dashboard/TopPerformers.jsx
import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCompact } from '../../utils/formatters'
import { initials } from '../../utils/formatters'

export function TopPerformers() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const currentMonth = new Date().toISOString().slice(0, 7)

    const { data } = await supabase
      .from('monthly_sales_data')
      .select('staff_id, new_client_revenue, renewal_revenue, users(name)')
      .eq('month_year', currentMonth)
      .order('new_client_revenue', { ascending: false })

    const rows = (data || [])
      .map(r => ({
        id:      r.staff_id,
        name:    r.users?.name || 'Unknown',
        revenue: (r.new_client_revenue || 0) + (r.renewal_revenue || 0),
        new:     r.new_client_revenue || 0,
        renewal: r.renewal_revenue    || 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    setRows(rows)
    setLoading(false)
  }

  const maxRevenue = Math.max(...rows.map(r => r.revenue), 1)

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="db-card">
      <h3 className="db-card-title">Top Performers <span style={{ fontSize: 13 }}>— This Month</span></h3>

      {loading ? (
        <div className="db-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="db-empty">
          <Trophy size={22} />
          <p>No data for this month yet</p>
        </div>
      ) : (
        <div className="db-performers-list">
          {rows.map((row, i) => (
            <div key={row.id} className="db-performer-row">
              <div className="db-performer-rank">
                {medals[i] || <span className="db-performer-num">{i + 1}</span>}
              </div>
              <div className="db-performer-avatar">
                {initials(row.name)}
              </div>
              <div className="db-performer-info">
                <div className="db-performer-name">{row.name}</div>
                <div className="db-performer-bar-track">
                  <div
                    className="db-performer-bar-fill"
                    style={{ width: `${(row.revenue / maxRevenue) * 100}%` }}
                  />
                </div>
              </div>
              <div className="db-performer-value">{formatCompact(row.revenue)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
