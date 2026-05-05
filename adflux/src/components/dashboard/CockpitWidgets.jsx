// src/components/dashboard/CockpitWidgets.jsx
//
// Phase 12 rev3 — widgets extracted from the retired CockpitV2 page
// and reused inside AdminDashboardDesktop, so the owner has ONE
// landing page (per Master Spec §3.5 + UI Design System §4.2).
//
// Each widget fetches its own data so it can drop into any host page
// without touching the host's state machine. Lightweight queries.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, AlertTriangle, ArrowRight, Clock, MapPin, FileText,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { LEAD_STAGES, STAGE_LABELS } from '../../hooks/useLeads'

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

/* ─── AI Briefing card ─────────────────────────────────────────────
   Rule-based body until the daily-brief Edge Function is deployed.
   Layout matches UI Design System §4.2 — purple→blue gradient,
   pulse-animated icon, eyebrow + recap + bullet list. */
export function AiBriefingCard() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('leads').select('id').eq('stage', 'SalesReady').lt('handoff_sla_due_at', new Date().toISOString()),
      supabase.from('users').select('id, name, team_role').eq('is_active', true).in('team_role', ['sales','telecaller','sales_manager','agency']),
      supabase.from('work_sessions').select('user_id, check_in_at').eq('work_date', today),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending'),
    ]).then(([sla, team, sess, app]) => {
      const checkedIn = new Set((sess.data || []).filter(s => s.check_in_at).map(s => s.user_id))
      const elevenAm = new Date(); elevenAm.setHours(11, 0, 0, 0)
      const isAfter11 = new Date() > elevenAm
      const noCheckIn = isAfter11
        ? (team.data || []).filter(u => !checkedIn.has(u.id))
        : []
      setStats({
        slaBreaches: (sla.data || []).length,
        noCheckIn,
        pendingApprovals: app.count || 0,
      })
    })
  }, [])

  if (!stats) return null

  const items = []
  if (stats.slaBreaches > 0)      items.push(`${stats.slaBreaches} Sales Ready leads past 24h SLA`)
  if (stats.noCheckIn.length > 0) items.push(`${stats.noCheckIn.length} field staff missed 11 AM check-in: ${stats.noCheckIn.slice(0,4).map(u => u.name).join(', ')}${stats.noCheckIn.length > 4 ? '…' : ''}`)
  if (stats.pendingApprovals > 0) items.push(`${stats.pendingApprovals} payments waiting approval`)

  const summary = items.length === 0
    ? 'No urgent issues. Pipeline looks healthy.'
    : items[0]

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
      }}>
        <Sparkles size={22} />
      </div>
      <div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
          color: 'var(--v2-ink-1, rgba(255,255,255,.62))', marginBottom: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#c084fc',
            animation: 'pulse 2s infinite',
          }} />
          AI briefing · {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, marginBottom: 12, color: 'var(--v2-ink-0, #fff)' }}>
          {summary}
        </div>
        {items.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.slice(1).map((t, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--v2-ink-1, rgba(255,255,255,.62))', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? '#fbbf24' : '#60a5fa' }} />
                {t}
              </div>
            ))}
          </div>
        )}
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


/* ─── Lead Pipeline funnel ─────────────────────────────────────────
   Different from the existing FunnelPanel which is for QUOTES.
   This one bins LEADS by their 10 stages. Click → /leads. */
