# Creative module — per-role views: APPROVED DESIGN SPEC (v3)

**Status: DESIGN ONLY. Nothing built.**
Produced 2026-07-21 by a three-direction design panel (one screen per person /
exception-first admin / one shared pipeline), judged into a single spec. The
mockup at `_design_reference/task_module_mockup.html` draws this spec.

Supersedes the layout thinking in the two earlier mockup attempts. The build
plan (`PLAN_task_module_build.md`) still governs stages and data.

---

# CREATIVE MODULE — APPROVED SPEC v3
**Untitled Advertising · per-role views · design only, nothing built yet**

---

## 1 · THE DECISION

**Direction C's spine wins: one job record that every role sees a different slice of, with the artwork→video dependency stored as a fact on the record rather than described in a message.** From B I take the owner's screen wholesale — it shows only what is wrong and is blank on a normal day — and from A I take the maker's answer block and the "delivered outside the app" release valve that keeps the late list honest. **Rejected: C's five-stage pipeline board and the stage strip on every card, A's five separate maker screens, and every version of a creative screen for sales reps.**

**Why the shared record wins.** The agency's real failure is not slow work. It is work nobody is holding — a GSRTC video with no assigned checker, an artwork sitting with one person while an editor waits, a retainer post that was never created. On separate per-person lists those conditions are invisible; nobody's screen is wrong, the job simply isn't anywhere. On one shared record, a job with no checker is a row with an empty name, and it lands on Brijesh's screen under a heading that says exactly that. Same reason Piyush's blocked reel and Renuka Vasava's pending approval must be one row seen from two ends: nobody writes "waiting on design", nobody maintains it, and one correction repairs five screens at once.

**Why C's pipeline board is rejected.** Five stages only work if something moves a job into stage two ("being made"), and C admits that depends on hour data keyed to job id, which does not exist. A board with one unreliable column is a picture of a lie, and a five-column board is a manager's mental model printed on a designer's screen. So the module keeps four words, and every one of them is an event with a timestamp that we actually capture:

> **Assigned · Sent · Approved · Changes asked**

Nothing renders "in progress", "started", "WIP" or a percentage anywhere in this module, on any screen, for any role. If it is not one of those four events plus a deadline, it does not appear.

**Why A's five screens are rejected.** Five files means five empty states, five mobile layouts, and a ninth work type landing in four of them with one missed. Two maker layouts (designer, video) on one route, plus one owner screen, plus two once-a-period tools. Five surfaces total, two sidebar entries.

**Why the sales rep gets no screen.** All three directions reached this and all three were right. Six reps who do no creative work, given a screen, get a chase button within two sprints; six reps pinging eight makers teaches the creative team to mute the app, and the time data — the only input this team supplies voluntarily — is the module's entire fuel supply. The omission is a decision and it is written here so nobody "helpfully" corrects it later.

**Two structural rules that come out of this and apply everywhere:**

1. **No job exists without a client, an owner, a deadline and a defined finish.** Enforced at creation, not at display.
2. **A job never routes to its own maker for checking.** When the routing table would send Renuka Vasava's own banner to Renuka Vasava, or Safika's own GSRTC video to Safika, it routes to Brijesh Solanki instead. None of the three directions covered this and it would have produced a silently stuck job in the first month.

**Every person, everywhere, is printed as full name plus role.** "Renuka Vasava · Design approval", never "Renuka". Two Renukas and two Dixitas make this a correctness rule, not a style preference.

**Routes and guards**

| Route | Who | Sidebar |
|---|---|---|
| `/creative` | 8 designers + 2 video (variant by team_role); approver lid appears for Renuka Vasava, Piyush Kumawat, Safika Bansiwala | **Work** (makers only) |
| `/creative/check` | approvers — the verdict surface, a route not a modal so the phone back gesture works | no |
| `/creative/desk` | Brijesh; Vishal filtered to government | **Creative** (admin only) |
| `/creative/assign` | Monday, one person | button on the desk |
| `/creative/plan` | 1st of month, one person | button on the desk |
| `/creative/hours` | monthly, owner | link on the desk |
| — | sales reps: one strip on the order they already open, two pushes | no |

One shell fix before anything ships: the purple proposed-incentive card is painted above every non-admin page. Creative staff are not on the sales incentive plan. Turn it off for designer and video roles, or the first thing eight people see every morning is a number about somebody else's money.

