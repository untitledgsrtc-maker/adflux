# Prompt for Claude Design - Operations module (Untitled OS)

Paste everything below the line into Claude Design.

---

You are redesigning the **Operations module** of "Untitled OS", the internal operating system of Untitled Advertising (Indian outdoor / digital advertising, Vadodara, Gujarat). The current Operations screens work technically but the owner is **not happy with them**: too many pages, confusing words, and nobody can tell in five seconds what is broken and who is fixing it. Your job is to replace them with **one simple, easy-to-understand design** for three kinds of users. Simple beats clever. A field technician who reads little English and the owner who is not a technical person must both understand every screen without training.

## What the business actually does (read this first)
- We own and sell advertising on a **network of LED screens inside GSRTC bus stations (depots)**: **about 264 screens in 20 stations** (cities) across Gujarat. Advertisers pay us to show their ads. **If a screen is off, the advertiser is not getting what they paid for**, so the whole job is: keep the screens ON.
- A separate signage system (aiadflux.com) reports every screen: **on / off, last seen, uptime, and a camera status**. Our module reads that. When a screen goes offline, an issue appears automatically. Technicians can also log an issue by hand.
- Screens belong to a **station** (city). Each station has **depot contacts** (the local electrician / depot manager, external people we phone). A station is assigned to one **field technician**.
- **Uptime only counts between 7 AM and 9 PM.** At night, offline screens are normal: show "all quiet", never red alarms.
- **Pay depends on uptime**: 70% fixed salary + 30% variable. The variable part is full at 95% uptime or more, zero at 75% or less, and scales in between (this rule is locked, do not change it). Technicians also get Rs 3 per km travelled.
- The Operations Head owns uptime and closes issues. The sales team is not involved, except one thing: a sales person can ask for a **live photo of a client's ad on a screen**; that becomes a "photo request" job for the technician, and the photo goes back to the sales person.

## Who uses it (design for these three, nobody else)
1. **Field technician ("operation executive")**: on a **phone, outdoors, one hand, often in sunlight**. Reads **Gujarati first** (English toggle available). Low reading level. Needs: where do I go, who do I call, what is wrong, how do I show it is fixed. About 10 technicians.
2. **Operation Head**: mostly **desktop**, sometimes phone. English with Gujarati labels where helpful. Manages the technicians. Needs: what is down right now, who has it, what is stuck for too long, how is each technician doing, what needs my approval.
3. **Owner / Admin (Brijesh)**: desktop and phone. **Not technical.** Needs one glance: how many screens are off right now, which stations are worst, is the team doing its job, what is the pay impact.

## What is wrong today (the problems to fix)
- **Too many pages with overlapping jobs.** The Head sees 6 operations menu items (Command center, Down now, Log issue, Live console, Station board, Tickets) and the technician has Home, Down now, Log issue, Tickets and more; they show the same screens in different ways.
- **Jargon.** "Ticket", "lifecycle", "approval" confuse people. Use plain words: **Issue**, **Being fixed**, **Fixed**.
- **Too much on one screen**, same numbers repeated in several cards.
- A technician has to open 3 or 4 screens to reach a phone number. The contact to call must be the **first thing** they see for a broken station.
- The owner cannot answer "how many screens are off and who has them" quickly.

## Design goals (in this order)
1. **Five-second test**: each role opens the app and instantly knows what is broken, who is on it, and what to do next.
2. **Maximum 4 menu items per role** (technician: 3). Everything else is reached from a button on a screen, not from the menu.
3. **Every action within 2 taps** from home.
4. Plain words, short labels, big targets, one primary button per screen.
5. The same screen layout for the same kind of thing (a station always looks like a station card; a screen always looks like a screen tile).

## Screens to design

### A. Field technician (phone, 390 px, Gujarati first)
Menu (bottom bar): **Home - Log issue - Me**.
1. **Home = "Today's job"**
   - Top: today's date, a green "on duty" check-in state (check-in is a one-tap swipe; checking in after 11:30 counts as a half-day, so make the check-in prominent and obvious before 11:30).
   - One big card for the **next station to fix**: station name, **how many of its screens are off** (e.g. "4 of 14 off"), and the **big green Call buttons for the depot contacts first**, then the list of which screens are off, then one large button **"Fixed - add photo"**.
   - Below: my other stations as small cards, worst first (off count, tap to open).
   - Photo requests from sales appear as a job card: "Show live photo - Screen 3, Surat".
   - Empty state: "All your screens are on" with a calm tick.
