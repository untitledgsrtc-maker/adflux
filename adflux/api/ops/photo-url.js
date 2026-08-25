// api/ops/photo-url.js — EDGE runtime (Operations module Phase 3, §230).
// ─────────────────────────────────────────────────────────────────────────
// Hands a short-lived signed URL for an ops-photos object to the sales rep
// who REQUESTED the photo (or any ops/admin user). The ops-photos bucket is
// private and its read RLS (ops_photos_read, Phase 0) intentionally excludes
// sales roles — so a rep cannot client-side createSignedUrl even on their own
// requested ticket. This endpoint checks ticket ownership with the service
// role, then signs. Mirrors the gated-media pattern (api/wa/media.js §114,
// api/quote-render-data.js §212).
//
// WHY EDGE: the app is AT the Vercel Hobby 12-Node-fn cap (§219); a Node fn
// here breaks every deploy. Edge fns don't count.
//
// Auth: caller's Supabase JWT (Authorization: Bearer). Allowed if the caller
// is the ticket's requested_by, OR an admin/co_owner/operation_head/
// operation_executive. Returns a 600s signed URL for ops_tickets.photo_path.
//
// Env: SUPABASE_URL (||VITE_) + SUPABASE_SERVICE_ROLE_KEY + (anon for JWT verify).
// ─────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

const OPS_READ_ROLES = ['admin', 'co_owner', 'operation_head', 'operation_executive']

const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

const sb = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
})

export default async function handler(req) {
  if (req.method !== 'POST') return j({ error: 'method' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return j({ error: 'not_configured' }, 503)

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return j({ error: 'no_auth' }, 401)

  // verify JWT → uid
  let user
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!ur.ok) return j({ error: 'bad_auth' }, 401)
    user = await ur.json()
  } catch { return j({ error: 'auth_unreachable' }, 502) }
  const uid = user?.id
  if (!uid) return j({ error: 'bad_auth' }, 401)

  let body = {}
  try { body = await req.json() } catch { /* empty */ }
  const ticketId = String(body.ticket_id || '')
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return j({ error: 'bad_ticket' }, 400)

  // ticket + caller role (service role — bypasses RLS for the ownership check)
  const ticket = (await (await sb(`ops_tickets?id=eq.${ticketId}&select=requested_by,photo_path&limit=1`)).json())?.[0]
  if (!ticket) return j({ error: 'not_found' }, 404)
  if (!ticket.photo_path) return j({ error: 'no_photo' }, 404)

  let role = null
  try { role = (await (await sb(`users?id=eq.${uid}&select=role&limit=1`)).json())?.[0]?.role || null } catch { /* unknown */ }

  const allowed = ticket.requested_by === uid || OPS_READ_ROLES.includes(role)
  if (!allowed) return j({ error: 'forbidden' }, 403)

  // sign (service role → ops-photos private bucket)
  try {
    const objPath = String(ticket.photo_path).split('/').map(encodeURIComponent).join('/')
    const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/ops-photos/${objPath}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    })
    if (!sr.ok) return j({ error: 'sign_failed' }, 502)
    const { signedURL } = await sr.json()
    return j({ url: `${SUPABASE_URL}/storage/v1${signedURL}` })
  } catch { return j({ error: 'sign_error' }, 502) }
}
