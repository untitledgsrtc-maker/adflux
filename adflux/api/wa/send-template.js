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
// SECURITY (§45): auth REQUIRED. TWO modes:
//   • RAW mode  (body.to)      — ADMIN / co_owner only. Manual + test sends.
//   • LEAD mode (body.lead_id) — admin / co_owner / TELECALLER (pilot). The
//     client sends only a lead id; phone, outcome and template are all derived
//     server-side, so a tampered request cannot reach an arbitrary number.
// from-number is SERVER-resolved (the marketing account), never client-chosen.
// ONE recipient per call (no bulk here — broadcast is Phase C with its own
// guards).
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

// Supabase REST with the service role. Edge runtime → raw fetch, no supabase-js.
const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

const one = async (path) => {
  try { const r = await sb(path); const j = await r.json().catch(() => []); return Array.isArray(j) ? j[0] : null }
  catch { return null }
}

// 10-digit Indian mobile → 91XXXXXXXXXX. Returns null if it isn't a sane number.
function waPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`
  return /^\d{11,15}$/.test(d) ? d : null
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function prettyDate(iso) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso))
  if (!m) return null
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim()
}
function prettyTime(t) {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t))
  if (!m) return null
  let h = Number(m[1]); const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m[2]} ${ap}`
}

// Junk-name guard (Phase 252). Auto-created leads can be named '.', a bare
// phone number, or the 'WhatsApp lead' placeholder — used raw, the customer
// received "Hi ." from the business number (real incident, §124). A name with
// no letters (Latin / Devanagari / Gujarati) or the known placeholder falls
// back to a neutral greeting instead.
function cleanLeadName(raw) {
  const n = String(raw || '').trim()
  if (!n) return 'there'
  if (/^whatsapp lead$/i.test(n)) return 'there'
  if (!/[a-zA-Zऀ-ॿ઀-૿]/.test(n)) return 'there'
  return n.slice(0, 60)
}

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

  // ── caller's row (fail closed on NULL, §41) ──
  let role = null, callerName = null
  try {
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${uid}&select=role,name`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    const rows = await rr.json().catch(() => [])
    role = Array.isArray(rows) && rows[0] ? rows[0].role : null
    callerName = Array.isArray(rows) && rows[0] ? rows[0].name : null
  } catch { /* role unknown → refused below */ }

  // ── body ──
  let body
  try { body = await req.json() } catch { body = {} }

  // ══ LEAD MODE (P3) ══════════════════════════════════════════════════════
  // Post-call send. The rep taps "Send from company number" in
  // WhatsAppPromptModal; everything that matters is decided HERE, server-side:
  // the recipient phone, the template, and the three conversation fields that
  // make the reply come back to the right person.
  //
  // Phase 255 — optional `template_key`: the inbox closed-window picker lets
  // the rep CHOOSE one of the standalone approved templates instead of the
  // outcome read-back. Validated against a server-side allowlist (never the
  // date-confirming callback/meeting templates — those need a fresh saved
  // time). Every other gate (role, ownership, opt-out, phone, per-lead 24h
  // throttle, conversation writes) is identical.
  if (body?.lead_id) {
    return await sendToLead({
      uid, role, callerName,
      leadId: String(body.lead_id),
      pickKey: body.template_key ? String(body.template_key) : null,
    })
  }

  // ══ RAW MODE (unchanged) — admin/co_owner manual + test sends ═══════════
  if (!['admin', 'co_owner'].includes(role)) return json({ error: 'not_allowed', detail: 'Admin only for now.' }, 403)
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

// ─────────────────────────────────────────────────────────────────────────
// LEAD MODE — post-call template send from the business number.
//
// Everything security-relevant is decided server-side. The client sends ONLY a
// lead_id: the phone, the template and the recipient are all derived here, so a
// tampered request cannot message an arbitrary number or pick a template.
//
// The three fields written onto the conversation ARE the feature:
//   lead_id      — else trg_campaign_conv_ensure_lead spawns a DUPLICATE lead
//   assigned_to  — else the reply is invisible to the rep who sent it
//                  (CampaignInboxV2 filters non-privileged users on assigned_to)
//   ai_paused    — else the AI answers before the rep, and treats the next
//                  inbound as first contact and fires the welcome poster
//
// Deliberately writes NO lead_activities row: lead_activity_after_insert bumps
// contact_attempts_count (halving the auto-Lost threshold) and sets
// last_contact_at, which re-sorts the TC queue and would deprioritise the lead
// the rep just messaged.
// ─────────────────────────────────────────────────────────────────────────
async function sendToLead({ uid, role, callerName, leadId, pickKey = null }) {
  // Pilot gate: telecallers + admins only (§ plan P5 — widen after the pilot).
  if (!['admin', 'co_owner', 'telecaller'].includes(role)) {
    return json({ error: 'not_allowed', detail: 'Telecallers only during the pilot.' }, 403)
  }
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return json({ error: 'bad_lead_id' }, 400)

  const lead = await one(`leads?id=eq.${leadId}&select=id,name,phone,stage,wa_opt_out,do_not_call,assigned_to,telecaller_id&limit=1`)
  if (!lead) return json({ error: 'lead_not_found' }, 404)

  // Ownership — the caller must own the lead, unless privileged.
  const privileged = ['admin', 'co_owner'].includes(role)
  if (!privileged && lead.assigned_to !== uid && lead.telecaller_id !== uid) {
    return json({ error: 'not_your_lead' }, 403)
  }
  if (lead.wa_opt_out) return json({ error: 'opted_out', detail: 'This lead asked not to receive WhatsApp messages.' }, 409)

  const to = waPhone(lead.phone)
  if (!to) return json({ error: 'no_phone', detail: 'No usable phone number on this lead.' }, 400)

  // ── which template? ──
  // Phase 255 PICK mode: the inbox closed-window picker names one of the
  // STANDALONE templates (2 body vars — name + rep). Server allowlist: the
  // date-confirming callback/meeting templates are NOT pickable (they confirm
  // a specific time, which the picker path does not have).
  let outcome
  if (pickKey) {
    const PICKABLE = ['positive', 'neutral', 'nurture', 'negative']
    if (!PICKABLE.includes(pickKey)) {
      return json({ error: 'bad_template_key', detail: 'That template cannot be sent from the inbox.' }, 400)
    }
    outcome = pickKey
  } else {
  // Outcome is READ BACK from the call the rep just saved — never taken from the
  // client. Keeps the four frozen host pages untouched (they don't pass it).
  const act = await one(
    `lead_activities?lead_id=eq.${leadId}&created_by=eq.${uid}&activity_type=eq.call` +
    `&outcome=not.is.null&select=outcome&order=created_at.desc&limit=1`
  )
  outcome = act?.outcome || null
  if (!outcome) return json({ error: 'no_outcome', detail: 'No saved call outcome for this lead yet.' }, 409)

  // The UI's "Nurture" outcome is STORED as 'neutral' — lead_activities.outcome
  // has a CHECK allowing only positive/neutral/negative/callback (Phase 107 chose
  // that workaround). Reading the column back therefore can never yield
  // 'nurture', which would silently send the "Maybe" template to every parked
  // lead. Nurture is the one outcome that also moves the lead to stage=Nurture,
  // so that pair disambiguates it — server-side, no client trust.
  if (outcome === 'neutral' && lead.stage === 'Nurture') outcome = 'nurture'

  // A MEETING beats any outcome. Scheduling one is a NEXT ACTION, so a rep can
  // book it off Good / Maybe / Call-later — and when they have, confirming the
  // appointment matters more than a generic follow-up.
  //
  // Detected via the row PostCallOutcomeModal writes for nextAction='meeting'
  // (activity_type='meeting', notes 'Meeting scheduled · <date>'). That note
  // prefix is the §33 exclusion marker, so this is reading an existing, stable
  // contract rather than inventing a signal.
  //
  // TIME-BOUNDED to the last 2 hours. Without a bound, ANY meeting ever booked
  // on this lead — held, cancelled, weeks old — would override every future
  // send and post a "we will meet you on <date>" confirmation built from the
  // earliest OPEN follow-up, which need not be that meeting at all. That is
  // wrong information going to a customer from the business number.
  const mtgSince = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
  const mtg = await one(
    `lead_activities?lead_id=eq.${leadId}&created_by=eq.${uid}&activity_type=eq.meeting` +
    `&notes=like.Meeting%20scheduled*&created_at=gte.${mtgSince}` +
    `&select=id&order=created_at.desc&limit=1`
  )
  if (mtg) outcome = 'meeting'
  }

  const tpl = await one(`wa_outcome_templates?outcome=eq.${outcome}&is_active=eq.true&select=*&limit=1`)
  if (!tpl?.meta_template_name) {
    return json({ error: 'no_template_for_outcome', detail: `No template mapped for outcome "${outcome}".` }, 409)
  }

  // ── marketing account (server-controlled sender) ──
  const acct = await one(`whatsapp_accounts?purpose=eq.marketing&phone_number_id=not.is.null&select=id,phone_number_id&limit=1`)
  if (!acct?.phone_number_id) return json({ error: 'no_marketing_number' }, 503)

  // ── existing thread (also drives the throttle) ──
  const conv = await one(`whatsapp_conversations?whatsapp_account_id=eq.${acct.id}&customer_wa_id=eq.${to}&select=id&limit=1`)

  // Throttle: at most ONE business-initiated template to a lead per day. Bounds
  // both cost and annoyance, and is per-LEAD (a per-rep cap would collide with
  // the TC's own 50-call daily target).
  if (conv?.id) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const recent = await one(
      `whatsapp_messages?conversation_id=eq.${conv.id}&direction=eq.out&type=eq.template&at=gte.${since}&select=id&limit=1`
    )
    if (recent) return json({ error: 'already_sent_today', detail: 'A message was already sent to this lead in the last 24 hours.' }, 429)
  }

  // ── variables ──
  const leadName = cleanLeadName(lead.name)
  const repName = (callerName || 'our team').slice(0, 60)
  let vars = [leadName, repName]
  if (outcome === 'callback' || outcome === 'meeting') {
    // Both templates CONFIRM a specific date + time, so neither can be sent
    // without one — and it MUST be the one the rep JUST saved in the outcome
    // modal. The old read (`order=follow_up_date.asc` over ALL open rows)
    // picked the lead's EARLIEST open follow-up, which on a lead with an
    // overdue backlog was a STALE row → "we will call you back on 12 July"
    // went out on the 21st (real incident, §124). So (Phase 252): only a row
    // CREATED in the last 2 hours (same bound as the meeting detection above),
    // by THIS rep, newest first — and its date must not be in the past.
    const freshSince = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    const fu = await one(
      `follow_ups?lead_id=eq.${leadId}&assigned_to=eq.${uid}&is_done=eq.false` +
      `&created_at=gte.${freshSince}` +
      `&select=follow_up_date,follow_up_time&order=created_at.desc&limit=1`
    )
    const d = prettyDate(fu?.follow_up_date), t = prettyTime(fu?.follow_up_time)
    // IST calendar day — a past-dated confirmation must never reach a customer.
    const istToday = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
    if (!d || !t || String(fu.follow_up_date) < istToday) {
      return json({
        error: outcome === 'meeting' ? 'no_meeting_time' : 'no_callback_time',
        detail: `No fresh ${outcome === 'meeting' ? 'meeting' : 'callback'} date/time saved on this call, so the confirmation cannot be sent.`,
      }, 409)
    }
    vars = [leadName, repName, d, t]
  }

  const components = [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: v })) }]
  if (tpl.header_doc_url) {
    components.unshift({
      type: 'header',
      parameters: [{ type: 'document', document: { link: tpl.header_doc_url, filename: tpl.header_doc_name || 'Untitled Advertising.pdf' } }],
    })
  }

  // ── send ──
  let resp, data
  try {
    resp = await fetch(`${GRAPH}/${acct.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name: tpl.meta_template_name, language: { code: tpl.language || 'en' }, components },
      }),
    })
    data = await resp.json().catch(() => ({}))
  } catch (e) {
    return json({ error: 'send_failed', detail: String(e?.message || e) }, 502)
  }
  if (!resp.ok) {
    return json({ error: 'send_failed', detail: data?.error?.message || `Graph HTTP ${resp.status}`, meta: data?.error || null }, 502)
  }
  const wamid = data?.messages?.[0]?.id || null

  // ── the three fields that make replies come back (see header) ──
  const nowIso = new Date().toISOString()
  let convId = conv?.id || null
  let routingOk = true
  try {
    if (convId) {
      await sb(`whatsapp_conversations?id=eq.${convId}`, {
        method: 'PATCH',
        body: JSON.stringify({ lead_id: leadId, assigned_to: uid, ai_paused: true, updated_at: nowIso }),
      })
    } else {
      // lead_id MUST be present on INSERT — trg_campaign_conv_ensure_lead only
      // early-returns when it is, otherwise it creates a duplicate lead.
      const r = await sb('whatsapp_conversations', {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify({
          whatsapp_account_id: acct.id, customer_wa_id: to, lead_id: leadId,
          assigned_to: uid, ai_paused: true, status: 'open',
        }),
      })
      const rows = await r.json().catch(() => [])
      convId = Array.isArray(rows) && rows[0] ? rows[0].id : null
    }
    if (!convId) routingOk = false
  } catch { routingOk = false }

  // ── log the outbound (also stops the AI treating the next inbound as first
  // contact and firing the welcome poster) ──
  if (convId) {
    try {
      // Log the REAL text, not "[template] <name>". A rep opening the thread
      // has to be able to read what the customer was actually sent — the raw
      // template name told them nothing.
      let logBody = tpl.preview_body
        ? vars.reduce((s, v, i) => s.split(`{{${i + 1}}}`).join(v), tpl.preview_body)
        : `[template] ${tpl.meta_template_name}`
      // Phase 252.1 — when the template carries a document header, SAY SO in
      // the log. The PDF was delivering all along (verified: 9/10 read or
      // delivered), but the inbox showed only the text, so everyone read it
      // as "brochure not attached".
      if (tpl.header_doc_url) {
        logBody += `\n\n(attachment: ${tpl.header_doc_name || 'PDF'})`
      }
      // Phase 263 — store the sent PDF link so the inbox shows a real
      // download, not just "(attachment: ...)" text.
      const row = {
        conversation_id: convId, wamid, direction: 'out', type: 'template',
        body: logBody, status: 'sent', at: nowIso,
      }
      if (tpl.header_doc_url) row.media_url = tpl.header_doc_url
      const r = await sb('whatsapp_messages', { method: 'POST', body: JSON.stringify(row) })
      // Deploy-order safety: retry without media_url if the column isn't there.
      if (r && r.ok === false && row.media_url) {
        delete row.media_url
        await sb('whatsapp_messages', { method: 'POST', body: JSON.stringify(row) })
      }
    } catch { /* best-effort */ }
  }

  // The message IS sent either way — but if the conversation write failed, the
  // reply will NOT route back to this rep and the AI is not muted. Surface it
  // rather than returning a clean ok:true over a half-done send (the exact
  // "looks successful, silently broken" mode this plan set out to avoid).
  return json({
    ok: true, wamid, outcome, template: tpl.meta_template_name, conversation_id: convId,
    ...(routingOk ? {} : { warning: 'reply_routing_failed', detail: 'Message sent, but the reply may not appear in your inbox. Tell an admin.' }),
  })
}
