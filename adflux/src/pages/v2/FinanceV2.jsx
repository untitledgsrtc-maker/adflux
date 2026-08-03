// =============================================================================
// FinanceV2 — Finance / P&L module (spec: docs/FINANCE_MODULE_SPEC.md, CLAUDE.md §155)
// Additive, admin + accounts + co_owner(Vishal govt-scoped). Tabs: Owner P&L ·
// Register · Import. Income = CRM (finance_pnl_summary RPC); costs from the bank
// ledger (finance_transactions). §66: P&L totals come from the server RPC, the
// Register pages the raw rows with .range().
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, ListChecks, Upload, TrendingUp, TrendingDown, BarChart3,
  AlertTriangle, Loader2, Repeat, Search, IndianRupee,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { formatCompact } from '../../utils/formatters'

/* ── helpers ── */
function fmtINR(n) {
  if (n == null || isNaN(n)) return '—'
  const v = Math.round(Number(n))
  return (v < 0 ? '−₹' : '₹') + new Intl.NumberFormat('en-IN').format(Math.abs(v))
}
const BUCKETS = [
  ['income', 'Income'], ['direct_cost', 'Direct cost'], ['common_expense', 'Common expense'],
  ['owner_drawings', 'Owner drawings'], ['investment', 'Investment'], ['asset', 'Asset'],
  ['loan_in', 'Loan in'], ['loan_out', 'Loan out'], ['internal_transfer', 'Internal transfer'],
  ['tax', 'Tax'], ['review', 'Review'],
]
const BUCKET_LABEL = Object.fromEntries(BUCKETS)
const SEGMENTS = [['GOVERNMENT', 'Government'], ['PRIVATE', 'Private']]

/* ── page shell ── */
export default function FinanceV2() {
  const profile = useAuthStore(s => s.profile)
  const canView = ['admin', 'co_owner', 'accounts'].includes(profile?.role)
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'pnl'
  const [seg, setSeg] = useState('all') // all | GOVERNMENT | PRIVATE

  const setTab = (t) => { const n = new URLSearchParams(sp); n.set('tab', t); setSp(n, { replace: true }) }

  if (!canView) {
    return <div className="v2d-page"><div className="v2d-empty-card">Finance is for admin + accounts only.</div></div>
  }

  const TABS = [
    { key: 'pnl', label: 'Owner · P&L', icon: LayoutDashboard },
    { key: 'register', label: 'Register', icon: ListChecks },
    { key: 'import', label: 'Import', icon: Upload },
  ]

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Untitled Group · Consolidated</div>
          <h1 className="v2d-page-title">Finance</h1>
          <div className="v2d-page-sub">Real P&amp;L from your bank ledger + CRM income. You + Accounts see all · Vishal (co-owner) Government only.</div>
        </div>
        <div style={{ display: 'flex', gap: 3, background: 'var(--v2-bg-2, #1a2742)', borderRadius: 999, padding: 3, alignSelf: 'flex-start' }}>
          {[['all', 'All'], ...SEGMENTS].map(([k, l]) => (
            <span key={k} onClick={() => setSeg(k)}
              style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                background: seg === k ? 'var(--v2-yellow, #FFE600)' : 'transparent',
                color: seg === k ? 'var(--v2-yellow-ink, #0b1220)' : 'var(--v2-ink-2, #6a7590)' }}>{l}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--v2-line, #1f2b47)', margin: '4px 0 18px' }}>
        {TABS.map(t => {
          const on = tab === t.key
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', fontSize: 13, fontWeight: 600,
                background: 'transparent', border: 'none', cursor: 'pointer', marginBottom: -1,
                color: on ? 'var(--v2-ink-0, #f5f7fb)' : 'var(--v2-ink-2, #6a7590)',
                borderBottom: on ? '2px solid var(--v2-yellow, #FFE600)' : '2px solid transparent' }}>
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'pnl' && <PnlTab seg={seg} />}
      {tab === 'register' && <RegisterTab seg={seg} onGoReview={() => setTab('register')} />}
      {tab === 'import' && <ImportTab />}
    </div>
  )
}