---

## 2 · THE SCREENS

### 2.1 DESIGNER — Shreya Panchal, Riya Jangid, Kamina Thakor, Dixita Rana, Dixita Gohel, Akshar Gohil, Damini Rane
`/creative` · phone-first · read-only except one button

**Top line.** One 13px muted line, nothing above it:

> Shreya Panchal · Thursday 9 April · 3 jobs, in order.

No hero number, no ring, no counts. She is not asking how much work she has, she is asking what she is making. The job is the first thing on the screen.

**Section 1 — MAKING NOW.** One full card, teal hero surface, radius 16.

```
GSRTC LED ARTWORK                                    Govt
Trimurti Clinic

Due Sun 12 Apr · last working day Sat 11 Apr · 2 days left
Finish: 1 artwork, 1920 x 1080, sent here.

Address on screen     Yes — full clinic address        [copy]
Phone number          Yes — reception line only        [copy]
Logo                  Uploaded            [ open ]
Reference             drive.google.com/…  [ open ]
Screens               10 · Jamnagar        Spot  20 seconds
Text to set           "Trimurti Clinic · Advanced
                       Diagnostics · Open 24x7"        [copy]
Sold by               Mayur · Sales

After you: Renuka Vasava · Design approval checks it,
then Piyush Kumawat cuts the 20-second video.

              [        Send file        ]
```

Two things in that card are doing all the work. The answer block exists so she never has to ask a question on WhatsApp to start — that is the entire justification for the card, and it is why an eight-row card here is not the eight-field grid that was rejected before. Those were metadata rows (status, priority, tags); these are the eight questions she would otherwise send a message about.

The **"After you"** line costs one row and converts sending a file from filing into unblocking two named people. She has never had that information.

**An unanswered field is never blank and is never her problem.** It renders in amber: `Phone number — not answered · Mayur asked 10:05, waiting`. She does nothing about it. The system asked at job creation. If she wants to push, a small `Ask` chip on the row re-fires the question to Mayur's phone as a notification with Yes/No buttons in it (see 2.4).

If the job has come back from a check, that job takes this position with a rose band above the answer block: `Changes asked by Renuka Vasava · 09:52 — Text wrong, Logo wrong` and a play button for her 12-second voice note.

**Section 2 — THEN.** Two one-line rows, no card chrome:
```
POST DESIGN · Mahant Investment · post 5 of 9 · due today 6:00 PM
FESTIVAL STORY · Mahant Investment · due Sat 11 Apr
```
Tapping expands the same answer block in place. It does not navigate away.

**Section 3 — WAITING ON A CHECK.** Her own sent work, still visible because the record is shared:
```
POST DESIGN · Mahant Investment · post 4 · with Renuka Vasava · 40 min
BANNER · Shreeji Motors · approved 08:30
```
Three rows, then a collapsed accordion. This is the shared-record payoff for a maker: she watches her own work move without asking anyone, which is the exact WhatsApp message we are trying to delete.

**Section 4 — TOMORROW.** One muted line: `Tomorrow: 2 jobs · Mahant posts 6 and 7`. Not tappable. It exists so she can pace.

**Interactive, exactly five things:** the material chips (logo, reference), the copy buttons, `Send file`, the `Ask` chip on an unanswered field, and read-taps on Then / Waiting / Tomorrow. Everything else is text.

`Send file` opens the phone's file picker directly. No modal, no fields, no date, no comment, no confirmation. On success the card collapses in place to a 44px line — `POST DESIGN · Mahant Investment · sent 13:40 · with Renuka Vasava` — and the next job rises into the hero slot.

**Empty state — nothing assigned:**
> **Nothing assigned to you yet.**
> 14 jobs are in this week's list. Renuka Vasava assigns on Monday morning.
> Last assignment: Mon 6 Apr, 09:20.

No button. She cannot fix it and a button that does nothing is worse than none. This state also writes a row the assigner screen counts, because a designer with no work is a load-balancing fact, not her problem.

**Empty state — everything sent:**
> **All three sent.**
> Two waiting with Renuka Vasava — oldest 40 minutes. One approved and gone to Mayur.

Accurate, no congratulation, no request for action.

