# Starter prompt for a fresh Claude conversation

Use this when you open a new conversation in Cowork/Claude and want it to pick up the Untitled OS build with full context. Copy the entire block below (between the `===` markers) and paste it as your first message.

You may need to attach the project folder first via Cowork's directory picker so Claude can read files. The folder to attach is the `untitled-os` clone (the one in `~/Documents/untitled-os/` if you followed the setup steps).

---

```
===
I'm Brijesh, owner of Untitled Advertising in Vadodara. I'm continuing work on Untitled OS — an extension of the Adflux platform.

PROJECT CONTEXT — read these two files first before responding:

1. adflux/ARCHITECTURE.md — full structural reference for the existing
   Adflux app (stack, database schema, RLS, business rules, etc.).
2. adflux/docs/UNTITLED_OS_ARCHITECTURE.md — the 12-month plan with the
   8 modules I want to build on top of Adflux.

CURRENT STATE:

- I have TWO Vercel projects, TWO Supabase projects, and TWO branches:
  • main branch → adflux-iota.vercel.app → original production Supabase
  • untitled-os branch → untitled-os-xxxx.vercel.app → new staging Supabase
- The untitled-os Supabase has the full Adflux schema migrated but
  zero data. It's my sandbox.
- I work in two LOCAL folders: ~/Downloads/adflux/ (main branch only)
  and ~/Documents/untitled-os/ (untitled-os branch only).
- All experimental work goes on the untitled-os branch only. Production
  fixes go on main only. They never merge until a module is shippable.

HOW I WORK:

- I'm non-technical. Walk me click-by-click through any Mac / GitHub
  Desktop / Vercel / Supabase steps.
- Push back on me hard when I'm wrong. Don't agree by default.
- Be direct, no warm-up. Lead with what's wrong or missing.
- I commit via GitHub Desktop, not the terminal.

NEXT TASK:

[REPLACE THIS LINE WITH THE MODULE OR TASK YOU WANT — for example:
"Build Module M1 (Sales Activity & Lead) — start with the daily
activity tracker per Section 4.1 of UNTITLED_OS_ARCHITECTURE.md."]

Read the two architecture docs first, then propose a concrete first
sprint (2–4 commits worth) before writing any code. I'll approve or
push back, then you start building on the untitled-os branch.
===
```

---

## How to use it

1. Open a new conversation in Claude / Cowork.
2. If asked to attach a folder: pick `~/Documents/untitled-os/` (the new clone).
3. Replace the `[REPLACE THIS LINE...]` placeholder with what you actually want done.
4. Paste the whole block as your first message.
5. The new Claude will read both docs, then come back with a proposed plan instead of immediately writing code. Say yes / push back / revise. Then it builds.

## Tips

- One module at a time. Don't say "build all 8 modules" in one message.
- The `ARCHITECTURE.md` file is the source of truth for HOW the existing code works. The `UNTITLED_OS_ARCHITECTURE.md` file is the source of truth for WHAT the new modules should do.
- If a future Claude session contradicts something in `ARCHITECTURE.md` §12 (the "don't break the money" section), stop it and ask why. Those rules are deliberate.
- Every commit shows up in GitHub Desktop on the `untitled-os` branch, and the Vercel staging site auto-redeploys. To see new work live, refresh the staging URL.
