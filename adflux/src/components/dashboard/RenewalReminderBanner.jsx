// src/components/dashboard/RenewalReminderBanner.jsx
// 30 / 7 / 3 day renewal reminder tiers.
// Reads won quotes whose campaign_end_date falls inside the window.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCcw, AlertTriangle, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, todayISO, addDaysISO } from '../../utils/formatters'

export function RenewalReminderBanner({ userId, scope = 'mine' }) {
  const [rows, setRows] = useState([])
  const navigate = useNavigate()

  useEffect(() => { load() }, [userId, scope])

  async function load() {
    const today = todayISO()
    const in30  = addDaysISO(30)

    let q = supabase
      .from('quotes')
      .select('id, quote_number, client_name, client_phone, total_amount, campaign_end_date, created_by')
      .eq('status', 'won')
      .gte('campaign_end_date', today)
      .lte('campaign_end_date', in30)
      .order('campaign_end_date', { ascending: true })

    if (scope === 'mine' && userId) q = q.eq('created_by', userId)

    const { data } = await q
    setRows(data || [])
  }

  if (!rows.length) return null

  const today = todayISO()
  const MS = 86400000
  const bucket = (end) => {
    const diff = Math.round((new Date(end) - new Date(today)) / MS)
    if (diff <= 3)  return { key: '3',  fg: '#ef5350', bg: 'rgba(239,83,80,.1)',  bd: 'rgba(239,83,80,.3)',  label: '≤ 3 days', icon: AlertTriangle }
    if (diff <= 7)  return { key: '7',  fg: '#ffb74d', bg: 'rgba(255,152,0,.1)',  bd: 'rgba(255,152,0,.3)',  label: '≤ 7 days', icon: Clock }
    return               { key: '30', fg: '#64b5f6', bg: 'rgba(100,181,246,.08)', bd: 'rgba(100,181,246,.25)', label: '≤ 30 days', icon: RotateCcw }
  }

  // Group and show most urgent tier first
  const grouped = rows.reduce((acc, r) => {
    const b = bucket(r.campaign_end_date)
    if (!acc[b.key]) acc[b.key] = { meta: b, items: [] }
    acc[b.key].items.push(r)
    return acc
  }, {})

  const order = ['3', '7', '30']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {order.filter(k => grouped[k]).map(k => {
        const { meta, items } = grouped[k]
        const Icon = meta.icon
        return (
          <div
            key={k}
            style={{
              background: meta.bg, border: `1px solid ${meta.bd}`,
              borderRadius: 10, padding: '10px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: items.length ? 8 : 0 }}>
              <Icon size={16} color={meta.fg} />
              <div style={{ color: meta.fg, fontWeight: 700, fontSize: '.85rem' }}>
                Renewal opportunity — {meta.label} ({items.length})
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {items.slice(0, 8).map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/quotes/${r.id}`)}
                  style={{
                    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
                    color: 'var(--wh)', borderRadius: 6, padding: '6px 10px',
                    fontSize: '.75rem', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center',
                  }}
                  title={`Ends ${r.campaign_end_date} · ${formatCurrency(r.total_amount)}`}
                >
                  <strong>{r.client_name}</strong>
                  <span style={{ color: 'var(--gray)' }}>· {r.campaign_end_date}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