**Phone.** This is the primary layout; desktop is the same thing centred at 560px. The hero card is roughly one screen. The answer block is two columns above 340px wide, label-over-value below. `Send file` is a 56px full-width yellow button at the foot of the hero card, in the flow, not floating — a floating button covers the field she is reading. Waiting-on-a-check collapses to one line: `2 with Renuka Vasava · oldest 40 min`.

---

### 2.2 VIDEO EDITOR — Piyush Kumawat, Safika Bansiwala
`/creative`, two-zone variant

**Top line.** `Piyush Kumawat · Thursday 9 April · 2 ready, 1 coming.`

Because Piyush also checks video, his approver lid (2.3) sits above everything. Then:

**Section 1 — READY NOW.** Same card grammar, longer body, fewer cards.

```
REEL EDITING
Mahant Investment · April retainer · reel 2 of 3

Due Mon 13 Apr · 4 days left
Finish: 1 reel, 9:16, under 60 MB, sent here.
      Uploading it to the page is a separate job.

Raw footage      14 clips     [ open folder ]
Length           45–60 sec
Music            client supplied — in folder
Green screen     yes, 2 clips
Subtitles        Gujarati

After you: Safika Bansiwala · Video approval checks it,
then REEL UPLOAD WORK goes to Riya Jangid.

              [        Send file        ]
```

**This zone is backfilled from the month's remaining retainer reels and is never allowed to be empty.** That is a data rule, not a layout preference. An empty ready-list tells the owner Piyush is idle on a day he is carrying eight hours of reel work, and nobody tolerates a screen that misrepresents them.

**Section 2 — COMING TO YOU.** The waiting shelf. Recessed surface, no glow, amber left border, a lock icon:

```
  GSRTC 20-SECOND SPOT · Trimurti Clinic
  Artwork made by Shreya Panchal · sent 09:15
  With Renuka Vasava · Design approval · 4 hrs
  If not checked by 16:00 it moves to Brijesh Solanki
  automatically. You do not need to do anything.
  Your date once it lands: Sat 11 Apr
```

**Zero interactive elements in this section except a read-tap.** No nudge, no comment, no chase. Chasing is the system's job and the escalation sentence is printed here so the age ticking up reads as evidence something is happening rather than evidence of a graveyard. If we ever give him a nudge button we have handed him upward management, and he already has a better tool for that.

**Section 3 — THIS WEEK.** Three or four dimmed one-line rows with a rough duration, because a reel is days and he plans in days:
`Fri 10 Apr · REEL EDITING · Mahant reel 3 of 3 · about 4 hrs`

**Section 4 — SENT THIS WEEK.** Collapsed accordion, same as the designer's.

**Empty state — nothing ready:**
> **April's Mahant reels are all sent — 3 of 3.**
> Nothing else assigned. May's reels appear on 1 May.
> One job is coming: Trimurti GSRTC, waiting on Renuka Vasava · Design approval, 4 hrs.

Names the reason, states the horizon, never reads as idleness — which matters because the owner sees the same record.

**Coming to you, empty:** renders nothing at all. No empty shelf.

**Phone.** Zones stack, ready-now first. Shelf rows compress to three lines: job and client / lock plus checker name and role / age plus the escalation sentence. The escalation sentence survives at every width — it is the line that stops the shelf feeling dead.

---

### 2.3 APPROVER — Renuka Vasava (all design) · Piyush Kumawat (video) · Safika Bansiwala (GSRTC video)

**She does not get a page. She gets every designer's page with a lid on top.** Her making is what she is judged on; her checking is what unblocks other people. Anything one tap away gets visited when the queue is four deep and someone has already phoned her, which is to say after it failed.

**The lid** — above her own first job, up to three rows, oldest first:

```
2 PEOPLE ARE WAITING ON YOU

 [thumb]  GSRTC LED artwork · Trimurti Clinic         [ Check ]
          Piyush Kumawat cannot start · 4 hrs
          Made by Shreya Panchal · Design

 [thumb]  POST DESIGN · Mahant Investment             [ Check ]
          Client posting today 6:00 PM · 1 hr
          Made by Dixita Rana · Design

          + 2 more
```

The second line always names **who is stopped**, never what is pending. "3 items pending review" is an admin chore and gets postponed. "Piyush Kumawat cannot start · 4 hrs" is a social fact and gets done. When nothing downstream is blocked it reads `2 files to check · oldest 40 min`.

