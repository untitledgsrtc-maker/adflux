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
  // Phase 31E — owner reported (9 May 2026) Voice Logs hero stat showed
  // "0 · counts coming · live". The voice_logs table has been live
  // since Phase 20 — placeholder copy was just stale. Wire actual
  // counts the same way callsByUser is wired.
  const [voiceByUser, setVoiceByUser] = useState({})
  // Phase 34U — latest GPS ping per rep (today only). Used to show
  // "📍 last seen N min ago" on each rep card instead of just the
  // static profile city. Owner reported the static city read as
  // "live location not fetched in dashboard".
  const [latestPingByUser, setLatestPingByUser] = useState({})
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

      const [repsRes, sesRes, callsRes, newLeadsRes, pipelineRes, voiceRes, pingsRes] = await Promise.all([
        // Phase 32F — agency excluded from Team Live grid. Owner spec
        // (10 May 2026): agency = external commission partner, not
        // an employee. They don't have GPS / attendance / morning
        // plan, so Team Live (a 'where are my reps right now' view)
        // doesn't apply. Reps shown here are the in-house field team.
        supabase.from('users')
          .select('id, name, team_role, city, daily_targets, is_active')
          .in('team_role', ['sales', 'sales_manager'])
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
        // Phase 18 — only count won quotes for "pipeline added today",
        // not every quote created. Drafts/sent/lost shouldn't inflate the
        // headline number. Owner saw ₹2.7Cr because every quote created
        // today was being summed regardless of status.
        supabase.from('quotes')
          .select('total_amount, status')
          .eq('status', 'won')
          .gte('created_at', startOfDay),
        // Phase 31E — voice_logs counted per rep for today.
        supabase.from('voice_logs')
          .select('user_id')
          .gte('created_at', startOfDay),
        // Phase 34U — pull every GPS ping captured today; we'll pick
        // the latest per user client-side. Cheaper than N round-trips
        // (one per rep), and the per-day per-rep set is small (10-h
        // shift × 1 ping / 5 min = ~120 rows / rep max).
        supabase.from('gps_pings')
          .select('user_id, lat, lng, captured_at, accuracy_m')
          .gte('captured_at', startOfDay)
          .order('captured_at', { ascending: false }),
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
      // Phase 31E — same shape as callsByUser: row-per-log, count by user_id.
      const voiceMap = {}
      ;(voiceRes.data || []).forEach(r => {
        if (!r.user_id) return
        voiceMap[r.user_id] = (voiceMap[r.user_id] || 0) + 1
      })
      setVoiceByUser(voiceMap)
      // Phase 34U — pick the latest ping per rep (rows already
      // ordered desc by captured_at, so the FIRST ping seen wins).
      const pingMap = {}
      ;(pingsRes.data || []).forEach((p) => {
        if (!p.user_id) return
        if (!pingMap[p.user_id]) pingMap[p.user_id] = p
      })
      setLatestPingByUser(pingMap)
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

  // Phase 31E — total voice logs across the team, today.
  const totalVoiceToday = useMemo(() => {
    return Object.values(voiceByUser).reduce((s, n) => s + n, 0)
  }, [voiceByUser])

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
          <HeroStat label="Voice logs"        value={totalVoiceToday}              delta={totalVoiceToday > 0 ? 'recorded today' : 'none yet today'}  acc />
          <HeroStat label="New leads added"   value={newLeadsToday}                delta="today"                                   up={newLeadsToday > 0} />
          <HeroStat label="Won today"         value={formatLakh(pipelineToday)}    delta="status=won"                              up={pipelineToday > 0} />
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
            <div
              className={`lead-rep-card ${isLive ? 'live' : ''}`}
              key={r.id}
              onClick={() => navigate(`/admin/gps/${r.id}`)}
              style={{ cursor: 'pointer' }}
              title={`Open ${r.name}'s full day`}
            >
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
                  {/* Phase 31E — wired to voiceByUser instead of literal 0. */}
                  <div className={`num ${(voiceByUser[r.id] || 0) > 0 ? 'acc' : ''}`}>
                    {voiceByUser[r.id] || 0}
                  </div>
                  <div className="lbl">Voice</div>
                </div>
              </div>
              <div className="lead-rep-progress">
                <span className={cls} style={{ width: `${Math.min(callPct, 100)}%` }} />
              </div>
              <div className="lead-rep-foot">
                <MapPin size={11} />
                {/* Phase 34U — live GPS readout. Falls back to the
                    static profile city when no ping was captured
                    today. */}
                <span>
                  {(() => {
                    const ping = latestPingByUser[r.id]
                    if (!ping) return r.city || '—'
                    const minsAgo = Math.max(0, Math.floor((Date.now() - new Date(ping.captured_at).getTime()) / 60000))
                    const fresh = minsAgo <= 10
                    const ago = minsAgo < 1
                      ? 'just now'
                      : minsAgo < 60
                        ? `${minsAgo} min ago`
                        : `${Math.floor(minsAgo / 60)}h ago`
                    return (
                      <>
                        <span style={{ color: fresh ? 'var(--success, #10B981)' : 'var(--text-muted, #94a3b8)' }}>
                          {fresh ? '● live' : '○'} {ago}
                        </span>
                        {r.city && <span style={{ color: 'var(--text-subtle, #64748b)', marginLeft: 6 }}>· {r.city}</span>}
                      </>
                    )
                  })()}
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {counters.new_leads ? <>Leads today: <b>{counters.new_leads}</b></> : null}
                  {/* Phase 31Z — owner couldn't find the GPS map view
                      because no UI surface linked to it. Each rep card
                      now has a "View track" link to /admin/gps/:userId
                      (defaults to today's date in GpsTrackV2). */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/admin/gps/${r.id}`) }}
                    style={{
                      background: 'transparent', border: 0,
                      color: 'var(--accent, #FFE600)',
                      fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', padding: 0,
                      textDecoration: 'underline',
                    }}
                    title="View today's GPS track on a map"
                  >
                    View track →
                  </button>
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ height: 16 }} />

      {/* Live voice feed — Phase 21a: voice is live (Phase 20). The
          live-streaming roll-up of voice_logs across the team is a
          Sprint C item once we have meaningful volume. For now this
          card just confirms the feature is deployed. */}
      <div className="lead-card">
        <div className="lead-card-head">
          <div>
            <div className="lead-card-title">
              <span className="voice-pill" style={{ marginRight: 8 }}>
                <Mic size={10} style={{ marginRight: 4 }} /> live
              </span>
              Live voice feed · all reps
            </div>
            <div className="lead-card-sub">
              Auto-classified · transcripts on each lead's timeline
            </div>
          </div>
        </div>
        <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
          Voice logging is deployed. Reps record from any lead detail page or <b style={{ color: 'var(--text)' }}>/voice</b>. Whisper transcribes, Claude classifies (call/whatsapp/meeting · positive/neutral/negative), and the result lands as a lead activity. A roll-up of recent voice logs across the whole team will surface here once usage builds up.
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
