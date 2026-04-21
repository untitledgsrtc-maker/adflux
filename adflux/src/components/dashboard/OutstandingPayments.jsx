// src/components/dashboard/OutstandingPayments.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate } from '../../utils/formatters'

export function OutstandingPayments() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    // Get all won quotes
    const { data: wonQuotes } = await supabase
      .from('quotes')
      .select('id, quote_number, client_name, client_company, total_amount, created_at')
      .eq('status', 'won')
      .order('created_at', { ascending: false })

    if (!wonQuotes?.length) { setRows([]); setLoading(false); return }

    // Get payments for those quotes
    const ids = wonQuotes.map(q => q.id)
    // Only approved payments count toward "paid so far" — pending
    // / rejected rows must not reduce the outstanding balance.
    const { data: payments } = await supabase
      .from('payments')
      .select('quote_id, amount_received, is_final_payment')
      .eq('approval_status', 'approved')
      .in('quote_id', ids)

    const pMap = {}
    for (const p of payments || []) {
      if (!pMap[p.quote_id]) pMap[p.quote_id] = { paid: 0, final: false }
      pMap[p.quote_id].paid  += p.amount_received || 0
      if (p.is_final_payment) pMap[p.quote_id].final = true
    }

    const outstanding = wonQuotes
      .map(q => {
        const paid      = pMap[q.id]?.paid  || 0
        const isFinal   = pMap[q.id]?.final || false
        const balance   = q.total_amount - paid
        return { ...q, paid, balance, isFinal }
      })
      .filter(q => !q.isFinal && q.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 8)

    setRows(outstanding)
    setLoading(false)
  }

  return (
    <div className="db-card">
      <h3 className="db-card-title">
        Outstanding Payments
        {rows.length > 0 && (
          <span className="db-badge db-badge--danger">{rows.length}</span>
        )}
      </h3>

      {loading ? (
        <div className="db-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="db-empty">
          <AlertCircle size={22} />
          <p>No outstanding balances</p>
        </div>
      ) : (
        <div className="db-outstanding-list">
          {rows.map(row => {
            const pct = Math.round((row.paid / row.total_amount) * 100)
            return (
              <div
                key={row.id}
                className="db-outstanding-row"
                onClick={() => navigate(`/quotes/${row.id}`)}
              >
                <div className="db-outstanding-info">
                  <div className="db-outstanding-name">
                    {row.client_name}
                    {row.client_company && (
                      <span className="db-outstanding-company"> · {row.client_company}</span>
                    )}
                  </div>
                  <div className="db-outstanding-quote">{row.quote_number}</div>
                </div>
                <div className="db-outstanding-right">
                  <div className="db-outstanding-balance">{formatCurrency(row.balance)}</div>
                  <div className="db-outstanding-track">
                    <div
                      className="db-outstanding-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="db-outstanding-pct">{pct}% paid</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
