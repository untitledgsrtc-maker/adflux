// src/pages/v2/TelecallerV2.jsx
//
// Phase 12 (M7) — Telecaller dashboard.
//
// Per master spec §3.6 + architecture §4.7:
//   • Today's call queue ranked by heat (hot first) + age (oldest contact first)
//   • Big "Next call" button → opens the lead in call-mode
//   • KPI panel: today's calls, qualified, accepted by sales, monthly conversions
//   • Pending hand-offs: leads I marked SalesReady, with hours remaining on 24h SLA
//
// RLS already filters: telecaller_id = auth.uid() OR assigned_to = auth.uid()
// (Sales Manager + admin see broader views via /leads.)

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Phone, ArrowRight, Clock, CheckCircle2, AlertTriangle, Flame,
  Users as UsersIcon, ChevronRight,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { STAGE_TINT, STAGE_LABELS } from '../../hooks/useLeads'
import { formatDate, formatDateTime } from '../../utils/formatters'

const HEAT_RANK = { hot: 0, warm: 1, cold: 2 }

export default function TelecallerV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const [leads, setLeads]       = useState([])
  const [callsToday, setCallsToday] = useState(0)
  const [qualifiedToday, setQualifiedToday] = useState(0)
  const [salesReadyHandoffs, setSalesReadyHandoffs] = useState([])
  const [loading, setLoading]   = useState(true)

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const startOfDay = `${today}T00:00:00`

    const [leadsRes, callsRes, qualRes, handoffRes] = await Promise.all([
      // Open call queue: assigned to me as telecaller, not yet SalesReady/Won/Lost
      supabase
        .from('leads')
        .select('*, assigned:assigned_to(id, name, city)')
        .eq('telecaller_id', profile.id)
        .not('stage', 'in', '("Won","Lost","SalesReady","QuoteSent","Negotiating","MeetingScheduled")')
        .order('created_at', { ascending: false })
        .limit(50),
      // Calls logged by me today
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('call_at', startOfDay),
      // Leads I qualified today (sales_ready_at OR qualified_at today)
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('telecaller_id', profile.id)
        .or(`sales_ready_at.gte.${startOfDay},qualified_at.gte.${startOfDay}`),
      // SalesReady leads I handed off — show SLA status
      supabase
        .from('leads')
        .select('*, assigned:assigned_to(id, name, city)')
        .eq('telecaller_id', profile.id)
        .eq('stage', 'SalesReady')
        .order('handoff_sla_due_at', { ascending: true })
        .limit(20),
    ])

    setLeads(leadsRes.data || [])
    setCallsToday(callsRes.count || 0)
    setQualifiedToday(qualRes.count || 0)
    setSalesReadyHandoffs(handoffRes.data || [])
    setLoading(false)
  }

  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])

  // Sort the queue by heat + last_contact_at age.
  const queue = useMemo(() => {
    return [...leads].sort((a, b) => {
      const heatA = HEAT_RANK[a.heat || 'cold']
      const heatB = HEAT_RANK[b.heat || 'cold']
      if (heatA !== heatB) return heatA - heatB
      const ageA = a.last_contact_at ? new Date(a.last_contact_at).getTime() : 0
      const ageB = b.last_contact_at ? new Date(b.last_contact_at).getTime() : 0
      return ageA - ageB  // older first (waiting longer)
    })
  }, [leads])

  const nextLead = queue[0]

  function slaStatus(due) {
    if (!due) return null
    const ms = new Date(due).getTime() - Date.now()
    const hrs = ms / 3_600_000
    if (hrs < 0) return { text: `${Math.round(-hrs)}h overdue`, color: '#f87171' }
    if (hrs < 6) return { text: `${Math.round(hrs)}h left`, color: '#fbbf24' }
    return { text: `${Math.round(hrs)}h left`, color: '#4ade80' }
  }

  if (loading) return <div className="v2d-loading"><div className="v2d-spinner" />Loading queue…</div>

  return (
    <div className="v2d-telecaller">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Inside sales</div>
          <h1 className="v2d-page-title">Call queue</h1>
          <div className="v2d-page-sub">
            {queue.length} leads waiting · {callsToday} calls today · {qualifiedToday} qualified today
          </div>
        </div>
      </div>

      {/* ─── Next call hero ─── */}
      {nextLead ? (
        <div className="v2d-panel" style={{
          padding: 24,
          marginBottom: 16,
          background: 'linear-gradient(135deg, rgba(255,230,0,.06), rgba(255,230,0,.02))',
          border: '1px solid rgba(255,230,0,.20)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="v2d-page-kicker" style={{ color: 'var(--v2-yellow, #facc15)', marginBottom: 6 }}>Next call</div>
              <div style={{ fontSize: 24, fontFamily: 'var(--v2-display)', fontWeight: 600, marginBottom: 4 }}>
                {nextLead.name}
              </div>
              {nextLead.company && <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', marginBottom: 8 }}>{nextLead.company}</div>}
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--v2-ink-2)', flexWrap: 'wrap' }}>
                {nextLead.phone && <span style={{ fontFamily: 'monospace' }}>{nextLead.phone}</span>}
                {nextLead.city && <span>{nextLead.city}</span>}
                {nextLead.heat === 'hot' && <span style={{ color: '#f87171' }}>🔥 Hot</span>}
                {nextLead.heat === 'warm' && <span style={{ color: '#fbbf24' }}>Warm</span>}
                <span>· Source: {nextLead.source}</span>
                {nextLead.last_contact_at && <span>· Last contact {formatDate(nextLead.last_contact_at)}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {nextLead.phone && (
                <a
                  href={`tel:${nextLead.phone}`}
                  className="v2d-cta"
                  style={{ textDecoration: 'none' }}
                >
                  <Phone size={14} /> Call now
                </a>
              )}
              <button
                className="v2d-ghost v2d-ghost--btn"
                onClick={() => navigate(`/leads/${nextLead.id}`)}
              >
                Open lead <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="v2d-panel v2d-empty-card" style={{ marginBottom: 16 }}>
          <div className="v2d-empty-ic"><CheckCircle2 size={32} style={{ color: '#4ade80' }} /></div>
          <div className="v2d-empty-t">Queue clear</div>
          <div className="v2d-empty-s">No pending leads. Wait for new ones, or upload more.</div>
        </div>
      )}

      {/* ─── KPI panel ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Today's calls"     value={callsToday} />
        <KpiCard label="Qualified today"   value={qualifiedToday} hint="Sales Ready hand-offs" />
        <KpiCard label="Open queue"        value={queue.length} hint="Waiting your call" />
        <KpiCard label="Pending handoffs"  value={salesReadyHandoffs.length} hint="Awaiting sales SLA" />
      </div>

      {/* ─── SLA status of recent handoffs ─── */}
      {salesReadyHandoffs.length > 0 && (
        <div className="v2d-panel" style={{ marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Pending hand-offs</div>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
              Leads you marked Sales Ready — sales has 24h to act.
            </div>
          </div>
          {salesReadyHandoffs.map(l => {
            const sla = slaStatus(l.handoff_sla_due_at)
            return (
              <div
                key={l.id}
                onClick={() => navigate(`/leads/${l.id}`)}
                style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{l.name}</div>
                  {l.company && <div style={{ fontSize: 12, color: 'var(--v2-ink-1)' }}>{l.company}</div>}
                  <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 4 }}>
                    Assigned to {l.assigned?.name || 'unassigned'}{l.assigned?.city && ` · ${l.assigned.city}`}
                  </div>
                </div>
                {sla && (
                  <div style={{
                    padding: '4px 10px', borderRadius: 999,
                    background: `${sla.color}22`,
                    border: `1px solid ${sla.color}55`,
                    color: sla.color,
                    fontSize: 11, fontWeight: 600,
                    fontFamily: 'monospace',
                  }}>
                    {sla.text}
                  </div>
                )}
                <ChevronRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Full queue list (after the next-call hero) ─── */}
      {queue.length > 1 && (
        <div className="v2d-panel" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>All open leads in your queue</div>
          </div>
          <table className="v2d-q-table">
            <thead>
              <tr>
                <th style={{ width: 18 }}></th>
                <th>Lead</th>
                <th>Stage</th>
                <th>Source</th>
                <th>Last contact</th>
              </tr>
            </thead>
            <tbody>
              {queue.slice(1).map(l => (
                <tr
                  key={l.id}
                  onClick={() => navigate(`/leads/${l.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    {l.heat === 'hot'  && <span style={{ color: '#f87171' }}>🔥</span>}
                    {l.heat === 'warm' && <span style={{ color: '#fbbf24' }}>·</span>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    {l.phone && <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontFamily: 'monospace' }}>{l.phone}</div>}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                      fontSize: 11, fontWeight: 600,
                      background: 'rgba(96,165,250,.12)',
                      color: '#60a5fa',
                    }}>
                      {STAGE_LABELS[l.stage] || l.stage}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--v2-ink-1)' }}>{l.source}</td>
                  <td style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontFamily: 'monospace' }}>
                    {l.last_contact_at ? formatDate(l.last_contact_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, hint }) {
  return (
    <div className="v2d-panel" style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--v2-display)', fontSize: 28, fontWeight: 600 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
