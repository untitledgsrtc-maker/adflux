# Telecaller module — hand-off for Dhara · Rima · Renuka

**Sprint shipped:** 18 May 2026
**Latest commit:** `0be3395` (Phase 49.1)
**Audit:** sales-module-guardian PASS on all P0+P1 contracts.

---

## What's new (in plain English)

You now have a real telecaller workspace at `/telecaller`. It does
the call audit, captures outcomes, schedules callbacks, sends
WhatsApp follow-ups in one tap, and tracks your daily numbers
against owner-approved targets.

## Today's numbers you'll see

At the top of `/telecaller`:

| Tile | What it means | Owner-approved target |
|---|---|---|
| **Calls today** | How many calls you made (audited) | **≥ 50** per day |
| **Connect rate** | % of calls where customer picked up | **≥ 30%** |
| **Qualified this week** | Leads you flipped to SalesReady since Monday | **≥ 5** |
| **SLA breaches** | Qualified leads pending sales handoff > 24h | **0** |

Color rules:
- Green left bar = hit target ✓
- Red / amber bar = below target

## How to use it

### Making a call

1. Open `/telecaller`. Top "Next Call" card shows your hottest
   waiting lead.
2. Tap **Call now** (yellow button).
3. Your phone dialer opens. Talk to the customer.
4. Hang up. Come back to the app.
5. After ~1.5 sec, the outcome popup opens. Pick one:
   - **Good** — wants quote/more info. Heat auto-flips to **hot**.
   - **Maybe** — uncertain. Heat stays.
   - **Call later** — wants a callback. Default next-action =
     "Call back in 2 hours" (today's date + now+2h auto-filled).
   - **Lost** — politely refused. Heat auto-flips to **cold**.
6. Pick a next-action chip (Call back in 2h / Follow up tomorrow /
   3 days / 7 days / Nurture 30d / Custom date / None).
7. Optional: pick call language (Gujarati / Hindi / English).
8. Tap **Save outcome**.

The lead's stage auto-flips to "Working" if it was "New" (no manual
status change needed).

### Sending a WhatsApp follow-up

After a no-answer (or any time):
1. On Next Call card → tap green **WhatsApp** button.
2. Modal opens with 5 templates (No-answer follow-up, Send brochure,
   etc.).
3. Pick one → text fills in with customer name + your name +
   company auto-replaced.
4. Edit if needed → tap **Open WhatsApp**.
5. WhatsApp opens with text pre-filled → you tap send.
6. App auto-logs the WhatsApp send under that lead's history.

Admin (Brijesh) edits the WhatsApp templates from
**Master → WhatsApp** tab.

### Using call scripts

Top of Next Call card → tap **▾ Script · {script name}**.
Collapsible panel shows the pitch with customer name auto-filled.
Read while ringing. Admin edits scripts in **Master → Scripts**.

Two scripts by default: one for Private leads, one for Government.
A generic fallback if no segment match.

### Heat tagging

Every lead shows a dot (hot / warm / cold). Tap to change.

Heat auto-set rules:
- Good outcome → heat=hot
- Lost outcome → heat=cold
- Maybe / Call later → no auto-change (you can still tap)

Top of `/telecaller` page: **Top hot leads** card surfaces your 3
hottest leads at the top (sorted by oldest contact first within
hot — i.e. the hot leads you haven't called recently).

### DNC + WhatsApp opt-out

If customer says "stop calling me":
1. Open the lead detail.
2. Tap the **DNC** chip on the hero — flips to solid red.
3. The Call button is now blocked. App shows "DNC active" tooltip.

Same for WhatsApp opt-out — tap **WA opt-out** chip → amber state →
WhatsApp button blocked.

To unblock later, tap the same chip again.

### Stale lead alerts

If you have ≥1 lead with no contact for 3+ days (and not DNC), an
**amber banner** appears at the top of `/telecaller`. Tap any lead
in the queue below — the oldest is bubbled to the top.

### Upcoming callbacks panel

If you have callbacks scheduled in the next 48 hours, a panel
appears between the hero and the queue. Each row has:
- Customer name + company
- Scheduled date + time (e.g. "Today · 16:00")
- Call + WhatsApp buttons inline

When the callback time arrives, your phone gets a push reminder
automatically.

---

## For Renuka (TC lead)

You currently have the same view as Dhara + Rima. Your team-lead
dashboard (monitor both reps' call disposition, connect rate,
conversion funnel, reassign leads between them) is **deferred** —
folds into the broader sales-manager build (Phase 42.2). Status:
DB foundation ready (you're in `users` table with team_role =
sales_manager, Dhara + Rima can be chained under your `manager_id`).
Frontend pending.

For now, use `/dashboard` (admin view shared with Brijesh) to see
team-wide call activity + source attribution.

---

## What's NOT in this sprint

| Feature | Why deferred |
|---|---|
| Power dialer / Exotel integration | Owner skipped — procurement decision pending |
| Voicemail drop | Depends on power dialer |
| AI call summary (Whisper transcription) | Depends on call recording |
| Sentiment / coaching tags | Lower daily ROI |
| Renuka's TC team dashboard | Folds into sales_manager Phase 42.2 |

---

## Bugs to flag

If you hit any of these, report to admin:

- Call button doesn't open dialer → check phone permissions
- Outcome modal doesn't open after 1.5s → reload page, try again
- WhatsApp button opens wrong number → lead.phone field is wrong;
  edit lead detail
- Date shows wrong day (e.g. 19 May at 6 PM IST) → hard refresh
  the page (PWA cache); fix landed 18 May
- Heat doesn't change after picking outcome → check internet;
  trigger fires DB-side
- DNC button doesn't block calls → admin check RLS policy

---

## SQL files admin already ran

(7 files between 17 May and 18 May)

```
supabase_phase47_1_whatsapp_templates.sql      → whatsapp_templates table + 5 seed templates
supabase_phase47_2_call_scripts.sql            → call_scripts table + 3 seed scripts
supabase_phase47_4_auto_heat_from_outcome.sql  → trigger flips heat on outcome
supabase_phase47_5_dnc_optout.sql              → 4 cols on leads
supabase_phase47_8_call_language.sql           → language col on call_logs
supabase_phase49_tc_policies.sql               → 2 cols on daily_targets
```

Plus from earlier sessions (17 May):
```
supabase_phase45_2_lead_first_engagement.sql   → trigger flips New → Working on first call
supabase_phase45_3_outcome_callback.sql        → adds 'callback' to outcome enum
```

---

## Open questions for owner before next sprint

1. **TC compensation override** — today TC inherits sales 70/30 +
   incentive same as sales reps. Comfortable? Or set a different
   slab?
2. **TC quote target** — `daily_targets.min_quotes` exists; not
   currently displayed for TC. Should TC be quoted for "min 2
   quotes/week"? If yes, surface in KPI strip.
3. **Renuka view priority** — sprint after this, or wait for sales
   side first?
4. **Power dialer (Exotel/Knowlarity)** — procure or skip indefinitely?
   ₹2-5k/seat/mo cost.

---

**Module is shipped.** Production-test on Monday 19 May. Report any
bug via WhatsApp to Brijesh — he forwards to me.
