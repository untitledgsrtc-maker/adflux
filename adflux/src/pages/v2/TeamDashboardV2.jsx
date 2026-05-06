// src/pages/v2/TeamDashboardV2.jsx
//
// Phase 16 commit 7 — Team Dashboard, ported from
// _design_reference/Leads/lead-voice.jsx (AdminTeamDash).
// Route: /team-dashboard. Privileged users only (admin/co_owner/sales_manager).
//
// Layout (matches design):
//   • Hero strip — purple gradient (Field Activity · Live)
//     5 KPIs: Reps active / Calls today / Voice logs / New leads / Pipeline added
//   • Rep grid — 3 cards per row at desktop, each card shows rep avatar,
//     name + role, live status pill, 3 KPIs (meetings/calls/voice),
//     progress bar (call target %), foot row with city + ₹ won today
//   • Live voice feed — Phase 2 placeholder
//
// Real-data wiring:
//   • Reps from users table where team_role IN sales/agency/sales_manager
//     AND is_active=true
//   • Live status from work_sessions check_in_at today
//   • Per-rep counters from work_sessions.daily_counters today
//   • Calls from call_logs count grouped by user_id today
//   • Won today value from quotes status='won' + payments today (rough)

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users as UsersIcon, MapPin, Mic, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { LeadAvatar, Pill } from '../../components/leads/LeadShared'
import { formatCurrency } from '../../utils/formatters'

