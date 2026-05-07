// src/pages/v2/CockpitV2.jsx
//
// Phase 12 (M8) — Owner Cockpit web view.
//
// Single-page dashboard for owner / government_partner that consolidates:
//   • AI Briefing card (pulse-animated icon, gradient bg) — placeholder
//     until AI Co-Pilot Edge Function is wired in Phase 1.5
//   • Hero revenue + outstanding aging
//   • Lead pipeline funnel
//   • Sales team scorecard (today's check-ins + counters)
//   • Top 3 attention items: SLA breaches, missed check-ins, overdue invoices
//   • Outstanding payments table
//
// Per UI Design System §4.2 (AI briefing) + §4.3 (hero) + §4.7 (compact table).
// All tokens are CSS variables — both day + night themes work.

import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, TrendingUp, Users, AlertTriangle, ArrowRight,
  Clock, FileText, CheckCircle2, MapPin, Phone,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { LEAD_STAGES, STAGE_LABELS, STAGE_TINT } from '../../hooks/useLeads'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters'

const STAGE_BAR_COLOR = {
  New:              'rgba(96,165,250,.50)',
  Contacted:        'rgba(96,165,250,.70)',
  Qualified:        'rgba(251,191,36,.70)',
  SalesReady:       'rgba(192,132,252,.70)',
  MeetingScheduled: 'rgba(251,191,36,.80)',
  QuoteSent:        'rgba(251,191,36,.90)',
  Negotiating:      'rgba(251,191,36,1)',
  Won:              'rgba(74,222,128,1)',
  Lost:             'rgba(248,113,113,.80)',
  Nurture:          'rgba(96,165,250,.40)',
}

