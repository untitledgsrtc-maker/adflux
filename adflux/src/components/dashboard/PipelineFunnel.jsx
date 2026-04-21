// src/components/dashboard/PipelineFunnel.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCompact } from '../../utils/formatters'

const STAGES = [
  { status: 'draft',        label: 'Draft',        color: 'var(--text-muted)' },
  { status: 'sent',         label: 'Sent',          color: 'var(--blue)' },
  { status: 'negotiating',  label: 'Negotiating',   color: 'var(--warning)' },
  { status: 'won',          label: 'Won',            color: 'var(--success)' },
  { status: 'lost',         label: 'Lost',           color: 'var(--danger)' },
]

export function PipelineFunnel() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('quotes')
      .select('status, total_amount')

    const quotes = data || []
    const total  = quotes.length || 1

    const counts = STAGES.map(s => {
      const qs     = quotes.filter(q => q.status === s.status)
      const count  = qs.length
      const value  = qs.reduce((sum, q) => sum + (q.total_amount || 0), 0)
      const pct    = Math.round((count / total) * 100)
      return { ...s, count, value, pct }
    })

    setRows(counts)
    setLoading(false)
  }

  const maxCount = Math.max(...rows.map(r => r.count), 1)

  return (
    <div className="db-card">
      <h3 className="db-card-title">Pipeline Funnel</h3>
      {loading ? (
        <div className="db-loading">Loading…</div>
      ) : (
        <div className="db-funnel">
          {rows.map(row => (
            <div key={row.status} className="db-funnel-row">
              <div className="db-funnel-label">
                <span style={{ color: row.color }}>{row.label}</span>
                <span className="db-funnel-count">{row.count}</span>
              </div>
              <div className="db-funnel-bar-track">
                <div
                  className="db-funnel-bar-fill"
                  style={{
                    width: `${(row.count / maxCount) * 100}%`,
                    background: row.color,
                  }}
                />
              </div>
              <div className="db-funnel-value">{formatCompact(row.value)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
