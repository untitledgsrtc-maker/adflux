// api/meta/leadgen-subscribe.js — EDGE runtime.
// Phase 409: connect the Aiadflux Facebook Page to the "Untitled Leads" Meta app for the `leadgen` webhook field,
// from the SERVER, using the system-user token already stored in Vercel (META_LEADS_TOKEN). The token never leaves
// the server and is never returned. Needed because the Page is owned through the Aiadflux business, so a personal
// Graph Explorer login cannot get a Page token for it.
//   POST  -> subscribe the Page to the app (field: leadgen), then report the result
//   GET   -> report only (which apps the Page is subscribed to, with which fields)
// Gated by x-ta-secret (== TEAM_ASSISTANT_SECRET), fail-closed. Safe to call more than once.
// Env: META_LEADS_TOKEN, TEAM_ASSISTANT_SECRET, optional META_LEADS_PAGE_ID (default 1247859895082575).

export const config = { runtime: 'edge' }

const TOKEN   = process.env.META_LEADS_TOKEN
const SECRET  = process.env.TEAM_ASSISTANT_SECRET
const PAGE_ID = process.env.META_LEADS_PAGE_ID || '1247859895082575'
const GRAPH   = 'https://graph.facebook.com/v21.0'

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const clip = (e) => String(e?.error?.message || e?.message || e || '').slice(0, 300)

export default async function handler(req) {
  if (!TOKEN || !SECRET) return json({ ok: false, reason: 'not_configured' }, 503)
  if (String(req.headers.get('x-ta-secret') || '') !== SECRET) return json({ ok: false, reason: 'forbidden' }, 403)
  if (req.method !== 'POST' && req.method !== 'GET') return json({ ok: false, reason: 'method_not_allowed' }, 405)

  try {
    // 1) the Page's own access token, fetched with the system-user token (kept in memory only)
    const pr = await fetch(`${GRAPH}/${PAGE_ID}?fields=id,name,access_token&access_token=${encodeURIComponent(TOKEN)}`)
    const pj = await pr.json().catch(() => ({}))
    if (!pr.ok || !pj.access_token) return json({ ok: false, step: 'page_token', error: clip(pj) }, 200)
    const pageToken = pj.access_token

    // 2) subscribe (POST only)
    let subscribed = null
    if (req.method === 'POST') {
      const sr = await fetch(`${GRAPH}/${PAGE_ID}/subscribed_apps`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ subscribed_fields: 'leadgen', access_token: pageToken }),
      })
      const sj = await sr.json().catch(() => ({}))
      if (!sr.ok) return json({ ok: false, step: 'subscribe', error: clip(sj) }, 200)
      subscribed = !!sj.success
    }

    // 3) report the current state (no tokens)
    const cr = await fetch(`${GRAPH}/${PAGE_ID}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`)
    const cj = await cr.json().catch(() => ({}))
    const apps = Array.isArray(cj.data) ? cj.data.map((a) => ({ id: a.id, name: a.name, fields: a.subscribed_fields })) : []
    return json({ ok: true, page: { id: pj.id, name: pj.name }, subscribe_call: subscribed, apps })
  } catch (e) {
    return json({ ok: false, step: 'exception', error: clip(e) }, 200)
  }
}
