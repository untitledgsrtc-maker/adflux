// api/ops/ticket-wa.js — send a WhatsApp ticket-alert template to a tech.
// Called by the DB engine via pg_net (Task 8). Edge (§219 12-Node cap — must NOT
// be a Node fn). Secret-gated with OPS_SYNC_SECRET (same as the sync). Best-effort.
export const config = { runtime: 'edge' }

export default async function handler(req) {
  const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
  if (req.method !== 'POST') return j({ error: 'method' }, 405)

  const secret = req.headers.get('x-ops-secret')
  const OPS_SECRET = process.env.OPS_SYNC_SECRET
  if (!OPS_SECRET || secret !== OPS_SECRET) return j({ error: 'forbidden' }, 403)

  const TOKEN = process.env.CAMPAIGN_WA_TOKEN
  const PNID  = process.env.OPS_WA_PHONE_NUMBER_ID  // the sending number's phone_number_id
  const TPL   = process.env.OPS_WA_TEMPLATE || 'ops_ticket_alert'
  if (!TOKEN || !PNID) return j({ ok: true, skipped: 'wa not configured' })

  let body = {}
  try { body = await req.json() } catch { return j({ error: 'bad json' }, 400) }
  const phone = String(body.phone || '').replace(/\D/g, '')
  const depot = String(body.depot || '').slice(0, 60)
  const count = String(body.count ?? '').replace(/\D/g, '') || '0'
  if (phone.length < 10) return j({ ok: true, skipped: 'no phone' })

  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PNID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: phone, type: 'template',
        template: { name: TPL, language: { code: 'gu' },
          components: [{ type: 'body', parameters: [
            { type: 'text', text: depot }, { type: 'text', text: count },
          ] }] },
      }),
    })
    const out = await r.json().catch(() => ({}))
    return j({ ok: r.ok, meta: out?.error?.message || out?.messages?.[0]?.id || null })
  } catch (e) { return j({ ok: false, error: String(e?.message || e).slice(0, 160) }) }
}
