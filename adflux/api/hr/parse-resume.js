// api/hr/parse-resume.js — EDGE runtime (Phase 283)
// HR uploads a resume PDF OR a screenshot (Naukri / any platform) → Claude reads
// it and returns the candidate's contact fields → the Add Candidate form
// pre-fills. HR reviews + edits + saves (the file is still stored as the resume
// on save via the existing flow). NOTHING is written here — parse only.
//
// EDGE (§219 — the project is at the 12 Node-serverless-fn Hobby cap; a Node fn
// here would break every deploy). Raw fetch, no supabase-js.
//
// Auth: verify the caller's Supabase JWT + gate to hr/admin/co_owner (recruitment
// is HR-only, §158). Env: SUPABASE_URL(||VITE_) + SUPABASE_SERVICE_ROLE_KEY +
// SUPABASE_ANON_KEY + ANTHROPIC_API_KEY [+ ANTHROPIC_MODEL].
export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL        = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const ANTHROPIC    = 'https://api.anthropic.com/v1/messages'

const MAX_BYTES = 4.5 * 1024 * 1024 // ~4.5 MB decoded — keeps the base64 body under
                                    // Vercel Edge's request-body limit so the clean
                                    // too_large 413 stays reachable. A resume/screenshot
                                    // is well under this.
const OK_IMAGE  = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// Per-instance runaway guard (not a billing control — Edge instances are ephemeral,
// same caveat as api/email/send.js). Bounds accidental spamming of the paid AI call.
const RL = new Map()
function rateLimited(uid) {
  const now = Date.now(), win = 60000, max = 20
  const arr = (RL.get(uid) || []).filter(t => now - t < win)
  if (arr.length >= max) return true
  arr.push(now); RL.set(uid, arr); return false
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server_not_configured' }, 500)
  if (!ANTHROPIC_KEY) return json({ error: 'ai_not_configured' }, 500)

  // 1. auth — verify the JWT
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'unauthorized' }, 401)
  let uid = null
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    if (!ur.ok) return json({ error: 'unauthorized' }, 401)
    uid = (await ur.json())?.id
  } catch { return json({ error: 'unauthorized' }, 401) }
  if (!uid) return json({ error: 'unauthorized' }, 401)

  // 2. role gate — recruitment is HR-only
  let role = null
  try {
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${uid}&select=role`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    const rows = rr.ok ? await rr.json() : []
    role = rows?.[0]?.role || null
  } catch { /* role unknown → refused below */ }
  if (!['hr', 'admin', 'co_owner'].includes(role)) return json({ error: 'forbidden' }, 403)
  if (rateLimited(uid)) return json({ error: 'rate_limited' }, 429)

  // 3. body
  let fileBase64, mediaType
  try {
    const b = await req.json()
    fileBase64 = b.fileBase64
    mediaType = (b.mediaType || '').toLowerCase()
  } catch { return json({ error: 'bad_body' }, 400) }
  if (!fileBase64 || typeof fileBase64 !== 'string') return json({ error: 'no_file' }, 400)
  // strip a data: URL prefix if present
  fileBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '')
  if (fileBase64.length * 0.75 > MAX_BYTES) return json({ error: 'too_large' }, 413)

  const isPdf = mediaType === 'application/pdf'
  const isImg = OK_IMAGE.includes(mediaType)
  if (!isPdf && !isImg) return json({ error: 'unsupported_type' }, 415)

  // 4. build the Claude content block (PDF document OR image)
  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType === 'image/jpg' ? 'image/jpeg' : mediaType, data: fileBase64 } }

  const instruction = [
    'This is a job candidate resume or a screenshot of a candidate profile from a hiring platform.',
    'Extract the candidate contact details. Reply with ONLY a JSON object, no prose, no markdown:',
    '{"name": string|null, "phone": string|null, "email": string|null, "role_applied": string|null}',
    'Rules: name = the candidate\'s own full name. phone = their mobile (digits, keep as written). email = their email.',
    'role_applied = the job title/role they are applying for or their current designation (short). Use null for any field not found. Do not invent.',
  ].join(' ')

  // 5. call Claude
  let out = {}
  try {
    const cr = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: instruction }] }],
      }),
    })
    if (!cr.ok) {
      const detail = await cr.text().catch(() => '')
      return json({ error: 'ai_failed', status: cr.status, detail: detail.slice(0, 300) }, 502)
    }
    const data = await cr.json()
    const text = (data?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n')
    const m = text.match(/\{[\s\S]*\}/)
    out = m ? JSON.parse(m[0]) : {}
  } catch (e) {
    return json({ error: 'ai_error', detail: String(e).slice(0, 200) }, 502)
  }

  const clean = (v) => (v == null || v === '' || /^n\/?a$/i.test(String(v).trim())) ? null : String(v).trim()
  return json({
    name:         clean(out.name),
    phone:        clean(out.phone),
    email:        clean(out.email),
    role_applied: clean(out.role_applied),
  })
}
