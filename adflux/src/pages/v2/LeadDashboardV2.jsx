// src/pages/v2/LeadDashboardV2.jsx
//
// Phase 16 commit 7 — Lead Dashboard, ported from
// _design_reference/Leads/lead-voice.jsx (AdminLeadDash).
// Route: /lead-dashboard. Privileged users see all rows (RLS),
// sales sees own only — same data the existing /leads list uses,
// just rolled up into a pipeline overview.
//
// Layout (matches design):
//   • Hero strip — teal gradient, 5 KPIs (Total / Hot idle / SLA breaches /
//     Pipeline ₹ / Win rate)
//   • Stage rail — 6 colored columns (New, Contacted, Qualified, SalesReady,
//     Won, Lost)
//   • AI briefing card — real signal from leads (hot idle, SLA breaches,
//     overnight Cronberry imports). Identical to the briefing on /leads.
//   • Two-column body: Voice activity (Phase 2 placeholder) + Hot leads top 6
//
// Voice activity is left as a "Coming with Voice-First" placeholder
// until the Anthropic API is wired (task #97).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Upload, Sparkles, ChevronRight, ArrowRight, Mic,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatRelative } from '../../utils/formatters'
import {
  StageChip, HeatDot, LeadAvatar,
} from '../../components/leads/LeadShared'

// Phase 18 — rail rolls up the 10 stages into 6 columns so every lead
// is visible somewhere. Previously a lead in QuoteSent / Negotiating /
// MeetingScheduled / Nurture was invisible (Total counted them but no
// rail column showed them) — that's why owner saw Total = 1 with all
// columns 0 on the test lead in Quote Sent stage.
// Phase 30A — collapsed to 5 stages. Each rail column maps to exactly
// one stage now (was 1-to-many for the 10-stage funnel).
const STAGE_RAIL = [
  { key: 'New',       k: 's-new',  short: 'New',        match: ['New'] },
  { key: 'Working',   k: 's-qual', short: 'Working',    match: ['Working'] },
  { key: 'QuoteSent', k: 's-sr',   short: 'Quote Sent', match: ['QuoteSent'] },
  { key: 'Won',       k: 's-won',  short: 'Won',        match: ['Won'] },
  { key: 'Lost',      k: 's-lost', short: 'Lost',       match: ['Lost'] },
]