**When the lid appears.** Twice a day, 11:00 and 16:30 IST, carrying everything since the last opening. Between those it collapses to one 32px line above her own work: `2 waiting · next check 16:30`. **Exception:** anything whose downstream deadline is inside 24 hours appears the moment it lands, with a rose border and the word `Now`. Trimurti's artwork on 9 April, with Piyush's cut due Saturday, is a `Now` item.

**The verdict surface** — `/creative/check`, a route so the back gesture works.
- Artwork full-bleed on black, pinch to zoom.
- A thin bar above it carries what she is checking against: `Address: Yes · Phone: Yes · Logo: client file` and one consequence line: `Piyush Kumawat starts when you approve.`
- Fixed bottom bar, 56px, thumb zone: **[ Changes asked ]** and **[ Approve ]**.
- **Approve is one tap.** No confirmation dialog — a confirm on the cheap path is how a queue swells. A five-second undo strip instead.
- **Changes asked opens chips, multi-select, no typing:** Text wrong · Logo wrong · Colours · Size wrong · Redo. Optional 15-second voice note. Send.
- Swipe moves to the next item. Three approvals is three taps and two swipes.

Saying no must cost the same as saying yes, or she approves things she should not.

**This is the only role permitted a second action in version one, and the reason is narrow: her yes or no is the work product, not a record of work already done.** Every abandoned status change in that time-tracking account was the second kind.

**The mechanism that keeps her queue from becoming the company's bottleneck:** at 6 working hours the item appears on Brijesh's screen. At 10 working hours **the check re-routes to Brijesh Solanki automatically** and the card on every screen says so — Piyush's shelf, Shreya's waiting list, the desk. Renuka's queue has an exit that does not depend on Renuka. Working hours means Monday to Saturday, 09:30–18:30 IST, so a 17:00 upload escalates at noon the next working day, not at 11 at night.

**Empty state: the lid is absent.** Not "0 waiting", not a tick, not "all caught up". Her own work is at the top of the screen exactly as it is for Shreya. Say this to the owner plainly, because it is the incentive that makes the whole thing work: **clearing the queue gives her back the top of her own screen.**

The unrouted bucket does not appear here. She does not inherit the company's routing failures — those go to Brijesh.

**Phone.** The lid is at most three rows, then "+N more", so the cost of scrolling past other people's work to reach her own stays bounded. The verdict surface is full-screen image with two 56px buttons in the thumb zone and safe-area padding; the chip sheet is a bottom sheet reachable with one thumb.

---

### 2.4 SALES REP — Mayur, Viral, Avkash, Dipak, kirti, Abhinav
**No screen. No route. No sidebar entry.** Three surfaces, none of which he has to visit.

**(a) One strip on the order he already opens** — inside `/quotes/:id` and `/proposal/:id`, under the client block, hidden entirely when the order has no creative job:

```
ARTWORK   With Renuka Vasava · Design approval · due Sun 12 Apr
VIDEO     Starts after artwork is approved · Piyush Kumawat
```
after approval:
```
ARTWORK   Approved Fri 10 Apr    [ trimurti-gsrtc-1920.jpg ]
VIDEO     With Safika Bansiwala · Video approval · 2 hrs
```
before anyone is on it:
```
ARTWORK   Not assigned yet · Renuka Vasava assigns Monday
```

**Three permitted forms: a name and a date, sent with the file, or not assigned yet.** The words "in progress", "pending" and "WIP" are banned from this strip. A vague status looks like information, fails to answer his client, and he phones Renuka Vasava anyway — and having done that once he does it forever. Two lines for GSRTC because there genuinely are two jobs, and this is where the shared record pays the rep: the sequencing becomes visible to him without anyone explaining it on the phone.

**Interactive: the file chip. Nothing else.** No chase button, no comment, no "request revision".

**(b) A push when the file is approved, carrying the file.**
> **Trimurti Clinic artwork approved**
> GSRTC LED · 10 screens Jamnagar · ready to send.

One tap forwards it to the client. This pre-empts his phone call instead of answering it, at a cost of zero actions.

**(c) A push when the brief has a hole — his only obligation in the whole module.**
> **Shreya Panchal needs one answer on Trimurti GSRTC**
> Does the phone number go on the screen?
> [ Yes ] [ No ]

Buttons in the notification, writing straight to the job. He never opens the app. This one mechanism removes the designer's single largest failure — the thin brief — for one tap from the person who already knows the answer. It fires automatically when a job is created with a mandatory field empty, and again when a designer taps `Ask`.

