// src/components/leads/TodayTasksPanel.jsx
//
// Phase 19 — Smart Task Engine UI panel. Mounts inside the /work
// page's B_ACTIVE state. Shows the rep's ranked task list for today
// (priority asc, then due_at asc).
//
// Each row: heat dot · lead name + reason + due hint · actions
//   Tap row    → /leads/:id (existing flow)
//   Done       → complete_lead_task (logs an activity, drops row)
//   Snooze     → moves to tomorrow
//   Skip       → marks skipped (won't regenerate today)
//
// Panel header has a "Refresh tasks" button that calls
// generate_lead_tasks(). Idempotent — re-running adds only new rows.

import { useNavigate } from 'react-router-dom'
import {
  Sparkles, RefreshCw, Phone, CheckCircle2, Clock,
  Forward, X as XIcon, Loader2,
} from 'lucide-react'
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

export default function TodayTasksPanel({ userId, limit = 10 }) {
  const navigate = useNavigate()
  const {
    tasks, loading, generating, error,
    generate, complete, snooze, skip,
  } = useLeadTasks({ userId })

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
          <div className="lead-tasks-sub">
            Ranked by SLA, follow-up date, and heat.
          </div>
        </div>
        <button
          type="button"
          className="lead-btn lead-btn-sm"
          onClick={generate}
          disabled={generating}
          title="Re-generate from current lead state"
        >
          {generating
            ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            : <RefreshCw size={12} />}
          <span>Refresh</span>
        </button>
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
            return (
              <div
                key={t.id}
                className={`lead-task-row tone-${tone}`}
                onClick={(e) => {
                  if (e.target.closest('button')) return   // don't bubble action clicks
                  navigate(`/leads/${t.lead_id}`)
                }}
              >
                <HeatDot heat={t.lead?.heat || 'warm'} />
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
                  <div className="lead-task-reason">
                    {t.reason || TASK_KIND_LABEL[t.kind]}
                    {t.lead?.last_contact_at && (
                      <span className="lead-task-meta">
                        {' · last '}{formatRelative(t.lead.last_contact_at)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="lead-task-actions">
                  {t.lead?.phone && (
                    <a
                      href={`tel:${t.lead.phone}`}
                      className="lead-btn lead-btn-sm"
                      onClick={e => e.stopPropagation()}
                      title="Call"
                    >
                      <Phone size={11} />
                    </a>
                  )}
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm"
                    onClick={() => snooze(t.id)}
                    title="Snooze to tomorrow"
                  >
                    <Forward size={11} />
                  </button>
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm"
                    onClick={() => skip(t.id)}
                    title="Skip — won't reappear today"
                  >
                    <XIcon size={11} />
                  </button>
                  <button
                    type="button"
                    className="lead-btn lead-btn-sm lead-btn-primary"
                    onClick={() => complete(t.id)}
                    title="Mark done"
                  >
                    <CheckCircle2 size={11} />
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
