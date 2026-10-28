// Finance -> Rev split tab (owner 2026-10-28). Profit of each WON Government deal (Auto Hood + GSRTC LED)
// split between the two partners (default Vishal 35% / Brijesh 65%). Profit per deal = order value (ex-GST)
// - commission (dept expense) - vendor costing - TDS withheld, same as the owner's sheet. Tick the deals to
// include; totals, the split and the Excel export follow the ticks. Read-only: nothing is written.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Loader2, Download, RefreshCw, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError } from '../../components/v2/Toast'
import SegmentToggle from '../../components/v2/SegmentToggle'
import { savePdfBlob } from '../../utils/savePdf'

const money = (n) => (n == null || isNaN(n) ? '—' : (n < 0 ? '−₹' : '₹') + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(n))))
const dmy = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : s }
const th = { padding: '11px 10px', fontSize: 12, textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }
const td = { padding: '10px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }
const MEDIA_LBL = { AUTO_HOOD: 'Auto Hood', GSRTC_LED: 'GSRTC LED', LED_OTHER: 'Pvt LED' }
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

async function pagedQuotes() {
  const PAGE = 1000; let all = []; let from = 0
  for (;;) {
    const { data, error } = await supabase.from('quotes')
      .select('id, quote_number, client_company, client_name, media_type, subtotal, total_amount, created_by, campaign_start_date, campaign_end_date')
      .eq('status', 'won').or('and(segment.eq.GOVERNMENT,media_type.in.(AUTO_HOOD,GSRTC_LED)),and(segment.eq.PRIVATE,media_type.eq.LED_OTHER)')
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
  const [common, setCommon] = useState({ cost: 0, income: 0 })   // org-wide office expense + total collected income (from the P&L)
  const [useCommon, setUseCommon] = useState(true)
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
        .eq('direction', 'out').eq('bucket', 'direct_cost').in('media_type', ['AUTO_HOOD', 'GSRTC_LED', 'LED_OTHER']).limit(5000)
      if (bke) throw bke
      setBank((bk || []).reduce((m, r) => ((m[r.media_type] = (m[r.media_type] || 0) + (Number(r.amount) || 0)), m), {}))
      const { data: pl } = await supabase.rpc('finance_pnl_summary', { p_from: null, p_to: null, p_segment: null, p_media: null })
      setCommon({ cost: Number(pl?.common_expense) || 0, income: Number(pl?.income) || 0 })
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
          inc: Number(q.total_amount) > 0 ? received * order / Number(q.total_amount) : 0,
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
  const mediaOn = ['AUTO_HOOD', 'GSRTC_LED', 'LED_OTHER'].filter(m => sel.some(d => d.media === m))
  const expLines = mediaOn.map(m => [(MEDIA_LBL[m]) + ' bank expenses', bank[m] || 0])
  const exp = expLines.reduce((s, l) => s + l[1], 0)
  const incSel = sel.reduce((s, d) => s + d.inc, 0)
  const commonShare = useCommon && common.income > 0 ? common.cost * Math.min(1, incSel / common.income) : 0
  const net = tot.profit - exp - commonShare
  const v = Math.min(100, Math.max(0, Number(vishal) || 0))
  const vShare = net * v / 100, bShare = net - vShare

  async function exportPdf() {
    try {
      const { buildRevSplitBlob } = await import('./RevSplitPDF')
      const on = new Date().toLocaleDateString('en-GB')
      const blob = await buildRevSplitBlob({
        on, v, vShare, bShare, net, useCommon, commonShare, expLines, tot, deals: sel,
        filterLabel: `${media === 'all' ? 'All deals' : MEDIA_LBL[media]} - ${pay === 'all' ? 'any payment' : pay}`,
      })
      await savePdfBlob(blob, `rev-split-${new Date().toISOString().slice(0, 10)}.pdf`, { title: 'Revenue split report' })
    } catch (e) { toastError(e, 'Could not make the PDF.') }
  }

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const head = ['No', 'Quote', 'Department', 'Media', 'Quantity', 'Start date', 'End date', 'Order amount (ex-GST)', 'Dept expense', 'Dept exp %', 'Vendor', 'TDS', 'Profit', 'Last payment', 'Status']
    const rows = sel.map((d, i) => [i + 1, d.no, d.dept, MEDIA_LBL[d.media], d.qty, dmy(d.start), dmy(d.end), Math.round(d.order), Math.round(d.comm), Math.round(d.commPct * 10) / 10 + '%', Math.round(d.vendor), Math.round(d.tds), Math.round(d.profit), dmy(d.last), d.status])
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows, [],
      ['', '', 'TOTAL', '', '', '', '', Math.round(tot.order), Math.round(tot.comm), '', Math.round(tot.vendor), Math.round(tot.tds), Math.round(tot.profit)],
      ...expLines.map(l => ['', '', l[0], '', '', '', '', '', '', '', '', '', -Math.round(l[1])]),
      ...(commonShare ? [['', '', 'Common expense share', '', '', '', '', '', '', '', '', '', -Math.round(commonShare)]] : []),
      ['', '', 'PROFIT AFTER EXPENSES', '', '', '', '', '', '', '', '', '', Math.round(net)],
      [], ['', '', 'VISHAL', v + '%', Math.round(vShare)], ['', '', 'BRIJESH', (100 - v) + '%', Math.round(bShare)]])
    ws['!cols'] = [6, 22, 40, 11, 10, 12, 12, 18, 14, 10, 14, 12, 14, 13, 10].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rev split')
    XLSX.writeFile(wb, `rev-split-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }
  const lbl = { fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 700, marginBottom: 6 }
  const dim = (n) => (Math.round(n) === 0 ? <span style={{ color: 'var(--text-subtle)' }}>—</span> : money(n))
  const stChip = (st) => ({ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
    background: st === 'Paid' ? 'var(--success-soft)' : st === 'Part paid' ? 'var(--warning-soft)' : 'var(--danger-soft)',
    color: st === 'Paid' ? 'var(--success)' : st === 'Part paid' ? 'var(--warning)' : 'var(--danger)' })
  const mediaOpts = [{ k: 'all', label: 'All deals' }, { k: 'AUTO_HOOD', label: 'Auto Hood' }, { k: 'GSRTC_LED', label: 'GSRTC LED' }, { k: 'LED_OTHER', label: 'Pvt LED' }]
  const payOpts = [{ k: 'all', label: 'Any payment' }, { k: 'Paid', label: 'Paid' }, { k: 'Part paid', label: 'Part paid' }, { k: 'Not paid', label: 'Not paid' }]
  const steps = [['Order value (ex-GST)', tot.order, false], ['Dept expense (commission)', -tot.comm, true], ['Vendor costing', -tot.vendor, true], ['TDS withheld', -tot.tds, true]]
  const byMedia = ['AUTO_HOOD', 'GSRTC_LED', 'LED_OTHER'].map(m => { const r = sel.filter(d => d.media === m); return { m, n: r.length, order: r.reduce((a, d) => a + d.order, 0), profit: r.reduce((a, d) => a + d.profit, 0) } }).filter(x => x.n)
  const wRow = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><Loader2 size={18} className="spin" /> Loading deals…</div>
  if (err) return <div className="lead-card" style={{ color: 'var(--danger)' }}>Could not load. <button type="button" className="lead-btn lead-btn-sm" onClick={load}>Retry</button></div>

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {/* hero: the answer + the two shares */}
      <div style={{ borderRadius: 16, padding: 22, display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px,100%), 1fr))',
        background: 'radial-gradient(420px 160px at 100% 0%, rgba(255,230,0,.20), transparent 60%), linear-gradient(135deg, #0d3d3a 0%, #134e4a 55%, #0f766e 100%)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, letterSpacing: '.1em', color: '#a7c4c0', fontWeight: 700 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} /> REVENUE SPLIT · {sel.length} OF {shown.length} DEALS
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 44, lineHeight: 1.1, fontWeight: 700, color: net >= 0 ? 'var(--accent)' : '#fca5a5', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{money(net)}</div>
          <div style={{ fontSize: 13, color: '#a7c4c0', marginTop: 4 }}>profit after expenses, shared between the partners</div>
        </div>
        {[['VISHAL', v, vShare], ['BRIJESH', 100 - v, bShare]].map(([n, pct, amt], i) => (
          <div key={n} style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, letterSpacing: '.1em', color: '#a7c4c0', fontWeight: 700 }}>{n}</span>
              {i === 0
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#fff', fontSize: 13 }}>
                    <input type="number" min="0" max="100" value={vishal} onChange={e => setVishal(e.target.value)} aria-label="Vishal share percent"
                      style={{ width: 62, padding: '6px 8px', minHeight: 36, borderRadius: 8, background: 'rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', boxSizing: 'border-box' }} />%
                  </span>
                : <span style={{ color: '#fff', fontSize: 13 }}>{pct}%</span>}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#fff', marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>{money(amt)}</div>
          </div>
        ))}
      </div>

      {/* filters + actions */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', padding: 14 }}>
        <div><div style={lbl}>Media</div><SegmentToggle value={media} onChange={setMedia} opts={mediaOpts} style={{ marginBottom: 0 }} /></div>
        <div><div style={lbl}>Payment</div><SegmentToggle value={pay} onChange={setPay} opts={payOpts} style={{ marginBottom: 0 }} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-muted)', minHeight: 44 }}>
          <input type="checkbox" checked={useCommon} onChange={e => setUseCommon(e.target.checked)} /> Deduct common expense
        </label>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="lead-btn" onClick={() => setPicked(new Set(shown.map(d => d.id)))}>Tick all</button>
          <button type="button" className="lead-btn" onClick={() => setPicked(new Set())}>Untick all</button>
          <button type="button" className="lead-btn" onClick={load} aria-label="Refresh"><RefreshCw size={16} /></button>
          <button type="button" className="lead-btn" disabled={!sel.length} onClick={exportXlsx}><Download size={16} /> Excel</button>
          <button type="button" className="lead-btn lead-btn-primary" disabled={!sel.length} onClick={exportPdf}><FileText size={16} /> Download PDF</button>
        </div>
      </div>

      {/* how it is worked out + by media */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px,100%), 1fr))' }}>
        <div style={card}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>How the profit is worked out</div>
          {steps.map(([l, n, less]) => (<div key={l} style={wRow}><span style={{ color: 'var(--text-muted)' }}>{less ? 'less  ' : ''}{l}</span><b style={{ fontFamily: 'var(--font-display)', color: less ? 'var(--warning)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{money(n)}</b></div>))}
          <div style={wRow}><b>Deals profit</b><b style={{ fontFamily: 'var(--font-display)', color: tot.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(tot.profit)}</b></div>
          {expLines.map(([l, n]) => (<div key={l} style={wRow}><span style={{ color: 'var(--text-muted)' }}>less  {l}</span><b style={{ fontFamily: 'var(--font-display)', color: 'var(--warning)' }}>{money(-n)}</b></div>))}
          {useCommon && <div style={wRow}><span style={{ color: 'var(--text-muted)' }}>less  Common expense share</span><b style={{ fontFamily: 'var(--font-display)', color: 'var(--warning)' }}>{money(-commonShare)}</b></div>}
          <div style={{ ...wRow, borderBottom: 'none', borderTop: '2px solid var(--text)', marginTop: 4, fontSize: 16 }}><b>Profit after expenses</b><b style={{ fontFamily: 'var(--font-display)', color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(net)}</b></div>
        </div>
        <div style={card}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>By media</div>
          <div style={{ ...wRow, color: 'var(--text-subtle)', fontSize: 12 }}><span style={{ flex: 1.2 }}>Media</span><span style={{ flex: 0.5, textAlign: 'right' }}>Deals</span><span style={{ flex: 1.2, textAlign: 'right' }}>Order value</span><span style={{ flex: 1.2, textAlign: 'right' }}>Profit</span></div>
          {byMedia.map(x => (<div key={x.m} style={wRow}><span style={{ flex: 1.2 }}>{MEDIA_LBL[x.m]}</span><span style={{ flex: 0.5, textAlign: 'right' }}>{x.n}</span><span style={{ flex: 1.2, textAlign: 'right', fontFamily: 'var(--font-display)' }}>{money(x.order)}</span><b style={{ flex: 1.2, textAlign: 'right', fontFamily: 'var(--font-display)', color: x.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(x.profit)}</b></div>))}
          {!byMedia.length && <div style={{ color: 'var(--text-subtle)', padding: '14px 0' }}>Tick at least one deal.</div>}
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 12, lineHeight: 1.5 }}>Deal profit = order value (ex-GST) − dept expense (commission) − vendor costing − TDS, on payments received so far. Bank expenses (e.g. the GSRTC capital investment) come off once for the whole media; common expense follows the income share of the ticked deals.</div>
        </div>
      </div>

      {/* deals */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>Deals</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{sel.length} ticked of {shown.length}</div>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '62vh' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 980 }}>
            <thead><tr>
              <th style={{ ...th, width: 40 }} />{['Department', 'Qty', 'Period', 'Order (ex-GST)', 'Dept exp', 'Vendor', 'TDS', 'Profit', 'Last payment', 'Status'].map((h, i) => <th key={h} style={{ ...th, textAlign: i >= 3 && i <= 7 ? 'right' : 'left' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map(d => (
                <tr key={d.id} style={{ opacity: isOn(d.id) ? 1 : 0.4 }}>
                  <td style={td}><input type="checkbox" checked={isOn(d.id)} onChange={() => toggle(d.id)} aria-label={'Include ' + d.no} /></td>
                  <td style={{ ...td, whiteSpace: 'normal', minWidth: 230 }}>{d.dept}<div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{d.no} · {MEDIA_LBL[d.media]}</div></td>
                  <td style={tdR}>{d.qty || <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{d.start ? dmy(d.start) + ' – ' + dmy(d.end) : '—'}</td>
                  <td style={tdR}>{money(d.order)}</td>
                  <td style={tdR}>{dim(d.comm)}</td><td style={tdR}>{dim(d.vendor)}</td><td style={tdR}>{dim(d.tds)}</td>
                  <td style={{ ...tdR, color: d.profit >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{money(d.profit)}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{dmy(d.last) || '—'}</td>
                  <td style={td}><span style={stChip(d.status)}>{d.status}</span></td>
                </tr>
              ))}
              {!shown.length && <tr><td style={{ ...td, textAlign: 'center', color: 'var(--text-subtle)', padding: 30 }} colSpan={11}>No deals match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
