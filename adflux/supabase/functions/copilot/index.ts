// supabase/functions/copilot/index.ts
//
// Phase 1.5 — AI Co-Pilot natural-language query handler.
//
// Flow:
//   1. Receive { query, user_id } from frontend
//   2. Call Claude Haiku with: question + DB schema + user role
//   3. Claude returns a structured plan: { sql, answer_template, action_chips? }
//   4. Execute the SQL through PostgREST using the caller's JWT (so RLS
//      still applies — Claude can't escalate).
//   5. Render the answer_template with results, return to frontend.
//
// Required env vars:
//   ANTHROPIC_API_KEY    — Claude API key
//   SUPABASE_URL         — auto-provided by Supabase
//   SUPABASE_ANON_KEY    — auto-provided
//
// Deploy:
//   supabase functions deploy copilot --no-verify-jwt=false
//
// Cost: ~₹0.30 per query at Haiku rates. ai_runs table tracks all calls.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!

const SCHEMA_HINT = `
TABLES (Postgres):
  users(id, name, email, role, team_role, city, manager_id, daily_targets jsonb,
        is_active, segment_access)
    role IN ('admin','co_owner','sales_manager','sales','agency','telecaller','govt_partner')
    segment_access IN ('ALL','PRIVATE','GOVERNMENT')

  leads(id, source, name, company, phone, email, city, segment, stage, lost_reason,
        heat, expected_value, assigned_to, telecaller_id, sales_ready_at,
        handoff_sla_due_at, contact_attempts_count, last_contact_at,
        notes, created_by, created_at, quote_id)
    stage IN ('New','Contacted','Qualified','SalesReady','MeetingScheduled',
              'QuoteSent','Negotiating','Won','Lost','Nurture')
    heat IN ('hot','warm','cold')
    segment IN ('PRIVATE','GOVERNMENT')

  lead_activities(id, lead_id, activity_type, outcome, notes,
                  next_action, next_action_date, gps_lat, gps_lng,
                  created_by, created_at)
    activity_type IN ('call','whatsapp','email','meeting','site_visit','note','status_change')
    outcome IN ('positive','neutral','negative')

  work_sessions(id, user_id, work_date, plan_submitted_at, check_in_at,
                check_out_at, evening_report_submitted_at, daily_counters jsonb,
                planned_meetings jsonb, planned_calls, planned_leads)
    daily_counters keys: meetings, calls, new_leads

  call_logs(id, user_id, lead_id, client_phone, call_at, outcome, notes,
            duration_seconds)
    outcome IN ('connected','no_answer','busy','wrong_number',
                'callback_requested','not_interested','sales_ready','already_client')

  quotes(id, quote_number, ref_number, client_name, client_company,
         client_phone, client_email, client_address, client_gst,
         total_amount, subtotal, gst_amount, status, segment, media_type,
         created_by, sales_person_name, created_at, proposal_date,
         campaign_start_date, campaign_end_date, lead_id, follow_up_date)
    status IN ('draft','sent','negotiating','won','lost')
    segment IN ('PRIVATE','GOVERNMENT')
    media_type IN ('LED_OTHER','AUTO_HOOD','GSRTC_LED','HOARDING','MALL',
                   'CINEMA','DIGITAL','OTHER','OTHER_MEDIA')

  quote_cities(id, quote_id, city_id, city_name, qty, unit_rate, amount,
               campaign_total, screens, slot_seconds, slots_per_day,
               duration_months, ref_kind)
    -- city_name on quote line items is where the city lives for govt
    -- proposals (auto-rickshaw districts, GSRTC station names) and for
    -- Other Media line items (denormalized media type)

  payments(id, quote_id, amount_received, approval_status, payment_date,
           is_final_payment, recorded_by)
    approval_status IN ('pending','approved','rejected')

  clients(id, name, company, phone, email, address, segment, created_at)

NOTES:
- Today's date: ${new Date().toISOString().slice(0,10)}
- "no check-in today" = work_sessions where work_date = current_date
  AND check_in_at IS NULL, joined to users where is_active = true AND
  team_role IN ('sales','agency','telecaller')
- "SLA breach" = leads where stage = 'SalesReady'
  AND handoff_sla_due_at < now()
- "outstanding payment" = quotes where status = 'won' AND total_amount >
  (SELECT coalesce(sum(amount_received),0) FROM payments p
     WHERE p.quote_id = quotes.id AND p.approval_status = 'approved')
- For city / location lookups, ALWAYS use ILIKE '%name%' on these columns
  in this priority order:
    leads.city, quotes.client_address, users.city, quote_cities.city_name,
    clients.address, clients.company
  Single-word city names (e.g. Gandhinagar, Surat, Vadodara, Ahmedabad)
  may be stored partial inside an address field. Use ILIKE not =.
- For "active quotes" = quotes WHERE status NOT IN ('won','lost')
- For "won" / "lost" use status = 'won' / status = 'lost' on quotes,
  OR stage = 'Won' / stage = 'Lost' on leads — pick by context.
- Stage and Status are different. Leads have STAGE; Quotes have STATUS.
- When user asks about a NAMED city / person / company, search across
  multiple plausible columns with OR ... ILIKE '%name%' so you don't
  miss matches because of where the data happens to live.
`

