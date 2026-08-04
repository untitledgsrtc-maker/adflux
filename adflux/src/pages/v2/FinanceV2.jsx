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
  RefreshCw, Wallet, PiggyBank, Boxes, ArrowLeftRight, Trash2, CheckCircle2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

/* ── helpers ── */
function fmtINR(n) {
  if (n == null || isNaN(n)) return '—'
  const v = Math.round(Number(n))
  return (v < 0 ? '−₹' : '₹') + new Intl.NumberFormat('en-IN').format(Math.abs(v))
}
function fmtDate(s) { if (!s) return '—'; const [y, m, d] = String(s).split('-'); return d ? `${d}/${m}/${y}` : s }
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
          <div className="v2d-page-sub">Real profit from your bank statements. You + Accounts see all · Vishal (co-owner) Government only.</div>
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

      {tab === 'pnl' && <PnlTab seg="all" />}
      {tab === 'home' && <HomeTab onReview={() => setTab('register')} />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'register' && <RegisterTab />}
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
                {assets.map((a, i) => <tr key={i}><td style={{ ...tdL, whiteSpace: 'nowrap', fontFamily: 'Space Grotesk' }}>{fmtDate(a.date)}</td>
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

/* ── Tasks (add / delete / mark done) ── */
function TasksTab() {
  const [tasks, setTasks] = useState([]); const [loading, setLoading] = useState(true)
  const [nt, setNt] = useState(''); const [nfreq, setNfreq] = useState('monthly'); const [nchan, setNchan] = useState('push'); const [ndue, setNdue] = useState('')
  const load = useCallback(() => { supabase.from('finance_tasks').select('*').order('frequency').then(({ data }) => { setTasks(data || []); setLoading(false) }) }, [])
  useEffect(() => { load() }, [load])

  const addTask = async () => {
    const title = nt.trim(); if (!title) return
    const { error } = await supabase.from('finance_tasks').insert({ title, frequency: nfreq, reminder_channel: nchan, next_due: ndue || null, status: 'open', is_active: true })
    if (error) return toastError(error, 'Could not add — maybe a task with that name already exists.')
    setNt(''); setNdue(''); load(); toastSuccess('Task added.')
  }
  const delTask = async (id) => { await supabase.from('finance_tasks').delete().eq('id', id); load() }
  const toggleStatus = async (t) => {
    const st = t.status === 'done' ? 'open' : 'done'
    setTasks(ts => ts.map(x => x.id === t.id ? { ...x, status: st } : x))
    const { error } = await supabase.from('finance_tasks').update({ status: st }).eq('id', t.id); if (error) load()
  }
  if (loading) return <Spin />
  const recurring = tasks.filter(t => t.frequency !== 'oneoff')
  const oneoff = tasks.filter(t => t.frequency === 'oneoff')
  const Pill = ({ t }) => <span onClick={() => toggleStatus(t)} style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: t.status === 'done' ? 'var(--success-soft, rgba(16,185,129,.12))' : 'var(--surface-2)', color: t.status === 'done' ? 'var(--success)' : 'var(--text-muted)' }}>{t.status === 'done' ? 'done' : 'open'}</span>
  const DelBtn = ({ id }) => <span onClick={() => delTask(id)} style={{ cursor: 'pointer', color: 'var(--text-subtle)', display: 'inline-flex' }} title="Delete"><Trash2 size={14} /></span>

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card>
        <CH>Add a task or reminder</CH>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={nt} onChange={e => setNt(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTask()} placeholder="Task (e.g. Pay electricity bill)" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 11px', color: 'var(--text)', fontSize: 13, minWidth: 240 }} />
          <select value={nfreq} onChange={e => setNfreq(e.target.value)} style={selStyle}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="oneoff">One-off</option></select>
          <select value={nchan} onChange={e => setNchan(e.target.value)} style={selStyle}><option value="push">Push</option><option value="push_wa">Push + WhatsApp</option></select>
          <input type="date" value={ndue} onChange={e => setNdue(e.target.value)} style={{ ...selStyle, colorScheme: 'dark' }} />
          <button onClick={addTask} style={{ background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', border: 'none', borderRadius: 999, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Add task</button>
        </div>
      </Card>

      <Card>
        <CH><RefreshCw size={15} style={{ verticalAlign: -2 }} /> Recurring</CH>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr><th style={thL}>Task</th><th style={thL}>Frequency</th><th style={thL}>Reminder</th><th style={thR}>Status</th><th style={thL}></th></tr></thead>
          <tbody>
            {recurring.map(t => <tr key={t.id}><td style={tdL}>{t.title}</td><td style={tdL}>{t.frequency}</td>
              <td style={tdL}><span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{t.reminder_channel === 'push_wa' ? 'Push + WA' : 'Push'}</span></td>
              <td style={tdR}><Pill t={t} /></td><td style={tdL}><DelBtn id={t.id} /></td></tr>)}
            {recurring.length === 0 && <tr><td colSpan={5} style={{ ...tdL, color: 'var(--text-subtle)' }}>No recurring tasks yet.</td></tr>}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 10 }}>Add / delete / tap Status to mark done. Auto-reminders (push / WhatsApp) get wired to the notification pipeline in a later phase.</div>
      </Card>

      {oneoff.length > 0 && <Card><CH>One-off</CH>{oneoff.map(t => <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 2px', borderBottom: '1px solid var(--border-soft, rgba(255,255,255,.06))' }}><div style={{ flex: 1, fontSize: 13.5, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--text-subtle)' : 'var(--text)' }}>{t.title}{t.next_due ? <span style={{ color: 'var(--text-subtle)', fontSize: 11, marginLeft: 8 }}>{fmtDate(t.next_due)}</span> : ''}</div><Pill t={t} /><DelBtn id={t.id} /></div>)}</Card>}
    </div>
  )
}