2. **Log an issue** (the owner's own sketch, keep exactly this flow): **City -> contacts appear automatically -> Screen (Screen 1..N) -> What was wrong (pick from the list) + Notes + Photo -> Save.** The list of "what was wrong" (data, editable later): Power cut, Light bill not paid, Software issue, Wiring problem, Ethernet / internet issue, Timer issue, Pigeon / bird nest problem, Switch problem, Display damaged / blank, Cleaning required, plus "Other - type it". After saving show the last 5 issues on that screen.
3. **Me**: my uptime % this month and what it means for my variable pay in rupees (one number, one progress bar with the 75 and 95 marks), fixes this month, km travelled today and this month (Rs 3 per km), my calls, leave request, my profile.
- Every label is shown in **Gujarati with an English toggle**. Provide the Gujarati text in your copy deck.

### B. Operation Head (desktop 1440 px first, then phone)
Menu: **Command center - Issues - Stations - Team** (4 items).
1. **Command center (home)**: row of 4 health numbers (**network uptime today, screens off now, total screens, cameras off**); an off-hours state that says "all quiet" after 9 PM and before 7 AM.
   - **"Needs you" list**: issues with nobody assigned, issues open more than 48 hours, leave requests and TA claims waiting. Each row has one action button.
   - **Technician scorecard**, worst first: name, photo, uptime % (green 90+, amber 75-90, red below 75), fixes, average fix time, km, on-duty dot. Tap a technician for their day.
   - A **map** of the 20 stations coloured by how many screens are off, with technicians' live position.
2. **Issues**: one list with tabs **Open - Being fixed - Fixed**, a filter by station and by technician, and a **Reassign** control on each row (this moves the work and the uptime attribution to another technician). A "Down now" quick filter replaces the separate Down-now page.
3. **Stations**: a grid of the 20 stations; open one to see its screens as tiles (green on / red off / grey no data), its depot contacts, its assigned technician (changeable), and its issue history. This replaces the old Station board and Live console.
4. **Team**: technicians list, each person's attendance, km, uptime and pay estimate; approvals for leave and TA claims live here.

### C. Owner / Admin (desktop and phone)
- **One cockpit page**: uptime today / this week / 30-day trend line, screens off right now with the worst 5 stations, technicians on duty now, issues older than 48 hours, and the **pay impact** (total variable pay earned vs maximum for the team). No tables of raw data on this page; links go to the Head's Issues / Stations.
- It must answer in 5 seconds: "How many screens are off right now, where, and who has them?"

## Brand rules (hard rules, do not break)
- Dark theme. Page background `#0f172a`, cards `#1e293b`, raised `#334155`, borders `#334155` (strong `#475569`). Text `#f1f5f9`, muted `#94a3b8`, subtle `#64748b`. Also provide a light version using tokens.
- **Brand yellow `#FFE600`** = the one primary action per screen area and the active state only. Text on yellow `#0f172a`.
- Status colours always as a soft tint plus solid text, never alone and never colour only (add an icon or word): success `#10B981`, warning `#F59E0B`, danger `#EF4444`, info `#3B82F6`.
- Radius scale only: 6 / 10 / 14 / 20 px, pills 999.
- Fonts: **Space Grotesk** for headings and all numbers (tabular figures), **DM Sans** for body, 16 px minimum for body text, 18 px minimum on the technician phone screens. Gujarati text must render cleanly (use a Gujarati-capable font such as Noto Sans Gujarati as a fallback).
- Icons: Lucide only, stroke 1.6, sizes 14 / 16 / 18 / 22. No emoji.
- Touch targets: **52 px minimum on the technician screens**, 44 px elsewhere. Visible focus rings, hover states, contrast 4.5:1 or better, sunlight-readable (high contrast on the phone screens).
- Voice: plain, calm, short. No exclamation marks, no marketing words. Indian number grouping where money appears (Rs 1,23,456).
- Layout: 12-column grid, 24 px gutters, 8 px spacing scale. **Never repeat the same number or list twice on one screen.**
- Every screen needs designed **empty, loading and error states** (error = red banner with Retry), and works at 720 px and 1100 px breakpoints.

## What I need from you
1. A **navigation map**: before (current pages) vs after (new pages) for each role, with the page count.
2. **Mockups for every screen above**: technician on a 390 px phone, Head and Owner at 1440 px desktop plus their phone versions. Show the important states: station with several screens off, all screens on, night / off-hours, a photo request job.
3. A **clickable prototype** of the technician flow (Home -> Call -> Fixed + photo, and Log issue) and the Head flow (Needs you -> Reassign).
4. A **copy deck**: every label in English and Gujarati, in a table.
5. **Two layout options** for the Head's Command center so the owner can pick one.
6. A short list of anything in this brief you think is unclear or should be simplified further.

## Do not
- Do not add a multi-step approval flow for issues. Issues are simply Open -> Being fixed -> Fixed.
- Do not show sales features here (incentive cards, quotes, leads).
- Do not invent data fields. Available data: station (city) name, screens per station with on/off, last seen and uptime, camera on/off, depot contacts (name, role, phone), issue (screen, what was wrong, notes, photo, who reported, who is assigned, opened and fixed time), technician (name, photo, attendance, km, uptime %, fixes), photo requests from sales, leave requests and TA claims.
- Do not put more than 4 menu items for the Head or 3 for the technician.
- Do not use jargon words (ticket, lifecycle, SLA, MTTR).

## How I will judge it
- A new technician understands the Home screen in 10 seconds without being told anything.
- The owner answers "how many screens are off, where, and who has them" in 5 seconds.
- The Head can reassign a station or an issue in 2 taps.
- Fewer pages and fewer words than today.
