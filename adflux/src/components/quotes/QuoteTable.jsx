// src/components/quotes/QuoteTable.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { QuoteStatusBadge } from './QuoteStatusBadge'
import { formatCurrency, formatDate, truncate } from '../../utils/formatters'

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ChevronsUpDown size={13} style={{ opacity: 0.3 }} />
  return sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
}

// Derive a per-quote payment snapshot from the `payments` relation loaded
// with the quote. Only approved payments count toward the balance — pending
// approvals shouldn't shrink what the client still owes. Lost quotes and
// untouched open quotes return { kind: 'none' } so the column renders a
// neutral em dash instead of a misleading "full amount due".
function computeBalance(q) {
  if (q.status === 'lost') return { kind: 'none' }
  const paid = (q.payments || [])
    .filter(p => p.approval_status === 'approved')
    .reduce((s, p) => s + Number(p.amount_received || 0), 0)
  if (paid === 0 && q.status !== 'won') return { kind: 'none' }
  const total = Number(q.total_amount || 0)
  const balance = Math.max(0, total - paid)
  if (balance === 0 && paid > 0) return { kind: 'paid' }
  return { kind: 'due', amount: balance }
}

export function QuoteTable({ quotes, isAdmin }) {
  const navigate = useNavigate()
  const [sortField, setSortField] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')

  function handleSort(field) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sorted = [...quotes].sort((a, b) => {
    let va = a[sortField]
    let vb = b[sortField]
    if (sortField === 'total_amount' || sortField === 'subtotal') {
      va = Number(va) || 0
      vb = Number(vb) || 0
    } else {
      va = String(va || '').toLowerCase()
      vb = String(vb || '').toLowerCase()
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function Th({ field, children }) {
    return (
      <th
        onClick={() => handleSort(field)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {children}
          <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
        </span>
      </th>
    )
  }

  if (!sorted.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📄</div>
        <p style={{ fontWeight: 600 }}>No quotes found</p>
        <p style={{ fontSize: 13 }}>Try adjusting your filters or create a new quote.</p>
      </div>
    )
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <Th field="quote_number">Quote #</Th>
            <Th field="client_name">Client</Th>
            <Th field="client_company">Company</Th>
            {isAdmin && <Th field="sales_person_name">Sales Rep</Th>}
            <Th field="total_amount">Amount</Th>
            <Th field="status">Status</Th>
            <th>Outstanding</th>
            <Th field="created_at">Date</Th>
            <th>Follow Up</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(q => (
            <tr
              key={q.id}
              onClick={() => navigate(`/quotes/${q.id}`)}
              style={{ cursor: 'pointer' }}
              className="quote-row"
            >
              <td>
                <span className="quote-number">{q.quote_number}</span>
              </td>
              <td>
                <span className="quote-client-name">{q.client_name}</span>
              </td>
              <td>
                <span style={{ color: 'var(--text-muted)' }}>
                  {truncate(q.client_company || '—', 24)}
                </span>
              </td>
              {isAdmin && (
                <td>
                  <span style={{ color: 'var(--text-muted)' }}>{q.sales_person_name || '—'}</span>
                </td>
              )}
              <td>
                <span style={{ fontWeight: 600 }}>{formatCurrency(q.total_amount)}</span>
              </td>
              <td>
                <QuoteStatusBadge status={q.status} />
              </td>
              <td>
                {(() => {
                  const b = computeBalance(q)
                  if (b.kind === 'none') {
                    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                  }
                  if (b.kind === 'paid') {
                    return (
                      <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 13 }}>
                        Paid
                      </span>
                    )
                  }
                  return (
                    <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                      {formatCurrency(b.amount)}
                    </span>
                  )
                })()}
              </td>
              <td>
                <span style={{ color: 'var(--text-muted)' }}>{formatDate(q.created_at)}</span>
              </td>
              <td>
                {q.follow_up_date ? (
                  <span
                    className={`follow-up-chip ${
                      !q.follow_up_done && new Date(q.follow_up_date) <= new Date()
                        ? 'follow-up-chip--overdue'
                        : q.follow_up_done
                        ? 'follow-up-chip--done'
                        : ''
                    }`}
                  >
                    {q.follow_up_done ? '✓ Done' : formatDate(q.follow_up_date)}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
