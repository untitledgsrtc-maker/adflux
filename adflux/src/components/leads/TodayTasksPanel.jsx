// src/components/leads/TodayTasksPanel.jsx
//
// Phase 19 — Smart Task Engine UI panel. Mounts inside the /work
// page's B_ACTIVE state. Shows the rep's ranked task list for today
// (priority asc, then due_at asc).
//
// Phase 19b polish:
//   • Bigger heat dot (12px), more visual weight
//   • Action buttons sit next to body content (not floated to far right)
//   • Done + Tomorrow have text labels; Skip is a small × icon
//   • Reason line drops the redundant kind label (the chip says it)
//
// Tap row → /leads/:id (existing flow).
// Done    → complete_lead_task (logs an activity, drops row).
// Tomorrow → snooze (resurfaces tomorrow if rule still applies).
// Skip    → marks skipped (won't reappear today).

import { useNavigate } from 'react-router-dom'
import {
  Sparkles, RefreshCw, Phone, CheckCircle2, Clock,
  Forward, X as XIcon, Loader2, ArrowRight,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLeadTasks, TASK_KIND_LABEL, TASK_KIND_TONE } from '../../hooks/useLeadTasks'
import { HeatDot, Pill } from './LeadShared'
import { formatRelative } from '../../utils/formatters'
import { supabase } from '../../lib/supabase'

function dueHint(due_at) {
  if (!due_at) return null
  const ms = new Date(due_at).getTime() - Date.now()
  const hours = ms / (3600 * 1000)
  if (hours < 0)  return { tone: 'danger',  label: `${Math.abs(Math.round(hours))}h overdue` }
  if (hours < 6)  return { tone: 'warning', label: `${Math.round(hours)}h left` }
  return { tone: 'info', label: `due ${new Date(due_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}` }
}

// Strip the redundant phrasing the SQL generator produces so the
// chip + reason don't duplicate. The chip already says it's a Hot
// lead / New lead / Follow-up etc.; the reason should just carry
// the specific detail.
const REASON_STRIP = [
  /^Hot lead\s*[—–-]\s*/i,
  /^New lead\s*[—–-]\s*/i,
  /^Follow-up:\s*/i,
  /^SalesReady past\s*/i,
  /^Qualified\s*[—–-]?\s*/i,
  /^Nurture\s*/i,
]
function trimReason(_kind, reason) {
  if (!reason) return ''
  let out = reason
  for (const re of REASON_STRIP) out = out.replace(re, '')
  return out.trim()
}

