// src/components/v2/NotificationPanel.jsx
//
// Phase 31A.4 — notification center. Owner sales-exec analysis (8 May
// 2026): 'no notification panel'. Replaces the decorative bell with a
// dropdown that aggregates real-time alerts from existing tables — no
// new schema. Each row links to its detail view.
//
// Sources (all RLS-scoped, so a sales rep sees own; admin sees all):
//   • payments where approval_status = 'pending'           → /pending-approvals
//   • follow_ups where !is_done AND follow_up_date <= today → /quotes/<id>
//   • leads where stage IN ('New','Working','QuoteSent')
//     AND handoff_sla_due_at < now()                       → /leads/<id>
//   • lead_activities where next_action_date = today       → /leads/<id>
//
// Total badge count is the sum across all four sources.
// Click outside closes; Esc closes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, X, AlertTriangle, Clock, CheckSquare, Calendar, ArrowRight, CheckCircle2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

const KIND_ICON  = { approval: CheckSquare, followup: Calendar, sla: AlertTriangle, dueAction: Clock }
const KIND_TINT  = { approval: '#FBBF24', followup: '#60A5FA', sla: '#F87171', dueAction: '#C084FC' }

// Phase 93.8c (25 May 2026) — bell items are recomputed live from
// source tables every open. No `notifications` table to mark-read
// against. Dismissal tracked per-device in localStorage so a "Mark
// all read" tap survives reload but resets if rep clears storage.
// Stable kind:id key; an SLA whose due date changes gets a fresh
// item id from the source table view, so a re-handoff re-surfaces.
const DISMISS_KEY = 'untitled_notif_dismissed_v1'
function loadDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}
function saveDismissed(set) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])) } catch {}
}
function dismissKey(it) { return `${it.kind}:${it.id}` }

// Phase 93.8d — group items that share a lead so a noisy queue
// collapses into one row per lead with "+N more" badge. Extract
// lead id from the route URL since each item already routes to
// /leads/:id (or doesn't, in which case it stays standalone).
function groupKey(it) {
  const m = (it.to || '').match(/\/leads\/([0-9a-fA-F-]+)/)
  return m ? `lead:${m[1]}` : `solo:${it.kind}:${it.id}`
}
function groupItems(list) {
  const map = new Map()
  for (const it of list) {
    const key = groupKey(it)
    if (!map.has(key)) {
      map.set(key, { key, items: [] })
    }
    map.get(key).items.push(it)
  }
  return [...map.values()]
}

