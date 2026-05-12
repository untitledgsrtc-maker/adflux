# Your Day in the App — Sales Rep Guide

**For:** Brahmbhatt, Sondarva, Dhara, Vishnu, Nikhil + any new sales rep.
**Last updated:** 13 May 2026 (after Phase 34 audit + Sprint A–E cleanup).
**Time to read:** 7 minutes. Bookmark this page on your phone.

This guide is your map. It tells you where every feature lives in the app and when to use it during your day. The app already has 80%+ of what you need — most reps just don't know it exists.

If you find one feature here you've never used, this guide already paid for itself.

---

## 9:30 AM — Start of your shift

Open the app. You land on **Today** (`/work`).

### The first 5 minutes — plan your day

1. Look at the **5 task slots** at the top of Today.
2. Pick the meetings you'll do today (drag, pick, fill — up to 5).
3. Tap **Start Day** → tap **Check-in** (one-time GPS confirmation that you're at office).
4. Pick **call target** for the day (default 10).
5. Pick **focus line** — one sentence on what matters today.

**Tip you may not know:** if you don't want to type, tap the **mic button** at the top of Today. Speak out loud: *"Today I have meetings with Mehul Patel in Vadodara, Rakesh in Anand. Goal is 10 calls and 1 quote sent."* The AI (Co-Pilot) breaks it into tasks automatically. You only confirm.

### Your morning brief

At exactly **9:00 AM** every day, a WhatsApp message arrives from the system. It says:

- New leads from overnight (Cronberry imports)
- SLA breaches (leads pending more than 24 hours)
- Hot idle leads (warm leads going cold)
- Yesterday's collections

The same brief shows inside the app on the **AI Briefing Card** on `/work` and `/leads`. Tap any lead name in the brief → opens directly.

---

## 9:30 AM – 1:00 PM — First field block

### Drive to first meeting

Open Google Maps yourself for now (route optimizer is on the build list). Once in the meeting, **leave the app open** — GPS pings every 5 minutes for the TA module.

### Inside the meeting

When you sit with the client, tap the lead from `/work` or `/leads`. Lead detail opens.

Use these buttons during/after the meeting:

| Button | What it does |
|---|---|
| **Log Activity** | Calls / WhatsApp / email / meeting / site visit / note |
| **Log Meet (on /work)** | Cold walk-in fast-path. Creates lead + activity in ONE save |
| **Photo** | Snap business card → AI fills client name + phone + email + company automatically (OCR) |
| **WhatsApp** | Sends templated message — picks the right one based on stage |
| **Call** | Dials. Important: log the outcome yourself after (auto-log is on the build list) |
| **Change Stage** | Move lead from New → Working → QuoteSent → Won/Lost/Nurture |

**Tip you may not know:** the LogActivity modal has **quick chips for "schedule follow-up"** — Today 5pm / Tomorrow 11am / Day after / Next week. Tap a chip. Don't open the date picker.

**Tip:** the **mic button inside the notes field** records up to 60 seconds. AI transcribes. Useful when standing in the client's office and don't want to type.

### After meeting

Tap **Log Activity → Meeting** → pick outcome → tap **Schedule Follow-up** chip → Save.

A WhatsApp prompt pops up. **Templated message** is ready — "Thank you for your time today, I will share the proposal by [Date]." Tap Send → opens WhatsApp.

---

## 1:00 PM — Lunch + call block

While eating, do call follow-ups:

1. Open `/follow-ups`.
2. See **Overdue / Today / Tomorrow / This Week** tabs.
3. Each row has **Call / WhatsApp / Mark-done** buttons. Tap **Call** → phone dials.
4. After call ends, tap the lead → **Log Activity → Call** → outcome → save.

**Why it matters:** if you don't log the call, the system thinks the lead is still cold. The next-day follow-up fires again. You waste tomorrow's morning.

**Tip you may not know:** if a lead asks for revisit later (e.g. "call me back in April"), change stage to **Nurture** and set **revisit_date**. The system surfaces it back to you on that date. No need to set a calendar reminder.

---

## 2:00 – 6:00 PM — Field block 2

Same as morning.

### Building a quote

When client wants a quote, on the lead detail tap **Convert to Quote**.

- For Private LED clients: 4-step wizard (Client → Campaign → Review → Send).
- For Other Media (hoardings, malls, cinemas, digital, etc): different wizard, uses media types from master.
- For Govt clients: separate wizards for Auto Hood + GSRTC LED.

**The Send step** generates the PDF + opens WhatsApp with a shortened link. The PDF includes:

- Cities + rates + GST split
- Grand Total (in numbers)
- **NEW** — Amount in Words (Indian lakh/crore format, e.g. "Twelve Lakh Twenty-One Thousand Three Hundred Rupees Only"). Shipped 13 May 2026.

**Tip you may not know:** if you click WhatsApp on the quote detail page and the PDF fails to upload, you now get a toast warning. Before the fix, WhatsApp opened with no PDF and you wouldn't know.

---

## 6:00 – 7:30 PM — Wrap up at office

### Voice end-of-day summary

Go to `/voice/evening`.

Tap **Record**. Speak 20-30 seconds:

> "Highlights today: Mehul Patel from Lalbaug confirmed verbal yes for 3.5 lakh. Blockers: Rakesh in Anand wants 15% discount, need owner approval. Tomorrow focus: send proposal to Mehul, call back Vishal Construction."

AI breaks this into:
- Highlights
- Blockers
- Tomorrow focus

Saves to `work_sessions`. Owner can read all evening summaries on `/cockpit`.

### Travel allowance (TA)

Go to `/admin/ta-payouts` (or your phone may show it directly on `/work` end-of-day card).

**Auto-filled from GPS data.** You drove 240 km today, 8 visits across 3 cities — the app already calculated DA + bike fuel + (hotel if overnight). You confirm or edit. Tap submit.

**Most reps don't realize this is automatic.** If you've been claiming manually, you've been wasting time.

### Check out

On `/work`, tap **Check Out**. GPS records end-of-shift. Counters for the day finalize.

---

## 7:30 PM — Scorecard arrives

WhatsApp message lands. Shows:

- Meetings done vs target
- Calls done vs target
- Quotes sent vs target
- Your team rank
- One "tip" for tomorrow ("Call back Vishal — 5 days idle")

This is your day in numbers.

---

## Features you may not know exist

| Where | Feature | Use case |
|---|---|---|
| Anywhere, **Cmd+K** (Mac) / **Ctrl+K** (Windows) | AI Co-Pilot — ask anything in plain English | "How much did Sondarva close last month?" |
| `/leads` top right | **AI Briefing Card** | Live signal — hot leads, SLA breaches, overnight imports |
| Lead detail | **Activity timeline** | Every call/meeting/WhatsApp ever logged on that lead |
| Lead detail | **Latest quote card** | Shows the most recent quote without opening /quotes |
| `/work` | **Voice morning plan** | Speak today's plan, AI parses into tasks |
| `/voice` | **Voice log a call** | Speak in Gujarati/Hindi/English, AI extracts outcome + amount + next action |
| `/leads/upload` | **Cronberry CSV import** | Bulk imports with 90-day cutoff, Remarks regex parser |
| `/leads` | **Bulk reassign / bulk stage** (admin only) | Move 20 leads at once |
| `/my-performance` | **Performance Score** | 70% base + 30% variable salary, 50% monthly cliff |
| `/incentives` | (admin only) — staff profiles + payout liability |
| Stage = Nurture | **revisit_date** auto-creates follow-up on that date |

---

## What is NOT yet built (don't waste time looking)

| Missing | Workaround for now |
|---|---|
| Auto-log call outcome on hang-up | Manually open lead → Log Activity → Call → outcome |
| "Tomorrow" tab on /work | Look at `/follow-ups` → Tomorrow tab instead |
| Quote templates ("copy from last") | Open last quote → screenshot → use as reference |
| Map view + route optimizer | Use Google Maps yourself; copy 3-4 addresses into a single search |
| Offline mode | Make sure to refresh `/work` and `/leads` before driving to a dead-zone area |
| Govt invoice template (post-WON) | Generate manually outside the app |
| Incentive forecaster on quote ("if you close, you earn X") | Open `/my-performance` and mental-math |

These are coming. Until then, the workarounds above.

---

## Common mistakes — don't do these

1. **Don't skip logging calls.** "I'll do it later" = never. Half of all coaching problems come from missing call data.
2. **Don't forget to log photo of business card during meeting.** Use the Photo button on lead detail. Costs 5 seconds, saves you from re-typing.
3. **Don't change stage without filling required fields.** Lost reason, Nurture revisit_date, SalesReady BANT fields are mandatory for a reason.
4. **Don't ignore SLA breaches.** Lead pending 24+ hours without action shows up on telecaller queue + admin dashboard. You're on report.
5. **Don't make new lead without phone number.** WhatsApp + Call buttons won't work later.

---

## When something breaks

- Toast bottom-right says "Could not save X" → screenshot it, send to Brijesh.
- Page is blank → hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows).
- Lost network mid-task → DON'T close the modal. Wait for signal. Form usually preserves entries.
- Wrong stage assigned → use **Change Stage** modal to fix; system logs the correction.

---

## Final tip — discover by tapping

If you see a button you've never tapped, tap it once. Most are safe — they open modals you can cancel. The app is fault-tolerant. You can't break it by exploring.

**Goal for this week:** find ONE feature in this guide you haven't used. Use it for 3 days. See if it saves time.

— end of guide
