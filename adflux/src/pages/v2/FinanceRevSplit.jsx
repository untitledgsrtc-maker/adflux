// Finance -> Rev split tab (owner 2026-10-28). Profit of each WON Government deal (Auto Hood + GSRTC LED)
// split between the two partners (default Vishal 35% / Brijesh 65%). Profit per deal = order value (ex-GST)
// - commission (dept expense) - vendor costing - TDS withheld, same as the owner's sheet. Tick the deals to
// include; totals, the split and the Excel export follow the ticks. Read-only: nothing is written.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Loader2, Download, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError } from '../../components/v2/Toast'

const money = (n) => (n == null || isNaN(n) ? '—' : (n < 0 ? '−₹' : '₹') + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(n))))
const dmy = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : s }
const th = { padding: '10px 10px', fontSize: 12, textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }
const td = { padding: '10px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

async function pagedQuotes() {
  const PAGE = 1000; let all = []; let from = 0
  for (;;) {
    const { data, error } = await supabase.from('quotes')
      .select('id, quote_number, client_company, client_name, media_type, subtotal, total_amount, created_by, campaign_start_date, campaign_end_date')
      .eq('segment', 'GOVERNMENT').eq('status', 'won').in('media_type', ['AUTO_HOOD', 'GSRTC_LED'])
      .order('created_at', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw error
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE; if (from >= 5000) break
  }
  return all
}

export default function FinanceRevSplit() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [picked, setPicked] = useState(null)       // Set of quote ids; null = all
  const [vishal, setVishal] = useState(35)
  const [media, setMedia] = useState('all')
  const [pay, setPay] = useState('all')          // all | Paid | Part paid | Not paid
  const [bank, setBank] = useState({})            // media -> bank direct cost (vendor / capital / lump sums)

  const load = useCallback(async () => {
    setLoading(true); setErr(false)
    try {
      const qs = await pagedQuotes()
      const ids = qs.map(q => q.id)
      const pays = [], costs = [], lines = []
      for (const part of chunk(ids, 120)) {
        const [p, c, l] = await Promise.all([
          supabase.from('payments').select('quote_id, amount_received, commission_amount, tds_amount, payment_date').eq('approval_status', 'approved').in('quote_id', part),
          supabase.from('quote_costs').select('quote_id, amount').in('quote_id', part),
          supabase.from('quote_cities').select('quote_id, qty').in('quote_id', part),
        ])
        if (p.error || c.error || l.error) throw (p.error || c.error || l.error)
        pays.push(...(p.data || [])); costs.push(...(c.data || [])); lines.push(...(l.data || []))
      }
      // direct costs paid from the bank per media (GSRTC capital investment + lump sums etc.); not tied to one deal
      const { data: bk, error: bke } = await supabase.from('finance_transactions').select('media_type, amount')
        .eq('direction', 'out').eq('bucket', 'direct_cost').in('media_type', ['AUTO_HOOD', 'GSRTC_LED']).limit(5000)
      if (bke) throw bke
      setBank((bk || []).reduce((m, r) => ((m[r.media_type] = (m[r.media_type] || 0) + (Number(r.amount) || 0)), m), {}))
      const creators = [...new Set(qs.map(q => q.created_by).filter(Boolean))]
      const { data: us } = creators.length ? await supabase.from('users').select('id, role, agency_commission_percent').in('id', creators) : { data: [] }
      const uMap = Object.fromEntries((us || []).map(u => [u.id, u]))
      const by = (arr) => arr.reduce((m, r) => ((m[r.quote_id] = m[r.quote_id] || []).push(r), m), {})
      const P = by(pays), C = by(costs), L = by(lines)
      setDeals(qs.map(q => {
        const pp = P[q.id] || []
        const order = Number(q.subtotal) || 0
        const received = pp.reduce((s, r) => s + (Number(r.amount_received) || 0), 0)
        const u = uMap[q.created_by]
        // agency-made deal: commission = share collected x subtotal x the agency user's % (default 5), same as Finance P&L
        const comm = u?.role === 'agency' && Number(q.total_amount) > 0
          ? pp.reduce((s, r) => s + (Number(r.amount_received) / Number(q.total_amount)) * order * (u.agency_commission_percent ?? 5) / 100, 0)
          : pp.reduce((s, r) => s + (Number(r.commission_amount) || 0), 0)
        const vendor = (C[q.id] || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
        const tds = pp.reduce((s, r) => s + (Number(r.tds_amount) || 0), 0)
        const last = pp.map(r => r.payment_date).filter(Boolean).sort().pop() || ''
        const status = !pp.length ? 'Not paid' : received >= Number(q.total_amount) * 0.999 ? 'Paid' : 'Part paid'
        return {
          id: q.id, no: q.quote_number, dept: q.client_company || q.client_name || '—', media: q.media_type,
          qty: (L[q.id] || []).reduce((s, r) => s + (Number(r.qty) || 0), 0), start: q.campaign_start_date, end: q.campaign_end_date,
          order, comm, commPct: order > 0 ? (comm / order) * 100 : 0, vendor, tds, profit: order - comm - vendor - tds, last, status,
        }
      }))
    } catch (e) { setErr(true); toastError(e, 'Could not load the deals.') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => deals.filter(d => (media === 'all' || d.media === media) && (pay === 'all' || d.status === pay)), [deals, media, pay])
  const isOn = (id) => (picked ? picked.has(id) : true)
  const toggle = (id) => setPicked(prev => { const s = new Set(prev || deals.map(d => d.id)); s.has(id) ? s.delete(id) : s.add(id); return s })
  const sel = shown.filter(d => isOn(d.id))
  const sum = (k) => sel.reduce((s, d) => s + d[k], 0)
  const tot = { order: sum('order'), comm: sum('comm'), vendor: sum('vendor'), tds: sum('tds'), profit: sum('profit') }
  const mediaOn = ['AUTO_HOOD', 'GSRTC_LED'].filter(m => sel.some(d => d.media === m))
  const expLines = mediaOn.map(m => [m === 'AUTO_HOOD' ? 'Auto Hood bank expenses' : 'GSRTC LED bank expenses', bank[m] || 0])
  const exp = expLines.reduce((s, l) => s + l[1], 0)
  const net = tot.profit - exp
  const v = Math.min(100, Math.max(0, Number(vishal) || 0))
  const vShare = net * v / 100, bShare = net - vShare

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const head = ['No', 'Quote', 'Department', 'Media', 'Quantity', 'Start date', 'End date', 'Order amount (ex-GST)', 'Dept expense', 'Dept exp %', 'Vendor', 'TDS', 'Profit', 'Last payment', 'Status']
    const rows = sel.map((d, i) => [i + 1, d.no, d.dept, d.media === 'AUTO_HOOD' ? 'Auto Hood' : 'GSRTC LED', d.qty, dmy(d.start), dmy(d.end), Math.round(d.order), Math.round(d.comm), Math.round(d.commPct * 10) / 10 + '%', Math.round(d.vendor), Math.round(d.tds), Math.round(d.profit), dmy(d.last), d.status])
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows, [],
      ['', '', 'TOTAL', '', '', '', '', Math.round(tot.order), Math.round(tot.comm), '', Math.round(tot.vendor), Math.round(tot.tds), Math.round(tot.profit)],
      ...expLines.map(l => ['', '', l[0], '', '', '', '', '', '', '', '', '', -Math.round(l[1])]),
      ['', '', 'PROFIT AFTER EXPENSES', '', '', '', '', '', '', '', '', '', Math.round(net)],
      [], ['', '', 'VISHAL', v + '%', Math.round(vShare)], ['', '', 'BRIJESH', (100 - v) + '%', Math.round(bShare)]])
    ws['!cols'] = [6, 22, 40, 11, 10, 12, 12, 18, 14, 10, 14, 12, 14, 13, 10].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rev split')
    XLSX.writeFile(wb, `rev-split-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const chip = (on) => ({ padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: '1px solid var(--border)',
    background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)', fontWeight: 600 })

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 size={18} className="spin" /> Loading deals…</div>
  if (err) return <div className="lead-card" style={{ color: 'var(--danger)' }}>Could not load. <button type="button" className="lead-btn lead-btn-sm" onClick={load}>Retry</button></div>

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['all', 'All Government'], ['AUTO_HOOD', 'Auto Hood'], ['GSRTC_LED', 'GSRTC LED']].map(([k, l]) => <button key={k} type="button" style={chip(media === k)} onClick={() => setMedia(k)}>{l}</button>)}
        <span style={{ width: 1, height: 24, background: 'var(--border)' }} />
        {[['all', 'Any payment'], ['Paid', 'Paid only'], ['Part paid', 'Part paid'], ['Not paid', 'Not paid']].map(([k, l]) => <button key={k} type="button" style={chip(pay === k)} onClick={() => setPay(k)}>{l}</button>)}
        <span style={{ flex: 1 }} />
        <button type="button" className="lead-btn lead-btn-sm" onClick={() => setPicked(new Set(shown.map(d => d.id)))}>Tick all</button>
        <button type="button" className="lead-btn lead-btn-sm" onClick={() => setPicked(new Set())}>Untick all</button>
        <button type="button" className="lead-btn lead-btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
        <button type="button" className="lead-btn lead-btn-primary" disabled={!sel.length} onClick={exportXlsx}><Download size={14} /> Excel ({sel.length})</button>
      </div>

      <div className="lead-card" style={{ overflowX: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr>
            <th style={th} />{['Department', 'Qty', 'Start', 'End', 'Order (ex-GST)', 'Dept exp', 'Vendor', 'TDS', 'Profit', 'Last payment', 'Status'].map((h, i) => <th key={h} style={{ ...th, textAlign: i >= 3 && i <= 8 ? 'right' : 'left' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {shown.map(d => (
              <tr key={d.id} style={{ opacity: isOn(d.id) ? 1 : 0.45 }}>
                <td style={td}><input type="checkbox" checked={isOn(d.id)} onChange={() => toggle(d.id)} aria-label={'Include ' + d.no} /></td>
                <td style={{ ...td, whiteSpace: 'normal', minWidth: 220 }}>{d.dept}<div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{d.no} · {d.media === 'AUTO_HOOD' ? 'Auto Hood' : 'GSRTC LED'}</div></td>
                <td style={tdR}>{d.qty || '—'}</td><td style={td}>{dmy(d.start) || '—'}</td><td style={td}>{dmy(d.end) || '—'}</td>
                <td style={tdR}>{money(d.order)}</td>
                <td style={tdR}>{money(d.comm)}<div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{Math.round(d.commPct)}%</div></td>
                <td style={tdR}>{money(d.vendor)}</td><td style={tdR}>{money(d.tds)}</td>
                <td style={{ ...tdR, color: d.profit >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{money(d.profit)}</td>
                <td style={td}>{dmy(d.last) || '—'}</td>
                <td style={td}><span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, background: d.status === 'Paid' ? 'var(--success-soft)' : 'var(--warning-soft)', color: d.status === 'Paid' ? 'var(--success)' : 'var(--warning)' }}>{d.status}</span></td>
              </tr>
            ))}
            {!shown.length && <tr><td style={{ ...td, textAlign: 'center', color: 'var(--text-subtle)' }} colSpan={12}>No won Government deals yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px,100%),1fr))', gap: 10 }}>
        {[['Order value', tot.order, 'var(--text)'], ['Dept expense', tot.comm, 'var(--warning)'], ['Vendor', tot.vendor, 'var(--warning)'], ['TDS', tot.tds, 'var(--warning)'], ['Deals profit', tot.profit, tot.profit >= 0 ? 'var(--success)' : 'var(--danger)'], ...expLines.map(l => [l[0], l[1], 'var(--warning)']), ['Profit after expenses', net, net >= 0 ? 'var(--success)' : 'var(--danger)']].map(([l, n, c]) => (
          <div key={l} className="lead-card" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: c, fontVariantNumeric: 'tabular-nums' }}>{money(n)}</div>
          </div>))}
      </div>

      <div className="lead-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px,100%),1fr))', gap: 12 }}>
        <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>VISHAL share %</div>
          <input type="number" min="0" max="100" value={vishal} onChange={e => setVishal(e.target.value)} style={{ width: 90, padding: '8px 10px', borderRadius: 'var(--radius)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', minHeight: 44, boxSizing: 'border-box' }} />
          <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 13 }}>Brijesh {100 - v}%</span></div>
        <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Vishal gets</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--accent)' }}>{money(vShare)}</div></div>
        <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Brijesh gets</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--accent)' }}>{money(bShare)}</div></div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Profit = order value (ex-GST) − dept expense (commission) − vendor costing − TDS withheld, on payments received so far. Bank expenses = direct costs paid from the bank for that media (e.g. the GSRTC capital investment and lump sums), taken off once as a whole because they are not tied to one deal. Office / common expenses are not taken off.</div>
    </div>
  )
}