export default function TeamDashboardV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner', 'sales_manager'].includes(profile?.role)

  const [reps, setReps] = useState([])
  const [sessions, setSessions] = useState([])
  const [callsByUser, setCallsByUser] = useState({})
  const [newLeadsToday, setNewLeadsToday] = useState(0)
  const [pipelineToday, setPipelineToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isPrivileged) return
    async function load() {
      setLoading(true); setError('')
      const today = new Date().toISOString().slice(0, 10)
      const startOfDay = `${today}T00:00:00`

      const [repsRes, sesRes, callsRes, newLeadsRes, pipelineRes] = await Promise.all([
        supabase.from('users')
          .select('id, name, team_role, city, daily_targets, is_active')
          .in('team_role', ['sales', 'agency', 'sales_manager'])
          .eq('is_active', true)
          .order('name'),
        supabase.from('work_sessions')
          .select('user_id, check_in_at, daily_counters')
          .eq('work_date', today),
        supabase.from('call_logs')
          .select('user_id', { count: 'exact' })
          .gte('call_at', startOfDay),
        supabase.from('leads')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startOfDay),
        supabase.from('quotes')
          .select('total_amount')
          .gte('created_at', startOfDay),
      ])
      if (repsRes.error || sesRes.error) {
        setError(repsRes.error?.message || sesRes.error?.message || 'Load failed')
      }
      setReps(repsRes.data || [])
      setSessions(sesRes.data || [])
      // Build calls-by-user map. PostgREST count with select returns
      // an array of rows so we count per user_id.
      const byUser = {}
      ;(callsRes.data || []).forEach(r => {
        byUser[r.user_id] = (byUser[r.user_id] || 0) + 1
      })
      setCallsByUser(byUser)
      setNewLeadsToday(newLeadsRes.count || 0)
      setPipelineToday((pipelineRes.data || []).reduce((s, q) => s + (Number(q.total_amount) || 0), 0))
      setLoading(false)
    }
    load()
  }, [isPrivileged])

  const sessionByUser = useMemo(() => {
    const m = new Map()
    sessions.forEach(s => m.set(s.user_id, s))
    return m
  }, [sessions])

  const live = useMemo(() => {
    return reps.filter(r => sessionByUser.get(r.id)?.check_in_at).length
  }, [reps, sessionByUser])

  const totalCallsToday = useMemo(() => {
    return Object.values(callsByUser).reduce((s, n) => s + n, 0)
  }, [callsByUser])

  if (!isPrivileged) {
    return (
      <div className="lead-root">
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          Team Dashboard is admin / sales-manager only.
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="lead-root">
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>Loading team dashboard…</div>
        </div>
      </div>
    )
  }

  const niceTime = new Date().toLocaleString('en-IN', {
    weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">
            Field force · {reps.length} active reps · live
          </div>
          <div className="lead-page-title">Team Dashboard</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="lead-btn lead-btn-primary" onClick={() => navigate('/leads')}>
            <UsersIcon size={14} /> Reassign queue
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13,
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Hero strip — purple gradient (overriding the default teal) */}
      <div
        className="lead-hero-strip"
        style={{
          background: 'radial-gradient(700px 220px at 100% 0%, rgba(192,132,252,.22), transparent 60%), linear-gradient(120deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)',
          borderColor: '#4338ca',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>
            <span className="lead-live-dot" />&nbsp;&nbsp;Field activity · live
          </div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{niceTime} IST</span>
        </div>
        <div className="lead-hero-stats">
          <HeroStat label="Reps active now"   value={`${live} / ${reps.length}`}   delta={`${reps.length - live} not checked-in`} down={live < reps.length} />
          <HeroStat label="Calls today"       value={totalCallsToday}             delta="from call_logs"                          up={totalCallsToday > 0} />
          <HeroStat label="Voice logs"        value={0}                            delta="Phase 2 — needs API"                     acc />
          <HeroStat label="New leads added"   value={newLeadsToday}                delta="today"                                   up={newLeadsToday > 0} />
          <HeroStat label="Pipeline added"    value={formatLakh(pipelineToday)}    delta="today"                                   up={pipelineToday > 0} />
        </div>
      </div>

      {/* Rep grid */}
      <div className="lead-team-grid">
        {reps.map(r => {
          const sess = sessionByUser.get(r.id)
          const isLive = !!sess?.check_in_at
          const counters = sess?.daily_counters || {}
          const targets = r.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
          const callsHere = callsByUser[r.id] || 0
          const callsTarget = targets.calls || 20
          const callPct = Math.round((callsHere / callsTarget) * 100)
          const cls = callPct >= 80 ? '' : callPct >= 50 ? 'warn' : 'dng'
          return (
            <div className={`lead-rep-card ${isLive ? 'live' : ''}`} key={r.id}>
              <div className="lead-rep-head">
                <LeadAvatar name={r.name} userId={r.id} />
                <div>
                  <div className="lead-rep-name">{r.name}</div>
                  <div className="lead-rep-meta">
                    {r.team_role}{r.city ? ` · ${r.city}` : ''}
                  </div>
                </div>
                <div className="lead-rep-status">
                  {isLive ? (
                    <Pill tone="success">
                      <span className="lead-live-dot" style={{ marginRight: 5, width: 6, height: 6 }} />
                      in field
                    </Pill>
                  ) : (
                    <Pill>off</Pill>
                  )}
                </div>
              </div>
              <div className="lead-rep-kpis">
                <div className="lead-rep-kpi">
                  <div className={`num ${counters.meetings >= targets.meetings ? 'suc' : counters.meetings === 0 ? 'dng' : ''}`}>
                    {counters.meetings || 0}/{targets.meetings || 0}
                  </div>
                  <div className="lbl">Meet</div>
                </div>
                <div className="lead-rep-kpi">
                  <div className={`num ${callPct >= 80 ? 'suc' : callPct >= 50 ? '' : 'dng'}`}>
                    {callsHere}/{callsTarget}
                  </div>
                  <div className="lbl">Calls</div>
                </div>
                <div className="lead-rep-kpi">
                  <div className="num acc">0</div>
                  <div className="lbl">Voice</div>
                </div>
              </div>
              <div className="lead-rep-progress">
                <span className={cls} style={{ width: `${Math.min(callPct, 100)}%` }} />
              </div>
              <div className="lead-rep-foot">
                <MapPin size={11} />
                <span>{r.city || '—'}</span>
                <span style={{ marginLeft: 'auto' }}>
                  {counters.new_leads ? <>Leads today: <b>{counters.new_leads}</b></> : '—'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ height: 16 }} />

      {/* Live voice feed — Phase 2 placeholder */}
      <div className="lead-card">
        <div className="lead-card-head">
          <div>
            <div className="lead-card-title">
              <span className="voice-pill" style={{ marginRight: 8 }}>
                <Mic size={10} style={{ marginRight: 4 }} /> coming soon
              </span>
              Live voice feed · all reps
            </div>
            <div className="lead-card-sub">
              Auto-translated · auto-classified · Phase 2 (needs Anthropic API)
            </div>
          </div>
        </div>
        <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
          When the voice integration goes live, every rep speaking into their phone (Gujarati / Hindi / English) will appear here in near-real-time, transcribed and classified by Claude. Today this stream is empty because the API is not yet deployed.
        </div>
      </div>
    </div>
  )
}

/* ─── Helpers ─── */
function HeroStat({ label, value, delta, up, down, acc }) {
  return (
    <div className="lead-hero-stat">
      <div className="lbl">{label}</div>
      <div className={`val ${acc ? 'acc' : ''}`}>{value}</div>
      <div className={`delta ${up ? 'up' : down ? 'down' : ''}`}>{delta}</div>
    </div>
  )
}

function formatLakh(n) {
  const x = Number(n) || 0
  if (x >= 10000000) return `₹${(x / 10000000).toFixed(1)}Cr`
  if (x >= 100000)   return `₹${(x / 100000).toFixed(1)}L`
  if (x >= 1000)     return `₹${(x / 1000).toFixed(0)}K`
  return `₹${x}`
}
