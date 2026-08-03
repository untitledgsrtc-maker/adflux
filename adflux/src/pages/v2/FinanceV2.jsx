// =============================================================================
// FinanceV2 — Finance / P&L module (spec: docs/FINANCE_MODULE_SPEC.md, CLAUDE.md §155)
// Matches _design_reference/finance_module_mockup.html. Tabs: Owner P&L · Accounts
// Home · Tasks · Import · Register. admin + accounts + co_owner(Vishal govt-scoped).
// P&L + Home totals come from server RPCs (§66); Register pages raw rows via .range().
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, ListChecks, Upload, TrendingUp, TrendingDown, BarChart3,
  AlertTriangle, Loader2, Search, IndianRupee, Home, CheckSquare, Clock,
  RefreshCw, Wallet, PiggyBank, Boxes, ArrowLeftRight,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'

/* ── helpers ── */
function fmtINR(n) {
  if (n == null || isNaN(n)) return '—'
  const v = Math.round(Number(n))
  return (v < 0 ? '−₹' : '₹') + new Intl.NumberFormat('en-IN').format(Math.abs(v))
}
function fmtL(n) { // compact ₹..L / ₹..Cr
  const v = Math.abs(Number(n) || 0)
  const s = v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : fmtINR(v)
  return (Number(n) < 0 ? '−' : '') + s
}
const BUCKETS = [
  ['income', 'Income'], ['direct_cost', 'Direct cost'], ['common_expense', 'Common expense'],
  ['owner_drawings', 'Owner drawings'], ['investment', 'Investment'], ['asset', 'Asset'],
  ['loan_in', 'Loan in'], ['loan_out', 'Loan out'], ['internal_transfer', 'Internal transfer'],
  ['tax', 'Tax'], ['review', 'Review'],
]
const SEGMENTS = [['GOVERNMENT', 'Government'], ['PRIVATE', 'Private']]
const MEDIA = [['OTHER_MEDIA', 'Other Media'], ['LED_OTHER', 'LED Cities'], ['GSRTC_LED', 'GSRTC LED'], ['AUTO_HOOD', 'Auto Hood'], ['HOARDING', 'Hoarding'], ['MALL', 'Mall'], ['CINEMA', 'Cinema'], ['DIGITAL', 'Digital'], ['OTHER', 'Other']]
const MIX_COLORS = ['var(--success, #10B981)', 'var(--blue, #3B82F6)', 'var(--purple, #c084fc)', 'var(--accent, #FFE600)', 'var(--warning, #F59E0B)', 'var(--danger, #EF4444)']

/* ── page shell ── */
export default function FinanceV2() {
  const profile = useAuthStore(s => s.profile)
  const canView = ['admin', 'co_owner', 'accounts'].includes(profile?.role)
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'pnl'
  const [seg, setSeg] = useState('all')
  const setTab = (t) => { const n = new URLSearchParams(sp); n.set('tab', t); setSp(n, { replace: true }) }

  if (!canView) return <div className="v2d-page"><Card>Finance is for admin + accounts only.</Card></div>

  const TABS = [
    { key: 'pnl', label: 'Owner · P&L', icon: LayoutDashboard },
    { key: 'home', label: 'Accounts Home', icon: Home },
    { key: 'tasks', label: 'Tasks', icon: CheckSquare },
    { key: 'import', label: 'Import', icon: Upload },
    { key: 'register', label: 'Register', icon: ListChecks },
  ]

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Untitled Group · Consolidated</div>
          <h1 className="v2d-page-title">Finance</h1>
          <div className="v2d-page-sub">Real P&amp;L from your bank ledger + CRM income. You + Accounts see all · Vishal (co-owner) Government only.</div>
        </div>
        <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2, #334155)', borderRadius: 999, padding: 3, alignSelf: 'flex-start' }}>
          {[['all', 'All'], ...SEGMENTS].map(([k, l]) => (
            <span key={k} onClick={() => setSeg(k)}
              style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                background: seg === k ? 'var(--accent, #FFE600)' : 'transparent',
                color: seg === k ? 'var(--accent-fg, #0f172a)' : 'var(--text-muted, #94a3b8)' }}>{l}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border, #334155)', margin: '4px 0 18px', flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const on = tab === t.key; const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', fontSize: 13, fontWeight: 600,
                background: 'transparent', border: 'none', cursor: 'pointer', marginBottom: -1,
                color: on ? 'var(--text, #f1f5f9)' : 'var(--text-muted, #94a3b8)',
                borderBottom: on ? '2px solid var(--accent, #FFE600)' : '2px solid transparent' }}>
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'pnl' && <PnlTab seg={seg} />}
      {tab === 'home' && <HomeTab onReview={() => setTab('register')} />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'register' && <RegisterTab seg={seg} />}
    </div>
  )
}

