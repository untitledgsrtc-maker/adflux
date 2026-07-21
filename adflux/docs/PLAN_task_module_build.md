# Department task module — BUILD PLAN

**Status: PLAN ONLY. Nothing built.**
Written 2026-07-21 after a 4-lens survey of the live repo plus two rounds of
owner decisions. Supersedes the staging in `PLAN_department_task_module.md`
(that file remains the analysis + decision log).

---

## 1 · The goal, in one sentence

When a quote is won, the people who make the artwork and video get a job card
that is already filled in — client, media, city, dates — instead of asking the
rep on WhatsApp.

Everything else in this plan is secondary to that sentence.

---

## 2 · Decisions locked

| Decision | Choice | Why it matters |
|---|---|---|
| Trackdek | **Stays** — both halves used | We build the job side only. No time tracking, no screenshots, ever. |
| Roles | **`role='staff'` + designation** ("Designer", "Video Editor") | No change to `users_role_check`, so no review of every role-gated query and RLS policy. Reversible later. |
| Free-form tasks | **In from stage 1** (owner overruled the recommendation) | Mitigated: same list, same statuses, one sub-task level, measured at 6 weeks. |
| Approval | **Per work type AND media type** | Design → Renuka Vasava · Video → Peyush · **GSRTC video → Safika**. The GSRTC exception is why a plain department→approver column will not do. |
| Attendance | Creative check in like sales | Reuse the existing flow; do not build a second one. |
| Creative needed? | **Asked on the win screen** | Artwork is client-supplied about half the time. Without this question, half of all auto-created jobs are noise — and noise is what teaches people to ignore a list. |

---

## 3 · What exists vs what is new

**Reusable as-is:** file upload + storage · push notifications · the approve /
send-back pattern (TA claims) · the tabbed admin page shape (People) · check-in ·
the designations master.

**Genuinely new:** a jobs table that is not tied to a lead · sub-tasks · a
routing table (media → who) · an approver table (work type + media → who) · a
creative home screen · the win-screen questions.

**Explicitly NOT reusable:** `lead_tasks`. It is machine-generated, locked to a
lead, has a closed 6-value list of sales reasons, and has no title, attachment or
parent. Do not try to extend it — that is how the sales module gets destabilised.

---

## 4 · Stages

Each stage is useful on its own. Do not start the next until the previous is in
real use.

### Stage 0 — the 10-order test · owner, ~1 day · GATE
Owner lists the jobs produced by the last 10 won orders.
Answer already given as "a core plus extras", so this is a confirmation rather
than an open question — but it sets the actual core job list that Stage 3
automates. **Without this list, Stage 3 cannot be built correctly.**

### Stage 1 — get creative into the app · ~2 weeks
- Accounts for Renuka Vasava, Peyush, Safika, and any other designers/editors.
- `staff` + designation; designations added if missing.
- **Fix the live bug:** a non-sales user currently lands on the SALES screens.
- A creative home screen: "my work today", nothing else.
- Jobs created MANUALLY by an admin at this stage.
- Check-in for creative staff (reuse).

**NOT in stage 1:** auto-creation · approvals · sub-tasks · per-task push ·
workload dashboards · anything Trackdek does.

*Why first: nothing else can be tested until these people can sign in.*

### Stage 2 — jobs become real work · ~1.5 weeks
- Job card: title, description, owner, due date, five fixed statuses
  (To do / Doing / Sent for approval / Changes needed / Done).
- File upload from a phone camera in two taps.
- Comment thread.
- **Free-form tasks + ONE level of sub-tasks** (owner decision) — in the SAME
  list as job cards, never a second place to look.
- One morning summary push. Nothing per-task.

### Stage 3 — the payoff: won quote creates the work · ~1.5 weeks
- Win screen gains: **creative needed? (yes/no)** and **material-due date**.
- Routing table: media type → department or named person, with a department
  fallback so a person on leave does not silently block a job.
- Auto-create the CORE jobs from the Stage 0 list. Extras stay manual.
- **Sequence support** where one job waits for another (GSRTC LED = designer,
  then editor once the artwork is approved). This is the single most complex
  part of the module — it is a dependency, not a list.

### Stage 4 — approval + visibility · ~1 week
- Approver table keyed on (work type, media type), most specific wins, so
  GSRTC video reaches Safika and other video reaches Peyush.
- Send back with a mandatory reason.
- Manager view: who has how many open, and what is overdue.
- Overdue count on the admin dashboard.

### Stage 5 — only if asked twice
WhatsApp share of a job · client-visible proof links · workload balancing ·
anything resembling time tracking (**never** — that is Trackdek's job).

**Total: roughly 6 weeks of build**, plus Stage 0 and real adoption time between
stages.

---

## 5 · The data, in plain English

- **Jobs** — belongs to a quote (optional) and a person. Title, description, due
  date, status, department, media type, sequence position, parent job (for
  sub-tasks, ONE level).
- **Job files** — uploads against a job.
- **Job comments** — a thread per job.
- **Routing** — media type → department or person.
- **Approvers** — (work type, media type) → person; media type null = "any".

All new tables. Nothing touches `leads`, `quotes`, `lead_tasks` or any sales
table beyond READING the won quote. Section 45 holds: additive only, no new load
on any hot path.

---

## 6 · Risks, in the order most likely to kill it

1. **Adoption — the big one.** This team has never opened the app. Their first
   experience must be a job card already filled in. An empty list they must
   populate themselves will be abandoned in weeks.
2. **Notification fatigue.** Reps already get several pushes a day. Per-task
   pushes get notifications disabled at the phone level — which silently breaks
   **sales** pushes too. Budget: one morning summary, one on assignment, one on
   send-back. That is the whole allowance.
3. **Stale data.** Two weeks of untouched "In progress" and the owner stops
   looking. Once he stops, it is dead.
4. **The two Renukas.** Renuka Vasava (designer) vs Renuka (telecaller lead).
   Every person-picker must show full name + role, or the wrong one gets
   assigned. This collision exists in the live data TODAY.
5. **Scope creep into Trackdek's territory.** The moment someone asks for hours
   or screenshots, the answer is no — that tool already exists and is paid for.
6. **Sales regression.** This module sits BESIDE the frozen sales module, never
   inside it. Guardian on any commit that touches shared surfaces.

---

## 7 · Still needed from the owner

1. **The remaining media map** — hoarding, newspaper, cinema, digital/social, and
   anything else sold. Known so far: GSRTC LED → designer then editor · Govt auto
   hood → Dixita.
2. **The Stage 0 core job list** — from the last 10 won orders.
3. **Full names + phone numbers** for the accounts to create.
4. Confirm **Dixita** already has a login (she appears in the system) or needs one.

---

## 8 · What this plan deliberately does NOT include

Time tracking · screenshots · Gantt charts · drag-drop boards · custom statuses ·
multiple assignees per job · a client portal · deep sub-task trees · hours-based
billing. Each of these has killed an in-house task module somewhere. If one is
genuinely needed later it can be argued on its own merits — not smuggled in.
