// src/components/dashboard/FollowUpsDueToday.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export function FollowUpsDueToday() {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date().toISOString().split('T')[0]

    const { data } = await supabase
      .from('follow_ups')
      .select('id, follow_up_date, note, is_done, quote_id, quotes(quote_number, client_name), users(name)')
      .lte('follow_up_date', today)
      .eq('is_done', false)
      .order('follow_up_date', { ascending: true })
      .limit(10)

    setItems(data || [])
    setLoading(false)
  }

  async function markDone(id, e) {
    e.stopPropagation()
    await supabase
      .from('follow_ups')
      .update({ is_done: true, done_at: new Date().toISOString() })
      .eq('id', id)
    setItems(prev => prev.filter(f => f.id !== id))
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="db-card">
      <h3 className="db-card-title">
        Follow-ups Due
        {items.length > 0 && (
          <span className="db-badge db-badge--warning">{items.length}</span>
        )}
      </h3>

      {loading ? (
        <div className="db-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="db-empty">
          <CheckCircle2 size={22} />
          <p>All caught up!</p>
        </div>
      ) : (
        <div className="db-fu-list">
          {items.map(item => {
            const isOverdue = item.follow_up_date < today
            return (
              <div
                key={item.id}
                className={`db-fu-row${isOverdue ? ' db-fu-row--overdue' : ''}`}
                onClick={() => navigate(`/quotes/${item.quote_id}`)}
              >
                <Bell size={14} style={{ color: isOverdue ? 'var(--danger)' : 'var(--warning)', flexShrink: 0 }} />
                <div className="db-fu-info">
                  <div className="db-fu-client">
                    {item.quotes?.client_name || '—'}
                    <span className="db-fu-qnum"> · {item.quotes?.quote_number}</span>
                  </div>
                  {item.users?.name && (
                    <div className="db-fu-assignee">{item.users.name}</div>
                  )}
                  {item.note && <div className="db-fu-note">{item.note}</div>}
                </div>
                <div className="db-fu-date" style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {item.follow_up_date}
                </div>
                <button
                  className="db-fu-done-btn"
                  onClick={e => markDone(item.id, e)}
                  title="Mark done"
                >
                  <CheckCircle2 size={15} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
