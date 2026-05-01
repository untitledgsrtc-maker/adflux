# Untitled Proposals

Standalone proposal generator + payment tracker for Untitled Advertising (Vadodara / Gandhinagar, Gujarat).

Two media products, both bilingual (Gujarati + English) PDFs:

- Auto-rickshaw hood advertising across 33 Gujarat districts
- GSRTC LED screens at 20 bus stations

## What's in this repo

| Folder | What it is |
| --- | --- |
| `db/` | Postgres migrations 001–011 + seed data + RLS + RPCs |
| `app/` | React + Vite frontend (Supabase JS, Zustand, React Query, RHF + Zod) |
| `pdf-templates/` | HTML/CSS templates that render to PDF (smoke-tested) |
| `pdf-api/` | Vercel serverless functions: render PDFs + daily expiry cron |
| `pdf-poc/` | Standalone Puppeteer PoC for Gujarati shaping (kept for reference) |
| `INSTALL.md` | **Step-by-step install + deploy guide — start here** |

## Quick stats

- **77 unit tests** (calc + 4 schema files + payload builders)
- **7 PDF templates** smoke-tested
- **11 SQL migrations** (run order documented in `db/README.md`)
- **3 PDF API endpoints** + 1 daily cron
- Builds clean: app ~ 619 KB → 170 KB gzipped

## Reading order (if new to the codebase)

1. `INSTALL.md` — what runs where
2. `db/README.md` — schema + role model + ref-no scheme
3. `app/src/main.jsx` — React route tree
4. `pdf-templates/render.js` — template dispatcher
5. `pdf-api/README.md` — API contract + cron
