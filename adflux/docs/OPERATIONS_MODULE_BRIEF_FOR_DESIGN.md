# Operations module — full brief for design (as built on 25 Oct 2026)

Purpose of this file: hand it to Claude Design so it can redesign the whole Operations module as one clear system. It says who uses it, every screen that exists today, the data behind it, what is automatic, what is confusing, and what is missing.

## 1. The business in two lines

Untitled Advertising runs about 265–300 LED advertising screens inside Gujarat GSRTC bus stations (20 stations, 10–20 screens each). The screens are the product; a screen that is off earns nothing. Operations = keep every screen on, fix it fast when it is not, and prove it.

## 2. Who uses it

| Role | Who today | Device | Language | Main job |
|---|---|---|---|---|
| Operation executive ("field tech") | Gohil Ankitkumar, Gulshan Yadav (about 10 stations each) | Android phone (the app) | Gujarati first, low reading level | See what is off at my stations, call the right person, fix, log |
| Operation head | Dixita (desk) | Laptop + phone | English / Gujarati | Run the network, give work, watch the team, handle "can't fix" |
| Admin / owner | Brijesh | Laptop + phone | English | Is the network healthy, what does it cost, who is performing |
| Office (office admin, HR, accounts) | Dixita Gohel, Riya, Diya | Laptop | English | Give a technician a job (fault, campaign photo, office work) |
| Sales rep | Sales team | Phone | English | Ask for a live photo of a running campaign |

Field staff are not technical readers: big buttons, few words, numbers and colours carry the meaning.

## 3. How a screen problem moves today (the real flow)

1. **Detect.** The signage system (aiadflux CMS) is read every 10 minutes. Each screen is online or offline; cameras are on or off.
2. **Operating window.** Screens must be ON 7 AM to 9 PM. Offline in that window = fault. Still ON after 9 PM = "timer fault" (checked 9:30 PM). Overnight offline is normal and never alarms.
3. **Open.** A screen offline for 15+ minutes (not before 7:30 AM) becomes a fault row for that screen. A station ticket opens after 20+ minutes (this also WhatsApps the technician when the Meta template exists).
4. **Technician acts** (new station screen): picks the screens, picks the reason, sees who to call for that reason, calls, taps "Called, start work". Ticket = In process.
5. **Fixed.** When the screens stay online about 30 minutes in a row the system marks it Fixed by itself. The technician can also mark it fixed (after-fix photo) or say "Can't fix, tell the office" (reason goes to head and admin).
6. **Measure.** Daily uptime per technician (7 AM–9 PM only), a fault report each evening, a technician score (report only), and a pay link (uptime drives the 30% variable salary: full at 95%+, zero below 85%).

## 4. Every screen that exists today (14 pages)

Technician (phone):
- **Home** (`/ops-home`): three numbers (Total down, In process, Fixed today), stations worst-first with days dark, "Problem on a working screen" button, folded report + month.
- **Station screen** (`/ops-fix/:station`): tabs Log problem / In process / Fixed (the new flow described above).
- **Faults / Tickets** (`/ops-tickets`): Open, In process, Fixed, Me tabs; also holds "Assigned to you" (photo requests, auto faults).
- **Log issue** (`/ops-log`): older form: city, screen, reason, notes, photo. Still used for working-screen problems.
- **Down now** (`/ops-down`): every station with off screens, expandable, who to call.
- **Station board** (`/ops-station`): screen wall (one box per screen, red/green), contacts, issue-to-solution list, per-screen fault history ("faulty N times").
- **Check-in / classic queue** (`/ops`): attendance + everything assigned (hidden from nav).
- **My Performance** (`/ops-performance`): uptime ring, base + variable pay estimate, fixed counts, salary slips.
- Shared: My Calls, My Offer, My Work (tasks), My profile.

Head / admin / office (laptop):
- **Command center** (`/ops-command`): network health, "Needs you" queue (unassigned faults, overdue over 48h, leave and TA claims), per-technician scorecard.
- **Live console** (`/ops-dashboard`): tabs Tickets / Stations / Screens / Field team; reassign a station or ticket; manage who-to-call numbers.
- **Technician detail** (`/ops-tech/:id`): one technician's stations, uptime, km, calls.
- **Approvals** (`/ops-approvals`): field team leave and TA/DA.
- **Owner view** (`/ops-admin`, admin only): hero "screens working", needs-you list, stations with problems, technicians, month report, faults today, pay estimate.
- **Give work to tech** (`/ops-assign`): office gives a technician a fault job, a campaign photo, or office work.
- Sales side: "Request live photo" button on a won private LED quote; the rep sees the photo that comes back.

