// src/pages/v2/OpsMyPerformanceV2.jsx
//
// "My Performance" for the Operations roles — the SAME format as the sales
// MyPerformanceV2 (§68), but composed for ops: the uptime hero card
// (OpsUptimeCard) + ops KPI tiles + the reused SalarySlipsCard (§79). The
// sales MyPerformanceV2 mounts revenue / campaign / presentation cards that
// mean nothing to an ops tech, so this is a dedicated ops page rather than a
// branch inside the §28-frozen sales page.
//
// exec → own screens' uptime + own calls/fixes.
// head → network uptime + team fixes (flat salary — head-pay model pending).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { istTodayISO } from '../../utils/istDate'
import { CalendarOff } from 'lucide-react'
import OpsUptimeCard from '../../components/incentives/OpsUptimeCard'
import TotalPayableCard from '../../components/incentives/TotalPayableCard'
import SalarySlipsCard from '../../components/incentives/SalarySlipsCard'
import TaDaRequestPanel from '../../components/incentives/TaDaRequestPanel'
import RepLeaveHistory from '../../components/leads/RepLeaveHistory'
import { RequestLeaveModal } from '../../components/leads/RepDayTools'
import { toastSuccess } from '../../components/v2/Toast'
import '../../styles/incentives.css'

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export default function OpsMyPerformanceV2() {
  const { profile } = useAuth()
  const uid = profile?.id
  const isHead = profile?.role === 'operation_head'
  const [kpi, setKpi] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaveRefresh, setLeaveRefresh] = useState(0)

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const monthStart = istTodayISO().slice(0, 8) + '01'
      const dayStart = istTodayISO() + 'T00:00:00+05:30'

      let depotIds = null
      if (!isHead) {
        const d = await supabase.from('ops_depots').select('id').eq('assigned_to', uid).eq('is_active', true)
        depotIds = (d.data || []).map(x => x.id)
      }

      let scrQ = supabase.from('ops_screens').select('status').eq('is_active', true)
      if (!isHead) scrQ = scrQ.in('depot_id', depotIds && depotIds.length ? depotIds : [NIL_UUID])

      let tkQ = supabase.from('ops_tickets').select('created_at, resolved_at').eq('status', 'resolved').eq('source', 'manual').gte('resolved_at', monthStart)
      if (!isHead) tkQ = tkQ.eq('assigned_to', uid)

      const clQ = isHead
        ? Promise.resolve({ data: [] })
        : supabase.from('call_logs').select('call_at').eq('user_id', uid).gte('call_at', monthStart)

      const [scr, tk, cl] = await Promise.all([scrQ, tkQ, clQ])
      const rows = scr.data || []
      const up = rows.filter(r => r.status === 'online').length
      const down = rows.filter(r => r.status === 'offline').length
      const fx = tk.data || []
      const durs = fx.map(r => (r.resolved_at && r.created_at) ? (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000 : null).filter(v => v != null && v >= 0)
      const calls = cl.data || []
      setKpi({
        up, down,
        fixedMo: fx.length,
        avgFixH: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
        callsMo: calls.length,
        callsToday: calls.filter(c => c.call_at >= dayStart).length,
      })
    } catch { /* keep prior */ }
  }, [uid, isHead])

  useEffect(() => { load() }, [load])
  // §318 — scope the realtime sub to own rows (ops tables aren't in the
  // publication anyway; this avoids a refetch on every other rep's activity).
  useAutoRefresh(() => { load(); setRefreshKey(k => k + 1) }, { userId: uid })

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Your numbers</div>
          <h1 className="v2d-page-title">My Performance</h1>
          <div className="v2d-page-sub">
            {isHead ? 'Network uptime, team fixes and your salary.' : 'Monthly uptime, salary projection, fixes and calls.'}
          </div>
        </div>
      </div>

      <OpsUptimeCard key={`up-${refreshKey}`} scope={isHead ? 'head' : 'exec'} />

      {/* Grand-total payable — the same consolidated card a sales rep gets
          (base + variable + incentive + TA/DA − unpaid-leave). Reads the
          single-source compute_monthly_salary RPC; variable follows the
          monthly score (uptime-derived once uptime pay is recording).
          EXEC only: the head's pay model is flat/pending (§251), and with no
          uptime score rows compute_monthly_salary would read a §184
          full-variable cap — so the head keeps the uptime projection card
          above as the payable surface, not this one. */}
      {!isHead && <TotalPayableCard key={`tp-${refreshKey}`} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Tile label="Fixed this month" val={kpi?.fixedMo ?? '—'} />
        <Tile label="Avg to fix" val={kpi?.avgFixH != null ? `${kpi.avgFixH}h` : '—'} />
        {!isHead && (
          <Tile label="My calls" val={kpi?.callsMo ?? '—'} sub={<span style={{ color: 'var(--text-muted)' }}>{kpi?.callsToday ?? 0} today</span>} />
        )}
        <Tile
          label={isHead ? 'Network screens' : 'My stations'}
          val={(kpi?.up ?? 0) + (kpi?.down ?? 0)}
          sub={<span><span style={{ color: 'var(--success)' }}>{kpi?.up ?? 0} up</span> · <span style={{ color: 'var(--danger)' }}>{kpi?.down ?? 0} down</span></span>}
        />
      </div>

      <SalarySlipsCard key={`slip-${refreshKey}`} />

      {/* TA / DA claim — the field exec's travel (₹3/km) + DA / hotel, same panel
          a sales rep gets on /my-offer. Self-scoped to the signed-in user. */}
      <TaDaRequestPanel />

      {/* Leave — request + history, same surface a sales rep gets on /my-offer.
          leaves RLS is role-agnostic → real for an ops exec today. */}
      {uid && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button className="v2d-cta" onClick={() => setLeaveOpen(true)}>
            <CalendarOff size={15} />
            <span>Request leave</span>
          </button>
        </div>
      )}
      {uid && <RepLeaveHistory userId={uid} refreshKey={leaveRefresh} />}
      {leaveOpen && (
        <RequestLeaveModal
          userId={uid}
          onClose={() => setLeaveOpen(false)}
          onSaved={() => { toastSuccess('Leave request submitted — admin will approve.'); setLeaveRefresh(k => k + 1) }}
        />
      )}
    </div>
  )
}

function Tile({ label, val, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-display, var(--font-sans))', color: 'var(--text)' }}>{val}</div>
      {sub && <div style={{ fontSize: 10 }}>{sub}</div>}
    </div>
  )
}
