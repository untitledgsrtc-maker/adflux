# Untitled OS · Adflux

Internal sales / CRM / quotation / GPS tracking / payroll system for
Untitled Advertising + Untitled Adflux Private Limited (OOH outdoor
ad agency, Vadodara).

**Canonical surface:** Web via `app.untitledad.in` (production) +
`untitled-os-tau.vercel.app` (preview). Deployed from `untitled-os`
branch on every push.

**Companion APK:** Capacitor 8 wrapper currently in live-update mode
(JS fetches from `app.untitledad.in` at cold-start). Last APK
release v0.95.1 (debug-signed, sideload). See `CAPACITOR_BUILD.md`
for rebuild flow.

## Source of truth

Read in order before touching code:

1. **`CLAUDE.md`** — working rules, brand tokens, frozen contracts,
   phase plan, all module status. Updated every major sprint;
   numbered sections grow chronologically.
2. **`UNTITLED_OS_MASTER_SPEC.md`** — 8-module OS vision + phase plan.
3. **`UI_DESIGN_SYSTEM.md`** + **`UI_PRIMITIVES.md`** — design tokens,
   components, type scale.
4. **`src/styles/tokens.css`** + **`src/styles/v2.css`** — LIVE
   tokens. Trumps docs when they disagree.
5. **`docs/UNTITLED_OS_v2_ARCHITECTURE.md`** — full architecture
   reference for V2 surface.
6. **`docs/SALES_MODULE_AUDIT_2026_05_26.md`** +
   **`docs/SALES_MODULE_SURFACE_AUDIT_2026_05_26.md`** — sales-module
   frozen baseline (Phase 34Z.88 → §28 + §29 + §31 contracts).

## Tech stack

- **React 18** + **Vite** + **React Router v6**
- **Zustand** for global state
- **React Hook Form** + **Zod** for forms
- **Supabase** (Postgres + Auth + Realtime + RLS + Edge Functions)
- **`@react-pdf/renderer`** (Other Media + Offer Letter PDFs)
- **`html2canvas` + `jsPDF`** (Quote PDF + Govt proposal)
- **`lucide-react`** for icons (only — no other icon library, no emoji)
- **DM Sans + Space Grotesk + JetBrains Mono** fonts
- **Vercel** auto-deploys from `untitled-os` branch
- **Capacitor 8** Android wrapper (live-update mode since Phase 94a)

## Local development

```bash
npm install
cp .env.example .env
# edit .env — paste Supabase URL + anon key + Google Maps key
npm run dev
```

App runs at `http://localhost:5173`.

## Deploy

Vercel watches `untitled-os` branch. Every `git push origin untitled-os`
triggers a build + deploy.

**APK rebuild:** only required for native changes (manifest, Java
plugin, build.gradle, new Capacitor plugin). JS/CSS/React changes
flow via live-update — no rebuild needed. See `CAPACITOR_BUILD.md`.

## Database

- Master schema in `supabase_schema.sql`
- Per-phase migrations in `supabase_phase{N}_*.sql` — owner pastes
  into Supabase Studio SQL Editor manually. Each ends with a
  `-- VERIFY` block.
- See `PHASE_33_INVENTORY.md` for the cadence-system migration map.

## Branches

| Branch | Vercel domain | Supabase | Purpose |
|---|---|---|---|
| `main` | adflux-iota.vercel.app | Original AdFlux Supabase | Live production (legacy, real money). Touch only for prod fixes. |
| `untitled-os` | app.untitledad.in + untitled-os-tau.vercel.app | New consolidated Supabase | All new module work. Auto-deploys on push. |

Never merge `untitled-os` → `main` until a sprint is genuinely
shippable. Prod runs untouched while consolidation continues in
parallel.

## Owner / users

- **Brijesh Solanki** — owner, primary user, UI-oriented, non-tech.
  All design + product decisions go through him.
- **Sales team** — 5 reps (Brahmbhatt, Sondarva, Dhara, Vishnu,
  Nikhil) + onboarding.
- **Telecaller** — Dhara + Rima (lead Renuka).
- **Admin / accounts** — admin role for office staff.

## Commit conventions

```
Phase {N}{rev?}: {one-line summary}

Body bullets describing root cause + fix.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

Pre-commit verification per `CLAUDE.md` §35: esbuild parse + brand
check + SQL schema check + sales-module-guardian agent audit on any
§28 frozen file.

