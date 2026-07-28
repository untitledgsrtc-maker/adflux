// api/meta/leadgen.js — Meta Lead Ads (Facebook/Instagram lead FORMS) → lead.
// Phase 265 (2026-07-28).
//
// A person fills a lead FORM on a Facebook/Instagram ad (no chat). Meta pings
// this webhook with a leadgen_id; we fetch the form fields via the Graph API and
// create a lead — source 'Social Media', attached to the active Meta campaign,
// routed to that campaign's telecaller (Dhara). Dedup by phone (never a colliding
// lead), idempotent on leadgen_id (Meta retries).
//
// SEPARATE from the WhatsApp webhook: leadgen is on the PAGE object, messages on
// whatsapp_business_account — different Meta products, different callback URLs.
// Edge fn (§219 — a new Node fn would break the 12-serverless-fn deploy cap).
//
// ⚠ INERT until the Meta side is wired: a Page leadgen subscription + a token
// with leads_retrieval. Deploying it changes NOTHING on its own — no existing
// flow is touched (§45-safe). It cannot be validated until a real form submit
// flows through; test end-to-end when the token + subscription are live.
//
// ENV: CAMPAIGN_APP_SECRET (same Meta app as WhatsApp — HMAC), META_LEADS_VERIFY_TOKEN
//      (webhook handshake), META_LEADS_TOKEN (Page/System-User token w/ leads_retrieval),
//      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_SECRET   = process.env.CAMPAIGN_APP_SECRET
const VERIFY_TOKEN = process.env.META_LEADS_VERIFY_TOKEN
const PAGE_TOKEN   = process.env.META_LEADS_TOKEN
const GRAPH = 'https://graph.facebook.com/v21.0'

// PostgREST helper (service role → RLS bypass, same pattern as ai-reply.js).
const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json', ...(init.headers || {}),
  },
})

const digitsOnly = (s) => String(s || '').replace(/\D/g, '')
// Normalize an Indian number to the leads convention (12-digit 91-prefixed where possible).
function cleanPhone(p) {
  const d = digitsOnly(p)
  if (d.length === 10) return '91' + d
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  return d.length >= 10 ? d : ''
}

// Meta lead-form field_data = [{ name, values:[...] }]. Field names vary by form
// (full_name|name, phone_number|phone, email, city|town). Map robustly.
function mapFields(fieldData) {
  const out = { name: '', phone: '', email: '', city: '', company: '' }
  for (const f of (fieldData || [])) {
    const key = String(f?.name || '').toLowerCase()
    const val = Array.isArray(f?.values) ? String(f.values[0] || '').trim() : ''
    if (!val) continue
    if (!out.name && /(full_?name|^name$|your_name)/.test(key)) out.name = val
    else if (!out.phone && /(phone|mobile|contact_?number|whatsapp)/.test(key)) out.phone = val
    else if (!out.email && /email/.test(key)) out.email = val
    else if (!out.city && /(city|town|location)/.test(key)) out.city = val
    else if (!out.company && /(company|business|firm|brand)/.test(key)) out.company = val
  }
  return out
}