export default function NotificationPanel() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null)
  const wrapRef = useRef(null)
  // Phase 93.8c — per-device dismissed set persisted to localStorage.
  const [dismissed, setDismissed] = useState(() => loadDismissed())

  async function fetchAll() {
    const todayIso = new Date().toISOString().slice(0, 10)
    const nowIso   = new Date().toISOString()
    const [apRes, fuRes, slaRes, naRes] = await Promise.all([
      supabase.from('payments')
        // ref_number was never a real column on quotes (Phase 33N
        // confirmed; CLAUDE.md §4 ref formats are stored in
        // quote_number directly). Selecting it broke the whole
        // payments query with HTTP 400. Dropped.
        .select('id, quote_id, amount_received, received_by, created_at, quotes(quote_number, client_company, client_name)')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(15),
      supabase.from('follow_ups')
        // Phase 31V — pulled follow_up_time too so notifications can
        // show "Meeting at 12:00" instead of just "Meeting today".
        // ref_number dropped per the same reason as the payments
        // select above.
        // Phase 34Z.81 — pull lead join too. Owner reported
        // "Follow-up: —" entries because PostCallOutcomeModal-spawned
        // follow_ups are lead-linked (no quote_id), so the quotes
        // join returned null and the title fell through to '—'.
        // Phase 34Z.83 — also pull quote.lead_id so quote-chase
        // follow-ups can route to /leads/:id (where the outcome
        // modal lives) instead of /quotes/:id (which has no Log
        // Outcome button).
        .select('id, quote_id, lead_id, follow_up_date, follow_up_time, note, quotes(quote_number, client_company, client_name, segment, lead_id), lead:lead_id(id, name, company)')
        .eq('is_done', false)
        .lte('follow_up_date', todayIso)
        .order('follow_up_date', { ascending: true })
        .limit(15),
      supabase.from('leads')
        .select('id, name, company, handoff_sla_due_at, stage')
        .not('stage', 'in', '(Won,Lost)')
        .lt('handoff_sla_due_at', nowIso)
        .order('handoff_sla_due_at', { ascending: true })
        .limit(15),
      supabase.from('lead_activities')
        // Phase 31V — pull next_action_time so the row reads
        // "Send quote · 14:30" not just "Send quote".
        .select('id, lead_id, next_action, next_action_date, next_action_time, lead:lead_id(name, company)')
        .eq('next_action_date', todayIso)
        .order('created_at', { ascending: false })
        .limit(15),
    ])

    const list = []
    ;(apRes.data || []).forEach(r => {
      const q = r.quotes
      list.push({
        kind: 'approval', id: r.id,
        title: `Payment pending: ₹${Number(r.amount_received||0).toLocaleString('en-IN')}`,
        sub: q?.client_company || q?.client_name || q?.quote_number || q?.ref_number || '—',
        to: '/pending-approvals',
        ts: r.created_at,
      })
    })
    ;(fuRes.data || []).forEach(r => {
      const q = r.quotes
      const l = r.lead
      // Phase 31V — bake follow_up_time into the title and sub.
      // Phase 34Z.81 — fall back to the lead's company/name when no
      // quote is attached (post-call modal spawned FUs are lead-only).
      // Also route to /leads/:id in that case.
      const tStr = r.follow_up_time ? String(r.follow_up_time).slice(0, 5) : ''
      const titleSubject = q?.client_company || q?.client_name
                        || l?.company || l?.name
                        || '—'
      // Phase 34Z.83 — prefer routing to /leads/:id so the rep lands
      // on the page that has the Call → outcome modal flow. Quote-
      // chase FUs were dumping to /quotes/:id which has no Log
      // Outcome action. Order of preference:
      //   1. The FU's own lead_id (post-call modal-spawned FUs)
      //   2. The linked quote's lead_id (Phase 14 — every quote has one)
      //   3. Fall back to /quotes/:id when quote is govt or lead_id null
      //   4. Last resort: /follow-ups
      const leadIdForRoute = r.lead_id || l?.id || q?.lead_id || null
      const route = leadIdForRoute
        ? `/leads/${leadIdForRoute}`
        : (q
          ? (q.segment === 'GOVERNMENT' ? `/proposal/${r.quote_id}` : `/quotes/${r.quote_id}`)
          : '/follow-ups')
      list.push({
        kind: 'followup', id: r.id,
        title: `Follow-up${tStr ? ` at ${tStr}` : ''}: ${titleSubject}`,
        sub: r.note || `${q?.quote_number || q?.ref_number || ''} · ${r.follow_up_date}${tStr ? ` ${tStr}` : ''}`,
        to: route,
        ts: r.follow_up_date,
      })
    })
    ;(slaRes.data || []).forEach(r => {
      list.push({
        kind: 'sla', id: r.id,
        title: `SLA breached: ${r.company || r.name || '—'}`,
        sub: `Stage ${r.stage} · handoff was due ${new Date(r.handoff_sla_due_at).toLocaleDateString('en-IN')}`,
        to: `/leads/${r.id}`,
        ts: r.handoff_sla_due_at,
      })
    })
    ;(naRes.data || []).forEach(r => {
      // Phase 31V — same time treatment for next-action-due rows.
      const tStr = r.next_action_time ? String(r.next_action_time).slice(0, 5) : ''
      list.push({
        kind: 'dueAction', id: r.id,
        title: `Today${tStr ? ` ${tStr}` : ''}: ${r.next_action || 'next action due'}`,
        sub: r.lead?.company || r.lead?.name || '—',
        to: `/leads/${r.lead_id}`,
        ts: r.next_action_date,
      })
    })
    // Sort: SLA first (red), then approvals, follow-ups, due actions.
    const order = { sla: 0, approval: 1, followup: 2, dueAction: 3 }
    list.sort((a, b) => order[a.kind] - order[b.kind])
    setItems(list)
  }

  // Initial fetch + refresh every 60s while open.
  useEffect(() => { fetchAll() }, [])
  useEffect(() => {
    if (!open) return
    const t = setInterval(fetchAll, 60_000)
    return () => clearInterval(t)
  }, [open])

  // Click outside / Esc closes.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    function onClick(e) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target)) setOpen(false)
    }
    if (open) {
      window.addEventListener('keydown', onKey)
      document.addEventListener('mousedown', onClick)
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  // Phase 93.8c+d — filter through dismissed set, then group by lead.
  // visibleItems = raw items minus dismissed
  // groups = visibleItems grouped by lead (or standalone for non-lead)
  const visibleItems = useMemo(
    () => (items || []).filter(it => !dismissed.has(dismissKey(it))),
    [items, dismissed],
  )
  const groups = useMemo(() => groupItems(visibleItems), [visibleItems])
  const count = groups.length

  function pick(item) {
    setOpen(false)
    navigate(item.to)
  }

  // Phase 93.13 (25 May 2026) — owner: "if i click on notofcatoon
  // its not remove from notofication". Tapping a row now dismisses
  // every item in that lead-group BEFORE navigating, so the same
  // row doesn't surface on next bell open. Matches the per-row X
  // behaviour. Auto-dismissal is per-device (localStorage) — if
  // the rep opens the app on another phone the row still shows
  // until they tap there too.
  function pickGroup(group) {
    if (!group?.items?.length) return
    const next = new Set(dismissed)
    group.items.forEach(x => next.add(dismissKey(x)))
    setDismissed(next)
    saveDismissed(next)
    setOpen(false)
    navigate(group.items[0].to)
  }

  function markAllRead() {
    if (!items || items.length === 0) return
    const next = new Set(dismissed)
    items.forEach(it => next.add(dismissKey(it)))
    setDismissed(next)
    saveDismissed(next)
  }

  function dismissOne(it, e) {
    e?.stopPropagation?.()
    const next = new Set(dismissed)
    next.add(dismissKey(it))
    setDismissed(next)
    saveDismissed(next)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        className="v2d-bell"
        aria-label="Notifications"
        onClick={() => setOpen(o => !o)}
        type="button"
        style={{ position: 'relative' }}
      >
        <Bell size={17} />
        {count > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 999, background: '#EF4444', color: '#fff',
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--v2-bg-0, #0f172a)',
          }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 360, maxWidth: 'calc(100vw - 24px)',
          background: 'var(--surface, #1e293b)',
          border: '1px solid var(--border, #334155)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,.4)',
          // Phase 34Z.88 — was 200 (rendered OVER mobile sidebar drawer at
          // z-60). Drawer now at 200 (v2.css); dropdown moves to 100 so the
          // drawer always wins. Still above topbar (10) + nav (40).
          maxHeight: '70vh', overflowY: 'auto', zIndex: 100,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: '1px solid var(--border-soft, rgba(255,255,255,.06))',
          }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Notifications</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Phase 93.8c — Mark all read clears every visible item
                  from the bell badge for this device. SLA / due rows
                  re-surface only if the underlying source row changes
                  (e.g. new handoff_sla_due_at, new follow-up). */}
              {visibleItems.length > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border, #334155)',
                    color: 'var(--text-muted, #94a3b8)',
                    fontSize: 11, fontWeight: 600,
                    padding: '5px 10px', borderRadius: 8,
                    cursor: 'pointer', fontFamily: 'inherit',
                    minHeight: 28,
                  }}
                >
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close"
                style={{
                  background: 'none', border: 0,
                  color: 'var(--text-muted)', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, padding: 0,
                }}>
                <X size={14} />
              </button>
            </div>
          </div>
          {items === null ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              {/* Phase 34Z.88 — Unicode ✓ → Lucide per §7 (Lucide only). */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 6, color: 'var(--success, #10B981)',
              }}>
                <CheckCircle2 size={22} strokeWidth={1.6} />
              </div>
              All clear — nothing pending right now.
            </div>
          ) : (
            groups.map((g, i) => {
              // Phase 93.8d — display the most-urgent item in this
              // lead group (SLA > approval > followup > dueAction —
              // already pre-sorted). "+N more" badge surfaces dupes.
              const it = g.items[0]
              const extra = g.items.length - 1
              const Icon = KIND_ICON[it.kind] || Bell
              const tint = KIND_TINT[it.kind] || '#FBBF24'
              return (
                <div
                  key={g.key}
                  onClick={() => pickGroup(g)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 14px', cursor: 'pointer',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-soft, rgba(255,255,255,.04))',
                  }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: 10,
                    background: `${tint}1A`, color: tint,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 13, fontWeight: 500,
                    }}>
                      <span style={{
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                      }}>
                        {it.title}
                      </span>
                      {extra > 0 && (
                        <span style={{
                          flexShrink: 0,
                          fontSize: 10, fontWeight: 700,
                          color: 'var(--danger, #EF4444)',
                          background: 'var(--danger-soft, rgba(239,68,68,0.12))',
                          padding: '2px 7px', borderRadius: 999,
                        }}>
                          +{extra} more
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 11, color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {it.sub}
                    </div>
                  </div>
                  {/* Phase 93.8c — per-row dismiss. Stops propagation
                      so the click doesn't navigate. Marks every item
                      in the group as dismissed in one go. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const next = new Set(dismissed)
                      g.items.forEach(x => next.add(dismissKey(x)))
                      setDismissed(next)
                      saveDismissed(next)
                    }}
                    title="Dismiss"
                    aria-label="Dismiss this notification"
                    style={{
                      background: 'none', border: 0, padding: 0,
                      color: 'var(--text-muted, #94a3b8)',
                      cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, marginTop: 0, flexShrink: 0,
                    }}
                  >
                    <X size={12} />
                  </button>
                  <ArrowRight size={12} style={{ color: 'var(--text-muted)', marginTop: 8, flexShrink: 0 }} />
                </div>
              )
            })
          )}
          {/* Phase 34Z.55 — diagnostics shortcut. Owner reported push
              not arriving on device. /push-debug shows each gate +
              has a "send test push" button. Sits at the foot of the
              drawer so it doesn't clutter the list. */}
          <div
            onClick={() => { setOpen(false); navigate('/push-debug') }}
            style={{
              borderTop: '1px solid var(--border-soft, rgba(255,255,255,.06))',
              padding: '10px 14px',
              fontSize: 11, color: 'var(--text-muted)',
              cursor: 'pointer', textAlign: 'center',
            }}
          >
            Push not arriving? Run diagnostics →
          </div>
        </div>
      )}
    </div>
  )
}
