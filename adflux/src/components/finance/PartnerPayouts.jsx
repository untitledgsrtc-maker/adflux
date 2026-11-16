// src/components/finance/PartnerPayouts.jsx
//
// Phase 580 — "Paid to Vishal" on Finance -> Rev split (admin only).
// Records each payout of the partner share (date, amount, how, note) together
// with the deals ticked at that moment, so Rev split can mark those deals
// "Settled" and warn before the same deal is paid twice.
// Table: partner_payouts (supabase_phase580_partner_payouts.sql). No edit:
// a wrong entry is deleted and entered again.

import { useRef, useState } from 'react'
import { Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'
import { confirmDialog } from '../v2/ConfirmDialog'
import { istTodayISO } from '../../utils/istDate'

const money = (n) => '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(n) || 0))
const dmy = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${y}` }
const METHODS = [['bank', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque']]

export default function PartnerPayouts({ payouts, selIds, settledIds, vShare, sharePct, onChanged, onTickUnsettled }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(istTodayISO())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('bank')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)   // section 47 latch: one tap = one payout row

  const total = payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const last = payouts[0]
  const alreadySettled = selIds.filter((id) => settledIds.has(id)).length

  function startNew() {
    setDate(istTodayISO())
    setAmount(vShare > 0 ? String(Math.round(vShare)) : '')
    setMethod('bank'); setNote(''); setOpen(true)
  }

  async function save() {
    if (savingRef.current || saving) return
    const amt = Number(amount)
    if (!date) { toastError(null, 'Pick the payment date.'); return }
    if (!(amt > 0)) { toastError(null, 'Enter an amount above zero.'); return }
    if (alreadySettled > 0) {
      const ok = await confirmDialog({
        title: 'Some deals are already settled',
        message: `${alreadySettled} of the ticked deals were already included in an earlier payout. Record this payout anyway?`,
        confirmLabel: 'Record anyway',
      })
      if (!ok) return
    }
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    const { error } = await supabase.from('partner_payouts').insert({
      partner: 'vishal', paid_on: date, amount: Math.round(amt * 100) / 100, method,
      note: note.trim() || null, share_pct: sharePct, quote_ids: selIds,
    })
    setSaving(false); savingRef.current = false
    if (error) { toastError(error, 'Could not save the payout.'); return }
    toastSuccess(`Payout of ${money(amt)} recorded.`)
    setOpen(false)
    onChanged()
  }

  async function remove(p) {
    const ok = await confirmDialog({
      title: 'Delete this payout?',
      message: `Delete the ${money(p.amount)} payout of ${dmy(p.paid_on)}? Its ${p.quote_ids?.length || 0} deals will show as not settled again.`,
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('partner_payouts').delete().eq('id', p.id)
    if (error) { toastError(error, 'Could not delete the payout.'); return }
    toastSuccess('Payout deleted.')
    onChanged()
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }
  const lbl = { fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 700, marginBottom: 6 }
  const input = { minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box', width: '100%' }

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>Paid to Vishal</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {payouts.length
              ? <>Total paid <b style={{ fontFamily: 'var(--font-display)', color: 'var(--text)' }}>{money(total)}</b> in {payouts.length} payment{payouts.length === 1 ? '' : 's'} · last {dmy(last.paid_on)}</>
              : 'No payouts recorded yet.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="lead-btn" onClick={onTickUnsettled}>Tick unsettled deals</button>
          <button type="button" className="lead-btn lead-btn-primary" onClick={startNew} disabled={open}><Plus size={16} /> Record payout</button>
        </div>
      </div>

      {alreadySettled > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 13 }}>
          <AlertTriangle size={16} /> {alreadySettled} of the ticked deals are already settled. Tap "Tick unsettled deals" to see what is still due.
        </div>
      )}

      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))', alignItems: 'end' }}>
          <div><div style={lbl}>Date</div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} aria-label="Payout date" /></div>
          <div><div style={lbl}>Amount (₹)</div><input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} aria-label="Payout amount" /></div>
          <div><div style={lbl}>Paid by</div>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={input} aria-label="Payment method">
              {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>Note (optional)</div><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UTR number, which month" style={input} aria-label="Payout note" /></div>
          <div style={{ gridColumn: '1 / -1', fontSize: 13, color: 'var(--text-muted)' }}>
            Settles the {selIds.length} ticked deal{selIds.length === 1 ? '' : 's'} at {sharePct}% (share shown above: {money(vShare)}).
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="lead-btn" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className="lead-btn lead-btn-primary" onClick={save} disabled={saving}>
              {saving ? <><Loader2 size={16} className="spin" /> Saving…</> : 'Save payout'}
            </button>
          </div>
        </div>
      )}

      {payouts.length > 0 && (
        <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
          {payouts.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 14 }}>
              <span style={{ minWidth: 90, color: 'var(--text-muted)' }}>{dmy(p.paid_on)}</span>
              <b style={{ minWidth: 110, fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }}>{money(p.amount)}</b>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(METHODS.find(([k]) => k === p.method) || [null, '—'])[1]} · {p.quote_ids?.length || 0} deals{p.share_pct != null ? ` · ${Number(p.share_pct)}%` : ''}{p.note ? ` · ${p.note}` : ''}
              </span>
              <button type="button" className="lead-btn lead-btn-sm" onClick={() => remove(p)} aria-label="Delete payout"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
