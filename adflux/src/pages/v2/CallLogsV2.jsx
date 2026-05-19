// src/pages/v2/CallLogsV2.jsx
//
// Phase 56m — per-rep call log page. Sales + telecaller see their
// own at `/calls`; admin / co_owner see any rep at
// `/admin/calls/:userId`.
//
// Owner directive (19 May 2026): showed Cronberry "Brijesh Solanki
// Call Logs" reference with three counters (OUTGOING / INCOMING /
// MISSED) + total duration each + table of every call. Replicates
// the same layout using our own call_logs + lead_activities data.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing,
  Loader2, Search, ArrowLeft, Plus,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import useAutoRefresh from '../../hooks/useAutoRefresh'

export default function CallLogsV2() {
  const navigate = useNavigate()
  const params   = useParams()
  const profile  = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)

  // /calls (rep view) → params.userId undefined → show own.
  // /admin/calls/:userId (admin view) → show that user's calls.
  const targetUserId = params?.userId || profile?.id
  const isOwnView = targetUserId === profile?.id
  const canViewTarget = isOwnView || isPrivileged

  const todayISO = () => {
    const d = new Date()
    // IST date boundary so "today" matches the rep's day.
    const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    return ist.toISOString().slice(0, 10)
  }

  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo,   setDateTo]   = useState(todayISO())
  const [search,   setSearch]   = useState('')
  const [rows,     setRows]     = useState([])
  const [targetUser, setTargetUser] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  async function load() {
    if (!targetUserId || !canViewTarget) {
      setLoading(false)
      return
    }
    setLoading(true); setError('')
    const fromIso = `${dateFrom}T00:00:00+05:30`
    const toIso   = `${dateTo}T23:59:59+05:30`
    try {
      const [callsRes, userRes] = await Promise.all([
        supabase
          .from('call_logs')
          .select('id, call_at, direction, duration_seconds, outcome, client_phone, lead_id, notes, lead:lead_id(id, name)')
          .eq('user_id', targetUserId)
          .gte('call_at', fromIso)
          .lte('call_at', toIso)
          .order('call_at', { ascending: false })
          .limit(500),
        supabase.from('users').select('id, name, role, team_role').eq('id', targetUserId).maybeSingle(),
      ])
      if (callsRes.error) throw callsRes.error
      setRows(callsRes.data || [])
      setTargetUser(userRes.data || null)
    } catch (e) {
      setError(e?.message || 'Failed to load call logs')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [targetUserId, dateFrom, dateTo])
  useAutoRefresh(load)

  // Filter by search (phone or lead name).
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      (r.client_phone || '').toLowerCase().includes(q) ||
      (r.lead?.name || '').toLowerCase().includes(q)
    )
  }, [rows, search])

  // Top tiles.
  const stats = useMemo(() => {
    const s = { outgoing: { count: 0, sec: 0 }, incoming: { count: 0, sec: 0 }, missed: { count: 0, sec: 0 } }
    for (const r of rows) {
      const dir = r.direction || 'outgoing'
      if (!s[dir]) s[dir] = { count: 0, sec: 0 }
      s[dir].count++
      s[dir].sec += Number(r.duration_seconds) || 0
    }
    return s
  }, [rows])

  if (!canViewTarget) {
    return (
      <div className="v2d-page">
        <div className="lead-card lead-card-pad">
          Access denied. Sign in as admin / co_owner to view other reps' call logs.
        </div>
      </div>
    )
  }

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isOwnView && (
            <button onClick={() => navigate(-1)} style={ghostBtn} aria-label="Back">
              <ArrowLeft size={14} />
            </button>
          )}
          <div>
            <div className="v2d-page-kicker">Calls</div>
            <h1 className="v2d-page-title">
              {isOwnView
                ? 'My call log'
                : `${targetUser?.name || 'Rep'} call log`}
            </h1>
            <div className="v2d-page-sub">
              Outgoing, incoming, and missed calls in the selected date range.
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={inputStyle}
        />
        <span style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>→</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={inputStyle}
        />
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} strokeWidth={1.6} style={{
            position: 'absolute', top: '50%', left: 10, transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
          }} />
          <input
            type="text"
            placeholder="Search by phone or lead name"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 30, width: '100%' }}
          />
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10,
        marginBottom: 14,
      }}>
        <Tile
          icon={<PhoneOutgoing size={14} strokeWidth={1.6} />}
          label="Outgoing"
          count={stats.outgoing.count}
          sub={`Duration: ${formatMinutes(stats.outgoing.sec)}`}
          color="var(--accent)"
        />
        <Tile
          icon={<PhoneIncoming size={14} strokeWidth={1.6} />}
          label="Incoming"
          count={stats.incoming.count}
          sub={`Duration: ${formatMinutes(stats.incoming.sec)}`}
          color="var(--success)"
        />
        <Tile
          icon={<PhoneMissed size={14} strokeWidth={1.6} />}
          label="Missed"
          count={stats.missed.count}
          sub={stats.missed.count === 0 ? 'No misses' : 'No answer'}
          color="var(--danger)"
        />
      </div>

      {/* Table */}
      <div className="lead-card">
        {loading ? (
          <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
            Loading…
          </div>
        ) : error ? (
          <div className="lead-card-pad" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>
        ) : visibleRows.length === 0 ? (
          <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No calls in this range.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>Duration</Th>
                  <Th>Date & Time</Th>
                  <Th>Type</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, i) => (
                  <tr key={r.id}>
                    <Td>{i + 1}</Td>
                    <Td>
                      {r.lead?.name ? (
                        <a
                          href={`/leads/${r.lead.id}`}
                          style={{ color: 'var(--text)', textDecoration: 'none', borderBottom: '1px dotted var(--text-muted)' }}
                        >
                          {r.lead.name}
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-subtle)' }}>—</span>
                      )}
                    </Td>
                    <Td><code style={{ fontFamily: 'inherit' }}>{r.client_phone || '—'}</code></Td>
                    <Td>{formatDuration(r.duration_seconds)}</Td>
                    <Td>{formatDateTime(r.call_at)}</Td>
                    <Td><DirectionPill direction={r.direction || 'outgoing'} /></Td>
                    <Td>
                      {!r.lead_id && r.client_phone && (
                        <button
                          onClick={() => navigate(`/leads/new?phone=${encodeURIComponent(r.client_phone)}`)}
                          style={miniBtn}
                          title="Convert to lead"
                        >
                          <Plus size={11} strokeWidth={1.6} /> Add Lead
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ icon, label, count, sub, color }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 10, fontWeight: 700, letterSpacing: '.10em',
        textTransform: 'uppercase', color, marginBottom: 6,
      }}>
        {icon} {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700,
        fontFamily: 'var(--font-display, var(--font-sans))',
        color: 'var(--text)',
      }}>{count}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  )
}