## 5. Data behind it

Stations (`ops_depots`, each assigned to one technician), screens (`ops_screens`, live status + camera + last response), contacts per station (depot office, electricians, cleaning, canteen), issue types with Gujarati/English fix steps (10 reasons: power cut, light bill not paid, software, wiring, internet, timer, bird nest, switch, display damage, cleaning), tickets (`ops_tickets`: source manual / auto offline / auto camera / sales photo request / timer), per-screen faults with start, fixed time, downtime and response (`ops_screen_faults`), daily uptime (`ops_uptime_daily`), calls (`call_logs` linked to a ticket), photos (private bucket), GPS pings for field tracking.

## 6. What is confusing today (design problems to solve)

1. **Too many overlapping pages.** A head sees 6 different places that show "what is down": Command center, Down now, Live console, Station board, Tickets, Owner view. Same data, different layouts and counts.
2. **Two vocabularies.** "Fault", "ticket", "issue", "problem", "job" are all used for the same thing.
3. **Station vs screen.** Tickets are per station, faults are per screen. The technician thinks in screens; the head thinks in stations.
4. **Auto vs manual tickets** look different and live in different lists.
5. **Pay and score are hidden** from the home screen on purpose, but the technician has no clear line between "what I did" and "what I earn".
6. **Night state.** At night everything reads "offline" (normal). The screens need a calm night mode.

## 7. What is missing (feature gaps, ranked)

Must-have for a field team:
1. **One ticket page** showing a fault's whole story: screens, reason, every call, notes, before/after photos, who touched it, time line. Today the story is scattered.
2. **Works without signal.** Technicians work where signal is poor; saves can fail silently. Needs queue-and-send-later with a clear "saved on phone" mark.
3. **Plan my day.** Order the technician's stations by urgency and distance; a visit list for today; "I reached the station" proof (GPS arrival).
4. **Escalation timers.** If nobody starts a fault in X hours, tell the head; if "can't fix", route to a named person with a deadline.
5. **WhatsApp alert** to the technician when a station goes down: the Meta template `ops_ticket_alert` was never approved, so it has never sent. Only in-app push works today.

Should-have:
6. **Screen profile page** (one screen): hardware, install date, license, full fault history, repeat-fault warning, photos.
7. **Before/after photo** visible to head and owner; today the after photo is saved but nobody can open it.
8. **Preventive work:** scheduled cleaning, power-meter checks, bird-nest rounds per station.
9. **Spare parts and cost:** what was replaced, by whom, how much (none today).
10. **Weekly and monthly report** for owner and for GSRTC / clients (uptime %, faults, time to fix, proof of play) as PDF/WhatsApp. Only a daily in-app report exists.
11. **Contact quality:** mark a contact "not reachable" or "wrong number"; add missing contacts from the field (technician can add numbers now, no review).
12. **Camera faults** are tracked but not part of the technician score.

Nice-to-have:
13. Head view of who is where (live map exists inside the console, not on a main screen).
14. Technician workload balance and reassign suggestions.
15. In-app notification list for operations (the bell is sales-based).
16. Gujarati for the office pages (English only today).

## 8. Brand rules the design must follow (Adflux Design Rules v1.0)

Dark navy base `#0f172a`, brand yellow `#FFE600` (one yellow primary per screen), status colours only green / amber / red / blue from tokens. Every screen opens with a teal hero card with ONE big number. Money and counts in Space Grotesk (22–42 px), body DM Sans. Radius 8 / 12 / 14–16 / pill. Lucide icons, stroke 1.6. Minimum 44 px tap targets, minimum 12 px text. Night theme only (Day mode was removed). Gujarati first with English under it, for field screens. Reference file: `_design_reference/Adflux_Design_Rules_v1.html`; flow mockup: `_design_reference/ops_technician_flow_mockup.html`.

## 9. Questions for the owner before design starts

1. Should the head have ONE home with tabs (Network / Tickets / Team / Reports) instead of six pages?
2. Do you want the technician to see a score or pay on the phone, or only fixes and uptime?
3. Is "plan my day" (urgent first, nearest first) wanted, or do stations stay worst-first?
4. Who gets the WhatsApp alert: technician only, or technician and head?
5. Should GSRTC / clients receive an uptime report from this module?
