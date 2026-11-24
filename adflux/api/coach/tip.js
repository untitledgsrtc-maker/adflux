// api/coach/tip.js — EDGE runtime.
// Phase 577 — evening coach AI tip (supabase_phase577_coach_ai_tip.sql).
// ─────────────────────────────────────────────────────────────────────────
// Called by coach_tip_dispatch (pg_cron 18:50 IST), one POST per person:
// body {user_id}. Reads that person's summary numbers itself
// (coach_tip_facts, service role), asks Claude for ONE short tip in English +
// Gujarati, and upserts coach_tips. The numbers are counts only: no client
// names, no phone numbers, no pay.
//
// WHY EDGE: Vercel Hobby 12-serverless-fn cap (CLAUDE.md section 219).
// WHY fetch (no SDK): same as api/wa/ai-reply.js; the project has no
// @anthropic-ai/sdk dependency and this is one request.
// SECURITY: x-ai-secret == AI_REPLY_SECRET (fail-closed). user_id is the only
// input taken from the request; everything else is server-derived.
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY +
//      AI_REPLY_SECRET (+ optional ANTHROPIC_COACH_MODEL).
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const AI_SECRET     = process.env.AI_REPLY_SECRET
const MODEL         = process.env.ANTHROPIC_COACH_MODEL || 'claude-opus-5-5'

const ok   = (obj = {}) => new Response(JSON.stringify({ ok: true, ...obj }), { status: 200, headers: { 'content-type': 'application/json' } })
const nope = (reason, status = 200) => new Response(JSON.stringify({ ok: false, reason }), { status, headers: { 'content-type': 'application/json' } })

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
})

const ROLE_TEXT = {
  sales: 'field sales rep who meets clients and sends quotes for outdoor and LED screen advertising',
  telecaller: 'telecaller who calls leads and sends quotes by phone',
  staff: 'office team member (design, social media, reports) working on assigned tasks',
  hr: 'HR person working on assigned tasks',
  accounts: 'accounts person (invoices, payments, bank work) working on assigned tasks',
  office_admin: 'office admin working on assigned tasks',
  operation_executive: 'field technician who fixes LED screens and cameras at bus stands',
  operation_head: 'operations head who manages the screen technicians',
}

const SYSTEM = `You are a practical work coach at Untitled Advertising, an outdoor and LED-screen advertising company in Gujarat, India.
You write ONE short tip for one team member, based only on their own numbers below.
Rules:
- One or two short sentences. Plain, simple words a sales rep or technician understands.
- Name ONE habit that would move their weakest number. Be specific (when, how many, in what order).
- Use only numbers that appear in the data. Never invent numbers, clients, names or places.
- Never talk about salary, pay, incentive, punishment or other people.
- Warm and direct, not salesy. No emoji.
- Give the same tip in English ("en") and in natural spoken Gujarati ("gu", Gujarati script; English words like quote, follow-up, ticket may stay in English).`

const SCHEMA = {
  type: 'object',
  properties: {
    en: { type: 'string', description: 'The tip in English, max 2 sentences' },
    gu: { type: 'string', description: 'The same tip in Gujarati, max 2 sentences' },
  },
  required: ['en', 'gu'],
  additionalProperties: false,
}

export default async function handler(req) {
  if (req.method !== 'POST') return nope('method_not_allowed', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY || !AI_SECRET) return nope('not_configured', 503)
  if (String(req.headers.get('x-ai-secret') || '') !== AI_SECRET) return nope('forbidden', 403)

  let userId = ''
  try { userId = String((await req.json())?.user_id || '') } catch { return nope('bad_body', 400) }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return nope('bad_user', 400)

  // facts (server-derived) + the person's first name
  const [factsRes, userRes] = await Promise.all([
    sb('rpc/coach_tip_facts', { method: 'POST', body: JSON.stringify({ p_user: userId }) }),
    sb(`users?id=eq.${userId}&select=name,role`),
  ])
  if (!factsRes.ok) return nope('facts_' + factsRes.status, 502)
  const facts = await factsRes.json()
  if (!facts) return ok({ skipped: 'no_facts' })
  const [u] = (await userRes.json().catch(() => [])) || []
  const firstName = String(u?.name || '').trim().split(/\s+/)[0] || ''

  const userMsg = `Person: ${firstName || 'team member'}, a ${ROLE_TEXT[facts.role] || 'team member'}.
Their numbers (last 28 days unless the name says otherwise; actions_done_pct_14d = share of the daily suggested actions they completed in the last 14 days):
${JSON.stringify(facts)}${facts.work_score_month ? `
Their work score this month (work_score_month) has three parts: tasks GIVEN by someone else and done on time (out of 20; tasks they write for themselves do not count), hours on task timers against 8 hours a working day (out of 50), and days their first timer started by 10:15 (out of 30; office opens 10:00). Coach the part with the most points missing.` : ''}`

  let en = '', gu = ''
  try {
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })
    if (!ar.ok) {
      let detail = ''
      try { detail = (await ar.text()).slice(0, 300) } catch {}
      await sb('ai_failures', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ http_status: ar.status, detail: 'coach_tip: ' + detail }) }).catch(() => {})
      return nope('claude_' + ar.status, 502)
    }
    const data = await ar.json()
    if (data?.stop_reason === 'refusal') return ok({ skipped: 'refusal' })
    const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    const parsed = JSON.parse(text)
    en = String(parsed.en || '').trim().slice(0, 400)
    gu = String(parsed.gu || '').trim().slice(0, 600)
  } catch {
    return nope('claude_error', 502)
  }
  if (!en || !gu) return nope('empty_tip', 502)

  // upsert today's tip; coach_tip_save stores the facts + the same md5 the dispatcher compares
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)   // IST date
  const save = await sb('rpc/coach_tip_save', {
    method: 'POST',
    body: JSON.stringify({ p_user: userId, p_date: today, p_en: en, p_gu: gu, p_model: MODEL }),
  })
  if (!save.ok) return nope('save_' + save.status, 502)
  return ok({ saved: true })
}
