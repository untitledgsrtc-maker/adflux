// src/pages/v2/ManagerDashboardV2.jsx
//
// Phase 61 (19 May 2026) — Manager dashboard MVP.
//
// Lands sales_manager (Jubin = sales head, Renuka = TC head). Shows:
//   - 4 hero tiles: team size · today's pipeline · today's calls · today's meetings
//   - Direct-reports grid: rep card per team member
//       · name + role chip
//       · today's calls (count + connect %)
//       · today's meetings (count)
//       · open leads (count)
//       · last GPS ping age (sales reps only)
//   - Tap a rep → /admin/calls/<userId> (existing per-rep call log)
//
// Data source: users.manager_id = profile.id chain. RLS already
// scopes call_logs / lead_activities / leads to a rep's own rows;
// manager sees the union via a single SELECT that filters by
// manager_id (Phase 42 column).
//
// What this DOES NOT do (MVP scope):
//   - No reassign-leads UI here. Owner directive: "admin can reassign
//     team to manager" lives in the admin People tab (TeamV2 edit).
//   - No coaching modal / call-recording surface. Phase 62+.
//   - No incentive-override editor. Phase 62+.

import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Phone, Calendar, Inbox, Users as UsersIcon, TrendingUp, MapPin, Loader2 } from 'lucide-react'
import OldCallbacksPanel from '../../components/manager/OldCallbacksPanel'

const istTodayISO = () => {
  // IST date at server-style format (yyyy-mm-dd). The dashboard
  // queries always anchor on the IST workday.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
  return fmt.format(new Date())
}