// HMAC-SHA256 verify (Edge Web Crypto), matching Meta's X-Hub-Signature-256.
async function verifySig(rawBody, header) {
  if (!APP_SECRET) return false
  const sig = String(header || '')
  if (!sig.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const expected = 'sha256=' + hex
  // constant-time-ish compare
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}

async function firstRow(path) {
  try { const r = await (await sb(path)).json(); return Array.isArray(r) ? r[0] : null } catch { return null }
}

export default async function handler(req) {
  const url = new URL(req.url)

  // ── GET: Meta webhook verification handshake ──
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return new Response(challenge || '', { status: 200 })
    }
    return new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response('not_configured', { status: 500 })

  // ── POST: verify signature, then process leadgen events ──
  const raw = await req.text()
  const ok = await verifySig(raw, req.headers.get('x-hub-signature-256'))
  if (!ok) return new Response('bad_signature', { status: 401 })

  let body
  try { body = JSON.parse(raw) } catch { return new Response('ok', { status: 200 }) }  // signed but garbage → ack, don't storm

  // Reply 200 fast; a token/lead failure must not make Meta retry forever, but a
  // real processing error returns 200 too (we audit-queue it) — Meta only needs
  // the ack. Best-effort per lead.
  const leadgens = []
  for (const entry of (body?.entry || [])) {
    for (const ch of (entry?.changes || [])) {
      // leadgen_id is a Meta numeric id; guard it (it's used in PostgREST paths).
      const lid = String(ch?.value?.leadgen_id || '')
      if (ch?.field === 'leadgen' && /^\d+$/.test(lid)) {
        leadgens.push({ leadgen_id: lid, form_id: ch.value.form_id, ad_id: ch.value.ad_id })
      }
    }
  }
  if (!leadgens.length) return new Response('ok', { status: 200 })
  // Inert until the Meta side is wired: no token → ack + do nothing (no rows
  // consumed) so real events process cleanly once META_LEADS_TOKEN is set.
  if (!PAGE_TOKEN) return new Response('ok', { status: 200 })

  // The Meta campaign to attribute + route by (Dhara). Same rule as Phase 264.
  const camp = await firstRow(`campaigns?source_type=eq.meta&is_active=eq.true&select=id,default_telecaller_id,segment&order=created_at.desc&limit=1`)
  const owner = camp?.default_telecaller_id || null

  let retryable = false
  for (const lg of leadgens) {
    const auditPatch = (status, lead_id, norm) => sb(`inbound_leads?provider=eq.meta_lead&external_event_id=eq.${lg.leadgen_id}`, {
      method: 'PATCH', body: JSON.stringify({ status, dedupe_phone: norm || null, ...(lead_id ? { lead_id } : {}) }),
    })
    try {
      // Fetch the form fields FIRST — so a Graph failure does NOT consume the
      // idempotency claim; Meta then retries the batch (done ones 409-skip).
      const gr = await fetch(`${GRAPH}/${lg.leadgen_id}?fields=field_data,created_time,ad_id,form_id&access_token=${encodeURIComponent(PAGE_TOKEN)}`)
      const gd = await gr.json().catch(() => ({}))
      if (!gr.ok) { retryable = true; continue }   // transient / not-yet-retrievable → let Meta retry

      // Idempotency claim AFTER a successful fetch. (provider, external_event_id)
      // is UNIQUE → a Meta retry (or a concurrent duplicate) hits 409 → skip.
      const claim = await sb('inbound_leads', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ provider: 'meta_lead', external_event_id: lg.leadgen_id, status: 'received', campaign_id: camp?.id || null }),
      })
      if (claim.status === 409) continue

      const f = mapFields(gd.field_data)
      const phone = cleanPhone(f.phone)
      const norm = digitsOnly(f.phone)

      // No usable phone → audit as error, no lead (mirror C4.5).
      if (phone.length < 10) { await auditPatch('error', null, norm); continue }

      // P0-1 DEDUP — attach to an existing open lead, never insert a collider.
      const dupRes = await sb('rpc/find_open_lead_id_by_phone', { method: 'POST', body: JSON.stringify({ p_phone: phone }) })
      const existing = await dupRes.json().catch(() => null)
      if (typeof existing === 'string' && existing) { await auditPatch('duplicate', existing, norm); continue }

      // P0-2 ROUTING — owner = the Meta campaign's telecaller (Dhara). Never a
      // NULL-owner lead: no telecaller on the campaign → audit-queue it.
      if (!owner) { await auditPatch('error', null, norm); continue }

      // Create the lead — mirrors the C4.5 contracts: BOTH owner cols = owner,
      // stage New, cadence_paused=true (no multi-step cadence; a one-time handoff
      // follow-up + assign push still fire, identical to the WhatsApp path),
      // source 'Social Media'.
      const leadRow = {
        name: f.name || f.company || 'Meta lead',
        phone,
        company: f.company || null,
        email: f.email || null,
        city: f.city || null,
        segment: camp?.segment || 'PRIVATE',
        source: 'Social Media',
        stage: 'New',
        heat: 'warm',
        cadence_paused: true,
        telecaller_id: owner,
        assigned_to: owner,
        created_by: owner,
        campaign_id: camp?.id || null,
      }
      const ins = await sb('leads', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify(leadRow),
      })
      const insData = await ins.json().catch(() => null)
      const newId = Array.isArray(insData) ? insData[0]?.id : insData?.id
      await auditPatch(newId ? 'converted' : 'error', newId || null, norm)
    } catch {
      retryable = true   // best-effort per lead; a real error → let Meta retry the batch
    }
  }

  // Retryable Graph/processing error → non-200 so Meta retries; everything already
  // done skips via the 409 claim. Meta's backoff is finite (no infinite storm).
  return new Response(retryable ? 'retry' : 'ok', { status: retryable ? 503 : 200 })
}
