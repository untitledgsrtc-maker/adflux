// api/wa/send-template.js — EDGE runtime (Phase A / campaign marketing).
// ─────────────────────────────────────────────────────────────────────────
// Send an APPROVED WhatsApp TEMPLATE (business-initiated) from the MARKETING
// number (whatsapp_accounts.purpose='marketing') to a recipient. This is the
// foundation for the automation (lead-welcome, post-call) + broadcasts later.
//
// WHY EDGE, not Node: the Vercel Hobby plan caps a deployment at 12 *Serverless*
// (Node) Functions and the project is at that limit (§219). api/wa/send.js +
// api/wa/webhook.js are Node (supabase-js). A Node fn here breaks every deploy.
// Edge functions don't count — raw fetch to the Graph API + Supabase REST.
//
// SECURITY (§45): auth REQUIRED; ADMIN / co_owner only for now (manual + test
// sends). The automation triggers (Phase B) will call the Graph API from a
// DEFINER DB path / service role, not this user-gated endpoint. from-number is
// SERVER-resolved (the marketing account), never client-chosen. ONE recipient
// per call (no bulk here — the broadcast tool is Phase C with its own guards).
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY
//   (||VITE_) + CAMPAIGN_WA_TOKEN (the permanent System User token, §54).
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const GRAPH = 'https://graph.facebook.com/v21.0'

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server_not_configured' }, 500)
  if (!WA_TOKEN) return json({ error: 'token_missing', detail: 'CAMPAIGN_WA_TOKEN is not set in Vercel.' }, 503)

  // ── auth: verify the caller's Supabase JWT ──
  const token = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'no_auth' }, 401)
  let uid
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!ur.ok) return json({ error: 'bad_auth' }, 401)
    uid = (await ur.json())?.id
  } catch { return json({ error: 'auth_unreachable' }, 502) }
  if (!uid) return json({ error: 'bad_auth' }, 401)

  // ── role gate: admin / co_owner only (fail closed on NULL, §41) ──
  let role = null
  try {
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${uid}&select=role`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    const rows = await rr.json().catch(() => [])
    role = Array.isArray(rows) && rows[0] ? rows[0].role : null
  } catch { /* role unknown → refused below */ }
  if (!['admin', 'co_owner'].includes(role)) return json({ error: 'not_allowed', detail: 'Admin only for now.' }, 403)

  // ── body ──
  let body
  try { body = await req.json() } catch { body = {} }
  const to = String(body?.to || '').replace(/\D/g, '')
  const templateName = String(body?.template || '').trim()
  const lang = String(body?.language || 'en_US').trim()
  // Simple body-variable substitution: variables → template {{1}},{{2}}…
  const variables = Array.isArray(body?.variables) ? body.variables.map((v) => String(v)) : []
  if (!/^\d{10,15}$/.test(to)) return json({ error: 'bad_recipient', detail: 'One valid phone (country code + number, digits only).' }, 400)
  if (!/^[a-z0-9_]{1,512}$/i.test(templateName)) return json({ error: 'template_required', detail: 'Enter the approved template name.' }, 400)

  // ── resolve the MARKETING account → its phone_number_id (server-controlled) ──
  let phoneNumberId = null, accountId = null
  try {
    const ar = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_accounts?purpose=eq.marketing&phone_number_id=not.is.null&select=id,phone_number_id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    const acct = (await ar.json().catch(() => []))?.[0]
    phoneNumberId = acct?.phone_number_id || null
    accountId = acct?.id || null
  } catch { /* handled below */ }
  if (!phoneNumberId) {
    return json({ error: 'no_marketing_number', detail: 'No whatsapp_accounts row with purpose=marketing and a phone_number_id. Register the marketing number first.' }, 503)
  }

  // ── build the template message + send via the Graph API ──
  const components = variables.length
    ? [{ type: 'body', parameters: variables.map((t) => ({ type: 'text', text: t })) }]
    : undefined
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name: templateName, language: { code: lang }, ...(components ? { components } : {}) },
  }

  let resp, data
  try {
    resp = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    data = await resp.json().catch(() => ({}))
  } catch (e) {
    return json({ error: 'send_failed', detail: String(e?.message || e) }, 502)
  }
  if (!resp.ok) {
    return json({ error: 'send_failed', detail: data?.error?.message || `Graph HTTP ${resp.status}`, meta: data?.error || null }, 502)
  }

  return json({ ok: true, wamid: data?.messages?.[0]?.id || null, account_id: accountId })
}
