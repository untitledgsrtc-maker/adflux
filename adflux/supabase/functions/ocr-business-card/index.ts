// supabase/functions/ocr-business-card/index.ts
//
// Phase 33D (11 May 2026) — Claude Vision OCR for business cards
// captured via the lead detail photo button. Same Anthropic API key
// the voice-process function already uses. No new vendor.
//
// Input:
//   { image_base64, mime_type, lead_id }
//
// Output:
//   {
//     ocr_text,                // raw transcript
//     fields: { name, phone, email, company, role },
//     is_business_card,        // Claude's judgment
//   }
//
// The client (PhotoCapture component) then patches the lead row with
// any fields it wants to use, and stores ocr_text + fields on the
// lead_photos row for audit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonResp = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const SYSTEM = `You read photographs of business cards or storefronts taken by a sales rep at an Indian outdoor advertising company. Extract structured contact details.

Return STRICT JSON only — no commentary, no markdown fences. Schema:
{
  "ocr_text": "full visible text, original layout",
  "is_business_card": true | false,
  "fields": {
    "name":    "person's name or null",
    "phone":   "primary phone digits (no formatting) or null",
    "email":   "email address or null",
    "company": "organization name or null",
    "role":    "designation / title or null"
  }
}

Rules:
- If the photo is NOT a business card (storefront, hoarding mockup, building, document), set is_business_card=false and leave fields null but still fill ocr_text with any visible text.
- Indian phone numbers: strip spaces / hyphens / +91 prefix; return 10 digits only.
- Don't invent fields. Null when uncertain.
- Latin script preferred for fields; ocr_text can be mixed Gujarati / Hindi / English.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return jsonResp({ error: 'POST required' }, 405)
  if (!ANTHROPIC_KEY)           return jsonResp({ error: 'ANTHROPIC_API_KEY not configured' }, 500)

  let body: any
  try { body = await req.json() } catch { return jsonResp({ error: 'Invalid JSON' }, 400) }
  const { image_base64, mime_type } = body || {}
  if (!image_base64) return jsonResp({ error: 'image_base64 required' }, 400)

  try {
    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime_type || 'image/jpeg', data: image_base64 } },
            { type: 'text', text: 'Extract contact details from this photo.' },
          ],
        }],
      }),
    })
    if (!cr.ok) {
      const t = await cr.text()
      return jsonResp({ error: 'Claude error: ' + t.slice(0, 300) }, 502)
    }
    const cj = await cr.json()
    const raw = (cj?.content?.[0]?.text || '').trim()
    // Strip code fences if Claude wrapped them.
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
    let parsed: any
    try { parsed = JSON.parse(clean) } catch {
      return jsonResp({ error: 'Claude returned non-JSON: ' + raw.slice(0, 200) }, 502)
    }
    return jsonResp({
      ocr_text:         parsed.ocr_text || '',
      fields:           parsed.fields   || {},
      is_business_card: !!parsed.is_business_card,
    }, 200)
  } catch (e: any) {
    return jsonResp({ error: 'OCR exception: ' + (e?.message || e) }, 502)
  }
})
