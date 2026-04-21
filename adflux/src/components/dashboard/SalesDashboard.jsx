// src/components/dashboard/SalesDashboard.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Bell, TrendingUp, CheckCircle2, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../utils/formatters'
import { useAuth } from '../../hooks/useAuth'
import { useIncentive } from '../../hooks/useIncentive'
import { calculateIncentive } from '../../utils/incentiveCalc'

export function SalesDashboard() {
  const { profile } = useAuth()
  const { fetchProfileForUser, fetchMonthlySales, fetchSettings } = useIncentive()
  const navigate = useNavigate()

  const [quotes,    setQuotes]    = useState([])
  const [followups, setFollowups] = useState([])
  const [incentive, setIncentive] = useState(null)
  const [loading,   setLoading]   = useState(true)

  const today = new Date().toISOString().split('T')[0]
  const thisMonth = today.slice(0, 7)

  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  async function load() {
    const uid = profile.id

    const [qRes, fRes] = await Promise.all([
      supabase
        .from('quotes')
        .select('id, quote_number, client_name, total_amount, status, created_at')
        .eq('created_by', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('follow_ups')
        .select('id, follow_up_date, note, is_done, quote_id, quotes(quote_number, client_name)')
        .eq('assigned_to', uid)
        .eq('is_done', false)
        .lte('follow_up_date', today)
        .order('follow_up_date', { ascending: true })
        .limit(6),
    ])

    setQuotes(qRes.data || [])
    setFollowups(fRes.data || [])

    // Load incentive for this month
    const [profRes, salesRes, settings] = await Promise.all([
      fetchProfileForUser(uid),
      supabase.from('monthly_sales_data').select('*').eq('staff_id', uid).eq('month_year', thisMonth).single(),
      fetchSettings(),
    ])

    if (profRes.data && salesRes.data) {
      const calc = calculateIncentive({
        ...profRes.data,
        newClientRevenue: salesRes.data.new_client_revenue || 0,
        renewalRevenue: salesRes.data.renewal_revenue || 0,
      })
      setIncentive({ ...calc, profile: profRes.data, sales: salesRes.data })
    }

    setLoading(false)
  }

  async function markDone(id, e) {
    e.stopPropagation()
    await supabase.from('follow_ups').update({ is_done: true, done_at: new Date().toISOString() }).eq('id', id)
    setFollowups(prev => prev.filter(f => f.id !== id))
  }

  const won      = quotes.filter(q => q.status === 'won')
  const active   = quotes.filter(q => !['lost'].includes(q.status))
  const pipeline = active.reduce((s, q) => s + (q.total_amount || 0), 0)
  const wonValue = won.reduce((s, q) => s + (q.total_amount || 0), 0)

  const STATUS_COLOR = { won: '#81c784', lost: '#ef9a9a', sent: '#64b5f6', negotiating: '#ffb74d', draft: '#888' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI Cards */}
      <div className="sg">
        {[
          { label: 'My Quotes',       val: quotes.length,              color: '#64b5f6' },
          { label: 'Pipeline Value',  val: formatCurrency(pipeline),   color: 'var(--y)' },
          { label: 'Won Revenue',     val: formatCurrency(wonValue),   color: '#81c784' },
          { label: 'Follow-ups Due',  val: followups.length,           color: '#ffb74d' },
        ].map((k, i) => (
          <div key={i} className="sc">
            <div className="sc-lbl">{k.label}</div>
            <div className="sc-val" style={{ color: k.color }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Incentive card */}
      {incentive && (
        <div className="card">
          <div className="card-h">
            <div className="card-t">My Incentive — {thisMonth}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 14, marginBottom: 14 }}>
            {[
              { label: 'Total Sales', val: formatCurrency(incentive.total), color: 'var(--wh)' },
              { label: `Target (${incentive.profile?.sales_multiplier || 5}×)`, val: formatCurrency(incentive.profile?.monthly_salary * (incentive.profile?.sales_multiplier || 5)), color: 'var(--y)' },
              { label: 'Incentive Earned', val: formatCurrency(incentive.incentive), color: '#81c784' },
              { label: 'Flat Bonus', val: incentive.flatBonus > 0 ? formatCurrency(incentive.flatBonus) : '—', color: 'var(--y)' },
            ].map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: '.68rem', color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: '1.3rem', color: f.color }}>{f.val}</div>
              </div>
            ))}
          </div>
          {/* Progress bar */}
          <div style={{ fontSize: '.72rem', color: 'var(--gray)', marginBottom: 5 }}>
            {Math.min(100, Math.round(incentive.pct || 0))}% of target reached
          </div>
          <div style={{ height: 6, background: 'var(--brd)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, transition: '.6s',
              width: `${Math.min(100, incentive.pct || 0)}%`,
              background: incentive.level === 'above' ? '#81c784' : incentive.level === 'mid' ? '#ffb74d' : '#ef9a9a',
            }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {/* Recent Quotes */}
        <div className="card">
          <div className="card-h">
            <div className="card-t">Recent Quotes</div>
            <button className="btn btn-y btn-sm" onClick={() => navigate('/quotes/new')}>
              <Plus size={13} /> New
            </button>
          </div>
          {loading ? <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--gray)' }}>Loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {quotes.slice(0, 6).map(q => (
                <div
                  key={q.id}
                  onClick={() => navigate(`/quotes/${q.id}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer' }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{q.client_name}</div>
                    <div style={{ fontSize: '.72rem', color: STATUS_COLOR[q.status] || 'var(--gray)', marginTop: 2, fontWeight: 600, textTransform: 'capitalize' }}>
                      {q.quote_number} · {q.status}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--y)' }}>{formatCurrency(q.total_amount)}</div>
                </div>
              ))}
              {quotes.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--gray)', fontSize: '.82rem' }}>No quotes yet</div>}
            </div>
          )}
        </div>

        {/* Follow-ups */}
        <div className="card">
          <div className="card-h">
            <div className="card-t">
              Follow-ups Due
              {followups.length > 0 && (
                <span style={{ background: 'rgba(255,152,0,.2)', color: '#ffb74d', borderRadius: 20, padding: '2px 8px', fontSize: '.68rem', fontWeight: 700, marginLeft: 8 }}>
                  {followups.length}
                </span>
              )}
            </div>
          </div>
          {loading ? <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--gray)' }}>Loading…</div> :
           followups.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--gray)' }}>
              <CheckCircle2 size={28} style={{ opacity: .3, margin: '0 auto 8px' }} />
              <div style={{ fontSize: '.82rem' }}>All caught up!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {followups.map(item => {
                const isOverdue = item.follow_up_date < today
                return (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/quotes/${item.quote_id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                      background: isOverdue ? 'rgba(229,57,53,.08)' : 'rgba(255,255,255,.03)',
                      border: `1px solid ${isOverdue ? 'rgba(229,57,53,.25)' : 'transparent'}`,
                    }}
                  >
                    <Bell size={14} style={{ color: isOverdue ? '#ef9a9a' : '#ffb74d', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.quotes?.client_name}
                      </div>
                      {item.note && <div style={{ fontSize: '.72rem', color: 'var(--gray)', marginTop: 2 }}>{item.note}</div>}
                    </div>
                    <div style={{ fontSize: '.72rem', color: isOverdue ? '#ef9a9a' : 'var(--gray)', flexShrink: 0 }}>{item.follow_up_date}</div>
                    <button
                      onClick={e => markDone(item.id, e)}
                      style={{ background: 'none', border: 'none', color: '#81c784', cursor: 'pointer', padding: 4 }}
                      title="Mark done"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