export function LeadPipelinePanel() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    supabase
      .from('leads')
      .select('stage, expected_value')
      .then(({ data }) => {
        const c = {}
        LEAD_STAGES.forEach(s => { c[s] = 0 })
        let value = 0
        ;(data || []).forEach(l => {
          c[l.stage] = (c[l.stage] || 0) + 1
          if (!['Won', 'Lost'].includes(l.stage)) value += Number(l.expected_value) || 0
        })
        setCounts({ counts: c, total: (data || []).length, value })
      })
  }, [])

  if (!counts) return null
  const max = Math.max(1, ...Object.values(counts.counts))

  return (
    <div className="v2d-panel" style={{ overflow: 'hidden' }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Lead pipeline</div>
          <div style={{ fontSize: 11, color: 'var(--v2-ink-2, rgba(255,255,255,.40))', marginTop: 2 }}>
            {counts.total} total · ₹{(counts.value/100000).toFixed(1)}L active value
          </div>
        </div>
        <button
          onClick={() => navigate('/leads')}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--v2-yellow, #facc15)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          View all <ArrowRight size={12} />
        </button>
      </div>
      <div style={{ padding: '12px 18px' }}>
        {LEAD_STAGES.map(stage => {
          const count = counts.counts[stage] || 0
          const pct = (count / max) * 100
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
              <div style={{ fontSize: 12, color: 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>{STAGE_LABELS[stage]}</div>
              <div style={{ height: 8, background: 'var(--v2-bg-2, rgba(255,255,255,.06))', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: STAGE_BAR_COLOR[stage] || 'var(--v2-ink-2)',
                  borderRadius: 4,
                  transition: 'width .6s ease',
                }} />
              </div>
              <div style={{
                fontFamily: 'var(--v2-display, "Space Grotesk")',
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
  )
}


/* ─── Today's team activity ────────────────────────────────────────
   Per-person row with check-in status + counters. Sales-only roles. */
export function TeamActivityPanel() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('users').select('id, name, team_role, city, daily_targets').eq('is_active', true).in('team_role', ['sales','telecaller','sales_manager','agency']),
      supabase.from('work_sessions').select('user_id, daily_counters, check_in_at, check_out_at').eq('work_date', today),
    ]).then(([t, s]) => {
      const sessions = new Map((s.data || []).map(x => [x.user_id, x]))
      setData({ team: t.data || [], sessions })
    })
  }, [])

  if (!data) return null
  if (data.team.length === 0) return null

  return (
    <div className="v2d-panel" style={{ overflow: 'hidden' }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Today's team activity</div>
        <div style={{ fontSize: 11, color: 'var(--v2-ink-2, rgba(255,255,255,.40))', marginTop: 2 }}>
          {Array.from(data.sessions.values()).filter(s => s.check_in_at).length} of {data.team.length} field staff checked in
        </div>
      </div>
      <table className="v2d-q-table">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: 60, textAlign: 'right' }}>MTG</th>
            <th style={{ width: 60, textAlign: 'right' }}>CALLS</th>
            <th style={{ width: 60, textAlign: 'right' }}>LEADS</th>
            <th style={{ width: 60 }}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {data.team.map(u => {
            const sess = data.sessions.get(u.id)
            const c = sess?.daily_counters || {}
            const targets = u.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
            const checkedIn = !!sess?.check_in_at
            const checkedOut = !!sess?.check_out_at
            return (
              <tr key={u.id} onClick={() => navigate('/team')} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--v2-ink-2, rgba(255,255,255,.40))', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    {u.team_role?.replace('_', ' ')}{u.city && ` · ${u.city}`}
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.meetings >= targets.meetings ? '#4ade80' : 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>
                  {c.meetings || 0}/{targets.meetings}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.calls >= targets.calls ? '#4ade80' : 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>
                  {c.calls || 0}/{targets.calls}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.new_leads >= targets.new_leads ? '#4ade80' : 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>
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
  )
}


/* ─── SLA breach alert row ─────────────────────────────────────────
   Shown only when there's at least one breach. Compact banner row
   that can sit alongside the existing missed-reps banner. */
export function SlaBreachBanner() {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)

  useEffect(() => {
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('stage', 'SalesReady')
      .lt('handoff_sla_due_at', new Date().toISOString())
      .then(({ count: n }) => setCount(n || 0))
  }, [])

  if (count === 0) return null

  return (
    <section
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: 'rgba(248,113,113,.08)',
        border: '1px solid rgba(248,113,113,.28)',
        borderRadius: 12,
        marginBottom: 16,
        cursor: 'pointer',
      }}
      onClick={() => navigate('/leads?stage=SalesReady')}
    >
      <Clock size={18} style={{ color: '#f87171', flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {count} Sales Ready lead{count === 1 ? '' : 's'} past 24h SLA
        </div>
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.40))' }}>
          Telecaller passed but sales hasn't acted. Click to see who's affected.
        </div>
      </div>
      <ArrowRight size={14} style={{ color: '#f87171' }} />
    </section>
  )
}