function DirectionPill({ direction }) {
  const palette = direction === 'incoming' ? 'var(--success)'
                : direction === 'missed'   ? 'var(--danger)'
                : 'var(--accent)'
  const Icon    = direction === 'incoming' ? PhoneIncoming
                : direction === 'missed'   ? PhoneMissed
                : PhoneOutgoing
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: palette,
      border: `1px solid ${palette}`,
    }}>
      <Icon size={11} strokeWidth={1.6} /> {direction}
    </span>
  )
}

function Th({ children }) {
  return (
    <th style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.10em',
      textTransform: 'uppercase', color: 'var(--text-muted)',
      padding: '8px 10px', textAlign: 'left',
      borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}
function Td({ children, style }) {
  return (
    <td style={{
      fontSize: 12, padding: '8px 10px',
      borderBottom: '1px solid var(--border)',
      color: 'var(--text)', verticalAlign: 'middle',
      whiteSpace: 'nowrap', ...style,
    }}>{children}</td>
  )
}

const inputStyle = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
}
const ghostBtn = {
  width: 32, height: 32,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
}
const miniBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px',
  fontSize: 11, fontWeight: 600,
  borderRadius: 10,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
  cursor: 'pointer',
}
const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--font-sans)',
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function formatDuration(sec) {
  if (sec == null) return '—'
  const s = Number(sec)
  if (!Number.isFinite(s) || s <= 0) return '0 sec'
  if (s < 60) return `${s} sec`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m} min` : `${m}m ${r}s`
}
function formatMinutes(sec) {
  const s = Number(sec) || 0
  if (s <= 0) return '0 min'
  const m = s / 60
  return `${m.toFixed(m >= 10 ? 0 : 1)} min`
}
