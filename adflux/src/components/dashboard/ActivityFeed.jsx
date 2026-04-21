// src/components/dashboard/ActivityFeed.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, CreditCard, CheckCircle2, Send, PenLine } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatRelative, formatCurrency } from '../../utils/formatters'

export function ActivityFeed() {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    const [quotesRes, paymentsRes] = await Promise.all([
      supabase
        .from('quotes')
        .select('id, quote_number, client_name, status, updated_at, sales_person_name')
        .order('updated_at', { ascending: false })
        .limit(10),
      supabase
        .from('payments')
        .select('id, quote_id, amount_received, is_final_payment, created_at, quotes(quote_number, client_name)')
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const quoteEvents = (quotesRes.data || []).map(q => ({
      type:    'quote',
      id:      q.id,
      ts:      q.updated_at,
      label:   q.client_name,
      sub:     q.quote_number,
      status:  q.status,
      actor:   q.sales_person_name,
    }))

    const payEvents = (paymentsRes.data || []).map(p => ({
      type:   'payment',
      id:     p.quote_id,
      ts:     p.created_at,
      label:  p.quotes?.client_name || '—',
      sub:    p.quotes?.quote_number || '',
      amount: p.amount_received,
      final:  p.is_final_payment,
    }))

    const all = [...quoteEvents, ...payEvents]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 12)

    setItems(all)
    setLoading(false)
  }

  function getIcon(item) {
    if (item.type === 'payment') {
      return item.final
        ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
        : <CreditCard size={14} style={{ color: 'var(--blue)' }} />
    }
    if (item.status === 'sent')        return <Send size={14} style={{ color: 'var(--blue)' }} />
    if (item.status === 'won')         return <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
    if (item.status === 'draft')       return <PenLine size={14} style={{ color: 'var(--text-muted)' }} />
    return <FileText size={14} style={{ color: 'var(--text-muted)' }} />
  }

  function getDesc(item) {
    if (item.type === 'payment') {
      return item.final
        ? `Final payment ${formatCurrency(item.amount)} received`
        : `Payment of ${formatCurrency(item.amount)} recorded`
    }
    const map = {
      draft:       'Quote drafted',
      sent:        'Quote sent to client',
      negotiating: 'Quote under negotiation',
      won:         'Quote marked Won 🎉',
      lost:        'Quote marked Lost',
    }
    return map[item.status] || `Status: ${item.status}`
  }

  return (
    <div className="db-card">
      <h3 className="db-card-title">Recent Activity</h3>

      {loading ? (
        <div className="db-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="db-empty">No activity yet</div>
      ) : (
        <div className="db-activity-list">
          {items.map((item, i) => (
            <div
              key={`${item.type}-${item.id}-${i}`}
              className="db-activity-row"
              onClick={() => navigate(`/quotes/${item.id}`)}
            >
              <div className="db-activity-dot">{getIcon(item)}</div>
              <div className="db-activity-body">
                <div className="db-activity-desc">{getDesc(item)}</div>
                <div className="db-activity-meta">
                  <span className="db-activity-client">{item.label}</span>
                  {item.sub && <span className="db-activity-quote"> · {item.sub}</span>}
                  {item.actor && <span className="db-activity-actor"> · {item.actor}</span>}
                </div>
              </div>
              <div className="db-activity-time">{formatRelative(item.ts)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