**Empty state:** there is no screen. On an order with no creative work the strip does not render.

**Phone:** two lines inside a page he already opens thirty times a day, plus two notifications. Nothing new to attend.

---

### 2.5 ADMIN / OWNER — Brijesh Solanki (Vishal filtered to government)
`/creative/desk` · **this screen is blank on a good day and that is the product**

Everything here comes from four facts we actually hold: a deadline, an assignment, an upload, an approval. Nothing derived from a status field, because no status field will ever be filled.

**Top line — no card, and it always speaks:**

Bad day:
> **2 jobs will miss their date. 1 has been waiting to be checked for 9 hours.**

Good day:
> **Nothing is wrong.** 14 jobs running · 6 due today · next deadline Trimurti Clinic, Sun 12 Apr.

The second line is load-bearing. A screen with literally nothing on it is indistinguishable from a broken one, so it must always prove it ran by stating a fact it had to query to know.

**Sections, in order. Every one disappears when empty.**

**1 · NOBODY IS CHECKING THIS** — rare, worst, therefore first. Rose.
```
CINEMA SLIDE · Shreeji Motors · sent by Akshar Gohil 2 days ago
No checker set for this media type. This job is in nobody's queue.
                                          [ Assign a checker ]
```
One vanished job costs a year of trust in an agency this size.

**2 · LATE** — deadline passed, nothing sent.
```
GSRTC 20-second spot · Trimurti Clinic
Piyush Kumawat · Video · due 12 Apr · 2 days late
Sold by Mayur · client campaign starts 15 Apr
                                   [ Delivered outside the app ]
```
The sold-by line is there because late artwork is client exposure and he needs to know whose client before deciding whether to care. The ghost button is what keeps this list honest under partial adoption: it closes the job and adds one to the footer tally.

**3 · WAITING ON A CHECK OVER 6 HOURS**
```
GSRTC LED artwork · Trimurti Clinic
With Renuka Vasava · Design approval · 9 hrs
Stops Piyush Kumawat · Video
Moves to you automatically at 10 hrs
```
This is the promise Piyush's shelf makes, kept.

**4 · DUE TODAY, NOTHING SENT** — and this section does not render before 15:00 IST. A due-today list at ten in the morning is noise and trains him to ignore the page.

**5 · NO OWNER YET** — a job with a deadline and nobody's name on it. This is what stops every read-only maker queue from silently emptying when the assigner skips a Monday.

**6 · RETAINER BEHIND PACE** — renders only when behind, never as a progress display.
```
Mahant Investment · 9 posts, 3 reels this month
5 posts, 1 reel sent · 12 days left · 3 posts behind pace
                                         [ Plan next month ]
```
Retainers are the larger half of the studio's load, they are contractual, and nothing anywhere currently tells him whether the agency delivered what it was paid for.

**Footer, 11px muted, always present:**
> April · 61 jobs created · 54 sent in the app · 4 delivered outside it · 6 briefs needed a chase
> [ See hours by work type ] [ Assign this week ] [ Plan next month ]

**Interactive:** every row is one tap to the place the problem gets fixed. Late and due-today open the job. Waiting opens the artwork so he can approve it himself if Renuka is out. No-owner opens the assign sheet with a person picker — tap a name, done, no drag. Unrouted opens the checker routing table. Plus the three footer buttons and a refresh.

**Hours by work type lives on its own page** (`/creative/hours`), reached from the footer, not on the desk. 356 hours on reel editing against 3.5 on a campaign letterhead is a pricing question he asks once a month, framed as money, and an exception screen must not carry a chart. **No per-person breakdown exists on that page or anywhere in this module.** The day the team believes this is a monitoring tool is the day the time tracking gets gamed, and the time tracking is the fuel supply for everything above.

**Empty state:** the good-day line, the retainer row if anything is behind, and the footer. Nothing else. No green banner, no all-clear card, no illustration.

**Vishal** — the identical page filtered to GSRTC and Auto Hood. A real filter: government is exactly where the artwork-then-video sequencing lives, so sections 1, 2 and 3 are most of his page. Sections 6 and the hours page are hidden.

**Phone.** This page is better on a phone than on a desktop and should be built phone-first. One line at the top, then at most five two-line cards. He checks it at 15:30 and again at 21:00, in ten seconds. Nothing collapses — if there is enough here to need collapsing, the day is already a disaster and he should see all of it.

