// src/components/incentives/SalaryPayoutModal.jsx
//
// Phase 37 — admin-only salary payout entry + history.
//
// Owner directive (17 May 2026): "when final salary count, accounts
// can payout in single or multiple payment with history."
//
// Mirrors IncentivePayoutModal — same shape, same UX, just bound
// to the salary_payouts table (Phase 37 SQL) instead of
// incentive_payouts.
//
// Props:
//   staff       — { user_id, name } object
//   monthYear   — 'YYYY-MM' string for the month being paid
//   monthLabel  — pretty label like 'May 2026' for the title bar
//   computed    — Number — the NET payable from compute_monthly_salary
//   onClose, onSaved — callbacks

import { useEffect, useState } from 'react'
import { X, Calendar, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency, formatMonthYear } from '../../utils/formatters'
import { toastError } from '../v2/Toast'

export function SalaryPayoutModal({ staff, monthYear, computed, onClose, onSaved }) {
  const { profile } = useAuth()
  const [payouts,  setPayouts]  = useState([])
  const [amount,   setAmount]   = useState('')
  const [isFull,   setIsFull]   = useState(false)
  const [note,     setNote]     = useState('')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  useEffect(() => { load() /* eslint-disable-next-line */ }, [staff?.user_id, monthYear])

  async function load() {
    if (!staff?.user_id) return
    const { data } = await supabase
      .from('salary_payouts')
      .select('*')
      .eq('user_id', staff.user_id)
      .eq('month_year', monthYear)
      .order('paid_date', { ascending: false })
    setPayouts(data || [])
  }

  const totalPaid  = payouts.reduce((s, p) => s + Number(p.amount_paid || 0), 0)
  const pendingPay = Math.max(0, Number(computed || 0) - totalPaid)
  const hasFull    = payouts.some(p => p.is_full_payment)

  async function addPayout(e) {
    e.preventDefault()
    setErr('')
    const amt = Number(amount)
    if (!amt || amt <= 0) { setErr('Enter a positive amount.'); return }
    if (hasFull)          { setErr('A full payment already exists for this month.'); return }
    setSaving(true)
    const { error } = await supabase.from('salary_payouts').insert({
      user_id:         staff.user_id,
      month_year:      monthYear,
      amount_paid:     amt,
      is_full_payment: isFull,
      note:            note || null,
      paid_date:       paidDate,
      paid_by:         profile?.id,
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setAmount(''); setNote(''); setIsFull(false)
    await load()
    onSaved?.()
  }

  async function remove(id) {
    if (!confirm('Remove this payout entry?')) return
    const { error } = await supabase
      .from('salary_payouts')
      .delete()
      .eq('id', id)
    if (error) {
      toastError(error, 'Could not remove payout entry.')
      return
    }
    await load()
    onSaved?.()
  }

  return (
    <div className="mo" onClick={onClose}>
      <div className="md" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="md-h">
          <div className="md-t">
            Salary Payout — {staff?.name || '—'} · {formatMonthYear(monthYear)}
          </div>
          <button className="md-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="md-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Summary row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10,
            background: 'rgba(255,255,255,.03)', border: '1px solid var(--border, #334155)',
            borderRadius: 8, padding: 12,
          }}>
            <div>
              <div style={{ fontSize: '.68rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>Net payable</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>
                {formatCurrency(computed || 0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '.68rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>Paid</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--success, #10B981)' }}>
                {formatCurrency(totalPaid)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '.68rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>Pending</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--warning, #F59E0B)' }}>
                {formatCurrency(pendingPay)}
              </div>
            </div>
          </div>

          {/* Entry form */}
          {!hasFull && (
            <form onSubmit={addPayout} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="grid2">
                <label>
                  <span style={{ fontSize: '.72rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>Amount Paid</span>
                  <input
                    type="number" step="0.01" value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder={pendingPay > 0 ? String(Math.round(pendingPay)) : '0.00'}
                    className="fg"
                    required
                  />
                </label>
                <label>
                  <span style={{ fontSize: '.72rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>Paid Date</span>
                  <input
                    type="date" value={paidDate}
                    onChange={e => setPaidDate(e.target.value)}
                    className="fg"
                    required
                  />
                </label>
              </div>
              <label>
                <span style={{ fontSize: '.72rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>Note (optional)</span>
                <input
                  type="text" value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. NEFT ref, salary advance, split reason"
                  className="fg"
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.82rem' }}>
                <input
                  type="checkbox" checked={isFull}
                  onChange={e => setIsFull(e.target.checked)}
                />
                Mark as full & final salary payment for this month
              </label>
              {err && <div style={{ color: 'var(--danger, #EF4444)', fontSize: '.78rem' }}>{err}</div>}
              <button className="btn btn-y" disabled={saving} type="submit">
                {saving ? 'Saving…' : 'Record Payout'}
              </button>
            </form>
          )}
          {hasFull && (
            <div style={{
              background: 'var(--tint-success, rgba(16,185,129,0.14))', border: '1px solid var(--tint-success-bd, rgba(16,185,129,0.40))',
              color: 'var(--success, #10B981)', padding: 10, borderRadius: 8, fontSize: '.82rem',
            }}>
              Full &amp; final payment already recorded. No further entries allowed for this month.
            </div>
          )}

          {/* History */}
          <div>
            <div style={{ fontSize: '.72rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', marginBottom: 8 }}>
              Payout History
            </div>
            {payouts.length === 0 ? (
              <div style={{ fontSize: '.8rem', color: 'var(--text-muted, #94a3b8)' }}>No payouts recorded yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {payouts.map(p => (
                  <div key={p.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 10px', border: '1px solid var(--border, #334155)', borderRadius: 6,
                  }}>
                    <div>
                      <div style={{ fontSize: '.85rem', fontWeight: 600 }}>
                        {formatCurrency(p.amount_paid)}
                        {p.is_full_payment && <span style={{ marginLeft: 8, color: 'var(--success, #10B981)', fontSize: '.7rem' }}>FULL</span>}
                      </div>
                      <div style={{ fontSize: '.7rem', color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
                        <Calendar size={10} style={{ display: 'inline', marginRight: 4 }} />
                        {p.paid_date}
                        {p.note && <> · {p.note}</>}
                      </div>
                    </div>
                    <button
                      onClick={() => remove(p.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger, #EF4444)', cursor: 'pointer', padding: 4 }}
                      title="Delete payout"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
