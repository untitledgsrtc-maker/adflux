// src/components/work/MissedCallsCard.jsx
//
// Phase 91b — Missed-call rescue card.
//
// Owner directive (24 May 2026):
//   "Today rep forgets missed calls — admin sees them in GpsTrack
//    but rep doesn't. Surface last-24h missed/no-answer rows on
//    /work + /telecaller with one-tap callback."
//
// Rules:
//   • Reads `call_logs` for the signed-in rep, last 24h.
//   • Includes only rows with a known lead_id (skip unknown numbers).
//   • Counts as "missed" when EITHER direction='missed' (incoming
//     unanswered) OR outcome='no_answer' (outgoing tel-tap that
//     didn't connect).
//   • Sorts by call_at DESC, caps at 8 rows.
//   • Hidden when count = 0 (exception-render).
//   • Tapping Callback fires the parent-supplied onCallLead which
//     mirrors WorkV2.quickLogCall (tel: → 1.5s → outcome modal
//     chain). No new modal mounted here.
//   • Auto-refresh: parent's useAutoRefresh tick is enough — the
//     card re-mounts read each time props change.

import React, { useEffect, useState, useCallback } from 'react'
import { PhoneMissed, Phone, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const LIMIT = 8
const WINDOW_HOURS = 24

function relativeTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function heatDotColor(heat) {
  const h = (heat || '').toLowerCase()
  if (h === 'hot') return 'var(--danger, #EF4444)'
  if (h === 'warm') return 'var(--warning, #F59E0B)'
  if (h === 'cold') return 'var(--blue, #3B82F6)'
  return 'var(--text-muted, #94a3b8)'
}

/**
 * @param {object} props
 * @param {string}   props.userId      — rep's auth uid
 * @param {function} props.onCallLead  — same signature as WorkV2.quickLogCall:
 *                                       (lead, taskId|null) → fires tel: + outcome modal chain
 * @param {number}   [props.refreshKey] — bump to force re-fetch (e.g. session.daily_counters.calls)
 */
export default function MissedCallsCard({ userId, onCallLead, refreshKey }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const sinceISO = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()
    // Phase 91b — pull both incoming-missed (direction='missed') and
    // outgoing-no-answer (outcome='no_answer') in one query via .or().
    // Supabase PostgREST `.or()` accepts a comma-separated list.
    const { data, error } = await supabase
      .from('call_logs')
      .select(`
        id, call_at, direction, outcome, duration_seconds, client_phone,
        lead:lead_id ( id, name, company, phone, heat, stage )
      `)
      .eq('user_id', userId)
      .gte('call_at', sinceISO)
      .not('lead_id', 'is', null)
      .or('direction.eq.missed,outcome.eq.no_answer')
      .order('call_at', { ascending: false })
      .limit(LIMIT * 2) // over-fetch to allow client-side dedup
    if (error) {
      console.warn('[MissedCallsCard] load failed:', error.message)
      setRows([])
      setLoading(false)
      return
    }
    // Dedup by lead_id (keep most recent), cap at LIMIT.
    const seen = new Set()
    const out = []
    for (const r of (data || [])) {
      const lid = r.lead?.id
      if (!lid || seen.has(lid)) continue
      // Drop rows where lead is missing fields the UI needs.
      if (!r.lead?.name && !r.lead?.company) continue
      seen.add(lid)
      out.push(r)
      if (out.length >= LIMIT) break
    }
    // Truth 5 — owner: "missed-call rescue not gone even after they called."
    // Nothing ever cleared an entry: a callback even made it STICKIER (the
    // rescue tap writes a fresh no_answer audit row). Clear a lead once a
    // REAL call (>=10s, the frozen §49 definition) exists at/after the
    // listed row — >= on call_at because the Phase 65/116 duration patch
    // lands on the SAME audit row, which then becomes its own proof. NOT
    // any-row: that would self-clear on the tap alone (audit row written
    // even if the dial was cancelled), hiding leads still needing rescue.
    if (out.length > 0) {
      // Phase 146 — owner: "rep already called back but it still shows."
      // The Truth-5 rule only cleared on a >=10s CONNECT, so a call-back
      // that didn't connect (lead didn't answer again) never cleared AND
      // added a fresh no_answer row → the lead kept nagging. New rule: a
      // missed/no-answer lead is RESCUED once the rep makes ANY call-back
      // to it — i.e. 2+ TOTAL calls to that lead in the 24h window (the
      // original + at least one follow-up attempt), connected or not. A
      // single un-returned call (count == 1) still shows. This matches
      // "I called back → stop showing it" and also covers the connected
      // case (the connect is the 2nd row).
      const { data: allCalls } = await supabase
        .from('call_logs')
        .select('lead_id')
        .eq('user_id', userId)
        .in('lead_id', out.map(r => r.lead.id))
        .gte('call_at', sinceISO)
      const countByLead = {}
      for (const c of (allCalls || [])) {
        countByLead[c.lead_id] = (countByLead[c.lead_id] || 0) + 1
      }
      setRows(out.filter(r => (countByLead[r.lead.id] || 0) < 2))
    } else {
      setRows(out)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
    // refreshKey is intentionally part of the dep list — parent bumps
    // it via useAutoRefresh tick to force a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshKey])

  // Exception-render: hide when nothing to rescue.
  if (loading || rows.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--v2-bg-1, #1e293b)',
        border: '1px solid var(--v2-line, #334155)',
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 10,
        }}
      >
        <PhoneMissed size={16} strokeWidth={1.6} color="var(--danger, #EF4444)" />
        <div style={{ fontWeight: 700, fontSize: 14 }}>Missed-call rescue</div>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 11, fontWeight: 600,
            color: 'var(--danger, #EF4444)',
            background: 'var(--danger-soft, rgba(239,68,68,0.12))',
            padding: '3px 9px', borderRadius: 999,
          }}
        >
          {rows.length} in 24h
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(row => {
          const lead = row.lead || {}
          const reason = row.direction === 'missed' ? 'Missed call' : 'No answer'
          return (
            <div
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: 'var(--v2-bg-0, rgba(15,19,32,0.6))',
                border: '1px solid var(--v2-line, #334155)',
                borderRadius: 10,
              }}
            >
              <span
                style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: heatDotColor(lead.heat),
                  flexShrink: 0,
                }}
                aria-label={`heat ${lead.heat || 'unknown'}`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13, fontWeight: 600,
                    color: 'var(--v2-ink-0, #f1f5f9)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {lead.name || lead.company || 'Lead'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--v2-ink-2, #94a3b8)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {reason} · {relativeTime(row.call_at)}
                  {lead.company && lead.name ? ` · ${lead.company}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onCallLead?.({
                  id: lead.id,
                  phone: lead.phone || row.client_phone,
                  name: lead.name,
                  company: lead.company,
                  stage: lead.stage,
                }, null)}
                disabled={!onCallLead || !(lead.phone || row.client_phone)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 10,
                  minHeight: 36,
                  background: 'var(--v2-yellow, #FFE600)',
                  color: 'var(--accent-fg, #0f172a)',
                  border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: 12,
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  opacity: (!onCallLead || !(lead.phone || row.client_phone)) ? 0.5 : 1,
                }}
              >
                <Phone size={12} strokeWidth={1.6} />
                Call back
                <ArrowRight size={12} strokeWidth={1.6} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
