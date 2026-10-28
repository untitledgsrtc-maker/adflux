// Phase 510 - Govt Auto Hood costing per deal (owner 2026-10-26).
// Cost lines (vendor / printing / installation / other) typed against ONE proposal. The Finance P&L deducts
// the total from Business Profit (finance_pnl_summary, supabase_phase510_quote_costs.sql). Admin + accounts
// edit; a government partner (co_owner) only reads. Money shown ex-GST: margin = quote value (subtotal) - cost.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Calculator, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../utils/formatters'
import { istTodayISO } from '../../utils/istDate'
import DateField from '../work/DateField'
import { confirmDialog } from '../v2/ConfirmDialog'
import { toastError, toastSuccess } from '../v2/Toast'

const KINDS = [
  { key: 'vendor', label: 'Vendor' },
  { key: 'printing', label: 'Printing' },
  { key: 'installation', label: 'Installation' },
  { key: 'other', label: 'Other' },
]
const kindLabel = (k) => KINDS.find(x => x.key === k)?.label || 'Other'
const box = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', padding: '10px 12px', minHeight: 44, fontSize: 14, width: '100%', boxSizing: 'border-box',
}

export default function QuoteCostingCard({ quote, canEdit }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)
  const [kind, setKind] = useState('vendor')
  const [vendor, setVendor] = useState('')
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(istTodayISO())
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const load = useCallback(async () => {
    if (!quote?.id) return
    setLoading(true)
    const { data, error } = await supabase.from('quote_costs').select('*')
      .eq('quote_id', quote.id).order('cost_date', { ascending: true }).order('created_at', { ascending: true })
    setLoadErr(!!error)
    if (!error) setRows(data || [])
    setLoading(false)
  }, [quote?.id])
  useEffect(() => { load() }, [load])

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const value = Number(quote?.subtotal) || 0
  const margin = value - total
  const pct = value > 0 ? Math.round((margin / value) * 1000) / 10 : null

  async function add() {
    if (savingRef.current) return
    const amt = Number(amount)
    if (!(amt > 0)) { toastError(null, 'Type an amount above 0.'); return }
    savingRef.current = true; setSaving(true)
    const { error } = await supabase.from('quote_costs').insert({
      quote_id: quote.id, kind, vendor: vendor.trim() || null, note: note.trim() || null,
      amount: amt, cost_date: date || istTodayISO(),
    })
    savingRef.current = false; setSaving(false)
    if (error) { toastError(error, 'Could not save the cost.'); return }
    setVendor(''); setNote(''); setAmount('')
    toastSuccess('Cost added. It now reduces Business Profit in Finance.')
    load()
  }

  async function remove(r) {
    const ok = await confirmDialog({
      title: 'Remove this cost?',
      message: `${kindLabel(r.kind)}${r.vendor ? ' - ' + r.vendor : ''}: ${formatCurrency(r.amount)}. Business Profit will go back up by this amount.`,
      confirmLabel: 'Remove', danger: true,
    })
    if (!ok) return
    const { data, error } = await supabase.from('quote_costs').delete().eq('id', r.id).select('id')
    if (error || !data?.length) { toastError(error, 'Could not remove the cost.'); return }
    load()
  }

  return (
    <div className="lead-card" style={{ marginBottom: 24 }}>
      <div className="lead-card-head">
        <div className="lead-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calculator size={16} /> Costing
        </div>
        <div className="lead-card-sub">What this deal costs us. Deducted from Business Profit in Finance.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '12px 0' }}>
        {[
          ['Quote value (ex-GST)', formatCurrency(value), 'var(--text)'],
          ['Total cost', formatCurrency(total), 'var(--warning)'],
          ['Margin', `${formatCurrency(margin)}${pct !== null ? ` · ${pct}%` : ''}`, margin >= 0 ? 'var(--success)' : 'var(--danger)'],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontVariantNumeric: 'tabular-nums', color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {loadErr ? (
        <div style={{ color: 'var(--danger)', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center' }}>
          Could not load the costs. <button type="button" className="lead-btn lead-btn-sm" onClick={load}>Retry</button>
        </div>
      ) : loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>No cost added yet. Add the vendor, printing and installation cost for this deal.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--text)' }}>{kindLabel(r.kind)}{r.vendor ? ` - ${r.vendor}` : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {r.cost_date ? `${r.cost_date.slice(8, 10)}/${r.cost_date.slice(5, 7)}/${r.cost_date.slice(0, 4)}` : ''}{r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{formatCurrency(r.amount)}</div>
              {canEdit && (
                <button type="button" aria-label="Remove cost" className="lead-btn lead-btn-sm" onClick={() => remove(r)} style={{ minWidth: 44 }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <select value={kind} onChange={e => setKind(e.target.value)} style={box} aria-label="Type of cost">
            {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor name (optional)" style={box} />
          <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Amount (Rs)" style={box} />
          <DateField value={date} onChange={e => setDate(e.target.value)} style={{ ...box, display: 'block' }} className="" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" style={{ ...box, gridColumn: '1 / -1' }} />
          <button type="button" className="lead-btn lead-btn-primary" onClick={add} disabled={saving} style={{ minHeight: 44, gridColumn: '1 / -1' }}>
            <Plus size={14} /> {saving ? 'Saving...' : 'Add cost'}
          </button>
        </div>
      )}
    </div>
  )
}
