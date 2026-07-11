// api/deck-videos.js
//
// Public city -> YouTube URL map for the offline pitch deck's coverage slide.
// The deck fetches this when online and shows a "Watch this station" button on
// a city that has a video. Service-role read (no auth); returns ONLY the city
// name (first word, upper-cased) + youtube_url for active cities that have a
// video — nothing sensitive. Cached at the edge.
//
// Key = first alpha token of the name, upper-cased, so the deck's names
// ("Gandhinagar", "Surat") match the master's ("GANDHINAGAR", "SURAT (CITY)",
// "ANKLESHWAR GIDC").

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

function keyOf(name) {
  return String(name || '').trim().toUpperCase().split(/[^A-Z]/)[0]
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(200).json({})
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const { data, error } = await admin
      .from('cities')
      .select('name, youtube_url')
      .eq('is_active', true)
      .not('youtube_url', 'is', null)
    if (error) return res.status(200).json({})
    const map = {}
    for (const c of (data || [])) {
      const k = keyOf(c.name)
      if (k && c.youtube_url) map[k] = c.youtube_url
    }
    return res.status(200).json(map)
  } catch {
    return res.status(200).json({})
  }
}