/* ── card ── */
function Card({ children, style }) {
  return <div style={{ background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, padding: 18, ...style }}>{children}</div>
}
function Kpi({ label, value, sub, color, Icon, tint }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-subtle, #64748b)', fontWeight: 600 }}>{label}</div>
        {Icon && <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: tint || 'var(--surface-2, #334155)', color: color || 'var(--text-muted)' }}><Icon size={17} /></span>}
      </div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 25, marginTop: 8, color: color || 'var(--text, #f1f5f9)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-subtle, #64748b)', marginTop: 3 }}>{sub}</div>}
    </Card>
  )
}

/* ── P&L dashboard ── */
function PnlTab({ seg }) {
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    supabase.rpc('finance_pnl_summary', { p_from: null, p_to: null, p_segment: seg === 'all' ? null : seg })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { setErr(error.message); setLoading(false); return }
        setD(data || {}); setLoading(false)
      })
    return () => { alive = false }
  }, [seg])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={26} style={{ animation: 'spin 1s linear infinite', color: 'var(--v2-ink-2)' }} /></div>
  if (err) return <Card style={{ borderColor: 'var(--danger, #EF4444)' }}><div style={{ color: 'var(--danger)' }}>Could not load P&amp;L: {err}</div></Card>
  if (!d || d.operating_profit == null) return <Card>No finance data yet. Run the Phase 1–3 SQL + import statements.</Card>

  const profit = Number(d.operating_profit) || 0
  const income = Number(d.income) || 0
  const excl = d.excluded || {}
  const byHead = d.by_head || []
  const maxHead = byHead.reduce((m, h) => Math.max(m, Number(h.amount) || 0), 0) || 1
  const review = d.review || { count: 0, amount: 0 }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* hero */}
      <div style={{ position: 'relative', overflow: 'hidden', border: '1px solid var(--border-strong, #475569)', borderRadius: 20, padding: '24px 26px',
        background: 'radial-gradient(480px 220px at 92% -10%, rgba(255,230,0,.16), transparent 60%), linear-gradient(160deg,#10192e,#0c1424)' }}>
        <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600 }}>
          Operating Profit / (Loss){seg !== 'all' ? ` · ${seg === 'GOVERNMENT' ? 'Government' : 'Private'}` : ''}
        </div>
        <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 46, lineHeight: 1.05, margin: '8px 0 4px',
          color: profit >= 0 ? 'var(--accent, #FFE600)' : 'var(--danger, #EF4444)' }}>{fmtINR(profit)}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Income {fmtINR(income)} · Costs {fmtINR(Number(d.direct_cost) + Number(d.common_expense))} · Margin {d.margin_pct}%
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        <Kpi label="Operating Income" value={fmtINR(income)} sub="CRM approved payments" Icon={TrendingUp} color="var(--success, #10B981)" tint="var(--success-soft, rgba(16,185,129,.12))" />
        <Kpi label="Operating Costs" value={fmtINR(Number(d.direct_cost) + Number(d.common_expense))} sub="direct + common" Icon={TrendingDown} color="var(--danger, #EF4444)" tint="var(--danger-soft, rgba(239,68,68,.12))" />
        <Kpi label="Operating P&L" value={fmtINR(profit)} sub={profit >= 0 ? 'profit' : 'loss'} Icon={BarChart3} color={profit >= 0 ? 'var(--success, #10B981)' : 'var(--danger)'} tint="var(--success-soft, rgba(16,185,129,.12))" />
        <Kpi label="Margin" value={`${d.margin_pct}%`} sub="income → profit" Icon={IndianRupee} color="var(--accent, #FFE600)" tint="var(--accent-soft, rgba(255,230,0,.14))" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* by segment */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Net Profit by Segment <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>common split by income share</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: 'var(--text-subtle)' }}>
              <th style={thL}>Segment</th><th style={thR}>Income</th><th style={thR}>Cost + Common</th><th style={thR}>Net</th>
            </tr></thead>
            <tbody>
              {(d.by_segment || []).map(s => {
                const cost = Number(s.direct) + Number(s.common)
                const net = Number(s.net)
                return (
                  <tr key={s.segment} style={{ borderTop: '1px solid var(--border-soft, rgba(255,255,255,.06))' }}>
                    <td style={tdL}>{s.segment === 'GOVERNMENT' ? 'Government' : 'Private'}<div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{s.company}</div></td>
                    <td style={tdR}>{fmtINR(s.income)}</td>
                    <td style={{ ...tdR, color: 'var(--danger)' }}>{fmtINR(cost)}</td>
                    <td style={{ ...tdR, color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtINR(net)}</td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '1px solid var(--border, #334155)', fontWeight: 700 }}>
                <td style={tdL}>TOTAL</td><td style={tdR}>{fmtINR(income)}</td>
                <td style={tdR}>{fmtINR(Number(d.direct_cost) + Number(d.common_expense))}</td>
                <td style={{ ...tdR, color: profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtINR(profit)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        {/* expense by head */}
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Operating Expense by Head</div>
          {byHead.length === 0 && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No costs in range.</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {byHead.map((h, i) => (
                <tr key={i}>
                  <td style={{ padding: '7px 4px' }}>{h.head}</td>
                  <td style={{ padding: '7px 4px', width: 110 }}>
                    <div style={{ height: 7, borderRadius: 4, background: 'var(--surface-2, #334155)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round((Number(h.amount) / maxHead) * 100)}%`, background: 'var(--accent, #FFE600)', borderRadius: 4 }} />
                    </div>
                  </td>
                  <td style={{ ...tdR, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600 }}>{fmtINR(h.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* excluded — loans / transfers / drawings */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Cash movements <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>kept OUT of profit</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {[
            ['Internal transfers', excl.internal_transfer, 'var(--blue, #3B82F6)'],
            ['Loans in / out', (Number(excl.loan_in) || 0) - (Number(excl.loan_out) || 0), 'var(--success, #10B981)'],
            ['Owner drawings', excl.owner_drawings, 'var(--warning, #F59E0B)'],
            ['Tax paid', excl.tax, 'var(--text-muted)'],
          ].map(([l, v, c]) => (
            <div key={l}>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{l}</div>
              <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 18, color: c, marginTop: 4 }}>{fmtINR(v || 0)}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* review flag */}
      {review.count > 0 && (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--danger-soft, rgba(239,68,68,.12))', border: '1px solid rgba(239,68,68,.3)', borderRadius: 12, padding: '11px 14px', fontSize: 13, color: 'var(--text-muted)' }}>
          <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
          <div><b style={{ color: 'var(--text)' }}>{review.count} transactions in REVIEW</b> — {fmtINR(review.amount)} unclassified. Open the Register, filter Bucket = Review, and tag them so the P&amp;L is complete.</div>
        </div>
      )}
    </div>
  )
}

/* ── Register ── */
function RegisterTab({ seg }) {
  const [rows, setRows] = useState([])
  const [banks, setBanks] = useState({})
  const [heads, setHeads] = useState({})
  const [loading, setLoading] = useState(true)
  const [fBucket, setFBucket] = useState('all')
  const [fBank, setFBank] = useState('all')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [baRes, hRes] = await Promise.all([
      supabase.from('bank_accounts').select('id, name'),
      supabase.from('finance_expense_heads').select('id, name'),
    ])
    setBanks(Object.fromEntries((baRes.data || []).map(b => [b.id, b.name])))
    setHeads(Object.fromEntries((hRes.data || []).map(h => [h.id, h.name])))
    const PAGE = 1000; let all = []; let from = 0
    for (;;) {
      const { data, error } = await supabase.from('finance_transactions')
        .select('id, txn_date, description, amount, direction, bucket, company, segment, media_type, expense_head_id, bank_account_id, raw_tag, note')
        .order('txn_date', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) { toastError(error, 'Could not load transactions.'); break }
      all = all.concat(data || [])
      if (!data || data.length < PAGE) break
      from += PAGE
      if (from >= 20000) break
    }
    setRows(all); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const retag = async (id, field, value) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r)) // optimistic
    const { error } = await supabase.from('finance_transactions').update({ [field]: value }).eq('id', id)
    if (error) { toastError(error, 'Could not save tag.'); load() } else toastSuccess('Tagged.')
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (seg !== 'all' && r.segment !== seg) return false
    if (fBucket !== 'all' && r.bucket !== fBucket) return false
    if (fBank !== 'all' && String(r.bank_account_id) !== fBank) return false
    if (q && !(r.description || '').toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [rows, seg, fBucket, fBank, q])

  const reviewCount = rows.filter(r => r.bucket === 'review').length

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={26} style={{ animation: 'spin 1s linear infinite', color: 'var(--v2-ink-2)' }} /></div>

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 14, borderBottom: '1px solid var(--border, #334155)' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{filtered.length} transactions</div>
        {reviewCount > 0 && <span onClick={() => setFBucket('review')} style={{ cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)' }}>{reviewCount} to review</span>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface-2, #334155)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <Search size={14} style={{ color: 'var(--text-subtle)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description…" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13, width: 160 }} />
        </div>
        <select value={fBucket} onChange={e => setFBucket(e.target.value)} style={selStyle}>
          <option value="all">Bucket: All</option>
          {BUCKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={fBank} onChange={e => setFBank(e.target.value)} style={selStyle}>
          <option value="all">Bank: All</option>
          {Object.entries(banks).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
          <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--surface, #1e293b)', zIndex: 1 }}>
            <th style={thL}>Date</th><th style={thL}>Description</th><th style={thR}>Amount</th>
            <th style={thL}>Bucket</th><th style={thL}>Segment</th><th style={thL}>Bank</th><th style={thL}>Head</th>
          </tr></thead>
          <tbody>
            {filtered.slice(0, 1500).map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border-soft, rgba(255,255,255,.06))', background: r.bucket === 'review' ? 'rgba(245,158,11,.06)' : undefined }}>
                <td style={{ ...tdL, whiteSpace: 'nowrap', fontFamily: 'Space Grotesk' }}>{r.txn_date}{r.note ? <span title={r.note} style={{ color: 'var(--warning)', marginLeft: 4 }}>≈</span> : ''}</td>
                <td style={{ ...tdL, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}<div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>{r.raw_tag}</div></td>
                <td style={{ ...tdR, fontFamily: 'Space Grotesk', fontWeight: 600, color: r.direction === 'in' ? 'var(--success)' : 'var(--text)' }}>{r.direction === 'in' ? '+' : ''}{fmtINR(r.amount)}</td>
                <td style={tdL}>
                  <select value={r.bucket} onChange={e => retag(r.id, 'bucket', e.target.value)} style={{ ...selStyle, minWidth: 130 }}>
                    {BUCKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td style={tdL}>
                  <select value={r.segment || ''} onChange={e => retag(r.id, 'segment', e.target.value || null)} style={{ ...selStyle, minWidth: 110 }}>
                    <option value="">—</option>
                    {SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td style={tdL}>{banks[r.bank_account_id] || '—'}</td>
                <td style={tdL}>{heads[r.expense_head_id] || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-subtle)' }}>No transactions match.</div>}
      </div>
    </Card>
  )
}

/* ── Import (placeholder — Phase 4) ── */
function ImportTab() {
  return (
    <Card style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div style={{ width: 64, height: 64, borderRadius: 14, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: 'var(--accent-soft, rgba(255,230,0,.14))', color: 'var(--accent, #FFE600)' }}><Upload size={30} /></div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Statement import — coming next</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 6 }}>Your 4 statements (Apr–Jul) are already loaded. The drag-&amp;-drop monthly importer lands in Phase 4.</div>
    </Card>
  )
}

/* ── shared cell styles ── */
const thL = { textAlign: 'left', fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-subtle, #64748b)', fontWeight: 600, padding: '9px 10px' }
const thR = { ...thL, textAlign: 'right' }
const tdL = { padding: '9px 10px', verticalAlign: 'middle' }
const tdR = { ...tdL, textAlign: 'right', fontFamily: 'Space Grotesk, sans-serif' }
const selStyle = { background: 'var(--surface-2, #334155)', border: '1px solid var(--border, #334155)', borderRadius: 6, padding: '5px 8px', fontSize: 12.5, color: 'var(--text, #f1f5f9)', cursor: 'pointer' }
