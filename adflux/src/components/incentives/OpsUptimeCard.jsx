// src/components/incentives/OpsUptimeCard.jsx
//
// The ops "My Performance" hero card — the SAME visual format as
// PerformanceScoreCard (§68): a score ring + Base/Variable/Projected grid +
// milestone box + status banner. Only the driver changes: uptime, not
// meeting-score. Reuses the lead-* design system + incentives.css.
//
// scope='exec' → the exec's own screens (ops_my_uptime_pay §233).
// scope='head' → network-wide uptime + flat salary (head-pay model pending
//                the owner's call — no personal variable).
//
// Indicative until uptime-pay p4 (§234) is live; ops_my_uptime_pay returns
// has_data=false until the screens report → the empty state shows.

import { useEffect, useState } from 'react'
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Sparkles, CheckCircle2, Circle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { estVariable, uptimeTone, UPTIME_FLOOR, UPTIME_TARGET, UPTIME_MAX } from '../../utils/opsPay'

const TONE = { danger: 'var(--danger)', warning: 'var(--warning)', success: 'var(--success)', muted: 'var(--text-muted)' }
function fmtINR(n) { return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(n) || 0)) }

export default function OpsUptimeCard({ scope = 'exec' }) {
  const isHead = scope === 'head'
  const [uptime, setUptime] = useState(null)   // whole %
  const [salary, setSalary] = useState(0)
  const [hasData, setHasData] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        const payRes = await supabase.rpc('ops_my_uptime_pay')
        const pay = Array.isArray(payRes.data) ? payRes.data[0] : payRes.data
        const sal = pay ? Number(pay.salary) || 0 : 0
        if (isHead) {
          const { data } = await supabase.from('ops_screens').select('status').eq('is_active', true)
          const rows = data || []
          const on = rows.filter(r => r.status === 'online').length
          const off = rows.filter(r => r.status === 'offline').length
          const net = (on + off) > 0 ? Math.round(on / (on + off) * 100) : null
          if (!cancel) { setUptime(net); setSalary(sal); setHasData(net != null) }
        } else {
          const up = pay && pay.has_data ? Math.round(Number(pay.uptime_pct) || 0) : null
          if (!cancel) { setUptime(up); setSalary(sal); setHasData(!!(pay && pay.has_data)) }
        }
      } catch { /* leave empty */ }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [isHead])

  if (loading) {
    return (
      <div className="lead-card lead-card-pad" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading uptime…
      </div>
    )
  }

  if (!hasData) {
    return (
      <div className="lead-card" style={{ padding: 20, marginBottom: 14, textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 999, margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,230,0,.10)', color: 'var(--accent, #FFE600)' }}>
          <Sparkles size={22} strokeWidth={1.6} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>No uptime data yet this month</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {isHead
            ? 'Network uptime appears here once the screens start reporting.'
            : 'Your salary and variable appear here once your screens start reporting uptime.'}
        </div>
      </div>
    )
  }

  const tone = uptimeTone(uptime)
  const ringColor = TONE[tone]
  const base = Math.round(salary * 0.70)
  const cap = Math.round(salary * 0.30)
  const variable = estVariable(salary, uptime)
  const projected = base + variable

  return (
    <div className="lead-card" style={{ padding: 16, marginBottom: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
        This month — {isHead ? 'network uptime' : 'screen uptime'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
          <svg viewBox="0 0 100 100" width="96" height="96">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-2)" strokeWidth="9" />
            <circle cx="50" cy="50" r="42" fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${(uptime / 100) * 264} 264`} transform="rotate(-90 50 50)" style={{ transition: 'stroke-dasharray .4s' }} />
            <text x="50" y="55" textAnchor="middle" fontFamily="Space Grotesk, system-ui" fontWeight="700" fontSize="22" fill="var(--text)">{uptime}%</text>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            {isHead
              ? 'The whole network live during 7 AM–9 PM, averaged this month.'
              : 'Your screens live during 7 AM–9 PM, averaged this month.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Base (70%)</span>
            <span className="mono" style={{ color: 'var(--text)' }}>{fmtINR(base)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Variable (30%)</span>
            <span className="mono" style={{ color: variable === 0 ? 'var(--danger)' : 'var(--text)' }}>{fmtINR(variable)} / {fmtINR(cap)}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Projected total</span>
            <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>{fmtINR(projected)}</span>
          </div>
        </div>
      </div>

      {(
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', fontSize: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>What's driving your variable</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 12 }}>
            <MRow ok={uptime >= UPTIME_FLOOR} label={`${UPTIME_FLOOR}% floor`}
              note={uptime >= UPTIME_FLOOR ? 'Variable unlocked' : `${Math.max(0, UPTIME_FLOOR - uptime).toFixed(0)}% to unlock variable`}
              pendColor="var(--danger)" />
            <MRow ok={uptime >= UPTIME_TARGET} label={`${UPTIME_TARGET}% target`}
              note={uptime >= UPTIME_TARGET ? 'On target' : `${Math.max(0, UPTIME_TARGET - uptime).toFixed(0)}% to team target`}
              pendColor="var(--warning)" />
            <MRow ok={uptime >= UPTIME_MAX} label={`${UPTIME_MAX}% max`}
              note={uptime >= UPTIME_MAX ? 'Full variable' : `${Math.max(0, UPTIME_MAX - uptime).toFixed(0)}% to full variable`}
              pendColor="var(--text-muted)" />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
            {isHead
              ? "Uptime = share of the whole network's screens live during 7 AM–9 PM."
              : 'Uptime = share of your screens live during 7 AM–9 PM, averaged this month.'}
          </div>
        </div>
      )}

      {(
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 8,
          background: tone === 'danger' ? 'rgba(239,68,68,.08)' : tone === 'success' ? 'rgba(16,185,129,.08)' : 'rgba(245,158,11,.08)',
          border: `1px solid ${ringColor}`, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {tone === 'danger'
            ? <><AlertTriangle size={13} color="var(--danger)" /> Below 90% — variable is zero. Get {isHead ? 'the network' : 'your screens'} back up to unlock it.</>
            : tone === 'success'
              ? <><TrendingUp size={13} color="var(--success)" /> Full variable payout on track.</>
              : <><TrendingDown size={13} color="var(--warning)" /> Variable scales with uptime — reach {UPTIME_MAX}% to max it.</>}
        </div>
      )}
    </div>
  )
}

function MRow({ ok, label, note, pendColor }) {
  return (
    <>
      <span style={{ color: ok ? 'var(--success)' : pendColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {ok ? <CheckCircle2 size={12} strokeWidth={1.6} /> : <Circle size={12} strokeWidth={1.6} />}{label}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>{note}</span>
    </>
  )
}
