// api/deck-videos.js — EDGE runtime (Phase 219)
//
// Public city -> YouTube URL map for the offline pitch deck's coverage slide.
// The deck fetches this when online and shows a "Watch this station" button on
// a city that has a video. Returns ONLY the city name (first alpha token,
// upper-cased) + youtube_url for active cities that have a video — nothing
// sensitive. Cached at the edge.
//
// WHY EDGE, not the default Node serverless: the Vercel Hobby plan caps a
// deployment at 12 *Serverless* Functions. This project was already at 12, so
// adding this as a Node function (Phase 15x) pushed it to 13 and every deploy
// failed ("No more than 12 Serverless Functions ... on the Hobby plan"). Edge
// Functions do NOT count against that cap, so running this on the edge keeps
// the feature AND unblocks deploys. Raw fetch to the PostgREST endpoint (no
// @supabase/supabase-js) so there is nothing Node-only to bundle.
//
// Key = first alpha token of the name, upper-cased, so the deck's names
// ("Gandhinagar", "Surat") match the master's ("GANDHINAGAR", "SURAT (CITY)",
// "ANKLESHWAR GIDC").

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

function keyOf(name) {
  return String(name || '').trim().toUpperCase().split(/[^A-Z]/)[0]
}

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
  'Content-Type': 'application/json',
}

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: HEADERS })
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response('{}', { status: 200, headers: HEADERS })
  }
  try {
    const url = `${SUPABASE_URL}/rest/v1/cities?select=name,youtube_url&is_active=eq.true&youtube_url=not.is.null`
    const r = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!r.ok) return new Response('{}', { status: 200, headers: HEADERS })
    const data = await r.json()
    const map = {}
    for (const c of (Array.isArray(data) ? data : [])) {
      const k = keyOf(c.name)
      if (k && c.youtube_url) map[k] = c.youtube_url
    }
    return new Response(JSON.stringify(map), { status: 200, headers: HEADERS })
  } catch {
    return new Response('{}', { status: 200, headers: HEADERS })
  }
}
