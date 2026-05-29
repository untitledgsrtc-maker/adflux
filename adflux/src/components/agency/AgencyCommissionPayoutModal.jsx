// src/components/agency/AgencyCommissionPayoutModal.jsx
//
// Phase 101.A3 JSX (2026-05-29) — per-quote commission payout entry.
//
// Mirrors Phase 37 SalaryPayoutModal shape (amount + paid_date +
// is_full_payment + note + delete) but scoped to (user_id, quote_id)
// rather than (user_id, month_year). Backed by Phase 101.A3 SQL
// agency_commission_payouts table.
//
// Props:
//   agency             — { id, name }
//   quote              — { id, quote_number, client, commission_earned }
//   onClose            — callback
//   onSaved            — callback after add/delete; parent refetches
//
// Brand: reuses .lead-modal-* shell + brand tokens; no new CSS.

import { useEffect, useState } from 'react'
import { X, Calendar, Trash2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency } from '../../utils/formatters'
import { toastError, toastSuccess } from '../v2/Toast'
import { confirmDialog } from '../v2/ConfirmDialog'
import { istTodayISO } from '../../utils/istDate'

export default function AgencyCommissionPayoutModal({ agency, quote, onClose, onSaved }) {
  const { profile } = useAuth()
  const [payouts,  setPayouts]  = useState([])
  const [amount,   setAmount]   = useState('')
  const [isFull,   setIsFull]   = useState(false)
  const [note,     setNote]     = useState('')
  const [paidDate, setPaidDate] = useState(istTodayISO())
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  useEffect(() => { load() /* eslint-disable-next-line */ }, [agency?.id, quote?.id])

  async function load() {
    if (!agency?.id || !quote?.id) return
    setLoading(true)
    const { data, error } = await supabase
      .from('agency_commission_payouts')
      .select('*')
      .eq('user_id', agency.id)
      .eq('quote_id', quote.id)
      .order('paid_date', { ascending: false })
    setLoading(false)
    if (error) {
      setErr(error.message)
      return
    }
    setPayouts(data || [])
  }

  const totalPaid = payouts.reduce((s, p) => s + Number(p.amount_paid || 0), 0)
  const earned    = Number(quote?.commission_earned || 0)
  const pending   = Math.max(0, earned - totalPaid)
  const hasFull   = payouts.some(p => p.is_full_payment)

  async function addPayout(e) {
    if (e && e.preventDefault) e.preventDefault()
    setErr('')
    const amt = Number(amount)
    if (!amount || Number.isNaN(amt) || amt <= 0) {
      setErr('Enter a payout amount greater than 0.')
      return
    }
    if (!paidDate) {
      setErr('Pick a paid date.')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('agency_commission_payouts')
      .insert([{
        user_id:         agency.id,
        quote_id:        quote.id,
        amount_paid:     amt,
        is_full_payment: !!isFull,
        paid_date:       paidDate,
        paid_by:         profile?.id || null,
        note:            note.trim() || null,
      }])
    setSaving(false)
    if (error) {
      toastError(error, 'Could not save payout.')
      setErr(error.message)
      return
    }
    toastSuccess(`Payout of ${formatCurrency(amt)} saved.`)
    setAmount('')
    setIsFull(false)
    setNote('')
    setPaidDate(istTodayISO())
    await load()
    onSaved?.()
  }

  async function removePayout(p) {
    if (!(await confirmDialog({
      title:        'Delete payout?',
      message:      `Remove ${formatCurrency(p.amount_paid)} dated ${p.paid_date}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger:       true,
    }))) return
    const { error } = await supabase
      .from('agency_commission_payouts')
      .delete()
      .eq('id', p.id)
    if (error) {
      toastError(error, 'Could not delete payout.')
      return
    }
    toastSuccess('Payout deleted.')
    await load()
    onSaved?.()
  }

  return (
    <div
      className="lead-modal-back"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.() }}
    >
      <div className="lead-modal" style={{ maxWidth: 560 }}>
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              Commission payout
            </div>
            <div className="lead-card-sub">
              {agency?.name} · {quote?.quote_number}{quote?.client ? ` · ${quote.client}` : ''}
            </div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          {/* Summary row — earned vs paid vs pending */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10, marginBottom: 14,
          }}>
            <SummaryTile label="Commission earned" value={earned} tone="accent" />
            <SummaryTile label="Already paid"      value={totalPaid} tone="ok" />
            <SummaryTile label="Pending"           value={pending} tone="muted" />
          </div>

          {err && (
            <div style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              borderRadius: 'var(--v2-r-sm, 10px)', padding: '10px 14px', fontSize: 13,
              marginBottom: 12,
            }}>
              {err}
            </div>
          )}

          {hasFull && (
            <div style={{
              background: 'var(--success-soft)',
              border: '1px solid var(--success)',
              color: 'var(--success)',
              borderRadius: 'var(--v2-r-sm, 10px)', padding: '10px 14px', fontSize: 13,
              marginBottom: 12,
            }}>
              Full payment already recorded. New entries appear in history but won&apos;t change the Paid state on the agency&apos;s ledger.
            </div>
          )}

          {/* Add-new form */}
          <form onSubmit={addPayout} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="lead-fld-label">Amount (₹)</label>
                <input
                  className="lead-inp"
                  type="number"
                  min="0"
                  step="1"
                  value={amount}
                  placeholder={pending > 0 ? String(Math.round(pending)) : 'e.g. 1000'}
                  onChange={e => setAmount(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="lead-fld-label">Paid date</label>
                <input
                  className="lead-inp"
                  type="date"
                  value={paidDate}
                  onChange={e => setPaidDate(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
            <div>
              <label className="lead-fld-label">Note (optional)</label>
              <input
                className="lead-inp"
                type="text"
                value={note}
                placeholder="e.g. 1st installment via NEFT"
                onChange={e => setNote(e.target.value)}
                disabled={saving}
              />
            </div>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 13, color: 'var(--v2-ink-1)',
            }}>
              <input
                type="checkbox"
                checked={isFull}
                onChange={e => setIsFull(e.target.checked)}
                disabled={saving}
              />
              Mark as full payment (closes this quote&apos;s commission)
            </label>
          </form>

          {/* History list */}
          <div style={{ marginTop: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
              color: 'var(--v2-ink-2)', textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Payout history
            </div>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--v2-ink-2)', fontSize: 13 }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Loading…
              </div>
            ) : payouts.length === 0 ? (
              <div style={{
                padding: 16, textAlign: 'center', fontSize: 12,
                color: 'var(--v2-ink-2)',
                border: '1px dashed var(--v2-line)',
                borderRadius: 10,
              }}>
                No payouts yet. Add the first one above.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {payouts.map(p => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    border: '1px solid var(--v2-line)',
                    borderRadius: 10,
                    background: 'var(--v2-bg-1)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontFamily: 'var(--v2-display)', fontWeight: 700,
                        fontSize: 14, color: 'var(--v2-ink-0)',
                      }}>
                        {formatCurrency(Number(p.amount_paid || 0))}
                        {p.is_full_payment && (
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            background: 'var(--success-soft)',
                            color: 'var(--success)',
                            border: '1px solid var(--success)',
                            padding: '2px 7px', borderRadius: 999,
                            letterSpacing: '.06em',
                          }}>FULL</span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 11, color: 'var(--v2-ink-2)',
                        marginTop: 2, display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <Calendar size={12} />
                        {p.paid_date}
                        {p.note ? ` · ${p.note}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePayout(p)}
                      title="Delete payout"
                      aria-label="Delete payout"
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--v2-line)',
                        color: 'var(--danger)',
                        borderRadius: 'var(--v2-r-sm, 10px)',
                        padding: 6,
                        cursor: 'pointer',
                        display: 'inline-flex',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onClose} disabled={saving} type="button">
            Close
          </button>
          <button
            className="lead-btn lead-btn-primary"
            onClick={addPayout}
            disabled={saving || !amount}
            type="button"
          >
            {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            <span>Save payout</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// Inline summary tile — 3-up grid inside the modal body. Brand-token only.
function SummaryTile({ label, value, tone }) {
  const color =
    tone === 'accent' ? 'var(--accent)' :
    tone === 'ok'     ? 'var(--success)' :
                        'var(--v2-ink-2)'
  return (
    <div style={{
      border: '1px solid var(--v2-line)',
      borderRadius: 10,
      padding: '10px 12px',
      background: 'var(--v2-bg-1)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
        color: 'var(--v2-ink-2)', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--v2-display)', fontWeight: 700,
        fontSize: 17, marginTop: 2,
        color,
      }}>{formatCurrency(Number(value || 0))}</div>
    </div>
  )
}
