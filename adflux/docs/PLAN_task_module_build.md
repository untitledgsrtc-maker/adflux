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

### Stage 5 — client page + brief + assets · ~1 week
See section 9. Rep-filled, no client link.

### Stage 6 — the brief lands on the job card · ~3 days
See section 9.

### Stage 7 — retainers + monthly auto-jobs · ~1 week
See section 9. This is where the module pays for itself on the digital side.

### Stage 8 — client sign-off gate · ~4 days
See section 9. Internal approval and client approval are two different gates.

### Later — only if asked twice
WhatsApp share of a job · client-visible proof links · workload balancing ·
anything resembling time tracking (**never** — that is Trackdek's job).

**Total: roughly 6 weeks for Stages 0–4, plus ~3 weeks for Stages 5–8**, plus
Stage 0 and real adoption time between stages.

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
4. ~~Confirm Dixita has a login~~ — owner confirms **NOBODY in creative has a
   login**, Dixita included.

⚠️ **But check for existing rows before creating anyone.** `dixita@untitledad.in`
already appears in the users table (it is in the Phase 240 email-footer mapping),
and §42 flagged Dixita/Kamina/Jignesh as scoring 0.0 all week — i.e. rows that
exist but are unused. So the work may be "activate and onboard", not "create",
and creating a second Dixita would be worse than doing nothing.

Run this first:

```sql
SELECT id, name, email, role, designation, is_active, last_sign_in_at
  FROM public.users
 WHERE name ILIKE ANY (ARRAY['%dixita%','%renuka%','%peyush%','%safika%'])
 ORDER BY name;
```

Rows that come back → activate + set designation + send credentials.
Nothing back → create fresh via HR → Add Member.
Two Renukas → expected; keep the DESIGNER one straight (see the name-collision
note in the analysis doc).

---

## 8 · What this plan deliberately does NOT include

Time tracking · screenshots · Gantt charts · drag-drop boards · custom statuses ·
multiple assignees per job · a client portal · deep sub-task trees · hours-based
billing. Each of these has killed an in-house task module somewhere. If one is
genuinely needed later it can be argued on its own merits — not smuggled in.

---

# 9 · The digital-services half (Stages 5–8)

Added 2026-07-21 after the owner shared
`Untitled Advertising Client Brief.xlsx` — the workbook the team fills with a
client before social-media work starts.

## 9.1 · Why this exists

Stages 0–4 assume **won quote → jobs**. True for GSRTC LED and hoardings: one
order, a few jobs, finished.

Social-media retainers do not work that way. Section 3.5 of the workbook sets a
monthly quantity — 12 posts, 4 reels, 8 stories. That is roughly **24 design
jobs every month, per client, indefinitely**, and not one of them comes from a
won quote.

Without Stages 5–8, the task module covers the smaller half of the creative
team's actual workload.

## 9.2 · What the app does not have today (verified 2026-07-21)

| Thing | State |
|---|---|
| Service list (`media_types`) | OOH/print only — newspaper, hoarding, cinema, mall, radio |
| Anything recurring or retainer | None. `RenewalToolsV2` is a report over won quotes, not a schedule |
| Client detail page | None. `/clients` is a table plus a six-field edit modal |
| Files against a client | None. Files attach to quotes, leads, companies — never a client |
| Client brief / brand assets | None |

There is nothing to reuse and nothing to break. Everything below is additive.

## 9.3 · Decisions locked

| Decision | Choice | Consequence |
|---|---|---|
| Who fills the brief | **The rep, in the office** | No public link, no token form, no client login. Cuts a week of build and every security question with it. |
| Scope | **All the way, including monthly auto-jobs** | Stages 5–8 all in. |
| How much of the workbook to model | **Only what somebody reads back** | ~20 real fields. The long tick-lists become arrays. Sections nobody reads stay in the file. |
| The Excel itself | **Keeps working during the build** | It is not switched off until reps are using the client page by choice. |

**The workbook is ~200 rows; a designer reads about 15 of them.** Modelling all
200 produces a form nobody finishes. That limit is the point, not a shortcut.

## 9.4 · How the workbook maps

| Section | What it actually is | Where it goes |
|---|---|---|
| 1 · Basic details | Duplicate of Leads/Clients — company, contact, phone, city, industry | **Read from the existing record. Never typed twice.** |
| 2 · Select services | The service catalogue the app is missing | Services master (see 9.6) |
| 3.1–3.4, 3.6, 3.7 | Platforms, goals, audience, language, tone | Arrays on the brief |
| 3.5 · Monthly quantity | **The recurring job generator** | `client_retainers` (Stage 7) |
| 4 · Assets, style, things to avoid | The prefilled brief on the job card | Brief columns + `client_files` |
| 5 · Approval process | The **client's** approver — a different person from ours | Brief columns (Stage 8) |
| 6 · Posting access | Who publishes, per-platform access status | Brief columns |
| 7 · Meta Ads | Paid-ads brief, only when that service is on | Arrays on the brief |
| 8 · Checklist + % complete | **An onboarding tracker.** A task list, already designed | Checklist on the brief (Stage 5) |

## 9.5 · Two approvals, not one

Stage 4 approvals are **internal** — design → Renuka Vasava, video → Peyush,
GSRTC video → Safika. Section 5 of the workbook is a **different** gate: the
client signs off before anything is published.

The five statuses in the mockup (To do / Doing / Sent for approval / Changes
needed / Done) collapse both into one. For digital work the real sequence is:

```
To do → Doing → Internal check → Sent to client → Client approved → Scheduled → Posted
```

Do not bolt this onto the OOH flow, which genuinely has one gate. **Statuses
should vary by service, or the OOH team gets two pointless extra steps.** This
is the main open design question in Stage 8.

## 9.6 · One service list or two — owner decision needed

Section 2 lists ten services. Four already exist as `media_types` (outdoor,
GSRTC LED, print, digital). Six do not (social media management, Meta ads,
graphic design, reel/video editing, branding, logo design).

- **Option A — extend `media_types`, add a `department` column.** One list.
  Cost: the Other Media quote wizard dropdown grows by six entries, which is
  arguably correct since these are sold.
- **Option B — a separate `services` master for routing.** Quoting stays
  untouched. Cost: two overlapping lists — exactly the duplication that section
  69 of CLAUDE.md documents as the cause of "works, then breaks".

**Recommend A.** One list, one truth. Confirm before Stage 5.

## 9.7 · Stage detail

### Stage 5 — client page + brief + assets · ~1 week
- A real client detail page (`/clients/:id`) — none exists.
- **Add Client** button. Today a client row only appears via a saved quote, so a
  retainer client with no quote yet cannot be created at all.
- `client_briefs` — one row per client. Real columns for what gets read back
  (brand colours, fonts, design style, languages, tone, who supplies content,
  things to avoid, competitor links, approver name/phone/method/SLA, posting
  owner). Tick-lists stored as text arrays. Nothing modelled that nobody reads.
- `client_files` + a `client-assets` bucket — logo PNG, logo vector, brand
  guidelines, brochure, catalogue, product photos. Same upload pattern as the
  existing quote attachments.
- Section 8's 13-item checklist, with the % complete it already calculates.
  Stored as a JSON list on the brief for v1 — a table only if "who marked this,
  and when" turns out to matter.
- Section 1 fields are **displayed from the existing lead/client record**, never
  re-entered.

### Stage 6 — the brief on the job card · ~3 days
The designer opens a job and sees brand colours, fonts, tone, language, design
style, things to avoid, competitor references and the asset files — without
opening a spreadsheet or asking the rep. This is the same promise Stage 3 makes
for won orders, applied to retainer work.

### Stage 7 — retainers + monthly auto-jobs · ~1 week
- `client_retainers` — client, service, posts/reels/stories per month, start
  month, active flag.
- A scheduled job (the same `pg_cron` that already sends pushes) runs near
  month-end and creates next month's cards for every active retainer,
  pre-filled from the brief and routed by service.
- **Guard rails, learned from the follow-up cadence work:** never generate twice
  for the same client-month; never generate for a paused or ended retainer;
  never generate past the retainer's end. One notification for the batch, not
  24 — notification fatigue is risk #2 in section 6 and 24 pushes would prove it.

### Stage 8 — client sign-off gate · ~4 days
Per-service status sets (9.5), a "sent to client / client approved / changes
needed" step with the reason captured, and the client-side approver from Section
5 shown on the card so nobody has to ask who signs off.

## 9.8 · Fix the workbook itself (free, today)

The blank template and the filled example disagree. Blank section 3.4 lists 14
content types (Static Posts, Reels, Carousel…); the example has two rows
("Content provide by us" / "by client"). Anyone copying the example into the
blank template will misalign the rows. Worth correcting in the file regardless
of what gets built.

## 9.9 · Out of scope, flagged

Monthly **billing** for retainers. Quotes are one-off; a retainer is currently
typed as a lump sum in the Other Media wizard. Recurring invoicing is an
accounts problem, not a task-module problem — noted so it is not assumed to be
covered.