---

### 2.6 THE TWO TOOLS THAT KEEP EVERY SCREEN ABOVE NON-EMPTY

**Assign this week** — `/creative/assign`, Monday morning, Renuka Vasava or Brijesh. The only comparative screen in the module and therefore the only board. People as columns, each header carrying full name, role, this week's job count and a small load bar. **The page opens with every unowned job already proposed to a person**, balanced by count and deadline. The human's action is `Accept all` — one tap — or tap a job then tap a person to override. **No drag and drop.** A drag happens in week one and never again. Free capacity ("Damini Rane · 0 jobs this week") is shown here and only here, framed as room, never on the owner's screen as idleness.

**Plan next month** — `/creative/plan`, 1st of the month, one person, once. Open it on 1 May and Mahant Investment's 9 posts and 3 reels already exist as twelve dated jobs with owners carried over from April. The human confirms owners and presses **Create 12 jobs**. This is an affordable second action — one person monthly, not eight people daily — and that ratio is the test every action in this module was judged against.

---

## 3 · WHAT EACH SCREEN DELIBERATELY DOES NOT HAVE

**Designer screen**
- **No status button, no comment box, no date picker.** This team has changed a status zero times in the history of an account they open every day. Sending the file is the only completion signal.
- **No progress ring, no "2 of 3", no percentage.** A ring drawn over a field nobody fills is decoration.
- **No tabs, no filters, no search, no sort.** Eight designers times three jobs is her whole world; every navigation control is an advertisement for a place the work is not.
- **No "start timer" button.** The existing time tool has one and it is the single habit that works. Do not duplicate it and do not compete with it.
- **No incentive card at the top.** She is not on that plan.

**Video editor screen**
- **No button of any kind on the waiting shelf.** An editor who must manage upward to start his own work goes back to WhatsApp, where that relationship already exists.
- **No "ready now" empty state that reads as idle.** Backfilled from retainer, always.
- **No ten-row list.** His items are days long; a long list is the wrong instrument.

**Approver lid**
- **No text field on the reject path.** If saying no costs a paragraph and yes costs a tap, she approves things she should not.
- **No confirmation dialog on approve.** A confirm on the cheap path is how a queue swells.
- **No zero-state card.** Clearing it must return her own screen to her; a "you're all caught up" tick takes that reward away.
- **No team view, no routing screen, no admin controls.** She is a checkpoint with a queue, not a manager.
- **No live stream of arrivals** except inside 24 hours of a deadline. Burning out the one person every design job passes through is the largest single risk in the module.

**Sales rep**
- **No screen, no route, no sidebar entry.**
- **No chase or nudge button, ever.** Six reps out-ping eight makers inside a week and the creative team mutes the app.
- **No word like "in progress".** A name and a date, or nothing.

**Owner desk**
- **No charts.** One chart exists and it lives on its own monthly page.
- **No per-person output, no leaderboard, no ranking.** Ranking named people turns the time data — the fuel for every screen here — into something to manage rather than record.
- **No completion percentage, no funnel, no activity feed** (removed once already), **no AI daily brief** (removed twice already; a third would be a pattern).
- **No inbox-zero congratulation.** The pending-payments banner precedent: at zero it disappears, it does not turn green.
- **No due-today list before 3 PM.**

---

## 4 · THE THREE TENSIONS — MECHANISM, NOT INTENTION

**The maker who is also the approver (Renuka Vasava).**
Five mechanisms, none of which depend on her discipline.
1. Her queue is a block on the same route, physically above her own first job. Reaching her own work means passing it.
2. The count rides the topbar badge on every page, so it cannot be escaped by navigating elsewhere.
3. Every row names a stopped person, not a pending item.
4. A verdict costs one tap and rejecting costs the same as approving — chips and an optional voice note, never typing.
5. **At 10 working hours the check re-routes to Brijesh Solanki automatically**, and every screen showing that job says so. This is the mechanism that matters: her queue has an exit that does not require her. Without it, the module's whole design half depends on one busy person's willpower, and the previous four mechanisms only lower the cost of a thing she may still be too busy to do.
Plus: the lid is absent at zero, so clearing it visibly returns her screen to her.

