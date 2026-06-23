// Vercel route: /api/brochure
//
// Phase 177.1 — branded redirect to the current PRIVATE company brochure.
// The private-lead intro email links app.untitledad.in/api/brochure instead of
// the raw Supabase storage URL; this 302-redirects to whatever brochure is
// uploaded on the PRIVATE companies row, so the email link is branded + stable
// (re-uploading a new brochure keeps the same link).
//
// No token gate — `company-assets` is a public bucket (marketing material meant
// to be shared), so this only saves a click from an ugly URL. Read-only, its own
// endpoint: cannot affect any other route or function.
//
// Env (already set for /api/pdf):
//   SUPABASE_URL              — server-side
//   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS for the read

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server not configured' })
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin
      .from('companies')
      .select('brochure_url')
      .eq('segment', 'PRIVATE')
      .limit(1)
      .maybeSingle()

    if (error || !data?.brochure_url) {
      return res.status(404).send('Brochure not available yet.')
    }
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.setHeader('Location', data.brochure_url)
    return res.status(302).end()
  } catch (e) {
    return res.status(500).json({ error: 'Brochure redirect failed' })
  }
}