const SYSTEM_PROMPT = `You are the Untitled OS Co-Pilot. The owner is Brijesh,
a Gujarati outdoor advertising business owner in Vadodara. Users speak in a
mix of Gujarati and English (Hinglish). Translate their question into:

1) A SQL SELECT (Postgres) — read-only, against the schema below.
2) A short answer_template that uses {{count}} or {{rows}} placeholders
   to render the result back to the user. Answer in the language of the
   question (Gujarati if Gujarati, English if English).
3) Up to 3 action_chips: { kind: 'navigate' | 'whatsapp', label, path?, phone?, message? }

Return JSON ONLY, no prose:
{
  "sql": "SELECT ...",
  "answer_template": "...",
  "action_chips": [{"kind":"navigate","label":"View leads","path":"/leads"}]
}

Constraints:
- SELECT only. No INSERT/UPDATE/DELETE/DROP/TRUNCATE.
- Limit to 100 rows.
- For lead/quote lookups, use city/name/phone matches (ILIKE %x%).
- For "today" use current_date.
- Keep answer_template under 200 characters.

${SCHEMA_HINT}`

interface CopilotResponse {
  answer_text: string
  table?: { columns: string[]; rows: any[][] }
  action_chips?: Array<{ kind: string; label: string; path?: string; phone?: string; message?: string }>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    if (!ANTHROPIC_KEY) {
      return json({ error: 'ANTHROPIC_API_KEY not set on Supabase project' }, 500)
    }

    const body = await req.json()
    const userQuery = (body.query || '').trim()
    if (!userQuery) return json({ error: 'query is required' }, 400)

    // Caller's JWT — used to run the SQL through PostgREST so RLS applies.
    const authHeader = req.headers.get('Authorization') || ''
    const callerJwt  = authHeader.replace(/^Bearer\s+/i, '')

    // 1. Ask Claude for a plan
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userQuery }],
      }),
    })

    if (!claudeRes.ok) {
      const text = await claudeRes.text()
      console.error('[copilot] Claude error:', text)
      return json({ error: 'AI call failed: ' + text.slice(0, 200) }, 500)
    }

    const claudeData = await claudeRes.json()
    const planText = claudeData?.content?.[0]?.text || '{}'

    // Extract JSON from the response (Claude sometimes wraps in markdown).
    const jsonMatch = planText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return json({ error: 'Co-Pilot returned no parseable plan.' }, 500)
    }
    const plan = JSON.parse(jsonMatch[0])

    // 2. Validate SQL is read-only
    const sql = (plan.sql || '').trim()
    if (!/^select\b/i.test(sql)) {
      return json({ error: 'Co-Pilot returned non-SELECT SQL — refusing.' }, 400)
    }
    if (/\b(insert|update|delete|drop|truncate|alter|create)\b/i.test(sql)) {
      return json({ error: 'Co-Pilot returned write SQL — refusing.' }, 400)
    }

    // 3. Execute through Supabase using the caller's JWT
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${callerJwt}` } },
    })

    // PostgREST doesn't accept arbitrary SQL — we need an RPC. The simplest
    // path is to expose a `run_select(sql text)` SECURITY INVOKER function
    // in the DB. For now we use postgres' explain-then-fetch through the
    // built-in RPC pattern. See setup README for the run_select() function.
    const { data: queryResult, error: sqlErr } = await userClient.rpc('run_select', {
      sql_text: sql,
    })

    if (sqlErr) {
      console.error('[copilot] SQL error:', sqlErr, 'sql:', sql)
      // Phase 17b — when run_select rejects, return the actual SQL Claude
      // generated so we can debug regex / shape mismatches without grepping
      // function logs. Safe to expose: it's the SAME string we're about to
      // execute, and the user already sees the rejection message.
      return json({
        error: 'Query failed: ' + sqlErr.message,
        debug_sql: sql.slice(0, 500),
      }, 500)
    }

    const rows: any[] = queryResult || []
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    // 4. Render answer
    const count = rows.length
    let answer_text = (plan.answer_template || 'Found {{count}} results.')
      .replace(/\{\{count\}\}/g, String(count))
      .replace(/\{\{rows\}\}/g, rows.slice(0, 5).map(r => Object.values(r).join(' · ')).join('\n'))

    // 5. Log the run for cost / debugging
    try {
      await userClient.from('ai_runs').insert([{
        run_type: 'copilot',
        input_json: { query: userQuery },
        output_json: { plan, count },
        model: 'claude-haiku-4-5',
        success: true,
      }])
    } catch (_) { /* table may not exist yet */ }

    const response: CopilotResponse = {
      answer_text,
      table: rows.length > 0 ? {
        columns,
        rows: rows.slice(0, 50).map(r => columns.map(c => formatCell(r[c]))),
      } : undefined,
      action_chips: Array.isArray(plan.action_chips) ? plan.action_chips.slice(0, 3) : undefined,
    }
    return json(response)
  } catch (e) {
    console.error('[copilot] FATAL:', e)
    return json({ error: String(e) }, 500)
  }
})

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Phase 17d — supabase-js v2 sends x-client-info on every request.
    // If it's not in this list the browser's CORS preflight succeeds but
    // the actual POST is silently blocked client-side. That's what
    // caused the "OPTIONS 200 but no POST + modal falls back to /leads"
    // symptom traced via Claude in Chrome on 6 May 2026.
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  }
}

function json(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  })
}

function formatCell(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