**The video editor blocked by an approval he does not control (Piyush Kumawat).**
The blocked job appears on his screen as a locked row in a separate zone that is never at the top. The row carries the checker's full name and role, the age in hours, and the sentence stating that at 6 hours it reaches Brijesh and at 10 it moves to him automatically. **The row has no button.** The escalation is real machinery, not a promise: section 3 of the owner's desk is where it lands, and the automatic re-route is what closes it. Meanwhile his ready-now zone is backfilled from retainer reels, so a blocked GSRTC job never produces a screen that says he has nothing to do.

**The sales rep who only wants a status (Mayur).**
He gets the answer pushed at him rather than a place to go and look. The order page he already opens carries a strip that is always a name and a date. When the file is approved, a notification arrives carrying the file, ready to forward — which answers the client before the client calls. When his job goes late, a second notification tells him so with the new expected date, because bad news must move across to the person holding the client, not only up to the owner; that is the one repair this spec takes from B's stated weakness. And the only thing he can do inside the module is answer a one-tap question about his own brief. There is no chase button and no screen to put one on.

---

## 5 · HOW IT DEGRADES

**Nothing assigned — the assigner skipped Monday.**
Designer: a named empty state that blames nobody and states when assignment happens, plus the date of the last one. Video: the same, and his retainer reels are still there because they were generated on the 1st, so his screen is not empty at all. Approver: no lid, her own screen. Rep: `Not assigned yet` on the order strip — honest, and it is the line that gets it fixed. Owner: **section 5 fills with every un-owned job**, and the footer line still states the running totals. This is the failure mode that would otherwise render as a perfect day, and section 5 plus the footer count are the two things that stop it.

**Everything late — a festival week, deadlines missed across the board.**
Designer: unchanged. Her hero is one job; being behind does not change what she is making right now, and there is no red wall to scroll past. Video: unchanged; ready-now is still one card. Approver: the lid shows three rows and "+6 more" — capped, deliberately, so the cost of passing it stays bounded even on the worst day. Owner: the desk fills top to bottom and every row has a name, a client and an age. This is the day the screen earns its keep. **Nothing collapses, nothing paginates** — if there is that much on it, he should see all of it.

**One person carrying everything — Renuka Vasava out sick, or simply buried.**
Hour 6: her pending items appear on Brijesh's desk with "Stops Piyush Kumawat". Hour 10: each one re-routes to Brijesh automatically and every downstream screen updates — Piyush's shelf now says "With Brijesh Solanki", Shreya's waiting list says the same, the rep's order strip says the same. Nobody sends a message. Nobody notices at 4 PM that a campaign date is gone. If Renuka is out for three days, the design half of the module runs on Brijesh with no configuration change and no conversation, and the assign screen on Monday shows her at zero capacity so nothing new lands on her.

**Half the team never uploads.** Section 2 of the desk fills with false lates. Each row has `Delivered outside the app`; one tap closes it and the footer reads `4 delivered outside it`. That converts partial adoption from a lie the screen tells into a number the owner can act on. If that number is high after a month, the module has its answer.

---

## 6 · THE ONE THING MOST LIKELY TO MAKE THIS FAIL

**A finished file can still reach the client without passing through the app.**

Shreya finishes the Trimurti banner, the client is on the phone, she WhatsApps it to Mayur the way she does today. The job never closes. On Sunday it appears on Brijesh's desk as two days late. He phones Renuka, learns the client had it on Friday, and the module joins the list of dashboards he does not trust. That is unrecoverable, and it is the single failure that takes everything else down with it — because five of the six screens above describe the same record, one wrong record is wrong in five places at once. Every other risk in this document is survivable; this one is not.

**The single decision that mitigates it: build the delivery half first, and ship nothing else until files are flowing through it.**

Week one is three things and nothing more: the approver's verdict screen, the approved-file push to the sales rep, and the file chip on the order page. No maker queues, no desk, no late list. The point is not compliance — it is that within a week, sending through the app becomes the **fastest way for a designer to get a rep off her back**, because the rep gets the file on his phone ready to forward before he thinks to ask for it. Delivery becomes the shortest path, not an extra step.

Then look at the number. If after three weeks files are arriving through the app, build the maker queues and the desk on top of a delivery habit that already exists. If they are not, the rest of the module would have been a screen full of confident wrong statements, and we will have spent three weeks instead of ten finding that out.

Everything else in this spec is a layout decision. This one is the decision.