export default function TodayTasksPanel({ userId, limit = 10, excludeTaskId = null }) {
  const navigate = useNavigate()
  const {
    tasks: rawTasks, loading, generating, error,
    generate, complete, snooze, skip,
  } = useLeadTasks({ userId })
  // Phase 34Z.47 — caller may pass excludeTaskId so the active
  // Next-up hero card doesn't render again at the top of this list.
  // Without this the same lead appears twice on /work (once as
  // "Next up", once as the first row here).
  const tasks = excludeTaskId
    ? rawTasks.filter((t) => t.id !== excludeTaskId)
    : rawTasks

  // Phase 33F (B7) — auto-regenerate when the tab regains focus.
  // Phase 34Z.45 — also fire ONCE on mount. Owner reported /work
  // says "Day is clear" while /follow-ups shows 13 due today. Root
  // cause: generate() only fired on window-focus, so a fresh route-
  // mount never populated lead_tasks → empty list → fallback shows
  // empty (todays_suggested_tasks doesn't read follow_ups). Mount-
  // time generate ensures Rule 3 (follow_up_due) inserts today's
  // tasks before the panel renders.
  useEffect(() => {
    if (!userId) return
    // mount call
    try { generate?.() } catch {}
    const onFocus = () => { try { generate?.() } catch {} }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const top = tasks.slice(0, limit)
  const overflow = Math.max(0, tasks.length - limit)

  return (
    <div className="lead-tasks-card">
      <div className="lead-tasks-head">
        <div>
          <div className="lead-tasks-eye">
            <Sparkles size={12} />
            <span>Today's tasks · {tasks.length}</span>
          </div>
          {/* Phase 33F (B6) — dropped the "Ranked by SLA / heat" subtitle.
              "SLA" and "heat" are technical terms a class-10 rep doesn't
              understand. The list IS the explanation. */}
        </div>
        {/* Phase 33F (B7) — manual Refresh button hidden for sales. The
            generate call now fires on focus + mount automatically. Admin
            still wants the button to debug regeneration. */}
      </div>

      {error && (
        <div className="lead-tasks-err">{error}</div>
      )}

      {loading && tasks.length === 0 && (
        <div className="lead-tasks-empty">Loading tasks…</div>
      )}

      {!loading && tasks.length === 0 && (
        <SuggestedTasks userId={userId} />
      )}

      {top.length > 0 && (
        <div className="lead-tasks-list">
          {top.map(t => {
            const due = dueHint(t.due_at)
            const tone = TASK_KIND_TONE[t.kind] || 'info'
            const trimmedReason = trimReason(t.kind, t.reason)
            return (
              <div
                key={t.id}
                className={`lead-task-row tone-${tone}`}
                onClick={(e) => {
                  if (e.target.closest('button')) return   // don't bubble action clicks
                  if (e.target.closest('a'))      return   // tel: link clicks
                  navigate(`/leads/${t.lead_id}`)
                }}
              >
                <span className="lead-task-heat">
                  <HeatDot heat={t.lead?.heat || 'warm'} />
                </span>
                <div className="lead-task-body">
                  <div className="lead-task-head">
                    <span className="lead-task-name">
                      {t.lead?.name || '(lead removed)'}
                    </span>
                    {t.lead?.company && (
                      <span className="lead-task-company">· {t.lead.company}</span>
                    )}
                    <Pill tone={tone}>{TASK_KIND_LABEL[t.kind] || t.kind}</Pill>
                    {due && <Pill tone={due.tone}>{due.label}</Pill>}
                  </div>
                  {(trimmedReason || t.lead?.last_contact_at) && (
                    <div className="lead-task-reason">
                      {trimmedReason}
                      {trimmedReason && t.lead?.last_contact_at && ' · '}
                      {t.lead?.last_contact_at && (
                        <span className="lead-task-meta">
                          last {formatRelative(t.lead.last_contact_at)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="lead-task-actions">
                  {t.lead?.phone && (
                    <a
                      href={`tel:${t.lead.phone}`}
                      className="lead-btn lead-btn-sm lead-task-btn-icon"
                      onClick={e => e.stopPropagation()}
                      title="Call"
                      aria-label="Call"
                    >
                      <Phone size={13} />
                    </a>
                  )}
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm"
                    onClick={() => snooze(t.id)}
                    title="Move to tomorrow"
                  >
                    <Forward size={13} />
                    <span>Tomorrow</span>
                  </button>
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm lead-task-btn-icon lead-task-btn-skip"
                    onClick={() => skip(t.id)}
                    title="Skip — won't reappear today"
                    aria-label="Skip"
                  >
                    <XIcon size={13} />
                  </button>
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm lead-btn-primary"
                    onClick={() => complete(t.id)}
                    title="Mark done"
                  >
                    <CheckCircle2 size={13} />
                    <span>Done</span>
                  </button>
                </div>
              </div>
            )
          })}
          {overflow > 0 && (
            <div className="lead-tasks-overflow">
              <Clock size={11} />
              <span>+ {overflow} more — finish the top first</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── SuggestedTasks ──────────────────────────────────────────────
   Phase 33Q (owner directive #5) — when the rep has no smart-tasks
   for today, fall back to the suggestion engine. Pulls from the
   todays_suggested_tasks RPC: new leads untouched > 24h, quotes
   sent > 5d, won quotes with outstanding > 14d.

   Tap a row → opens the lead or quote in detail view. */
function SuggestedTasks({ userId }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      // Phase 34Z.45 — also union pending follow_ups due today, since
      // the RPC doesn't read that table. Owner reported /work showed
      // empty while /follow-ups had 13 entries — this closes the gap
      // so the rep sees them even when generate_lead_tasks fails or
      // hasn't fired yet.
      const today = new Date().toISOString().slice(0, 10)
      const [rpcRes, fuRes] = await Promise.all([
        supabase.rpc('todays_suggested_tasks', { p_user_id: userId }),
        supabase.from('follow_ups')
          .select('id, lead_id, follow_up_date, note, lead:lead_id(name, company)')
          .eq('assigned_to', userId)
          .eq('is_done', false)
          .lte('follow_up_date', today)
          .order('follow_up_date', { ascending: true })
          .limit(8),
      ])
      if (cancelled) return
      const rpcItems = Array.isArray(rpcRes.data) ? rpcRes.data : []
      const fuItems = (fuRes.data || []).map((f) => ({
        kind: 'follow_up',
        lead_id: f.lead_id,
        quote_id: null,
        primary_text: `Follow up ${f.lead?.name || f.lead?.company || ''}`.trim(),
        secondary_text: f.note || (f.follow_up_date === today ? 'due today' : `overdue · ${f.follow_up_date}`),
        priority: 0,
      }))
      // Follow-ups first (most actionable), then RPC suggestions.
      setItems([...fuItems, ...rpcItems])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  if (loading) {
    return (
      <div className="lead-tasks-empty">
        Loading suggestions…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="lead-tasks-empty">
        All caught up — nothing flagged for today.
      </div>
    )
  }

  const toneFor = (kind) => kind === 'new_lead' ? 'info'
    : kind === 'chase_quote' ? 'warning'
    : kind === 'follow_up'  ? 'warning'
    : 'danger'
  const labelFor = (kind) => kind === 'new_lead' ? 'NEW LEAD'
    : kind === 'chase_quote' ? 'CHASE'
    : kind === 'follow_up'  ? 'FOLLOW-UP'
    : 'COLLECT'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)',
        padding: '8px 4px 4px',
      }}>
        Suggested for today — nothing else flagged
      </div>
      {items.map((it, i) => (
        <div
          key={`${it.kind}-${i}`}
          onClick={() => {
            if (it.lead_id) navigate(`/leads/${it.lead_id}`)
            else if (it.quote_id) navigate(`/quotes/${it.quote_id}`)
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            }}>
              <Pill tone={toneFor(it.kind)}>{labelFor(it.kind)}</Pill>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {it.primary_text}
              </span>
            </div>
            {it.secondary_text && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                {it.secondary_text}
              </div>
            )}
          </div>
          <ArrowRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </div>
      ))}
    </div>
  )
}

