<!-- ANALYSIS ONLY - nothing built. 2026-07-21, from a 4-lens survey of the live
repo: existing task infra, the won-quote chain, the original master spec, and
what Trackdek actually is. Owner asked for a plan, not code. -->

# Department Task Module — Plan (no code)

## 1 · What you already have

Almost nothing for this. Be clear-eyed:

- **Zero task tables** outside sales. The one task table (`lead_tasks`) is machine-generated, locked to a lead, and has a fixed 6-item list of sales reasons. No title, no description, no attachments, no sub-tasks. It cannot hold a designer job.
- **No creative/production module.** It has always been "Phase 3, not started" in your own spec. The design that exists is one sentence: "12-field brief form, designer queue, review gate, revision counter."
- **A live bug today:** designers and video editors already exist as staff in your system, and if one logs in they land on the *sales rep* screens. Nothing usable for them.

What *does* exist and is reusable: your people list already knows who is a designer / video editor / ops (roles are set up), push notifications work for any person, file upload + storage works, the approve/reject pattern works (TA claims), and the tabbed admin page pattern (People) is ready to copy. So the plumbing is there; the module is not.

## 2 · The honest question

**Build it — but a much smaller thing than you asked for, and only for the work that starts from a won order.**

Reasoning, not diplomacy:

- Trackdek is mainly **time tracking and screenshots**. If what you actually value is watching hours and screen captures, do not try to replace that. We will not build surveillance, and a task module won't give it to you. Keep paying for that half if you want it.
- The *only* good reason to build in-house is the join you cannot buy: **won quote → job card already filled with client, media, cities, campaign dates**. If a rep still has to retype the brief, we've built a worse Trackdek.
- The part of your ask that worries me: *"all people can assign task to concerned person, and sub-tasks under that."* That is a generic to-do app. Every generic to-do app inside a CRM dies in about 8 weeks, because nothing forces anyone to use it. Quotes get used because they produce the PDF the client signs. Free-form tasks produce nothing, so people go back to WhatsApp.

So: yes to auto-created department jobs. No (for now) to free-form everyone-assigns-everyone with sub-tasks.

**Test to run before we write a line:** take your last 10 won orders. List every job each one produced. If the same 4–6 jobs repeat, this works. If all 10 look different, it's ad-hoc work and no module will fix it.

## 3 · If we build — the minimum that actually replaces the tool

Genuinely needed: job card auto-created from a won quote · one owner, one due date · five fixed statuses (To do / Doing / Sent for approval / Changes needed / Done) · file upload from a phone camera in two taps · approve or send-back with a mandatory reason · a comment thread · "my jobs today" on mobile · a manager screen showing who has how many open and overdue.

Feels needed, isn't: timesheets and hours (designers won't log honestly, you don't bill by the hour) · screenshots · Gantt charts · drag-drop boards · custom statuses per project · multiple assignees · client login · free-form sub-tasks.

## 4 · The won-quote handoff — what's missing

Today, when a quote is marked Won, five things fire automatically (payment follow-ups, rep notification, lead marked Won). **Nothing goes to any department.**

The gap is bigger than plumbing. A won quote records **what was sold** — medium, cities/stations, screens, quantity, dates, money. It records **nothing about what must be made**. Missing:

1. Is artwork/video needed at all, or is the client supplying it?
2. Static design or video? What sizes/formats?
3. Material-due date (usually days before campaign start).
4. Which department each medium belongs to — nothing anywhere says "Newspaper = designer, GSRTC LED = video editor".
5. A reliable win timestamp.

Two of these you must decide (1–3 become 3 new fields on the win screen). Item 4 becomes a small settings table you control.

## 5 · Staged plan

**Stage 0 — 1 day.** The 10-orders test above. Gate for everything else.

**Stage 1 — ~1 week.** Department home screen. Designer/editor logs in, sees *their* job list, changes status, uploads a file, comments. Jobs created manually by an admin. Fixes the "designer sees sales screens" bug. **Not in stage 1:** auto-creation, sub-tasks, approvals, anyone-assigns-anyone, notifications beyond one morning summary.

**Stage 2 — ~1 week.** Won quote auto-creates jobs, using your medium→department settings, with 3 new fields on the win screen. This is the payoff.

**Stage 3 — ~4 days.** Approval gate (send back with reason) + manager workload screen + overdue counts on your dashboard.

**Stage 4 — later, only if asked twice.** Free-form tasks for admin/ops, one level of sub-tasks, WhatsApp share button.

## 6 · Biggest risks

- **Adoption.** Nothing forces use. Mitigation: jobs appear by themselves, and the file lives here — if the artwork is in the app, WhatsApp becomes the chat, not the record.
- **Stale data kills trust.** Two weeks of "In progress" and you stop looking at the screen. Once you stop, it's dead.
- **Notification fatigue.** Reps already get several pushes a day. Adding per-task pushes gets notifications switched off at the phone level — which silently breaks your *sales* pushes too. Budget: one morning summary, one on assignment, one on send-back. That's all.
- **Sales module regression.** Your sales flow is frozen. This module must sit beside it, never inside it.
- **Scope creep.** Six weeks in, someone asks for hours, then a client portal. That's when it stops being a module.

## 7 · What I need from you

1. **Which half of Trackdek do you actually pay for** — the task board, or the screenshots and hours? If it's the second, we build nothing and you keep it.
2. **Run the 10-order test.** Your call, your memory, nobody else can do it.
3. **Medium → department map.** Newspaper, hoarding, GSRTC LED, auto hood, cinema, radio, digital — who makes the material for each?
4. **Who approves creative** before it goes to the client — you, or Piyush as creative lead? One name.
5. **Do you want free-form task assignment in stage 1?** I recommend no. If you insist, say so now and I'll price it separately.
6. **How do designers mark attendance** — office check-in, or not tracked in the app at all?
