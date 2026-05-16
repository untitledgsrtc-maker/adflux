// src/components/incentives/IncentivePayoutModal.jsx
// Admin-only: punch actual incentive paid (full or partial) against a staff+month.
// Rows go into incentive_payouts (Phase 2 SQL addendum table).
import { useEffect, useState } from 'react'
import { X, IndianRupee, Calendar, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency, formatMonthYear } from '../../utils/formatters'
import { toastError } from '../v2/Toast'

// Phase 39 — IST today (was UTC). `new Date().toISOString()` returns
// UTC, which from 18:30 onwards already rolled the date forward but
// before that left it on yesterday in IST. Force IST anchor.
function istTodayISO() {
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000)
  return ist.toISOString().slice(0, 10)
}

export function IncentivePayoutModal({ staff, monthYear, monthLabel, computed, onClose, onSaved }) {
  const { profile } = useAuth()
  const [payouts,  setPayouts]  = useState([])
  const [amount,   setAmount]   = useState('')
  const [isFull,   setIsFull]   = useState(false)
  const [note,     setNote]     = useState('')
  const [paidDate, setPaidDate] = useState(istTodayISO())
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  useEffect(() => { load() }, [staff?.user_id, monthYear])

  async function load() {
    if (!staff?.user_id) return
    const { data } = await supabase
      .from('incentive_payouts')
      .select('*')
      .eq('staff_id', staff.user_id)
      .eq('month_year', monthYear)
      .order('paid_date', { ascending: false })
    setPayouts(data || [])
  }

  const totalPaid   = payouts.reduce((s, p) => s + Number(p.amount_paid || 0), 0)
  const pendingPay  = Math.max(0, Number(computed || 0) - totalPaid)
  const hasFull     = payouts.some(p => p.is_full_payment)

  async function addPayout(e) {
    e.preventDefault()
    setErr('')
    const amt = Number(amount)
    if (!amt || amt <= 0) { setErr('Enter a positive amount.'); return }
    if (hasFull)          { setErr('A full payment already exists for this month.'); return }
    setSaving(true)
    const { error } = await supabase.from('incentive_payouts').insert({
      staff_id:        staff.user_id,
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
    // Phase 34b — was unchecked. If RLS or the row's already-locked
    // state blocks the delete, the UI reloaded with the row still
    // there. Surface the real error so accounts knows the row is
    // still on the books.
    const { error } = await supabase
      .from('incentive_payouts')
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
            Incentive Payout — {staff?.name || '—'} · {formatMonthYear(monthYear)}
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
              <div style={{ fontSize: '.68rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase' }}>Computed</div>
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
                    placeholder="0.00"
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
                  placeholder="e.g. bank transfer ref, partial split reason"
                  className="fg"
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.82rem' }}>
                <input
                  type="checkbox" checked={isFull}
                  onChange={e => setIsFull(e.target.checked)}
                />
                Mark as full & final payment for this month
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
              Full & final payment already recorded. No further entries allowed for this month.
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
