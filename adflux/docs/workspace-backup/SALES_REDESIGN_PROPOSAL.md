# Sales Module — Simplification Redesign

**Goal:** make the sales side usable by a Gujarati-speaking field rep with limited English, on a phone, while walking between meetings.

### Scope (locked, 11 May 2026)

This redesign applies to **Private segment** sales only — the field reps doing daily walk-ins, hoarding follow-ups, private LED, and other-media quotes.

**Government segment is OUT OF SCOPE for this redesign.** Govt flow stays exactly as it is today:

- Auto Hood + GSRTC LED wizards (no UI changes)
- GovtProposalRenderer with Gujarati cover letter + letterhead + bidan + district list (no changes)
- /proposal/:id route and detail page (no changes)
- Govt quote routing, OC/AWO upload, Mark Sent, Mark Won (no changes)
- Govt-specific master tabs (Districts, Stations, Companies) (no changes)

Reason: govt flow is handled by senior reps and the owner directly, not by the field reps the simplification targets. It's settled, it works, and changing it for low-literacy users would break the workflow that actually closes govt deals.

What this means in practice: the Today screen, simplified LogMeeting, color-coded leads, photo capture, etc. apply to **PRIVATE leads only**. A rep viewing a `segment='GOVERNMENT'` lead sees the existing UI unchanged.

---

**Constraints from owner (11 May 2026):**
- Voice as a first-class input, not the only one
- Today screen = home, always
- Big touch targets, **all UI labels in English** — Gujarati is for speaking, not for reading
- Hide what most reps never use, keep escape hatch for power users
- LogMeeting must be one-flow, sub-10-second

### Language policy (locked, 11 May 2026)

| Surface | Language |
|---|---|
| UI labels, buttons, headers, menus | **English only** |
| Voice input (Whisper transcription) | Gujarati / Hindi / English |
| Saved transcript stored on `voice_logs.transcript` | Whatever was spoken (Gujarati script after Phase 32N correction) |
| Outgoing WhatsApp message templates to clients | Gujarati or English (admin choice per template) |
| Govt proposal PDFs (`GovtProposalRenderer`) | Gujarati (existing, Phase 11) |
| Activity timeline notes | Whatever the rep typed/dictated |

The product looks and reads as English. Reps learn ~25 English action words (Meeting, Call, Save, Cancel, Hot, Lost) paired with icons. Native language is where it actually matters: speaking the note, dictating the company name, the client-facing PDF.

---

## 1. Stress-test of the brief

Three pushbacks worth flagging before we build:

**Voice ≠ primary for everything.** Voice is great for open-ended notes (evening summary, lead context) and for plan dictation. It's bad for structured choices (outcome chips, stage picker) — typing or tapping is 5x faster. Design rule: voice button next to every textarea, no voice for binary decisions.

**Don't remove features. Demote them.** Hide low-frequency features behind one "More" affordance on each screen. Power users (you, sales managers) can still get to everything. Removing means every edge case becomes a CLAUDE.md §3 patch later.

**Icon-only buttons fail low-literacy users.** Pure pictograms confuse — reps tap a phone icon expecting WhatsApp and get the dialer. Pattern for every button: **icon on top + one English word below**, always paired. 25-ish action words across the whole flow; reps memorise them in a day.

---

## 2. New sidebar / nav structure

### Mobile (the primary device for sales)

Bottom nav, 4 items only. Each: icon + English label.

| Icon | Label | Route |
|---|---|---|
| Home | Today | `/work` |
| Users | Leads | `/leads` |
| Mic | Voice | `/voice` |
| Chart | Score | `/scorecard` |