/* ── shared bits ── */
function Card({ children, style }) {
  return <div style={{ background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, padding: 18, ...style }}>{children}</div>
}
function CH({ children }) { return <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{children}</div> }
function Kpi({ label, value, sub, color, Icon, tint }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-subtle, #64748b)', fontWeight: 600 }}>{label}</div>
        {Icon && <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: tint || 'var(--surface-2)', color: color || 'var(--text-muted)' }}><Icon size={17} /></span>}
      </div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 25, marginTop: 8, color: color || 'var(--text, #f1f5f9)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3 }}>{sub}</div>}
    </Card>
  )
}
const Spin = () => <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={26} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} /></div>
const thL = { textAlign: 'left', fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-subtle, #64748b)', fontWeight: 600, padding: '9px 10px' }
const thR = { ...thL, textAlign: 'right' }
const tdL = { padding: '9px 10px', verticalAlign: 'middle', borderTop: '1px solid var(--border-soft, rgba(255,255,255,.06))' }
const tdR = { ...tdL, textAlign: 'right', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600 }
const totRow = { fontWeight: 700, background: 'var(--surface-2, #334155)' }
const g2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }
const g4 = { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }
const selStyle = { background: 'var(--surface-2, #334155)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }
const Dot = ({ c }) => <span style={{ width: 9, height: 9, borderRadius: 9, background: c, display: 'inline-block' }} />

/* ── P&L dashboard ── */
function PnlTab({ seg }) {
  const [d, setD] = useState(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true; setLoading(true); setErr(null)
    supabase.rpc('finance_pnl_summary', { p_from: null, p_to: null, p_segment: seg === 'all' ? null : seg })
      .then(({ data, error }) => { if (!alive) return; if (error) setErr(error.message); else setD(data || {}); setLoading(false) })
    return () => { alive = false }
  }, [seg])

  if (loading) return <Spin />
  if (err) return <Card style={{ borderColor: 'var(--danger)' }}><span style={{ color: 'var(--danger)' }}>Could not load P&amp;L: {err}</span></Card>
  if (!d || d.operating_profit == null) return <Card>No finance data yet — run the Phase 1–3 SQL.</Card>

  const profit = Number(d.operating_profit) || 0, income = Number(d.income) || 0
  const cost = Number(d.direct_cost) + Number(d.common_expense)
  const excl = d.excluded || {}, byHead = d.by_head || [], mix = d.revenue_mix || [], monthly = d.monthly || []
  const assets = d.assets || [], review = d.review || { count: 0, amount: 0 }
  const maxHead = byHead.reduce((m, h) => Math.max(m, +h.amount || 0), 0) || 1

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* hero */}
      <div style={{ position: 'relative', overflow: 'hidden', border: '1px solid var(--border-strong, #475569)', borderRadius: 20, padding: '24px 26px',
        background: 'radial-gradient(480px 220px at 92% -10%, rgba(255,230,0,.16), transparent 60%), linear-gradient(160deg,#10192e,#0c1424)' }}>
        <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600 }}>Operating Profit / (Loss){seg !== 'all' ? ` · ${seg === 'GOVERNMENT' ? 'Government' : 'Private'}` : ''}</div>
        <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 46, lineHeight: 1.05, margin: '8px 0 4px', color: profit >= 0 ? 'var(--accent, #FFE600)' : 'var(--danger)' }}>{fmtINR(profit)}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Income {fmtINR(income)} · Costs {fmtINR(cost)} · Margin {d.margin_pct}%</div>
      </div>

      <div style={g4}>
        <Kpi label="Operating Income" value={fmtINR(income)} sub="money received (bank)" Icon={TrendingUp} color="var(--success, #10B981)" tint="var(--success-soft, rgba(16,185,129,.12))" />
        <Kpi label="Operating Costs" value={fmtINR(cost)} sub="direct + common" Icon={TrendingDown} color="var(--danger)" tint="var(--danger-soft, rgba(239,68,68,.12))" />
        <Kpi label="Operating P&L" value={fmtINR(profit)} sub={profit >= 0 ? 'profit' : 'loss'} Icon={BarChart3} color={profit >= 0 ? 'var(--success, #10B981)' : 'var(--danger)'} tint="var(--success-soft, rgba(16,185,129,.12))" />
        <Kpi label="Margin" value={`${d.margin_pct}%`} sub="income → profit" Icon={IndianRupee} color="var(--accent, #FFE600)" tint="var(--accent-soft, rgba(255,230,0,.14))" />
      </div>

      {/* trend + mix */}
      <div style={g2}>
        <Card>
          <CH>Monthly Trend <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>income vs costs</span></CH>
          <div style={{ display: 'flex', gap: 14, marginBottom: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Dot c="var(--blue, #3B82F6)" />Income</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Dot c="var(--danger, #EF4444)" />Costs</span>
          </div>
          <TrendChart data={monthly} />
        </Card>
        <Card>
          <CH>Revenue Mix by Segment</CH>
          <MixDonut mix={mix} total={income} />
        </Card>
      </div>

      {/* segment net + common split */}
      <div style={g2}>
        <Card>
          <CH>Net Profit by Segment <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>common split by income share</span></CH>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={thL}>Segment</th><th style={thR}>Income</th><th style={thR}>Cost + Common</th><th style={thR}>Net</th></tr></thead>
            <tbody>
              {(d.by_segment || []).map((s, i) => {
                const c = +s.direct + +s.common, net = +s.net
                return <tr key={i}><td style={tdL}><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Dot c={MIX_COLORS[i % MIX_COLORS.length]} />{s.label}</span></td>
                  <td style={tdR}>{fmtINR(s.income)}</td><td style={{ ...tdR, color: 'var(--danger)' }}>{fmtINR(c)}</td>
                  <td style={{ ...tdR, color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtINR(net)}</td></tr>
              })}
              <tr style={totRow}><td style={tdL}>TOTAL</td><td style={tdR}>{fmtINR(income)}</td><td style={tdR}>{fmtINR(cost)}</td><td style={{ ...tdR, color: profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtINR(profit)}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <CH>Common Expense — split by income share</CH>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={thL}>Segment</th><th style={thR}>Income</th><th style={thR}>Share</th><th style={thR}>Common ₹</th></tr></thead>
            <tbody>
              {(d.by_segment || []).map((s, i) => <tr key={i}><td style={tdL}><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Dot c={MIX_COLORS[i % MIX_COLORS.length]} />{s.label}</span></td>
                <td style={tdR}>{fmtINR(s.income)}</td><td style={tdR}>{s.pct}%</td><td style={{ ...tdR, color: 'var(--warning)' }}>{fmtINR(s.common)}</td></tr>)}
              <tr style={totRow}><td style={tdL}>POOL (common)</td><td style={tdR}></td><td style={tdR}></td><td style={tdR}>{fmtINR(d.common_expense)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      {/* per company + loans */}
      <div style={g2}>
        <Card>
          <CH>Per Company — Operating P&amp;L</CH>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={thL}>Company</th><th style={thR}>Income</th><th style={thR}>Op P&amp;L</th><th style={thR}>Margin</th></tr></thead>
            <tbody>
              {(d.per_company || []).map(c => <tr key={c.company}><td style={tdL}>{c.company}</td><td style={tdR}>{fmtINR(c.income)}</td>
                <td style={{ ...tdR, color: +c.op_pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtINR(c.op_pnl)}</td><td style={tdR}>{c.margin}%</td></tr>)}
              <tr style={totRow}><td style={tdL}>GROUP</td><td style={tdR}>{fmtINR(income)}</td><td style={{ ...tdR, color: profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtINR(profit)}</td><td style={tdR}>{d.margin_pct}%</td></tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <CH><ArrowLeftRight size={15} style={{ verticalAlign: -2 }} /> Loans &amp; Transfers <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>not profit</span></CH>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              <tr><td style={tdL}>Loan In (borrowed)</td><td style={{ ...tdR, color: 'var(--success)' }}>{fmtINR(excl.loan_in || 0)}</td></tr>
              <tr><td style={tdL}>Loan Out (repaid / given)</td><td style={{ ...tdR, color: 'var(--danger)' }}>{fmtINR(excl.loan_out || 0)}</td></tr>
              <tr style={totRow}><td style={tdL}>Net loan position</td><td style={{ ...tdR, color: 'var(--success)' }}>{fmtINR((+excl.loan_in || 0) - (+excl.loan_out || 0))}</td></tr>
              <tr><td style={tdL}>Internal transfers <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>own accounts</span></td><td style={{ ...tdR, color: 'var(--blue)' }}>{fmtINR(excl.internal_transfer || 0)}</td></tr>
              <tr><td style={tdL}>Owner drawings</td><td style={{ ...tdR, color: 'var(--warning)' }}>{fmtINR(excl.owner_drawings || 0)}</td></tr>
              <tr><td style={tdL}>Tax paid</td><td style={tdR}>{fmtINR(excl.tax || 0)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      {/* assets + expense heads */}
      <div style={g2}>
        <Card>
          <CH><Boxes size={15} style={{ verticalAlign: -2 }} /> Assets &amp; Investments <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>capital</span></CH>
          {assets.length === 0 ? <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>None tagged yet — tag investment/asset rows in the Register.</div> :
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><th style={thL}>Date</th><th style={thL}>Remark</th><th style={thR}>Amount</th></tr></thead>
              <tbody>
                {assets.map((a, i) => <tr key={i}><td style={{ ...tdL, whiteSpace: 'nowrap', fontFamily: 'Space Grotesk' }}>{a.date}</td>
                  <td style={{ ...tdL, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.remark}>{a.remark}</td><td style={tdR}>{fmtINR(a.amount)}</td></tr>)}
                <tr style={totRow}><td style={tdL} colSpan={2}>Total capital</td><td style={tdR}>{fmtINR(assets.reduce((s, a) => s + (+a.amount || 0), 0))}</td></tr>
              </tbody>
            </table>}
        </Card>
        <Card>
          <CH>Operating Expense by Head</CH>
          {byHead.length === 0 ? <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No costs in range.</div> :
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><tbody>
              {byHead.map((h, i) => <tr key={i}><td style={{ padding: '7px 4px' }}>{h.head}</td>
                <td style={{ padding: '7px 4px', width: 110 }}><div style={{ height: 7, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round((+h.amount / maxHead) * 100)}%`, background: 'var(--accent, #FFE600)', borderRadius: 4 }} /></div></td>
                <td style={{ ...tdR, borderTop: 'none' }}>{fmtINR(h.amount)}</td></tr>)}
            </tbody></table>}
        </Card>
      </div>

      {review.count > 0 && (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--danger-soft, rgba(239,68,68,.12))', border: '1px solid rgba(239,68,68,.3)', borderRadius: 12, padding: '11px 14px', fontSize: 13, color: 'var(--text-muted)' }}>
          <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
          <div><b style={{ color: 'var(--text)' }}>{review.count} transactions in REVIEW</b> — {fmtINR(review.amount)} unclassified. Open the Register, filter Bucket = Review, tag them so the P&amp;L is complete.</div>
        </div>
      )}
    </div>
  )
}

function TrendChart({ data }) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: 20 }}>No monthly data.</div>
  const max = data.reduce((m, x) => Math.max(m, +x.income || 0, +x.cost || 0), 0) || 1
  const W = 560, H = 200, base = 172, slot = W / data.length
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <line x1="10" x2={W - 10} y1={base} y2={base} stroke="var(--border)" />
      {data.map((m, i) => {
        const cx = i * slot + slot / 2, bh = 130
        const ih = (+m.income / max) * bh, ch = (+m.cost / max) * bh
        const net = (+m.income || 0) - (+m.cost || 0)
        return (
          <g key={m.month}>
            <text x={cx} y="18" textAnchor="middle" fontSize="12" fontFamily="Space Grotesk" fontWeight="600" fill={net >= 0 ? 'var(--success)' : 'var(--danger)'}>{net >= 0 ? '+' : '−'}{fmtL(Math.abs(net))}</text>
            <rect x={cx - 28} y={base - ih} width="26" height={ih} rx="3" fill="var(--blue, #3B82F6)" />
            <rect x={cx + 2} y={base - ch} width="26" height={ch} rx="3" fill="var(--danger, #EF4444)" />
            <text x={cx} y="190" textAnchor="middle" fontSize="10" fill="var(--text-subtle)" fontFamily="Space Grotesk">{m.month}</text>
          </g>
        )
      })}
    </svg>
  )
}

function MixDonut({ mix, total }) {
  if (!mix || mix.length === 0 || !total) return <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: 20 }}>No CRM revenue in range.</div>
  const R = 54, C = 2 * Math.PI * R
  let off = 0
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="150" height="150" viewBox="0 0 150 150">
        {mix.map((m, i) => {
          const frac = (+m.amount || 0) / total, len = frac * C
          const el = <circle key={i} cx="75" cy="75" r={R} fill="none" stroke={MIX_COLORS[i % MIX_COLORS.length]} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 75 75)" />
          off += len
          return el
        })}
        <text x="75" y="73" textAnchor="middle" fontFamily="Space Grotesk" fontWeight="600" fontSize="17" fill="var(--text)">{fmtL(total)}</text>
        <text x="75" y="90" textAnchor="middle" fontSize="8" fill="var(--text-subtle)" letterSpacing="1.5">REVENUE</text>
      </svg>
      <div style={{ flex: 1, minWidth: 180 }}>
        {mix.map((m, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', gap: 8 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Dot c={MIX_COLORS[i % MIX_COLORS.length]} />{m.label}</span>
          <span style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 13 }}>{fmtL(m.amount)}</span>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{m.pct}%</span>
        </div>)}
      </div>
    </div>
  )
}

/* ── Accounts Home ── */
function HomeTab({ onReview }) {
  const [d, setD] = useState(null); const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    supabase.rpc('finance_accounts_home').then(({ data }) => { if (alive) { setD(data || {}); setLoading(false) } })
    return () => { alive = false }
  }, [])
  if (loading) return <Spin />
  const tc = d?.to_collect || {}, tasks = d?.tasks || []
  const today = tasks.filter(t => t.frequency === 'daily' || t.status !== 'done').slice(0, 5)
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={g4}>
        <Kpi label="To collect" value={fmtINR(tc.total || 0)} sub={`${tc.count || 0} clients`} Icon={IndianRupee} color="var(--danger)" tint="var(--danger-soft, rgba(239,68,68,.12))" />
        <Kpi label="Approvals pending" value={d?.approvals_pending ?? 0} sub="payments from reps" Icon={CheckSquare} color="var(--warning)" tint="var(--warning-soft, rgba(245,158,11,.12))" />
        <Kpi label="REVIEW to tag" value={d?.review_count ?? 0} sub="unclassified entries" Icon={AlertTriangle} color="var(--purple, #c084fc)" tint="var(--purple-soft, rgba(192,132,252,.14))" />
        <Kpi label="Reminders" value={tasks.length} sub="active tasks" Icon={Clock} color="var(--blue)" tint="var(--blue-soft, rgba(59,130,246,.12))" />
      </div>
      <div style={g2}>
        <Card>
          <CH>Today's tasks</CH>
          {today.map(t => <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', borderBottom: '1px solid var(--border-soft, rgba(255,255,255,.06))' }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, border: '1.6px solid var(--border-strong, #475569)', flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 13.5 }}>{t.title}</div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: 'var(--blue-soft, rgba(59,130,246,.12))', color: 'var(--blue)' }}>{t.frequency}</span>
          </div>)}
          {today.length === 0 && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Nothing due.</div>}
        </Card>
        <Card>
          <CH>Money to collect <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>oldest first</span></CH>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={thL}>Client</th><th style={thR}>Overdue</th><th style={thR}>Amount</th></tr></thead>
            <tbody>
              {(tc.rows || []).slice(0, 8).map((r, i) => <tr key={i}><td style={tdL}>{r.client}</td>
                <td style={tdR}><span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: r.days > 30 ? 'var(--danger-soft, rgba(239,68,68,.12))' : 'var(--warning-soft, rgba(245,158,11,.12))', color: r.days > 30 ? 'var(--danger)' : 'var(--warning)' }}>{r.days}d</span></td>
                <td style={tdR}>{fmtINR(r.amount)}</td></tr>)}
              <tr style={totRow}><td style={tdL}>{tc.count || 0} clients</td><td style={tdR}></td><td style={tdR}>{fmtINR(tc.total || 0)}</td></tr>
            </tbody>
          </table>
          {(tc.rows || []).length === 0 && <div style={{ color: 'var(--text-subtle)', fontSize: 13, marginTop: 8 }}>Nothing outstanding.</div>}
        </Card>
      </div>
    </div>
  )
}

/* ── Tasks ── */
function TasksTab() {
  const [tasks, setTasks] = useState([]); const [loading, setLoading] = useState(true)
  useEffect(() => { supabase.from('finance_tasks').select('*').order('frequency').then(({ data }) => { setTasks(data || []); setLoading(false) }) }, [])
  if (loading) return <Spin />
  const recurring = tasks.filter(t => t.frequency !== 'oneoff')
  const oneoff = tasks.filter(t => t.frequency === 'oneoff')
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card>
        <CH><RefreshCw size={15} style={{ verticalAlign: -2 }} /> Recurring</CH>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr><th style={thL}>Task</th><th style={thL}>Frequency</th><th style={thL}>Reminder</th><th style={thR}>Status</th></tr></thead>
          <tbody>
            {recurring.map(t => <tr key={t.id}><td style={tdL}>{t.title}</td><td style={tdL}>{t.frequency}</td>
              <td style={tdL}><span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{t.reminder_channel === 'push_wa' ? 'Push + WA' : 'Push'}</span></td>
              <td style={tdR}><span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{t.status}</span></td></tr>)}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 10 }}>Starter set — reminders fire as app notifications; key ones also ping WhatsApp. Editing/toggling lands in a later phase.</div>
      </Card>
      {oneoff.length > 0 && <Card><CH>One-off</CH>{oneoff.map(t => <div key={t.id} style={{ padding: '10px 2px', borderBottom: '1px solid var(--border-soft, rgba(255,255,255,.06))', fontSize: 13.5 }}>{t.title}</div>)}</Card>}
    </div>
  )
}

/* ── Import (Phase 4 placeholder, mockup shell) ── */
function ImportTab() {
  const chips = ['SALARY → Staff Salaries', 'FACEBOOK → Marketing', 'TORRENT POWER → GSRTC · Rent', 'BRIJESH self → Internal Transfer', 'EMI → Owner Drawings', 'SWEEP → Transfer']
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 22, marginBottom: 4 }}>
        {['Upload', 'Map columns', 'Review & classify'].map((s, i) => <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: i === 0 ? 'var(--text)' : 'var(--text-subtle)' }}>
          <b style={{ width: 22, height: 22, borderRadius: 7, background: i === 0 ? 'var(--accent, #FFE600)' : 'var(--surface-2)', color: i === 0 ? 'var(--accent-fg)' : 'inherit', display: 'grid', placeItems: 'center', fontFamily: 'Space Grotesk' }}>{i + 1}</b>{s}</div>)}
      </div>
      <div style={{ border: '2px dashed var(--border-strong, #475569)', borderRadius: 14, padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface)' }}>
        <div style={{ width: 64, height: 64, borderRadius: 14, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: 'var(--accent-soft, rgba(255,230,0,.14))', color: 'var(--accent, #FFE600)' }}><Upload size={30} /></div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Statement import — coming next (Phase 4)</div>
        <div style={{ fontSize: 12.5, marginTop: 6 }}>Your 4 statements (Apr–Jul) are already loaded. Monthly drag-&amp;-drop lands here next.</div>
      </div>
      <Card>
        <CH>Smart auto-tagging</CH>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chips.map(c => <span key={c} style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{c}</span>)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 10 }}>Rules learn over time — you only correct what it gets wrong.</div>
      </Card>
    </div>
  )
}

/* ── Register ── */
function RegisterTab({ seg }) {
  const [rows, setRows] = useState([]); const [banks, setBanks] = useState({}); const [heads, setHeads] = useState({})
  const [loading, setLoading] = useState(true); const [fBucket, setFBucket] = useState('all'); const [fBank, setFBank] = useState('all'); const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [baRes, hRes] = await Promise.all([supabase.from('bank_accounts').select('id, name'), supabase.from('finance_expense_heads').select('id, name')])
    setBanks(Object.fromEntries((baRes.data || []).map(b => [b.id, b.name])))
    setHeads(Object.fromEntries((hRes.data || []).map(h => [h.id, h.name])))
    const PAGE = 1000; let all = []; let from = 0
    for (;;) {
      const { data, error } = await supabase.from('finance_transactions')
        .select('id, txn_date, description, amount, direction, bucket, company, segment, media_type, expense_head_id, bank_account_id, raw_tag, note')
        .order('txn_date', { ascending: false }).range(from, from + PAGE - 1)
      if (error) { toastError(error, 'Could not load transactions.'); break }
      all = all.concat(data || [])
      if (!data || data.length < PAGE) break
      from += PAGE; if (from >= 20000) break
    }
    setRows(all); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const retag = async (id, field, value) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
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
  if (loading) return <Spin />

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 14, borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{filtered.length} transactions</div>
        {reviewCount > 0 && <span onClick={() => setFBucket('review')} style={{ cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)' }}>{reviewCount} to review</span>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <Search size={14} style={{ color: 'var(--text-subtle)' }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13, width: 150 }} />
        </div>
        <select value={fBucket} onChange={e => setFBucket(e.target.value)} style={selStyle}><option value="all">Bucket: All</option>{BUCKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={fBank} onChange={e => setFBank(e.target.value)} style={selStyle}><option value="all">Bank: All</option>{Object.entries(banks).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
          <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
            <th style={thL}>Date</th><th style={thL}>Description</th><th style={thR}>Amount</th><th style={thL}>Bucket</th><th style={thL}>Segment</th><th style={thL}>Media</th><th style={thL}>Bank</th><th style={thL}>Head</th>
          </tr></thead>
          <tbody>
            {filtered.slice(0, 1500).map(r => (
              <tr key={r.id} style={{ background: r.bucket === 'review' ? 'rgba(245,158,11,.06)' : undefined }}>
                <td style={{ ...tdL, whiteSpace: 'nowrap', fontFamily: 'Space Grotesk' }}>{r.txn_date}{r.note ? <span title={r.note} style={{ color: 'var(--warning)', marginLeft: 4 }}>≈</span> : ''}</td>
                <td style={{ ...tdL, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}<div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>{r.raw_tag}</div></td>
                <td style={{ ...tdR, color: r.direction === 'in' ? 'var(--success)' : 'var(--text)' }}>{r.direction === 'in' ? '+' : ''}{fmtINR(r.amount)}</td>
                <td style={tdL}><select value={r.bucket} onChange={e => retag(r.id, 'bucket', e.target.value)} style={{ ...selStyle, minWidth: 130 }}>{BUCKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td style={tdL}><select value={r.segment || ''} onChange={e => retag(r.id, 'segment', e.target.value || null)} style={{ ...selStyle, minWidth: 105 }}><option value="">—</option>{SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td style={tdL}><select value={r.media_type || ''} onChange={e => retag(r.id, 'media_type', e.target.value || null)} style={{ ...selStyle, minWidth: 105 }}><option value="">—</option>{MEDIA.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
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