export default function CockpitV2() {
  const navigate = useNavigate()
  const profile  = useAuthStore(s => s.profile)
  const isAllowed = ['admin', 'co_owner'].includes(profile?.role)

  const [leads, setLeads]               = useState([])
  const [workSessions, setWorkSessions] = useState([])
  const [team, setTeam]                 = useState([])
  const [outstandingQuotes, setOutstandingQuotes] = useState([])
  const [pendingApprovals, setPendingApprovals]   = useState(0)
  const [loading, setLoading]           = useState(true)

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    const [leadsRes, sessionsRes, teamRes, quotesRes, approvalsRes] = await Promise.all([
      supabase.from('leads').select('id, stage, expected_value, segment, handoff_sla_due_at, last_contact_at'),
      supabase.from('work_sessions').select('*, user:user_id(id, name, team_role, city)').eq('work_date', today),
      supabase.from('users').select('id, name, team_role, city, daily_targets').eq('is_active', true),
      supabase.from('quotes').select('id, quote_number, ref_number, client_name, total_amount, payments(amount_received, approval_status, payment_date)').eq('status', 'won'),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending'),
    ])

    setLeads(leadsRes.data || [])
    setWorkSessions(sessionsRes.data || [])
    setTeam(teamRes.data || [])
    setOutstandingQuotes(quotesRes.data || [])
    setPendingApprovals(approvalsRes.count || 0)
    setLoading(false)
  }

  useEffect(() => { if (isAllowed) load() /* eslint-disable-next-line */ }, [isAllowed])

  /* ─── Derived metrics ─── */
  const pipeline = useMemo(() => {
    const counts = {}
    let value = 0
    LEAD_STAGES.forEach(s => { counts[s] = 0 })
    leads.forEach(l => {
      counts[l.stage] = (counts[l.stage] || 0) + 1
      if (!['Won', 'Lost'].includes(l.stage)) value += Number(l.expected_value) || 0
    })
    return { counts, value, total: leads.length }
  }, [leads])

  const slaBreaches = useMemo(() => {
    // Phase 30A — SalesReady stage removed. Active-lead SLA breach
    // detection now uses handoff_sla_due_at on any non-closed stage.
    return leads.filter(l =>
      !['Won','Lost'].includes(l.stage) &&
      l.handoff_sla_due_at &&
      new Date(l.handoff_sla_due_at) < new Date()
    )
  }, [leads])

  const noCheckIn = useMemo(() => {
    const checkedInIds = new Set(workSessions.filter(s => s.check_in_at).map(s => s.user_id))
    const elevenAm = new Date()
    elevenAm.setHours(11, 0, 0, 0)
    const isAfter11 = new Date() > elevenAm
    if (!isAfter11) return []
    // Sales + telecaller roles only — not designers, accounts, etc.
    return team.filter(u =>
      ['sales', 'telecaller', 'sales_manager', 'agency'].includes(u.team_role) &&
      !checkedInIds.has(u.id)
    )
  }, [team, workSessions])

  const outstanding = useMemo(() => {
    return outstandingQuotes
      .map(q => {
        const paid = (q.payments || [])
          .filter(p => p.approval_status === 'approved')
          .reduce((s, p) => s + Number(p.amount_received || 0), 0)
        const balance = Math.max(0, Number(q.total_amount || 0) - paid)
        return { ...q, balance }
      })
      .filter(q => q.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
  }, [outstandingQuotes])

  const totalOutstanding = outstanding.reduce((s, q) => s + q.balance, 0)

  if (!isAllowed) {
    return (
      <div className="v2d-cockpit">
        <div style={{
          background: 'rgba(248,113,113,.10)',
          border: '1px solid rgba(248,113,113,.28)',
          color: '#f87171',
          borderRadius: 12, padding: '14px 18px', fontSize: 13,
        }}>
          ⚠ Cockpit is admin / co-owner only.
        </div>
      </div>
    )
  }

  if (loading) return <div className="v2d-loading"><div className="v2d-spinner" />Loading cockpit…</div>

  return (
    <div className="v2d-cockpit">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Owner cockpit</div>
          <h1 className="v2d-page-title">Today across all 22 people</h1>
          <div className="v2d-page-sub">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* ─── AI Briefing card (placeholder until Co-Pilot wired) ─── */}
      <AiBriefingCard
        slaBreaches={slaBreaches.length}
        noCheckIn={noCheckIn.length}
        pendingApprovals={pendingApprovals}
        outstandingTotal={totalOutstanding}
      />

      {/* ─── Hero stats strip ─── */}
      <div style={{
        background: 'linear-gradient(120deg, #0d3d3a 0%, #134e4a 55%, #0f766e 100%)',
        borderRadius: 16,
        padding: '22px 26px',
        marginBottom: 16,
        position: 'relative',
        overflow: 'hidden',
        color: '#fff',
      }}>
        <div style={{
          position: 'absolute', right: -80, top: -80,
          width: 280, height: 280, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(250,204,21,.18), transparent 60%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,.7)', marginBottom: 12,
        }}>
          Pipeline overview
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 4,
          position: 'relative', zIndex: 1,
        }}>
          <HeroStat label="Pipeline value"  value={formatCurrency(pipeline.value)}            accent />
          <HeroStat label="Active leads"    value={pipeline.total - (pipeline.counts.Won || 0) - (pipeline.counts.Lost || 0)} />
          <HeroStat label="Won this view"   value={pipeline.counts.Won || 0} />
          <HeroStat label="Outstanding"     value={formatCurrency(totalOutstanding)} />
          <HeroStat label="Pending approval" value={pendingApprovals} />
        </div>
      </div>

      {/* ─── Top-3 attention items ─── */}
      {(slaBreaches.length > 0 || noCheckIn.length > 0 || pendingApprovals > 0) && (
        <div className="v2d-panel" style={{ marginBottom: 16, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <AlertTriangle size={16} style={{ color: '#fbbf24' }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>Needs your attention</div>
          </div>
          {slaBreaches.length > 0 && (
            <AttentionRow
              icon={<Clock size={16} />}
              color="#f87171"
              count={slaBreaches.length}
              label="Sales Ready leads past 24h SLA"
              sub="Telecaller passed but sales hasn't acted."
              cta="View"
              onClick={() => navigate('/leads')}
            />
          )}
          {noCheckIn.length > 0 && (
            <AttentionRow
              icon={<MapPin size={16} />}
              color="#fbbf24"
              count={noCheckIn.length}
              label="No check-in by 11 AM"
              sub={noCheckIn.map(u => u.name).slice(0, 5).join(', ') + (noCheckIn.length > 5 ? '…' : '')}
              cta="View"
              onClick={() => navigate('/team')}
            />
          )}
          {pendingApprovals > 0 && (
            <AttentionRow
              icon={<FileText size={16} />}
              color="#60a5fa"
              count={pendingApprovals}
              label="Payments awaiting approval"
              sub="Sales submitted; you decide."
              cta="Review"
              onClick={() => navigate('/pending-approvals')}
            />
          )}
        </div>
      )}

      {/* ─── Two-column: pipeline funnel + team scorecard ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 16 }}>
        {/* Lead pipeline funnel */}
        <div className="v2d-panel">
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Lead pipeline</div>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
              {pipeline.total} total leads · {LEAD_STAGES.filter(s => !['Won','Lost'].includes(s)).reduce((s, st) => s + (pipeline.counts[st] || 0), 0)} active
            </div>
          </div>
          <div style={{ padding: '12px 18px' }}>
            {LEAD_STAGES.map(stage => {
              const count = pipeline.counts[stage] || 0
              const max   = Math.max(1, ...Object.values(pipeline.counts))
              const pct   = (count / max) * 100
              return (
                <div
                  key={stage}
                  onClick={() => navigate('/leads')}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '110px 1fr 40px',
                    gap: 10, alignItems: 'center',
                    padding: '6px 0', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--v2-ink-1)' }}>{STAGE_LABELS[stage]}</div>
                  <div style={{ height: 8, background: 'var(--v2-bg-2)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: STAGE_BAR_COLOR[stage] || 'var(--v2-ink-2)',
                      borderRadius: 4,
                      transition: 'width .6s ease',
                    }} />
                  </div>
                  <div style={{
                    fontFamily: 'var(--v2-display)',
                    fontWeight: 600, fontSize: 13,
                    textAlign: 'right',
                  }}>
                    {count}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Team scorecard */}
        <div className="v2d-panel">
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Today's team activity</div>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
              {workSessions.filter(s => s.check_in_at).length} of {team.filter(t => ['sales','telecaller','sales_manager','agency'].includes(t.team_role)).length} field staff checked in
            </div>
          </div>
          <table className="v2d-q-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 50, textAlign: 'right' }}>Mtg</th>
                <th style={{ width: 50, textAlign: 'right' }}>Calls</th>
                <th style={{ width: 50, textAlign: 'right' }}>Leads</th>
                <th style={{ width: 60 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {team
                .filter(u => ['sales','telecaller','sales_manager','agency'].includes(u.team_role))
                .map(u => {
                  const sess    = workSessions.find(s => s.user_id === u.id)
                  const c       = sess?.daily_counters || {}
                  const targets = u.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
                  const checkedIn = !!sess?.check_in_at
                  const checkedOut = !!sess?.check_out_at
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                          {u.team_role?.replace('_', ' ')}{u.city && ` · ${u.city}`}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.meetings >= targets.meetings ? '#4ade80' : 'var(--v2-ink-1)' }}>
                        {c.meetings || 0}/{targets.meetings}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.calls >= targets.calls ? '#4ade80' : 'var(--v2-ink-1)' }}>
                        {c.calls || 0}/{targets.calls}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.new_leads >= targets.new_leads ? '#4ade80' : 'var(--v2-ink-1)' }}>
                        {c.new_leads || 0}/{targets.new_leads}
                      </td>
                      <td>
                        {checkedOut
                          ? <span style={{ fontSize: 11, color: '#c084fc' }}>✓ Done</span>
                          : checkedIn
                          ? <span style={{ fontSize: 11, color: '#4ade80' }}>● In</span>
                          : <span style={{ fontSize: 11, color: '#f87171' }}>○ No</span>}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Outstanding receivables ─── */}
      {outstanding.length > 0 && (
        <div className="v2d-panel" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Top outstanding receivables</div>
              <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
                {outstanding.length} unpaid quotes · {formatCurrency(totalOutstanding)} total
              </div>
            </div>
          </div>
          <table className="v2d-q-table">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Client</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map(q => (
                <tr
                  key={q.id}
                  onClick={() => navigate(`/quotes/${q.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {q.quote_number || q.ref_number}
                  </td>
                  <td>{q.client_name}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 600 }}>
                    {formatCurrency(q.total_amount)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--v2-display)', fontWeight: 600, color: '#f87171' }}>
                    {formatCurrency(q.balance)}
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

/* ─── Sub-components ─── */

function HeroStat({ label, value, accent }) {
  return (
    <div style={{ padding: '4px 0', position: 'relative' }}>
      <div style={{
        fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,.6)', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--v2-display)', fontWeight: 600,
        fontSize: 24, lineHeight: 1.1,
        color: accent ? '#facc15' : '#fff',
        letterSpacing: '-.02em',
      }}>{value}</div>
    </div>
  )
}

function AttentionRow({ icon, color, count, label, sub, cta, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
        display: 'grid',
        gridTemplateColumns: '32px auto 1fr auto',
        gap: 14, alignItems: 'center',
        cursor: 'pointer',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 9,
        display: 'grid', placeItems: 'center',
        background: `${color}1f`, color,
      }}>
        {icon}
      </div>
      <div style={{
        fontFamily: 'var(--v2-display)',
        fontWeight: 600, fontSize: 22,
        color, minWidth: 30,
      }}>
        {count}
      </div>
      <div>
        <div style={{ fontSize: 13, color: 'var(--v2-ink-0)', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12, fontWeight: 600, color: 'var(--v2-ink-1)',
      }}>
        {cta} <ArrowRight size={12} />
      </div>
    </div>
  )
}

function AiBriefingCard({ slaBreaches, noCheckIn, pendingApprovals, outstandingTotal }) {
  // Placeholder until AI Co-Pilot Edge Function is wired (Phase 1.5).
  // Renders the same layout as the final version — just with rule-based
  // text instead of an LLM call.
  const top3 = []
  if (slaBreaches > 0)        top3.push(`${slaBreaches} Sales Ready leads past 24h SLA`)
  if (noCheckIn > 0)          top3.push(`${noCheckIn} field staff missed 11 AM check-in`)
  if (pendingApprovals > 0)   top3.push(`${pendingApprovals} payments waiting your approval`)
  if (outstandingTotal > 0)   top3.push(`Outstanding payable: ${(outstandingTotal/100000).toFixed(1)}L`)
  const summary = top3.length === 0
    ? 'No urgent issues. Pipeline looks healthy.'
    : top3[0]

  return (
    <div style={{
      position: 'relative',
      background: `
        radial-gradient(900px 200px at 100% 0%, rgba(192,132,252,.18), transparent 60%),
        radial-gradient(700px 200px at 0% 100%, rgba(96,165,250,.18), transparent 60%),
        linear-gradient(135deg, rgba(192,132,252,.10), rgba(96,165,250,.10))
      `,
      border: '1px solid var(--v2-line, rgba(255,255,255,.08))',
      borderRadius: 16,
      padding: '20px 22px',
      marginBottom: 16,
      display: 'grid',
      gridTemplateColumns: '44px 1fr',
      gap: 18,
      alignItems: 'start',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: 'linear-gradient(135deg, #c084fc, #60a5fa)',
        display: 'grid', placeItems: 'center',
        color: 'white',
        position: 'relative',
      }}>
        <Sparkles size={22} />
      </div>
      <div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
          color: 'var(--v2-ink-1)', marginBottom: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#c084fc',
            animation: 'pulse 2s infinite',
          }} />
          AI briefing · {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, marginBottom: 12, color: 'var(--v2-ink-0)' }}>
          {summary}
        </div>
        {top3.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {top3.slice(1).map((t, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--v2-ink-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? '#fbbf24' : '#60a5fa' }} />
                {t}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 12 }}>
          Daily WhatsApp brief at 9 AM + 7:30 PM ships once you wire the Meta API key. Until then, this card is rule-based.
        </div>
      </div>
      <style>{`
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(192,132,252,.5); }
          70%  { box-shadow: 0 0 0 6px rgba(192,132,252,0); }
          100% { box-shadow: 0 0 0 0 rgba(192,132,252,0); }
        }
      `}</style>
    </div>
  )
}