export default function ManagerDashboardV2() {
  const navigate = useNavigate()
  const { profile, isManager, isManagerSales, isManagerTelecaller } = useAuth()

  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [reps, setReps]           = useState([])
  const [byUser, setByUser]       = useState({}) // rep_id → {calls, connected, meetings, openLeads, lastPing}
  const [teamOpen, setTeamOpen]   = useState(null) // Phase 582: distinct open leads of the team

  useEffect(() => {
    if (!profile?.id || !isManager) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError('')
      try {
        const today = istTodayISO()
        // IST midnight (was UTC midnight, which counted yesterday evening 18:30-24:00 IST as today).
        const startUtc = `${today}T00:00:00+05:30`

        // 1. Direct reports — users.manager_id = me.
        const { data: repsRows, error: repsErr } = await supabase
          .from('users')
          .select('id, name, role, team_role, city, designation, is_active')
          .eq('manager_id', profile.id)
          .eq('is_active', true)
          .order('name', { ascending: true })
        if (repsErr) throw repsErr
        if (cancelled) return

        const repIds = (repsRows || []).map(r => r.id)
        setReps(repsRows || [])

        if (repIds.length === 0) {
          setByUser({})
          setLoading(false)
          return
        }

        // 2. Today's calls per rep + connected count.
        // Phase 76.2.2 (2026-05-23) — only calls with
        // duration_seconds >= 10 count toward the KPI. Mirrors the
        // filter on /telecaller, /work (useDaySummary), and
        // /team-dashboard. NULLs excluded by Postgres .gte.
        // Phase 93.1 — also exclude direction='missed' (inbound
        // unanswered) so the count matches GpsTrack's qualified
        // bucket. .or() preserves legacy rows where direction=NULL.
        // Phase 93.24 — lead-tied calls only.
        // Perf (audit M13) — queries 2-5 all depend only on repIds+startUtc and
        // are mutually independent → one parallel wave, not 4 serial round-trips.
        const [
          { data: callRows },   // 2. Today's calls per rep (>=10s, lead-tied, not missed).
          { data: meetRows },   // 3. Today's meetings per rep (activity_type='meeting').
          { data: leadRows },   // 4. Open leads per rep (stage not in Won/Lost).
          { data: pingRows },   // 5. Latest GPS ping per rep (today only).
          { count: openTotal }, // 6. Phase 582: team open leads, each counted once.
        ] = await Promise.all([
          supabase.from('call_logs')
            .select('user_id, outcome')
            .in('user_id', repIds)
            .gte('call_at', startUtc) // Phase 589 - call time, same as Team Live (was sync time)
            .gte('duration_seconds', 10)
            .or('direction.is.null,direction.neq.missed')
            .not('lead_id', 'is', null),
          // Phase 568 — done meetings only (CLAUDE.md section 33): meeting + site_visit, minus scheduled
          // ("Meeting scheduled...") and auto check-in companion rows, one per lead (revisits = 1).
          // Same rule as GpsTrackV2.uniqueMeetingCount and the DB counter; keep in lockstep.
          supabase.from('lead_activities')
            .select('id, created_by, lead_id, activity_type, notes')
            .in('created_by', repIds)
            .in('activity_type', ['meeting', 'site_visit'])
            .gte('created_at', startUtc),
          // Phase 582 — exact count per rep in the database (was: download rows,
          // capped at 1000 by the API, so the total read 1000 and some reps 0).
          // A lead counts for a rep when they are its owner OR its telecaller.
          Promise.all(repIds.map(id => supabase.from('leads')
            .select('id', { count: 'exact', head: true })
            .or(`assigned_to.eq.${id},telecaller_id.eq.${id}`)
            .not('stage', 'in', '(Won,Lost)')
            .then(({ count }) => [id, count || 0])))
            .then(pairs => ({ data: pairs })),
          // Phase 582 — one latest ping per rep (the old single query took the newest
          // 1000 pings of the whole team, so a rep who stopped earlier read "No GPS today").
          Promise.all(repIds.map(id => supabase.from('gps_pings')
            .select('user_id, created_at')
            .eq('user_id', id)
            .gte('created_at', startUtc)
            .order('created_at', { ascending: false })
            .limit(1)
            .then(({ data }) => (data && data[0]) || null)))
            .then(rows => ({ data: rows.filter(Boolean) })),
          // Phase 582 — team total counts each open lead once (a lead can have an owner
          // AND a telecaller in the same team).
          supabase.from('leads')
            .select('id', { count: 'exact', head: true })
            .or(`assigned_to.in.(${repIds.join(',')}),telecaller_id.in.(${repIds.join(',')})`)
            .not('stage', 'in', '(Won,Lost)'),
        ])

        const calls   = {}
        const conn    = {}
        const meet    = {}
        const open    = {}
        const ping    = {}
        ;(callRows || []).forEach(r => {
          calls[r.user_id] = (calls[r.user_id] || 0) + 1
          if (r.outcome === 'connected') conn[r.user_id] = (conn[r.user_id] || 0) + 1
        })
        const meetSeen = new Set()
        ;(meetRows || []).forEach(r => {
          const note = r.notes || ''
          if (note.startsWith("I'm here · auto-check-in") || note.startsWith('Meeting scheduled')) return
          const key = `${r.created_by}|${r.lead_id || `walkin_${r.id}`}`
          if (meetSeen.has(key)) return
          meetSeen.add(key)
          meet[r.created_by] = (meet[r.created_by] || 0) + 1
        })
        ;(leadRows || []).forEach(([id, n]) => { open[id] = n })
        ;(pingRows || []).forEach(r => {
          // First (most recent) wins because rows are ordered DESC.
          if (!ping[r.user_id]) ping[r.user_id] = r.created_at
        })

        if (!cancelled) setTeamOpen(openTotal ?? null)
        if (!cancelled) {
          setByUser(Object.fromEntries(repIds.map(id => [id, {
            calls:     calls[id] || 0,
            connected: conn[id]  || 0,
            meetings:  meet[id]  || 0,
            openLeads: open[id]  || 0,
            lastPing:  ping[id]  || null,
          }])))
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load team')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [profile?.id, isManager])

  // Hero tile totals.
  const totals = useMemo(() => {
    const acc = { calls: 0, connected: 0, meetings: 0, openLeads: 0 }
    Object.values(byUser).forEach(r => {
      acc.calls     += r.calls
      acc.connected += r.connected
      acc.meetings  += r.meetings
      acc.openLeads += r.openLeads
    })
    return acc
  }, [byUser])

  if (!isManager) {
    // Defensive guard — RootRedirect should have prevented landing
    // here, but a deep-link could still hit /manager directly.
    return (
      <div className="v2" style={{ padding: 24, color: 'var(--v2-ink-1, #cbd5e1)' }}>
        This page is for team leads only.
      </div>
    )
  }

  return (
    <div className="v2" style={{ padding: '24px 20px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontFamily:    'var(--v2-display, "Space Grotesk")',
          fontSize:      13,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color:         'var(--v2-ink-2, #94a3b8)',
        }}>
          {isManagerSales ? 'Sales team' : isManagerTelecaller ? 'Telecaller team' : 'My Team'}
        </div>
        <h1 style={{
          fontFamily: 'var(--v2-display, "Space Grotesk")',
          fontSize:   28,
          fontWeight: 700,
          margin:     '6px 0 0',
          color:      'var(--v2-ink-0, #f1f5f9)',
        }}>
          {profile?.name?.split(' ')[0] || 'Manager'} · your team today
        </h1>
      </div>

      {/* Hero tiles */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap:                 12,
        marginBottom:        20,
      }}>
        <HeroTile icon={<UsersIcon size={16} />}   label="Team size"     value={reps.length} />
        <HeroTile icon={<Phone size={16} />}       label="Calls today"   value={totals.calls}
                  sub={totals.calls > 0
                    ? `${Math.round((totals.connected / totals.calls) * 100)}% connected`
                    : '—'} />
        <HeroTile icon={<Calendar size={16} />}    label="Meetings"      value={totals.meetings} />
        <HeroTile icon={<Inbox size={16} />}       label="Open leads"    value={teamOpen ?? totals.openLeads} />
      </div>

      {/* Direct-reports grid */}
      {loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 40, color: 'var(--v2-ink-2, #94a3b8)',
        }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
          Loading team…
        </div>
      )}

      {!loading && error && (
        <div style={{
          padding: 16, borderRadius: 14,
          background: 'rgba(239,68,68,0.10)',
          color:      'var(--v2-rose, #EF4444)',
        }}>
          {error}
        </div>
      )}

      {!loading && !error && reps.length === 0 && (
        <div style={{
          padding:      32,
          borderRadius: 14,
          background:   'var(--v2-bg-1, #1e293b)',
          border:       '1px dashed var(--v2-line, #334155)',
          textAlign:    'center',
          color:        'var(--v2-ink-2, #94a3b8)',
        }}>
          No direct reports assigned to you yet. Ask admin to assign reps under People → Team.
        </div>
      )}

      {!loading && !error && reps.length > 0 && (
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap:                 12,
        }}>
          {reps.map(r => (
            <RepCard
              key={r.id}
              rep={r}
              stats={byUser[r.id] || { calls: 0, connected: 0, meetings: 0, openLeads: 0, lastPing: null }}
              onClick={() => navigate(`/admin/calls/${r.id}`)}
            />
          ))}
        </div>
      )}

      {/* Phase 567 — old callbacks, oldest first, bulk close */}
      {!loading && !error && reps.length > 0 && <OldCallbacksPanel reps={reps} />}
    </div>
  )
}

