// src/utils/followups.js
//
// Phase 175 (Consolidation) — ONE definition of "did the REP complete this
// follow-up, or did the SYSTEM close it?". Reports + the rep day-card must agree
// (owner #4: "follow-up data in reports shows mismatched records").
//
// A follow-up is closed (is_done=true) for two very different reasons:
//   * the rep actually did it (real work — counts toward "F-up done"), OR
//   * the system closed it — auto-closed on Lost/Won, auto-skipped a superseded
//     row, healed a backlog row, cancelled by a stage change. These are NOT rep
//     work and must NOT inflate any "done" count.
//
// The system stamps a marker into done_note (or note) every time it closes a
// row. This matches every such marker, case-insensitively, anywhere in the
// string — so a leading space or a phase-number prefix can't slip one through
// (the bug that made the Phase 174 heal rows count as "done"). Add new system
// close-markers here, in this ONE place, never inline in a component.

// Applied to follow_ups.done_note ONLY — a system-written column. The rep's own
// note goes to follow_ups.note / lead_activities.notes; the outcome modal closes
// a follow-up with done_note=NULL. So the bare 'heal' substring can never collide
// with rep free-text. Do NOT apply this regex to any rep-entered field.
const SYSTEM_CLOSE_RE = /auto-closed|auto-skipped|retro-closed|heal|cancelled by stage|closed: auto/i

// true when the follow-up was closed by the system, not completed by the rep.
export function isSystemClose(note) {
  return !!note && SYSTEM_CLOSE_RE.test(note)
}

// Phase 316 (Consolidation) — ONE definition of "does this OPEN follow-up belong
// in the active queue?". The follow-ups LIST and every per-rep overdue/pending
// COUNT must agree, or a parked Nurture lead shows "N overdue" on the dashboard
// card with nothing in the list (the recurring count-vs-list bug, §133/§163).
// Phase 310 added this rule inside FollowUpsV2 but the TeamDashboard overdue count
// (JS) + the team_dashboard_bundle RPC (SQL) were never updated — this brings all
// three to one source. Mirror any change here in the RPC's overdue_fu subquery.
//   • Lost lead     → never in the queue (terminal).
//   • Nurture lead  → ONLY its 30-day 'nurture' check-in (cadence_type==='nurture').
//                     A parked lead's near-term "after call" next-action stays OPEN
//                     in the DB but must not nag the rep or inflate counts.
//   • everything else → in the queue.
// Row must carry lead.stage (embed lead:leads(stage)) + cadence_type.
export function keepInFollowupQueue(row) {
  const stage = row?.lead?.stage
  if (stage === 'Lost') return false
  if (stage === 'Nurture') return row?.cadence_type === 'nurture'
  return true
}