export default function LeadDashboardV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      const { data, error: err } = await supabase
        .from('leads')
        .select('*, assigned:assigned_to(id, name, city)')
        .order('created_at', { ascending: false })
      if (err) {
        setError(err.message)
        setLeads([])
      } else {
        setLeads(data || [])
      }
      setLoading(false)
    }
    load()
  }, [])

  /* ─── KPIs computed from real lead data ─── */
  const kpis = useMemo(() => {
    const now = Date.now()
    const dayAgo = now - 24 * 3600 * 1000
    const weekAgo = now - 7 * 24 * 3600 * 1000

    const total = leads.length
    const newThisWeek = leads.filter(l => l.created_at && new Date(l.created_at).getTime() > weekAgo).length

    const hotIdle = leads.filter(l =>
      l.heat === 'hot' &&
      !['Won','Lost'].includes(l.stage) &&
      (!l.last_contact_at || new Date(l.last_contact_at).getTime() < dayAgo)
    ).length

    // Phase 30A — SalesReady is no longer a stage, but the
    // handoff_sla_due_at column still records when a Working lead
    // needed pickup. SLA breach = any active (non-closed) lead with a
    // handoff deadline in the past.
    const slaBreaches = leads.filter(l =>
      !['Won','Lost'].includes(l.stage) &&
      l.handoff_sla_due_at &&
      new Date(l.handoff_sla_due_at).getTime() < now
    ).length

    const slaBreachByRep = (() => {
      const m = new Map()
      leads
        .filter(l => !['Won','Lost'].includes(l.stage) && l.handoff_sla_due_at && new Date(l.handoff_sla_due_at).getTime() < now)
        .forEach(l => {
          const name = l.assigned?.name || 'unassigned'
          m.set(name, (m.get(name) || 0) + 1)
        })
      return Array.from(m.entries()).map(([n, c]) => `${n} × ${c}`).join(' · ')
    })()

    const pipelineValue = leads
      .filter(l => !['Won','Lost'].includes(l.stage))
      .reduce((s, l) => s + (Number(l.expected_value) || 0), 0)

    const won = leads.filter(l => l.stage === 'Won').length
    const lost = leads.filter(l => l.stage === 'Lost').length
    const winRate = won + lost === 0 ? null : Math.round((won / (won + lost)) * 100)

    const wonValue = leads
      .filter(l => l.stage === 'Won')
      .reduce((s, l) => s + (Number(l.expected_value) || 0), 0)

    return { total, newThisWeek, hotIdle, slaBreaches, slaBreachByRep, pipelineValue, winRate, won, lost, wonValue }
  }, [leads])

  /* ─── Stage rail counts ─── */
  const stageCounts = useMemo(() => {
    const counts = {}
    leads.forEach(l => { counts[l.stage] = (counts[l.stage] || 0) + 1 })
    return counts
  }, [leads])

  /* ─── Hot leads top 6 — sorted by heat × SLA risk ─── */
  const hotLeads = useMemo(() => {
    const HEAT_RANK = { hot: 0, warm: 1, cold: 2 }
    const arr = leads
      .filter(l => !['Won','Lost'].includes(l.stage))
      .slice()
    arr.sort((a, b) => {
      const ha = HEAT_RANK[a.heat] ?? 2
      const hb = HEAT_RANK[b.heat] ?? 2
      if (ha !== hb) return ha - hb
      const slaA = a.handoff_sla_due_at ? new Date(a.handoff_sla_due_at).getTime() : Infinity
      const slaB = b.handoff_sla_due_at ? new Date(b.handoff_sla_due_at).getTime() : Infinity
      return slaA - slaB
    })
    return arr.slice(0, 6)
  }, [leads])

  if (loading) {
    return (
      <div className="lead-root">
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          Loading lead dashboard…
        </div>
      </div>
    )
  }

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Lead pipeline · {kpis.total} active</div>
          <div className="lead-page-title">Lead Dashboard</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isPrivileged && (
            <button className="lead-btn" onClick={() => navigate('/leads/upload')}>
              <Upload size={14} /> Upload CSV
            </button>
          )}
          <button className="lead-btn lead-btn-primary" onClick={() => navigate('/leads/new')}>
            <Plus size={14} /> New Lead
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

      {/* ─── Hero strip — teal gradient with 5 KPI columns ─── */}
      <div className="lead-hero-strip">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>
            <span style={{ color: 'var(--accent)' }}>●</span>&nbsp;&nbsp;Pipeline pulse · live
          </div>
        </div>
        <div className="lead-hero-stats">
          <HeroStat label="Total leads"     value={kpis.total}                     delta={kpis.newThisWeek > 0 ? `+${kpis.newThisWeek} this week` : '—'} up={kpis.newThisWeek > 0} />
          <HeroStat label="Hot · idle 24h"  value={kpis.hotIdle}                   delta={kpis.hotIdle > 0 ? 'needs action' : 'all warm'}                  down={kpis.hotIdle > 0} acc />
          <HeroStat label="SLA breaches"    value={kpis.slaBreaches}               delta={kpis.slaBreaches > 0 ? (kpis.slaBreachByRep || 'overdue') : 'on track'} down={kpis.slaBreaches > 0} />
          <HeroStat label="Pipeline ₹"      value={formatLakh(kpis.pipelineValue)} delta="non-Won/Lost"                                                     up />
          <HeroStat label="Win rate"        value={kpis.winRate != null ? `${kpis.winRate}%` : '—'} delta={kpis.won + kpis.lost === 0 ? 'no decisions yet' : `${kpis.won} won · ${kpis.lost} lost`} up={kpis.winRate != null && kpis.winRate >= 50} />
        </div>
      </div>

      {/* ─── Stage rail (rolls up 10 stages into 6 columns) ─── */}
      <div className="lead-stage-rail">
        {STAGE_RAIL.map((s) => {
          const n = s.match.reduce((sum, st) => sum + (stageCounts[st] || 0), 0)
          const sub = subForStage(s.key, leads, kpis)
          return (
            <div className={`lead-stage-col ${s.k}`} key={s.key}>
              <div className="top">{s.short}</div>
              <div className="num">{n}</div>
              <div className="sub">{sub}</div>
            </div>
          )
        })}
      </div>

      {/* ─── AI briefing ─── */}
      {(kpis.hotIdle > 0 || kpis.slaBreaches > 0) && (
        <div className="lead-ai-card" style={{ marginBottom: 16 }}>
          <div className="lead-ai-icon"><Sparkles size={20} /></div>
          <div>
            <div className="lead-ai-eyebrow">
              <span className="pulse" /> AI · briefing · today
            </div>
            <p className="lead-ai-recap">
              {kpis.hotIdle > 0 && (<><b>{kpis.hotIdle} hot lead{kpis.hotIdle !== 1 ? 's' : ''}</b> idle &gt; 24h</>)}
              {kpis.hotIdle > 0 && kpis.slaBreaches > 0 && ' · '}
              {kpis.slaBreaches > 0 && (<><b>{kpis.slaBreaches} SLA breach{kpis.slaBreaches !== 1 ? 'es' : ''}</b> on hand-offs</>)}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <button className="lead-btn lead-btn-primary lead-btn-sm" onClick={() => navigate('/leads')}>
              Open queue <ArrowRight size={11} />
            </button>
          </div>
        </div>
      )}

      {/* ─── Two-up: Voice activity + Hot leads ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', gap: 16 }}>
        {/* Voice activity — Phase 21a: voice is shipped (Phase 20).
            Card now points to the live page; recent transcripts surface
            on each lead's activity timeline. A roll-up panel here is a
            Sprint C item once we have meaningful volume. */}
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">
                <span className="voice-pill" style={{ marginRight: 8 }}>
                  <Mic size={10} style={{ marginRight: 4 }} /> live
                </span>
                Voice activity
              </div>
              <div className="lead-card-sub">Reps speaking Gujarati / Hindi / English · auto-classified</div>
            </div>
          </div>
          <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
            Voice logging is live. Reps tap the <b style={{ color: 'var(--text)' }}>Voice</b> button on any lead detail page (or open <b style={{ color: 'var(--text)' }}>/voice</b>) to record a note. The audio is transcribed via Whisper, classified via Claude, and saved as a lead activity automatically. Transcripts and classifications appear on each lead's activity timeline.
          </div>
        </div>

        {/* Hot leads */}
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Hot leads · top {hotLeads.length}</div>
              <div className="lead-card-sub">Sorted by heat × SLA risk</div>
            </div>
            <span className="lead-card-link" onClick={() => navigate('/leads')}>
              View all <ArrowRight size={11} />
            </span>
          </div>
          {hotLeads.length === 0 ? (
            <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              No active leads.
            </div>
          ) : (
            <table className="lead-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Lead</th>
                  <th>Stage</th>
                  <th>Assigned</th>
                  <th>Last</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {hotLeads.map(l => (
                  <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                    <td style={{ width: 18 }}><HeatDot heat={l.heat} /></td>
                    <td>
                      <div className="name-cell">
                        <div>
                          <div className="name">{l.name}</div>
                          <div className="company">{l.company || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td><StageChip stage={l.stage} sm /></td>
                    <td>
                      {l.assigned?.name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <LeadAvatar name={l.assigned.name} userId={l.assigned.id} />
                          <span>{l.assigned.name}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>—</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {l.last_contact_at ? formatRelative(l.last_contact_at) : '—'}
                    </td>
                    <td className="mono" style={{ fontWeight: 600, fontFamily: 'var(--font-display)', textAlign: 'right' }}>
                      {l.expected_value ? formatCurrency(l.expected_value) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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

function subForStage(stage, leads, kpis) {
  // Phase 30A — 5 stages. Working merges Contacted+Qualified+SalesReady+
  // MeetingScheduled; QuoteSent merges QuoteSent+Negotiating.
  if (stage === 'New')       return `${leads.filter(l => l.stage === 'New'     && l.heat === 'hot').length} hot`
  if (stage === 'Working')   return kpis.slaBreaches > 0
                                      ? `${kpis.slaBreaches} SLA risk`
                                      : `${leads.filter(l => l.stage === 'Working' && l.heat === 'hot').length} hot`
  if (stage === 'QuoteSent') return 'awaiting client'
  if (stage === 'Won')       return formatLakh(kpis.wonValue)
  if (stage === 'Lost')      return 'auto-closed'
  return ''
}

function formatLakh(n) {
  const x = Number(n) || 0
  if (x >= 10000000) return `₹${(x / 10000000).toFixed(1)}Cr`
  if (x >= 100000)   return `₹${(x / 100000).toFixed(1)}L`
  if (x >= 1000)     return `₹${(x / 1000).toFixed(0)}K`
  return `₹${x}`
}
