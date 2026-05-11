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
  Forward, X as XIcon, Loader2,
} from 'lucide-react'
import { useEffect } from 'react'
import { useLeadTasks, TASK_KIND_LABEL, TASK_KIND_TONE } from '../../hooks/useLeadTasks'
import { HeatDot, Pill } from './LeadShared'
import { formatRelative } from '../../utils/formatters'

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

export default function TodayTasksPanel({ userId, limit = 10 }) {
  const navigate = useNavigate()
  const {
    tasks, loading, generating, error,
    generate, complete, snooze, skip,
  } = useLeadTasks({ userId })

  // Phase 33F (B7) — auto-regenerate when the tab regains focus.
  // Saves the rep a tap; covers the case where they checked a meeting
  // in another tab and want the smart-task list to refresh.
  useEffect(() => {
    if (!userId) return
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
        <div className="lead-tasks-empty">
          Nothing flagged for today. Tap Refresh to re-check.
        </div>
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
