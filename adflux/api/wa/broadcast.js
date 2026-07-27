// api/wa/broadcast.js
// ─────────────────────────────────────────────────────────────────────────
// Campaign — bulk broadcast of an APPROVED template to a saved segment.
//
//   GET                      → list broadcasts (or ?id= → one broadcast + funnel)
//   POST {action:'create'}   → resolve segment → queue recipients → return id+total
//   POST {action:'send_batch'} → send the next ≤25 queued recipients (page loops)
//   POST {action:'test'}     → send the template to ONE number (test-to-self)
//
// Auth: admin/co_owner JWT (mirrors api/wa/send + templates). The send can ONLY
// use a Meta-approved template + the active number's phone_number_id; token is
// server-side. Self-contained (supabase-js + fetch) → Vercel-bundle safe (§35).
// §45: writes ONLY campaign tables; READS leads (phones) to build the list — no
// lead write, no hot-path trigger.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN     = process.env.CAMPAIGN_WA_TOKEN
const GRAPH = 'https://graph.facebook.com/v21.0'
const BATCH = 25                   // recipients per send_batch call (timeout-safe)
const ALL_STAGES = 6

function cleanPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length === 10) return '91' + d
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  return d.length >= 11 ? d : ''
}

// Phase 199 — build the template media-header component for a broadcast/test.
// type ∈ image|video|document; url = a public link Meta fetches. null = no header.
function buildHeaderComp(type, url) {
  const t = String(type || '').toLowerCase()
  if (!url || !['image', 'video', 'document'].includes(t)) return null
  if (t === 'document') return { type: 'header', parameters: [{ type: 'document', document: { link: url, filename: 'document.pdf' } }] }
  return { type: 'header', parameters: [{ type: t, [t]: { link: url } }] }
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })
  if (!WA_TOKEN) return res.status(503).json({ error: 'token_missing', detail: 'CAMPAIGN_WA_TOKEN not set in Vercel.' })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── auth: admin / co_owner ──
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'no_auth' })
  const { data: ures, error: uerr } = await admin.auth.getUser(token)
  const uid = ures?.user?.id
  if (uerr || !uid) return res.status(401).json({ error: 'bad_auth' })
  const { data: me } = await admin.from('users').select('role').eq('id', uid).maybeSingle()
  if (!me || !['admin', 'co_owner'].includes(me.role)) return res.status(403).json({ error: 'not_allowed' })

  // marketing sending account (phone_number_id + waba_id)
  // Phase 262 — resolve by purpose='marketing', NOT is_active. Both the service
  // and marketing numbers are is_active=true, so the old "is_active ORDER BY
  // created_at ASC LIMIT 1" silently picked the OLDEST = the SERVICE number →
  // a broadcast would go out the wrong line, and the picker listed the wrong
  // WABA's templates (§133). A broadcast is business-initiated marketing → it
  // MUST use the marketing number. Still require a COMPLETE account (both ids).
  const { data: acct } = await admin.from('whatsapp_accounts')
    .select('phone_number_id, waba_id').eq('purpose', 'marketing')
    .not('phone_number_id', 'is', null).not('waba_id', 'is', null)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  const pnid = acct?.phone_number_id
  const wabaId = acct?.waba_id

  // ── GET: list / one broadcast ──
  if (req.method === 'GET') {
    const id = req.query?.id
    if (id) {
      const { data: bc } = await admin.from('campaign_broadcasts').select('*').eq('id', id).maybeSingle()
      if (!bc) return res.status(404).json({ error: 'not_found' })
      const { data: recips } = await admin.from('broadcast_recipients').select('status').eq('broadcast_id', id)
      const funnel = { queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 }
      ;(recips || []).forEach((r) => { funnel[r.status] = (funnel[r.status] || 0) + 1 })
      return res.status(200).json({ ok: true, broadcast: bc, funnel })
    }
    const { data: list } = await admin.from('campaign_broadcasts').select('*').order('created_at', { ascending: false }).limit(50)
    return res.status(200).json({ ok: true, broadcasts: list || [] })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
  const action = String(body?.action || '')

  // helper: does the template body carry {{1}}?
  async function templateHasVar(name) {
    if (!wabaId) return false
    try {
      const r = await fetch(`${GRAPH}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,components`, {
        headers: { Authorization: `Bearer ${WA_TOKEN}` },
      })
      const j = await r.json().catch(() => ({}))
      const b = (j.data?.[0]?.components || []).find((c) => String(c.type).toUpperCase() === 'BODY')
      return /\{\{\s*1\s*\}\}/.test(b?.text || '')
    } catch { return false }
  }

  // ── CREATE: resolve segment → queue recipients ──
  if (action === 'create') {
    const segmentId = body?.segment_id
    const templateName = String(body?.template_name || '').trim()
    const language = String(body?.template_language || 'en')
    // Phase 199 — optional media header (image/video/document) sent on every msg.
    const headerType = String(body?.header_type || '').trim().toLowerCase()
    const headerMediaUrl = String(body?.header_media_url || '').trim()
    if (!segmentId || !templateName) return res.status(400).json({ error: 'segment_id + template_name required' })
    if (headerType && !['image', 'video', 'document'].includes(headerType)) return res.status(400).json({ error: 'bad_header' })
    if (headerType && !headerMediaUrl) return res.status(400).json({ error: 'no_header_media', detail: 'This template has a media header — upload the image/video/PDF to send.' })

    const { data: seg } = await admin.from('campaign_segments').select('id, name, rules_json').eq('id', segmentId).maybeSingle()
    if (!seg) return res.status(404).json({ error: 'segment_not_found' })

    const r = seg.rules_json || {}
    let q = admin.from('leads').select('id, name, phone').not('phone', 'is', null).limit(5000)
    if (Array.isArray(r.stages) && r.stages.length && r.stages.length < ALL_STAGES) q = q.in('stage', r.stages)
    if (r.heat) q = q.eq('heat', r.heat)
    if (r.source) q = q.eq('source', r.source)
    if (r.city) q = q.ilike('city', `%${r.city}%`)
    // A broadcast ALWAYS excludes opted-out leads (Do-Not-Call / WhatsApp
    // opt-out) — compliance hard rule, regardless of the segment's own toggle.
    q = q.not('do_not_call', 'is', true).not('wa_opt_out', 'is', true)
    const { data: leads, error: lerr } = await q
    if (lerr) return res.status(502).json({ error: 'lead_query', detail: lerr.message })

    const seen = new Set(); const uniq = []
    for (const l of (leads || [])) {
      const ph = cleanPhone(l.phone)
      if (ph && !seen.has(ph)) { seen.add(ph); uniq.push({ lead_id: l.id, phone: ph, name: l.name }) }
    }
    if (!uniq.length) return res.status(400).json({ error: 'no_recipients', detail: 'This segment has no leads with a usable phone.' })

    // Phase 262 — HARD OPT-IN GATE. A broadcast is business-initiated marketing;
    // WhatsApp policy requires the recipient to have OPTED IN, not merely "not
    // opted out". So we keep ONLY phones that MESSAGED our WhatsApp first (a
    // conversation with last_inbound_at set = they contacted us). This makes it
    // impossible to cold-blast a lead list — the exact mistake that got the
    // marketing number flagged for spam (§133). Cross-number: a prior inbound on
    // EITHER our line counts as opting in to the business.
    const optedIn = new Set()
    const allPhones = uniq.map((x) => x.phone)
    for (let i = 0; i < allPhones.length; i += 300) {
      const chunk = allPhones.slice(i, i + 300)
      const { data: convs, error: ce } = await admin.from('whatsapp_conversations')
        .select('customer_wa_id')
        .in('customer_wa_id', chunk)
        .not('last_inbound_at', 'is', null)
      if (ce) return res.status(502).json({ error: 'optin_check_failed', detail: ce.message })
      ;(convs || []).forEach((c) => optedIn.add(c.customer_wa_id))
    }
    const gated = uniq.filter((x) => optedIn.has(x.phone))
    if (!gated.length) return res.status(400).json({
      error: 'no_opted_in_recipients',
      detail: 'A broadcast can only go to people who messaged your WhatsApp first (opt-in). No one in this segment has — WhatsApp bans cold marketing to non-opted-in numbers.',
    })

    const { data: bc, error: be } = await admin.from('campaign_broadcasts').insert({
      segment_id: seg.id, segment_name: seg.name, template_name: templateName,
      template_language: language, status: 'queued', total: gated.length, created_by: uid,
      header_type: headerType || null, header_media_url: headerMediaUrl || null,
    }).select('id').maybeSingle()
    if (be || !bc) return res.status(502).json({ error: 'create_failed', detail: be?.message })

    const rows = gated.map((x) => ({ broadcast_id: bc.id, lead_id: x.lead_id, phone: x.phone, name: x.name, status: 'queued' }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error: ie } = await admin.from('broadcast_recipients').insert(rows.slice(i, i + 500))
      if (ie) return res.status(502).json({ error: 'queue_failed', detail: ie.message })
    }
    return res.status(200).json({ ok: true, broadcast_id: bc.id, total: gated.length })
  }

  // ── SEND_BATCH: send the next ≤25 queued recipients ──
  if (action === 'send_batch') {
    if (!pnid) return res.status(409).json({ error: 'no_number', detail: 'No active WhatsApp number on file.' })
    const bid = body?.broadcast_id
    if (!bid) return res.status(400).json({ error: 'broadcast_id required' })
    const { data: bc } = await admin.from('campaign_broadcasts').select('*').eq('id', bid).maybeSingle()
    if (!bc) return res.status(404).json({ error: 'not_found' })

    // Atomically CLAIM the next batch (queued → sending) so two concurrent
    // send_batch calls can never grab the same recipient → no double-send.
    const { data: picked } = await admin.from('broadcast_recipients')
      .select('id').eq('broadcast_id', bid).eq('status', 'queued').limit(BATCH)
    const ids = (picked || []).map((r) => r.id)
    let batch = []
    if (ids.length) {
      const { data: claimed } = await admin.from('broadcast_recipients')
        .update({ status: 'sending' }).in('id', ids).eq('status', 'queued').select('id, phone, name')
      batch = claimed || []
    }
    if (batch.length) await admin.from('campaign_broadcasts').update({ status: 'sending' }).eq('id', bid)
    const hasVar = batch.length ? await templateHasVar(bc.template_name) : false
    // Phase 199 — media header component (same creative for every recipient).
    const headerComp = buildHeaderComp(bc.header_type, bc.header_media_url)

    let sent = 0, failed = 0
    for (const rec of batch) {
      try {
        const tpl = { name: bc.template_name, language: { code: bc.template_language || 'en' } }
        const comps = []
        if (headerComp) comps.push(headerComp)
        if (hasVar) comps.push({ type: 'body', parameters: [{ type: 'text', text: rec.name || 'there' }] })
        if (comps.length) tpl.components = comps
        const resp = await fetch(`${GRAPH}/${pnid}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: rec.phone, type: 'template', template: tpl }),
        })
        const rj = await resp.json().catch(() => ({}))
        if (resp.ok) {
          sent++
          await admin.from('broadcast_recipients').update({ status: 'sent', wamid: rj?.messages?.[0]?.id || null, sent_at: new Date().toISOString() }).eq('id', rec.id)
        } else {
          failed++
          await admin.from('broadcast_recipients').update({ status: 'failed', error: String(rj?.error?.message || `HTTP ${resp.status}`).slice(0, 300) }).eq('id', rec.id)
        }
      } catch (e) {
        failed++
        await admin.from('broadcast_recipients').update({ status: 'failed', error: String(e?.message || e).slice(0, 300) }).eq('id', rec.id)
      }
    }

    const { data: agg } = await admin.from('broadcast_recipients').select('status').eq('broadcast_id', bid)
    const sentTotal = (agg || []).filter((x) => x.status === 'sent').length
    const failTotal = (agg || []).filter((x) => x.status === 'failed').length
    const remaining = (agg || []).filter((x) => x.status === 'queued').length
    await admin.from('campaign_broadcasts').update({
      sent: sentTotal, failed: failTotal, status: remaining === 0 ? 'done' : 'sending', updated_at: new Date().toISOString(),
    }).eq('id', bid)
    return res.status(200).json({ ok: true, sent, failed, remaining })
  }

  // ── TEST: send the template to ONE number ──
  if (action === 'test') {
    if (!pnid) return res.status(409).json({ error: 'no_number' })
    const templateName = String(body?.template_name || '').trim()
    const language = String(body?.template_language || 'en')
    const to = cleanPhone(body?.to)
    if (!templateName || !to) return res.status(400).json({ error: 'template_name + valid to required' })
    const hasVar = await templateHasVar(templateName)
    const headerComp = buildHeaderComp(body?.header_type, body?.header_media_url)  // Phase 199
    const tpl = { name: templateName, language: { code: language } }
    const comps = []
    if (headerComp) comps.push(headerComp)
    if (hasVar) comps.push({ type: 'body', parameters: [{ type: 'text', text: 'Test' }] })
    if (comps.length) tpl.components = comps
    try {
      const resp = await fetch(`${GRAPH}/${pnid}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: tpl }),
      })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok) return res.status(502).json({ error: 'meta_error', detail: j?.error?.error_user_msg || j?.error?.message || `HTTP ${resp.status}` })
      return res.status(200).json({ ok: true, wamid: j?.messages?.[0]?.id || null })
    } catch (e) {
      return res.status(502).json({ error: 'meta_unreachable', detail: String(e?.message || e) })
    }
  }

  return res.status(400).json({ error: 'bad_action' })
}