function HeroTile({ icon, label, value, sub }) {
  return (
    <div style={{
      padding:      16,
      borderRadius: 14,
      background:   'var(--v2-bg-1, #1e293b)',
      border:       '1px solid var(--v2-line, #334155)',
    }}>
      <div style={{
        color: 'var(--v2-ink-2, #94a3b8)',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12,
      }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{
        marginTop:  4,
        fontFamily: 'var(--v2-display, "Space Grotesk")',
        fontSize:   28,
        fontWeight: 700,
        color:      'var(--v2-ink-0, #f1f5f9)',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          marginTop: 2,
          fontSize:  12,
          color:     'var(--v2-ink-2, #94a3b8)',
        }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function RepCard({ rep, stats, onClick }) {
  const connectPct = stats.calls > 0
    ? Math.round((stats.connected / stats.calls) * 100)
    : null
  const ageMin = stats.lastPing
    ? Math.floor((Date.now() - new Date(stats.lastPing).getTime()) / 60000)
    : null

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick?.() }}
      style={{
        padding:      14,
        borderRadius: 14,
        background:   'var(--v2-bg-1, #1e293b)',
        border:       '1px solid var(--v2-line, #334155)',
        cursor:       'pointer',
        transition:   'border-color 160ms, transform 160ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--v2-yellow, #FFE600)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--v2-line, #334155)' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{
          fontFamily: 'var(--v2-display, "Space Grotesk")',
          fontSize:   17,
          fontWeight: 600,
          color:      'var(--v2-ink-0, #f1f5f9)',
        }}>
          {rep.name}
        </div>
        <div style={{
          fontSize: 12,
          padding: '3px 8px',
          borderRadius: 999,
          background: 'rgba(148,163,184,0.10)',
          color: 'var(--v2-ink-2, #94a3b8)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {rep.role}
        </div>
      </div>
      {rep.city && (
        <div style={{ marginTop: 2, fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>
          {rep.city}{rep.designation ? ` · ${rep.designation}` : ''}
        </div>
      )}
      <div style={{
        marginTop: 12,
        display:   'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap:        8,
        fontSize:   12,
      }}>
        <Stat icon={<Phone size={12} />}    label="Calls"    value={stats.calls}    sub={connectPct != null ? `${connectPct}%` : null} />
        <Stat icon={<Calendar size={12} />} label="Meetings" value={stats.meetings} />
        <Stat icon={<Inbox size={12} />}    label="Open"     value={stats.openLeads} />
      </div>
      {rep.role === 'sales' && (
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12,
          color: ageMin == null
                  ? 'var(--v2-rose, #EF4444)'
                  : ageMin > 60
                    ? 'var(--v2-amber, #F59E0B)'
                    : 'var(--v2-green, #10B981)',
        }}>
          <MapPin size={12} />
          {ageMin == null
            ? 'No GPS today'
            : `Seen ${ageMin} min ago`}
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value, sub }) {
  return (
    <div style={{
      padding:      8,
      borderRadius: 10,
      background:   'var(--v2-bg-2, #0f172a)',
      border:       '1px solid var(--v2-line, #334155)',
    }}>
      <div style={{ color: 'var(--v2-ink-2, #94a3b8)', display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{
        fontFamily: 'var(--v2-display, "Space Grotesk")',
        fontSize:   17,
        fontWeight: 600,
        color:      'var(--v2-ink-0, #f1f5f9)',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>{sub}</div>
      )}
    </div>
  )
}
