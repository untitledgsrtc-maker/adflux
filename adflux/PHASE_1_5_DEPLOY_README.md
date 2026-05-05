# Phase 1.5 deploy guide — AI Co-Pilot + Daily Brief + Scorecard

This document covers the ONLY pieces of Phase 1.5 that need owner setup
beyond a normal Vercel push: Supabase Edge Functions + cron schedules +
WhatsApp Business API + Anthropic API key.

Frontend code is already shipped (`CopilotModal.jsx`, `⌘K` hotkey in shell,
`AiBriefingCard` placeholder in `/cockpit`). Until you complete the steps
below, the modal falls back to a /leads search and the brief card shows
rule-based text.

---

## 1. Run the support SQL

In Supabase Studio → SQL Editor, paste the contents of
`supabase_phase13_ai_copilot_support.sql` and run.

Creates:
- `ai_runs` table (cost + debug log for every AI call)
- `run_select(sql_text)` SECURITY INVOKER RPC that the Co-Pilot uses to
  execute LLM-generated SELECTs through the user's JWT (RLS preserved)

Verify:
```sql
SELECT public.run_select('SELECT id, name FROM users LIMIT 3');
-- expect jsonb array with 3 rows
SELECT public.run_select('DELETE FROM users');
-- expect: ERROR: Write/DDL keywords are forbidden
```

---

## 2. Get API credentials

### 2a. Anthropic API key
1. Go to https://console.anthropic.com/settings/keys
2. Create a new key. Cap monthly spend at $50 (~₹4,200) for safety.
3. Copy the key (starts with `sk-ant-…`).

### 2b. Meta WhatsApp Business API
You said Meta is approved. Get from https://business.facebook.com/wa/manage:

1. **Phone Number ID** — Settings → WhatsApp → API setup → "Phone number ID"
2. **Access Token** — same screen, "Temporary access token" (24h)
   OR generate a permanent token via System User in Business Settings.

For permanent setup, follow https://developers.facebook.com/docs/whatsapp/business-management-api/get-started

---

## 3. Set Supabase Edge Function secrets

In Supabase Studio → Edge Functions → Settings → Secrets, add:

| Secret name                  | Value                                          |
|------------------------------|------------------------------------------------|
| `ANTHROPIC_API_KEY`          | sk-ant-…                                       |
| `META_WABA_PHONE_NUMBER_ID`  | (from Meta Business Manager)                   |
| `META_WABA_ACCESS_TOKEN`     | (permanent token from System User)             |
| `OWNER_WHATSAPP_NUMBER`      | 919428273686  (your number, no '+', country code first) |

The first two are needed for AI Co-Pilot. The last three for scheduled briefs.

---

## 4. Deploy the three Edge Functions

Install Supabase CLI if you haven't (one time, on your Mac):
```bash
brew install supabase/tap/supabase
supabase login
```

From the repo root:
```bash
cd /Users/apple/Documents/untitled-os2/Untitled/adflux
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy copilot
supabase functions deploy daily-brief --no-verify-jwt
supabase functions deploy scorecard --no-verify-jwt
```

`copilot` keeps JWT verification ON because it runs as the calling user.
`daily-brief` and `scorecard` run on cron (no user) so JWT is OFF — they
use the service role key to read everything.

Test the Co-Pilot:
```bash
supabase functions invoke copilot --data '{"query":"how many leads today"}'
```

---

## 5. Schedule the crons

In Supabase Studio → Database → Cron Jobs:

| Name              | Schedule       | URL                                                                    |
|-------------------|----------------|------------------------------------------------------------------------|
| daily-brief-am    | `30 3 * * *`   | `https://YOUR_PROJECT.supabase.co/functions/v1/daily-brief?slot=morning` |
| daily-brief-pm    | `0 14 * * *`   | `https://YOUR_PROJECT.supabase.co/functions/v1/daily-brief?slot=evening` |
| scorecard-pm      | `0 14 * * *`   | `https://YOUR_PROJECT.supabase.co/functions/v1/scorecard`              |

Both 14:00 UTC = 19:30 IST. 3:30 UTC = 9:00 IST.

In the cron job's HTTP Headers, add: `Authorization: Bearer YOUR_ANON_KEY`.

---

## 6. Verify end-to-end

After deploys, push the frontend (`git push` will Vercel-deploy automatically).
Then in the live app:

1. Press **Cmd+K** anywhere in the app. Modal opens.
2. Type "today's pipeline value". Hit Enter.
3. You should see an answer like "Pipeline value today is ₹X.XL across N leads."

If you get "AI Co-Pilot Edge Function not deployed yet", revisit step 4.

For the brief, manually trigger to verify:
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/daily-brief?slot=morning" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

You should receive the brief on WhatsApp within 5 seconds.

---

## 7. Cost guardrails

The `ai_runs` table logs every AI call. Check monthly cost:

```sql
SELECT run_type, count(*), sum(coalesce(cost_inr, 0)) AS total_inr
FROM ai_runs
WHERE created_at > date_trunc('month', current_date)
GROUP BY run_type;
```

Co-Pilot at Haiku rates is ~₹0.30 per query. If monthly Co-Pilot cost
exceeds ₹500, ask Brijesh whether to cap it (rate-limit per user) or upgrade.

---

## 8. What to tell the team

> "We have a new AI helper. Press ⌘K (Mac) or Ctrl+K (Windows) anywhere
> in Adflux. Ask anything in Gujarati or English — 'who hasn't checked in',
> 'pending invoices over 45 days', 'leads from Surat this week'.
> Replies in seconds. If the answer looks wrong, tell Brijesh and we'll
> adjust the prompt."

For the daily WhatsApp briefs, no team announcement needed — they only go
to Brijesh (owner cockpit) + each individual rep (their own scorecard).

---

## Anything not in this guide?

The frontend ships with a placeholder card on `/cockpit` that uses
rule-based logic. If the Edge Functions never get deployed, the app
still works — owner just doesn't get the LLM-formatted version.