/* ── Import (real: upload → map columns → classify → save) ── */
const IMP_HCAT = { 'Vehicle Expense': 'Vehicle Expense', 'Refreshments': 'Refreshments', 'Travel & Transportation': 'Travel & Conveyance', 'Office Expense': 'Office Expense', 'Labour charges': 'Labour charges', 'Rent Expense': 'Rent & Utilities' }
function classifyImport(tag, dir, desc, hcat, bankco, rules) {
  const t = (tag || '').toUpperCase().trim(), du = (desc || '').toUpperCase()
  let b = 'review', co = null, seg = null, media = null, head = null
  if (t === 'SWEEP') b = 'internal_transfer'
  else if (t === 'PERSONAL') b = 'owner_drawings'
  else if (t === 'LOAN FROM FRIEND') b = dir === 'in' ? 'loan_in' : 'loan_out'
  else if (t === 'TAX') { b = 'tax'; head = 'Duties & Taxes' }
  else if (t === 'COMMON EXPENSE') { b = 'common_expense'; head = IMP_HCAT[hcat] || null }
  else if (t === 'GSRTC') { b = dir === 'in' ? 'income' : 'direct_cost'; seg = 'GOVERNMENT'; media = 'GSRTC_LED' }
  else if (t === 'AUTO HOOD') { b = dir === 'in' ? 'income' : 'direct_cost'; seg = 'GOVERNMENT'; media = 'AUTO_HOOD'; if (dir === 'out') head = 'Vendor Payment' }
  else if (t === 'UNTITLED ADVERTISING') { co = 'Untitled Advertising'; b = dir === 'in' ? 'income' : 'review' }
  else if (t === 'UNTITLED ADFLUX PVT LTD') { co = 'Untitled Adflux Pvt Ltd'; b = dir === 'in' ? 'income' : 'review' }
  else if (t === 'OTHER EXPENSE') { b = 'common_expense'; head = IMP_HCAT[hcat] || 'Other' }
  if (!head && (b === 'common_expense' || b === 'direct_cost' || b === 'review')) {
    if (du.includes('SALARY')) { head = 'Staff Salaries & Benefits'; if (b === 'review') b = 'common_expense' }
    else if (du.includes('FACEBOOK') || du.includes('GOOGLE')) head = 'Marketing & Promotion'
    else if (du.includes('TORRENT POWER')) head = 'Rent & Utilities'
  }
  // your own rules — only rescue rows the tag left as 'review'
  if (b === 'review' && rules && rules.length) {
    const hit = rules.find(rl => rl.is_active !== false && rl.pattern && du.includes(String(rl.pattern).toUpperCase()))
    if (hit) { if (hit.set_bucket) b = hit.set_bucket; if (hit.set_head) head = hit.set_head; if (hit.set_segment) seg = hit.set_segment }
  }
  if (!co) co = bankco   // every row in this account belongs to the account's company
  return { bucket: b, company: co, segment: seg, media_type: media, head }
}
function impDate(v, last) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return null // serial → untrusted, carry forward from neighbours
  const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!m) return null
  let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000
  const today = new Date(); const cands = []
  for (const [mo, d] of [[b, a], [a, b]]) { const dt = new Date(y, mo - 1, d); if (dt.getMonth() === mo - 1 && dt <= today) cands.push(dt) }
  if (!cands.length) return null
  if (last) cands.sort((p, q) => ((p < last) - (q < last)) || (Math.abs(p - last) - Math.abs(q - last)))
  return cands[0]
}
const impIso = (dt) => dt ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` : null

function ImportTab() {
  const [banks, setBanks] = useState([]); const [heads, setHeads] = useState([])
  const [raw, setRaw] = useState(null); const [hdr, setHdr] = useState(0)
  const [map, setMap] = useState({}); const [bankId, setBankId] = useState('')
  const [busy, setBusy] = useState(false); const [result, setResult] = useState(null); const [err, setErr] = useState(null)
  const [rules, setRules] = useState([]); const [impCompany, setImpCompany] = useState('')
  const [nkw, setNkw] = useState(''); const [nbucket, setNbucket] = useState('common_expense'); const [nhead, setNhead] = useState('')
  const loadRules = useCallback(() => { supabase.from('finance_rules').select('*').order('priority').then(({ data }) => setRules(data || [])) }, [])

  useEffect(() => {
    supabase.from('bank_accounts').select('id, name').order('display_order').then(({ data }) => { setBanks(data || []); if (data && data[0]) setBankId(data[0].id) })
    supabase.from('finance_expense_heads').select('id, name').then(({ data }) => setHeads(data || []))
    loadRules()
  }, [loadRules])

  const addRule = async () => {
    const kw = nkw.trim(); if (!kw) return
    const { error } = await supabase.from('finance_rules').insert({ pattern: kw.toUpperCase(), match_type: 'contains', priority: 50, set_bucket: nbucket, set_head: nhead || null, is_active: true })
    if (error) return toastError(error, 'Could not add rule.')
    setNkw(''); setNhead(''); loadRules(); toastSuccess('Rule added.')
  }
  const delRule = async (id) => { await supabase.from('finance_rules').delete().eq('id', id); loadRules() }
  const reapply = async () => {
    setBusy(true)
    const { data } = await supabase.from('finance_transactions').select('id, description').eq('bucket', 'review').limit(5000)
    const headByName = Object.fromEntries(heads.map(h => [h.name, h.id]))
    let n = 0
    for (const r of (data || [])) {
      const du = (r.description || '').toUpperCase()
      const hit = rules.find(rl => rl.is_active !== false && rl.pattern && du.includes(String(rl.pattern).toUpperCase()))
      if (hit && hit.set_bucket) { await supabase.from('finance_transactions').update({ bucket: hit.set_bucket, segment: hit.set_segment || null, expense_head_id: hit.set_head ? (headByName[hit.set_head] || null) : null }).eq('id', r.id); n++ }
    }
    setBusy(false); toastSuccess(`Re-tagged ${n} rows.`)
  }

  const onFile = async (file) => {
    setErr(null); setResult(null)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false })
      let h = 0
      for (let i = 0; i < Math.min(rows.length, 8); i++) { if ((rows[i] || []).filter(c => String(c == null ? '' : c).trim()).length >= 4) { h = i; break } }
      const header = (rows[h] || []).map(c => String(c == null ? '' : c).toLowerCase())
      const find = (...kw) => { const i = header.findIndex(c => kw.some(k => c.includes(k))); return i < 0 ? '' : i }
      const findAll = (...kw) => header.map((c, i) => (kw.some(k => c.includes(k)) ? i : -1)).filter(i => i >= 0)
      const drI = findAll('dr', 'debit'), crI = findAll('cr', 'credit'), tyI = findAll('expense type', 'type')
      setRaw(rows); setHdr(h)
      setMap({ date: find('date', 'tran date'), desc: find('narration', 'particular', 'description'),
        dr: drI[0] == null ? '' : drI[0], drtag: tyI[0] == null ? '' : tyI[0],
        cr: crI[0] == null ? '' : crI[0], crtag: (tyI[1] == null ? tyI[0] : tyI[1]) == null ? '' : (tyI[1] == null ? tyI[0] : tyI[1]),
        cat: find('category', 'expense catego'), receipt: find('receipt', 'chqno', 'cheque', 'ref') })
    } catch (e) { setErr('Could not read the file: ' + (e.message || e)) }
  }

  const doImport = async () => {
    setBusy(true); setErr(null)
    try {
      const bank = banks.find(b => b.id === bankId)
      const bankco = impCompany || (/adflux/i.test(bank && bank.name || '') ? 'Untitled Adflux Pvt Ltd' : 'Untitled Advertising')
      const headByName = Object.fromEntries(heads.map(h => [h.name, h.id]))
      const data = raw.slice(hdr + 1)
      let last = null; const dates = data.map(r => { const gd = impDate(r[map.date], last); if (gd) last = gd; return gd })
      const filled = dates.slice(); let lg = null
      for (let i = 0; i < filled.length; i++) { if (filled[i]) lg = filled[i]; else if (lg) filled[i] = lg }
      let ng = null; for (let i = filled.length - 1; i >= 0; i--) { if (filled[i]) ng = filled[i]; else if (ng) filled[i] = ng }
      const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0 }
      const out = []
      data.forEach((r, idx) => {
        const d = filled[idx]; if (!d) return
        const desc = String(r[map.desc] == null ? '' : r[map.desc])
        const hcat = map.cat !== '' ? String(r[map.cat] == null ? '' : r[map.cat]) : ''
        const est = dates[idx] == null
        const sides = []
        if (map.dr !== '' && num(r[map.dr])) sides.push(['out', num(r[map.dr]), map.drtag !== '' ? String(r[map.drtag] == null ? '' : r[map.drtag]) : ''])
        if (map.cr !== '' && num(r[map.cr])) sides.push(['in', num(r[map.cr]), map.crtag !== '' ? String(r[map.crtag] == null ? '' : r[map.crtag]) : ''])
        sides.forEach(([dir, amt, tag], si) => {
          const c = classifyImport(tag, dir, desc, hcat, bankco, rules)
          out.push({ bank_account_id: bankId, txn_date: impIso(d), ref_no: map.receipt !== '' ? (String(r[map.receipt] == null ? '' : r[map.receipt]).trim() || null) : null, description: desc, amount: amt, direction: dir,
            bucket: c.bucket, company: c.company, segment: c.segment, media_type: c.media_type,
            expense_head_id: c.head ? (headByName[c.head] || null) : null, raw_tag: tag || null, source: 'import',
            dedupe_key: `${bank && bank.name}|${impIso(d)}|${amt}|${dir}|${desc.slice(0, 26)}|${idx}|${si}`,
            note: est ? 'date estimated (statement order)' : null })
        })
      })
      if (!out.length) { setErr('No rows found with that mapping — check the Date + Money In/Out columns.'); setBusy(false); return }
      for (let i = 0; i < out.length; i += 200) {
        const { error } = await supabase.from('finance_transactions').upsert(out.slice(i, i + 200), { onConflict: 'dedupe_key', ignoreDuplicates: true })
        if (error) throw error
      }
      setResult({ total: out.length }); toastSuccess(`Imported ${out.length} rows.`)
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  const cols = raw ? (raw[hdr] || []).map((c, i) => ({ i, name: String(c == null ? '' : c) || `Col ${i + 1}` })) : []
  const ColSel = ({ field, label }) => (
    <div style={{ marginBottom: 9 }}>
      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <select value={map[field] === '' || map[field] == null ? '' : map[field]} onChange={e => setMap(m => ({ ...m, [field]: e.target.value === '' ? '' : +e.target.value }))} style={{ ...selStyle, width: '100%' }}>
        <option value="">— none —</option>{cols.map(c => <option key={c.i} value={c.i}>{c.name}</option>)}
      </select>
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Smart auto-tagging <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 12 }}>keyword → category, applied on every import</span></div>
          <button onClick={reapply} disabled={busy} style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Working…' : 'Re-apply to Review rows'}</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {rules.map(rl => (
            <span key={rl.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, padding: '4px 9px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {rl.pattern} → {(BUCKET_OPTS.find(([k]) => k === rl.set_bucket) || [null, rl.set_bucket || '?'])[1]}{rl.set_head ? ' · ' + rl.set_head : ''}
              <span onClick={() => delRule(rl.id)} style={{ cursor: 'pointer', color: 'var(--text-subtle)', display: 'inline-flex' }}><Trash2 size={12} /></span>
            </span>
          ))}
          {rules.length === 0 && <span style={{ color: 'var(--text-subtle)', fontSize: 12.5 }}>No custom rules yet — built-in keyword rules still apply.</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={nkw} onChange={e => setNkw(e.target.value)} placeholder="Keyword in description (e.g. ZERODHA)" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', color: 'var(--text)', fontSize: 13, minWidth: 210 }} />
          <span style={{ color: 'var(--text-subtle)' }}>→</span>
          <select value={nbucket} onChange={e => setNbucket(e.target.value)} style={selStyle}>{BUCKET_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select value={nhead} onChange={e => setNhead(e.target.value)} style={selStyle}><option value="">Head (optional)</option>{heads.map(h => <option key={h.id} value={h.name}>{h.name}</option>)}</select>
          <button onClick={addRule} style={{ background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', border: 'none', borderRadius: 999, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Add rule</button>
        </div>
      </Card>
      {!raw && (
        <label style={{ border: '2px dashed var(--border-strong, #475569)', borderRadius: 14, padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface)', cursor: 'pointer', display: 'block' }}>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
          <div style={{ width: 64, height: 64, borderRadius: 14, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: 'var(--accent-soft, rgba(255,230,0,.14))', color: 'var(--accent, #FFE600)' }}><Upload size={30} /></div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Click to choose a bank statement</div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>Excel (.xlsx / .xls) or CSV &middot; already-imported rows are skipped automatically</div>
          {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{err}</div>}
        </label>
      )}
      {raw && !result && (
        <>
          <Card>
            <CH>Tell me which column is which</CH>
            <div style={g2}>
              <div><ColSel field="date" label="Date" /><ColSel field="desc" label="Description" /><ColSel field="cr" label="Money In (Credit)" /><ColSel field="crtag" label="In category" /></div>
              <div><ColSel field="dr" label="Money Out (Debit)" /><ColSel field="drtag" label="Out category" /><ColSel field="cat" label="Expense head column (optional)" /><ColSel field="receipt" label="Receipt No (optional)" />
                <div style={{ marginBottom: 9 }}><label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600, marginBottom: 4 }}>Which bank</label>
                  <select value={bankId} onChange={e => setBankId(e.target.value)} style={{ ...selStyle, width: '100%' }}>{banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                <div style={{ marginBottom: 9 }}><label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600, marginBottom: 4 }}>Company</label>
                  <select value={impCompany} onChange={e => setImpCompany(e.target.value)} style={{ ...selStyle, width: '100%' }}><option value="">Auto (from bank / tag)</option>{COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              </div>
            </div>
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px 0', fontSize: 12, color: 'var(--text-subtle)' }}>Preview (first 6 rows)</div>
            <div style={{ overflowX: 'auto', padding: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>{cols.map(c => <th key={c.i} style={thL}>{c.name}</th>)}</tr></thead>
                <tbody>{raw.slice(hdr + 1, hdr + 7).map((r, i) => <tr key={i}>{cols.map(c => <td key={c.i} style={tdL}>{String(r[c.i] == null ? '' : r[c.i]).slice(0, 18)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </Card>
          {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={doImport} disabled={busy || map.date === '' || (map.dr === '' && map.cr === '')} style={{ background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', border: 'none', borderRadius: 999, padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Importing…' : 'Import transactions'}</button>
            <button onClick={() => { setRaw(null); setErr(null) }} style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 999, padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Choose another file</button>
          </div>
        </>
      )}
      {result && (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--success)', marginBottom: 10 }}><CheckCircle2 size={40} /></div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Imported {result.total} rows</div>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6 }}>Open the Register to review + tag. Duplicates were skipped automatically.</div>
          <button onClick={() => { setRaw(null); setResult(null) }} style={{ marginTop: 16, background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', border: 'none', borderRadius: 999, padding: '9px 18px', fontWeight: 700, cursor: 'pointer' }}>Import another</button>
        </Card>
      )}
    </div>
  )
}

/* ── Register (detailed, month-grouped, all dropdowns) ── */
const COMPANIES = ['Untitled Advertising', 'Untitled Adflux Pvt Ltd', 'Trade Venture']
const BUCKET_OPTS = [
  ['income', 'Income'], ['direct_cost', 'Direct Cost'], ['common_expense', 'Common / Overhead'],
  ['owner_drawings', 'Owner Drawings'], ['investment', 'Investment'], ['asset', 'Asset'],
  ['loan_in', 'Loan In'], ['loan_out', 'Loan Out'], ['internal_transfer', 'Transfer'], ['tax', 'Tax'], ['review', 'Review'],
]
const SEGMED = [
  ['GOVERNMENT|AUTO_HOOD', 'Government — Auto Hood'],
  ['GOVERNMENT|GSRTC_LED', 'Government — GSRTC LED'],
  ['PRIVATE|OTHER_MEDIA', 'Private — Other Media'],
  ['PRIVATE|LED_OTHER', 'Private — LED Cities'],
  ['GOVERNMENT|', 'Government — Other'],
  ['PRIVATE|', 'Private — Other'],
  ['|', 'Common (all)'],
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(ym) { const [y, m] = (ym || '').split('-'); return m ? `${MONTHS[+m - 1]}-${y.slice(2)}` : ym }

function RegisterTab() {
  const [rows, setRows] = useState([]); const [banks, setBanks] = useState([]); const [heads, setHeads] = useState([])
  const [loading, setLoading] = useState(true); const [fBucket, setFBucket] = useState('all'); const [fBank, setFBank] = useState('all'); const [q, setQ] = useState('')
  const [fCompany, setFCompany] = useState('all'); const [fSegment, setFSegment] = useState('all'); const [fMonth, setFMonth] = useState('all')
  const [selected, setSelected] = useState(() => new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [baRes, hRes] = await Promise.all([
      supabase.from('bank_accounts').select('id, name').order('display_order'),
      supabase.from('finance_expense_heads').select('id, name').order('display_order'),
    ])
    setBanks(baRes.data || []); setHeads(hRes.data || [])
    const PAGE = 1000; let all = []; let from = 0
    for (;;) {
      const { data, error } = await supabase.from('finance_transactions')
        .select('id, txn_date, ref_no, description, amount, direction, bucket, company, segment, media_type, expense_head_id, bank_account_id, raw_tag, note')
        .order('txn_date', { ascending: false }).range(from, from + PAGE - 1)
      if (error) { toastError(error, 'Could not load.'); break }
      all = all.concat(data || [])
      if (!data || data.length < PAGE) break
      from += PAGE; if (from >= 20000) break
    }
    setRows(all); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const patch = async (id, obj) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    const { error } = await supabase.from('finance_transactions').update(obj).eq('id', id)
    if (error) { toastError(error, 'Could not save.'); load() }
  }
  const del = async (r) => {
    if (!(await confirmDialog({ title: 'Delete this transaction?', message: r.description || '', confirmLabel: 'Delete', danger: true }))) return
    const { error } = await supabase.from('finance_transactions').delete().eq('id', r.id)
    if (error) toastError(error, 'Could not delete.'); else { setRows(rs => rs.filter(x => x.id !== r.id)); setSelected(s => { const n = new Set(s); n.delete(r.id); return n }); toastSuccess('Deleted.') }
  }
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const bulkDel = async () => {
    const ids = [...selected]; if (!ids.length) return
    if (!(await confirmDialog({ title: `Delete ${ids.length} transactions?`, message: 'This permanently removes them. Cannot be undone.', confirmLabel: `Delete ${ids.length}`, danger: true }))) return
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('finance_transactions').delete().in('id', ids.slice(i, i + 200))
      if (error) { toastError(error, 'Could not delete.'); load(); setSelected(new Set()); return }
    }
    const gone = new Set(ids)
    setRows(rs => rs.filter(x => !gone.has(x.id))); setSelected(new Set()); toastSuccess(`Deleted ${ids.length}.`)
  }
  const bulkSet = async (obj) => {
    const ids = [...selected]; if (!ids.length) return
    const sel = new Set(ids)
    setRows(rs => rs.map(r => sel.has(r.id) ? { ...r, ...obj } : r))
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('finance_transactions').update(obj).in('id', ids.slice(i, i + 200))
      if (error) { toastError(error, 'Could not update.'); load(); return }
    }
    toastSuccess(`Updated ${ids.length}.`)
  }

  const months = useMemo(() => [...new Set(rows.map(r => (r.txn_date || '').slice(0, 7)).filter(Boolean))].sort((a, b) => b.localeCompare(a)), [rows])
  const filtered = useMemo(() => rows.filter(r => {
    if (fBucket !== 'all' && r.bucket !== fBucket) return false
    if (fBank !== 'all' && String(r.bank_account_id) !== fBank) return false
    if (fCompany !== 'all' && r.company !== fCompany) return false
    if (fSegment !== 'all' && r.segment !== fSegment) return false
    if (fMonth !== 'all' && (r.txn_date || '').slice(0, 7) !== fMonth) return false
    if (q && !((r.description || '') + ' ' + (r.ref_no || '')).toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [rows, fBucket, fBank, fCompany, fSegment, fMonth, q])
  const groups = useMemo(() => {
    const g = {}
    filtered.forEach(r => { const m = (r.txn_date || '').slice(0, 7); (g[m] = g[m] || []).push(r) })
    return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])
  const reviewCount = rows.filter(r => r.bucket === 'review').length
  if (loading) return <Spin />

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 14, borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{filtered.length} transactions <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>&middot; edit any dropdown, dashboard updates live</span></div>
        {reviewCount > 0 && <span onClick={() => setFBucket('review')} style={{ cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)' }}>{reviewCount} to sort</span>}
        {selected.size > 0 ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent, #FFE600)' }}>{selected.size} selected:</span>
            <select value="" onChange={e => { if (e.target.value) bulkSet({ company: e.target.value === '__none__' ? null : e.target.value }) }} style={selStyle}><option value="">Set company…</option>{COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}<option value="__none__">— clear —</option></select>
            <select value="" onChange={e => { if (e.target.value) bulkSet({ bucket: e.target.value }) }} style={selStyle}><option value="">Set bucket…</option>{BUCKET_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select value="" onChange={e => { if (e.target.value) { const [sg, md] = e.target.value.split('|'); bulkSet({ segment: sg || null, media_type: md || null }) } }} style={selStyle}><option value="">Set segment…</option>{SEGMED.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button onClick={bulkDel} style={{ background: 'var(--danger, #EF4444)', color: '#fff', border: 'none', borderRadius: 999, padding: '5px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Trash2 size={13} />Delete {selected.size}</button>
            <span onClick={() => setSelected(new Set())} style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>clear</span>
          </>
        ) : (
          <span onClick={() => setSelected(new Set(filtered.map(r => r.id)))} style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-subtle)' }}>select all ({filtered.length})</span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <Search size={14} style={{ color: 'var(--text-subtle)' }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search..." style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13, width: 150 }} />
        </div>
        <select value={fMonth} onChange={e => setFMonth(e.target.value)} style={selStyle}><option value="all">Month: All</option>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        <select value={fCompany} onChange={e => setFCompany(e.target.value)} style={selStyle}><option value="all">Company: All</option>{COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <select value={fSegment} onChange={e => setFSegment(e.target.value)} style={selStyle}><option value="all">Segment: All</option>{SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={fBucket} onChange={e => setFBucket(e.target.value)} style={selStyle}><option value="all">Bucket: All</option>{BUCKET_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={fBank} onChange={e => setFBank(e.target.value)} style={selStyle}><option value="all">Bank: All</option>{banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '72vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1180 }}>
          <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
            <th style={{ ...thL, width: 30 }}><input type="checkbox" checked={filtered.length > 0 && filtered.every(r => selected.has(r.id))} onChange={e => setSelected(e.target.checked ? new Set(filtered.map(r => r.id)) : new Set())} /></th>
            <th style={thL}>Date</th><th style={thL}>Description</th><th style={thR}>Amount</th>
            <th style={thL}>Company</th><th style={thL}>Bucket</th><th style={thL}>Segment</th><th style={thL}>Expense Head</th><th style={thL}>Bank</th><th style={thL}></th>
          </tr></thead>
          <tbody>
            {groups.flatMap(([m, rs]) => {
              const inn = rs.filter(r => r.direction === 'in').reduce((s, r) => s + (+r.amount || 0), 0)
              const out = rs.filter(r => r.direction === 'out').reduce((s, r) => s + (+r.amount || 0), 0)
              const head = (
                <tr key={'h' + m} style={{ background: 'var(--surface-2, #334155)' }}>
                  <td style={{ ...tdL, fontWeight: 700, color: 'var(--accent, #FFE600)', fontFamily: 'Space Grotesk', whiteSpace: 'nowrap' }} colSpan={4}>{monthLabel(m)} <span style={{ color: 'var(--text-subtle)', fontWeight: 400, fontSize: 11 }}>&middot; {rs.length} txns</span></td>
                  <td style={{ ...tdL, fontSize: 11.5 }} colSpan={6}><span style={{ color: 'var(--success)' }}>In {fmtINR(inn)}</span> &nbsp; <span style={{ color: 'var(--danger)' }}>Out {fmtINR(out)}</span> &nbsp; <b>Net {fmtINR(inn - out)}</b></td>
                </tr>
              )
              const trs = rs.map(r => {
                const segmed = `${r.segment || ''}|${r.media_type || ''}`
                return (
                  <tr key={r.id} style={{ background: selected.has(r.id) ? 'rgba(255,230,0,.08)' : r.bucket === 'review' ? 'rgba(245,158,11,.06)' : undefined }}>
                    <td style={tdL}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td style={{ ...tdL, whiteSpace: 'nowrap', fontFamily: 'Space Grotesk' }}>{fmtDate(r.txn_date)}{r.note ? <span title={r.note} style={{ color: 'var(--warning)', marginLeft: 4 }}>~</span> : ''}</td>
                    <td style={{ ...tdL, maxWidth: 260 }} title={r.description}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>{r.ref_no ? <div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>Receipt {r.ref_no}</div> : null}</td>
                    <td style={{ ...tdR, color: r.direction === 'in' ? 'var(--success)' : 'var(--text)' }}>{r.direction === 'in' ? '+' : ''}{fmtINR(r.amount)}</td>
                    <td style={tdL}><select value={r.company || ''} onChange={e => patch(r.id, { company: e.target.value || null })} style={selStyle}><option value="">-</option>{COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}</select></td>
                    <td style={tdL}><select value={r.bucket} onChange={e => patch(r.id, { bucket: e.target.value })} style={selStyle}>{BUCKET_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td style={tdL}><select value={SEGMED.some(([k]) => k === segmed) ? segmed : ''} onChange={e => { const [sg, md] = e.target.value.split('|'); patch(r.id, { segment: sg || null, media_type: md || null }) }} style={selStyle}><option value="">-</option>{SEGMED.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td style={tdL}><select value={r.expense_head_id || ''} onChange={e => patch(r.id, { expense_head_id: e.target.value || null })} style={selStyle}><option value="">-</option>{heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></td>
                    <td style={tdL}><select value={r.bank_account_id || ''} onChange={e => patch(r.id, { bank_account_id: e.target.value })} style={selStyle}>{banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>
                    <td style={tdL}><span onClick={() => del(r)} style={{ cursor: 'pointer', color: 'var(--text-subtle)', display: 'inline-flex' }} title="Delete"><Trash2 size={15} /></span></td>
                  </tr>
                )
              })
              return [head, ...trs]
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-subtle)' }}>No transactions match.</div>}
      </div>
    </Card>
  )
}
