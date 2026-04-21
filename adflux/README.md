# Adflux — Untitled Adflux Private Limited

Internal quotation & campaign management for the outdoor advertising sales team.

## Tech stack

- React 18 + Vite
- Supabase (Postgres + Auth + Realtime)
- Zustand for state
- React Hook Form + Zod for form validation
- @react-pdf/renderer for PDF generation
- date-fns
- Tailwind CSS

## Local development

```bash
npm install
cp .env.example .env
# edit .env — paste your Supabase URL and anon key
npm run dev
```

## Deploy

See `DEPLOY_GUIDE.md` for the step-by-step.

## Database

The schema lives in `supabase_schema.sql`. Run it once in the Supabase SQL Editor for a fresh project.