Hidden in a single "More" sheet (tap profile avatar → drawer):
- Follow-ups (or merge into Today as today's section)
- Quotes (also reachable from a lead's detail page via a "Quote આપો / Make quote" button)
- Clients (low value for daily use)
- Settings
- Log out

### Desktop sidebar

Same 4 primary items at the top. Everything else moved under a "More" expand. Sales reps mostly use phones, but the few that desktop should match the mobile mental model.

### What goes away from the rep's view

These move to admin/co_owner only — sales never needs them:
- Master settings (already admin-only, but confirm)
- Team dashboard
- Approvals queue
- Incentive rules editor

### What stays but moves under "More"

- Clients list (rep can find via a lead's company name; standalone screen rarely used)
- Quotes list (rep usually opens via a specific lead, not the global list)
- Voice page (also reachable via mic buttons everywhere)

---

## 3. The new /work (Today) screen

Three screen states only — collapsed from the current 5:

### State A — Day not started

Single button, full width, brand yellow:

```
[  ☀   Start My Day  ]
```

Tap → GPS capture → moves to State B. The morning plan textarea is collapsed under a small "Add plan (optional)" link below — for reps who want to type or dictate; otherwise the day just starts.

### State B — Day in progress (the main screen)

Vertical stack, top to bottom:

**1. Counter ring (one only — meetings)**

Big circular progress ring, center number 28px Space Grotesk:

```
       ╭─────────╮
      ╱  3 / 5  ╲
     │ Meetings │
      ╲ Today   ╱
       ╰─────────╯
```

Hide the calls and new_leads counters from the primary view. They appear when the rep taps the ring to see an "All targets" sheet. This is the one metric that matters for the daily milestone — don't dilute attention.

**2. Three giant action buttons (full-width, 80px tall each)**

Stacked vertically. Each: 28px icon on top + single English word below.

```
┌──────────────────────────────────┐
│        🤝                        │  ← opens LogMeeting (simplified)
│      Meeting                     │
└──────────────────────────────────┘
┌──────────────────────────────────┐
│        📞                        │  ← lead list filtered "needs call"
│       Call                       │
└──────────────────────────────────┘
┌──────────────────────────────────┐
│        🎤                        │  ← voice page
│       Voice                      │
└──────────────────────────────────┘
```

These three are the rep's daily ATM. Nothing else gets this much space.

**3. Today's tasks card (max 3 visible)**

```
Today · 3 left

 ⓘ Sunrise Diagnostics — call back
 ⓘ Patel Sweets — visit at 4 pm
 ⓘ Dr. Mehta — send quote

[ View all (8) → ]
```

Each row: big tap target, lead name as primary, action as secondary. Tap a row → opens the lead. Tap the round circle on left → marks done.

If more than 3 tasks today, "View all" expands. If zero, show:

```
✓ All done
  Log a new meeting?
```

**4. Quick links (small, bottom)**

A row of tiny chips, secondary visual weight:

```
 [ Follow-ups (5) ]   [ My leads ]
```

That's it. Total screen real estate budget: counter ring + 3 giant buttons + 3 task rows + 2 chips. Everything else goes behind taps.

### State C — End of day

After 6 PM, the "Start My Day" button becomes:

```
[  🌙   End My Day  ]
```

Tap → opens a voice modal with the headline **"Speak today's summary"**. Rep records 30s evening update → Claude parses → saves. GPS captured. Done.

No textarea form. No 3-field evening report. Just voice + auto-save. Reps who prefer typing can tap "Type instead" below the record button. The transcript that gets stored on `voice_logs` is whatever was spoken — usually Gujarati, displayed in Gujarati script (Phase 32N correction).

---

## 4. Simplified LogMeeting flow

Current flow: 6 fields + outcome + notes + GPS = ~8 inputs.

New flow: **3 inputs max, voice-assisted on each.**

### Layout (modal opens with GPS already captured)

```
┌─────────────────────────────────────┐
│   🤝   New Meeting                  │
├─────────────────────────────────────┤
│                                     │
│   Shop / company name               │
│   ┌─────────────────────┐  ┌─────┐ │
│   │ [text input]        │  │ 🎤  │ │  ← Voice mic next to input
│   └─────────────────────┘  └─────┘ │
│                                     │
│   How did it go?                    │
│                                     │
│   ┌─────────┐ ┌─────────┐ ┌────────┐│
│   │   😊    │ │   😐    │ │   😞   ││
│   │  Good   │ │  Maybe  │ │  Lost  ││
│   └─────────┘ └─────────┘ └────────┘│
│                                     │
│   ▾  More details (optional)        │  ← Collapsed by default
│                                     │
│   📍  GPS captured · ±15 m          │
│                                     │
├─────────────────────────────────────┤
│   [ Cancel ]         [ Save ]       │
└─────────────────────────────────────┘
```

That's 1 typed field + 1 chip choice = saved in 7 seconds. Voice mic accepts Gujarati / Hindi / English dictation for the company name when the rep can't type.

The "More details" expand contains: contact name, phone, city, notes — all optional, all secondary. 90% of meetings don't need them at the moment of logging.

### After save

Toast banner stays for 2 seconds, brand yellow:

```
✓ Saved · 4/5 meetings today
```

Then closes. Counter ring on /work ticks up immediately (Phase 12 trigger does the bump).

---

## 5. Features to remove or move to admin-only

| Feature | Current home | New home | Why |
|---|---|---|---|
| CSV bulk upload | /leads | Admin only | Reps never need it; admin-level workflow |
| Bulk stage change | /leads multi-select | Admin only | Confusing batch ops |
| Bulk reassign | /leads multi-select | Admin only | Reps don't reassign their own leads |
| Industry filter | /leads | Removed | <5% usage in real data |
| Per-rep filter | /leads chips | Admin only | Reps see only own already |
| Quote PDF download from list | /quotes | Hidden until lead reaches QuoteSent stage | Premature for early-stage leads |
| Stage history detail | Lead detail right panel | Collapsed under "More ▼" | Last 3 changes enough |
| Activity timeline >5 entries | Lead detail | "View all" link, show 5 by default | Wall of text scares reps |
| Multiple morning plan fields | /work A_PLAN | Single optional voice note | Most reps skip the form anyway |
| Detailed evening report | /work C_CHECKOUT | Voice-only summary | See §3 State C |
| Smart Task Engine panel | /work | Merged into "Today's tasks" card | Don't surface as a separate concept |
| ProposedIncentiveCard | Every page (big purple gradient) | Every page (small 32-40px strip) | Owner's call (11 May): keep it visible everywhere as daily motivation, just shrink it so it doesn't compete with the giant action buttons. Tap strip → /scorecard for deep view. |

Net effect: a rep going through the day touches 5 screens (Today, Leads list, Lead detail, LogMeeting modal, Voice modal). That's it. Quotes / Clients / Follow-ups / Score reachable but not in the way.

---

## 6. New simple features for low-literacy users

These are net-new ideas. Pick what you want to ship.

### 6.1 Photo capture on every lead

A "📷 ફોટો / Take photo" button on lead detail. Snap a shot of the shopfront, a business card, a hoarding mockup. Stores in Supabase Storage, attached to the lead.

**Why:** Reps remember faces and places better than names. A photo of the shop is worth 3 paragraphs of notes. Also: when Phase 2 OCR ships, business card photo auto-fills the contact name + phone (saves typing for low-literacy reps).

### 6.2 Color-coded lead rows

Replace the stage chip with full-row background tint:

| Color | Meaning |
|---|---|
| Green tint | Won or contacted in last 3 days |
| Yellow tint | Follow-up due today or this week |
| Red tint | Last contact >7 days, stage active |
| Gray tint | Nurture or Lost |

Reps scan the list by color in 2 seconds. Stage chip moves to a smaller corner badge.

### 6.3 "I'm here" auto-check-in

On lead detail, a big "📍 હું અહીં છું / I'm at this shop" button. Tap → GPS pin captured against the lead → meeting timer starts. If rep stays at the location >5 min, auto-logs a meeting with the captured pin.

**Why:** removes the "did I log this meeting?" cognitive load. Rep just shows up and taps once.

### 6.4 Days-since-contact dot

On every lead row + lead detail header, a colored dot next to the name:

- Green dot: last contact ≤3 days
- Yellow dot: 4–7 days
- Red dot: >7 days

Replaces the "last contact 3 days ago" text on the row. Reps read color, not text.

### 6.5 One-tap WhatsApp follow-up template

On lead detail, a "📤 ફોલો-અપ મોકલો / Send follow-up" button. Opens WhatsApp with a pre-filled Gujarati message:

```
નમસ્તે [Name],
ગયા અઠવાડિયે મીટિંગ થઈ હતી.
શું તમે કાંઈ વિચાર્યું છે?
- [Rep name], Untitled
```

The template lives in `master.message_templates` so admin can edit without code.

### 6.6 Voice transcript confirm screen

After Whisper + Claude run on a voice note, show the transcript for 3 seconds with a "ફરી બોલો / Re-record" link before auto-saving. Reps see what was captured; they can re-record if wrong.

### 6.7 Big numbers everywhere

Every count, target, value, and date uses 22-28px Space Grotesk numbers. The 14px text-style numbers on the current /work screen are too small for outdoor reading.

### 6.8 No empty states — always show next action

Every screen has SOMETHING actionable, even when empty:

- No leads → big "પ્રથમ લીડ ઉમેરો / Add first lead" button
- No follow-ups today → "નવી મીટિંગ લોગ કરો / Log a meeting"
- No tasks → "+ Quick add"

### 6.9 Audio confirmations

Optional setting: short audio chime ("ting" sound) when an activity is logged, a meeting is saved, a milestone is hit. Reps in noisy environments / not looking at the screen still know the save worked.

### 6.10 Long-press for power features

Admin / co_owner viewing the rep UI can long-press any element to surface advanced options (bulk select, raw data view, debug info). Normal reps never see these. Keeps power-user features alive without polluting the sales view.

---

## 7. Critical: what NOT to over-simplify

These are commonly tempting to strip but would hurt the rep:

- **Stage management.** Reps need to move New → Follow-up themselves. Keep the stage chip + button, just make it big and the modal pre-fill the obvious next stage.
- **Activity log on a lead.** Reps look at it to remember "what did I last say to this client". Keep the timeline visible; just truncate to 5.
- **GPS accuracy badge.** When GPS is off, reps need to know so they can step outside. Keep the ±Nm visible.
- **Phone + WhatsApp + Email buttons.** These are the highest-value actions per lead. Stay big, stay obvious.

---

## 8. Suggested ship order (1 sprint = 1 week)

If you want to do this in batches:

**Sprint A (week 1) — Core daily flow**

1. Simplified /work screen: 3-state machine, counter ring, 3 giant buttons, 3-row task card
2. Simplified LogMeeting modal: company + outcome chip + voice mic
3. Toast confirmation on save
4. Bottom nav reduced to 4 items

**Sprint B (week 2) — Lead view polish**

5. Color-coded lead rows
6. Days-since-contact dot
7. "I'm here" button on lead detail
8. WhatsApp follow-up template

**Sprint C (week 3) — Voice everywhere**

9. Voice button next to every text input
10. Voice transcript confirm screen
11. Evening report = voice-only

**Sprint D (week 4) — Photo + audio**

12. Photo capture on lead
13. Optional audio chime on save
14. Big numbers pass (24-28px on all KPIs)

---

## 9. Acceptance criteria

A field rep with class-10 Gujarati-medium education, given a phone with this app for the first time, should be able to:

1. Log in (already done via SSO/passwordless)
2. Tap "દિવસ ચાલુ" → start day → check in → on Today screen
3. Walk into a shop, tap "નવી મીટિંગ", say the shop name into the mic, tap "સારી", save → all in <15s
4. See the meeting counter tick from 2/5 to 3/5
5. Repeat 4 more times across the day
6. At end of day, tap "દિવસ બંધ", record a 20s voice summary, done
7. Never see a screen they can't read or understand

If that flow works without help, the redesign is successful.

---

## 10. Open questions for owner before I build

1. **Bottom nav 4 items vs 3?** I propose 4 (Today, Leads, Speak, Score). Could be 3 if Score moves into Today as a strip. Pick.
2. **Outcome chips: 3 (Good/Maybe/No) or 5 (Hot/Warm/Cold/Quote-asked/Not interested)?** I propose 3 — anything more is decision fatigue. Confirm.
3. **Auto-log on >5min GPS dwell?** Useful but adds complexity. Ship in Sprint B or hold for later?
4. **WhatsApp template library?** Just one default, or multiple admin-editable templates (e.g., "New lead intro", "Follow-up after quote", "Renewal nudge")?
5. **Photos: just file storage, or auto-OCR business cards?** OCR is a Phase 2 feature, but I could stub it now and wire OCR later.
6. **Should the simplified UI replace the current one for ALL sales reps, or be a toggle ("Simple mode") in user settings?** I'd push for a hard switch — toggles get forgotten. But you might want a soft launch.

Answer these and I'll ship Sprint A as Phase 33.
