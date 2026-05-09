// supabase/functions/voice-process/index.ts
//
// Phase 20 — Voice-First V1
//
// Receives an audio recording from a sales rep, transcribes it via
// OpenAI Whisper, classifies the transcript via Anthropic Claude
// Haiku, and writes a lead_activities row. Audit trail of every run
// lands in voice_logs.
//
// Single sync request — no background queueing in V1. A typical
// 30-second clip should round-trip in 5–10 seconds (Whisper ~3s,
// Claude ~2s, DB writes <1s).
//
// Required env vars (set on the Supabase project):
//   OPENAI_API_KEY      — for Whisper transcription
//   ANTHROPIC_API_KEY   — for Claude classification (already set
//                         from Co-Pilot phase)
//   SUPABASE_URL        — auto-provided
//   SUPABASE_ANON_KEY   — auto-provided
//
// Deploy:
//   supabase functions deploy voice-process
//
// Request body (JSON):
//   {
//     audio_base64:     "...",           // raw audio, base64-encoded
//     mime_type:        "audio/webm",    // MediaRecorder default on Chrome
//     lead_id:          "uuid"|null,     // optional — null = orphan note
//     duration_seconds: 24,              // for audit
//     language_hint:    "gu"|"hi"|"en"   // optional — biases Whisper
//   }
//
// Response (200):
//   {
//     voice_log_id:  "uuid",
//     activity_id:   "uuid"|null,
//     transcript:    "Mehta sahebne mali aavyo…",
//     language:      "gu",
//     classified: {
//       activity_type:   "call"|"whatsapp"|"meeting"|"site_visit"|"note",
//       outcome:         "positive"|"neutral"|"negative",
//       notes:           "Cleaned-up English summary…",
//       next_action:     "Send quote",
//       next_action_date:"2026-05-08"
//     }
//   }

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY')
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!

// Whisper API accepts only ISO-639-1 codes from a fixed list. Gujarati
// ('gu') is NOT on the list even though Whisper can transcribe it — the
// API rejects 'gu' with "Language 'gu' is not supported." We pass the
// hint only for languages OpenAI explicitly accepts; for Gujarati we
// send nothing and let Whisper auto-detect (works fine in practice).
const WHISPER_HINT_OK = new Set(['en', 'hi'])

// System prompt for evening summary mode. Rep speaks a 20-30s end-of-day
// recap; we extract Highlights / Blockers / Tomorrow into a structured
// JSON the /voice/evening UI renders as the design's AI summary card.
const EVENING_SYSTEM = `You summarise an end-of-day voice note from a sales rep at an Indian outdoor advertising company. They speak in Gujarati, Hindi, or English (often mixed) about what happened during their workday.

Return ONLY a JSON object. No prose, no markdown fence. Schema:
{
  "transcript_en":   "Sentence-level natural English translation of what the rep said. Preserve their exact meaning.",
  "highlights":      "1-2 sentences of what went well (deals progressed, meetings completed, pipeline added). Use Indian numbering (lakh/crore). English.",
  "blockers":        "1-2 sentences of what's stuck or pending. English. Empty string if nothing.",
  "tomorrow_focus":  "1 sentence on what the rep plans to do tomorrow. English. Empty string if not mentioned.",
  "quotes_sent":     "Numeric count of quotes sent today, or 0 if not mentioned.",
  "pipeline_added":  "Total ₹ pipeline added today as a plain rupee number, or 0. Convert lakh/crore."
}

Guidance:
- Keep highlights/blockers/tomorrow_focus terse and English so they read clean on the rep's dashboard summary card.
- transcript_en is the natural English version of the spoken note (not a summary).
- Don't invent numbers the rep didn't say.
`

const CLASSIFY_SYSTEM = `You classify a short voice note from a sales rep at an Indian outdoor advertising company. The rep speaks in Gujarati, Hindi, or English (often mixed). The transcript is what they said about a customer interaction.

Return ONLY a JSON object. No prose, no markdown fence. Schema:
{
  "activity_type": "call" | "whatsapp" | "meeting" | "site_visit" | "note",
  "outcome":       "positive" | "neutral" | "negative",
  "transcript_en": "Sentence-level natural English translation of what the rep said (NOT a summary). Preserve their exact meaning. If transcript is already mostly English, copy it through.",
  "notes":         "Short English summary of what happened (1-3 sentences). This is for the activity timeline.",
  "next_action":   "Short phrase like 'Send quote' or 'Follow up Tuesday', or empty string",
  "next_action_date": "YYYY-MM-DD or empty string",
  "amount":        "Numeric rupee amount mentioned, or 0. Convert lakh/crore to plain rupees (e.g. '3.8 lakh' -> 380000, '2 crore' -> 20000000).",
  "stage_to":      "If the rep clearly indicates a stage transition, one of: 'Working' | 'QuoteSent' | 'Won' | 'Lost'. Otherwise empty string. (Phase 30A — collapsed from 10 stages to 5.)"
}

Guidance:
- Default activity_type to "call" unless the rep clearly says they met the person (meeting), visited a site (site_visit), or only sent a message (whatsapp).
- "Positive" = customer agreed, asked for a quote, scheduled a meeting, said yes.
- "Negative" = customer said no, not interested, budget issue.
- "Neutral" = neither — a follow-up or info-gathering call.
- next_action only if the rep explicitly mentioned what to do next.
- next_action_date only if the rep mentioned a specific day. "tomorrow" or "Monday" → resolve to date based on today's date provided in user message.
- transcript_en is the user-facing English version of the spoken note, distinct from notes (the cleaned-up summary).
- amount: only if the rep stated a specific number. "₹3.8 lakh nu quote" → 380000. Don't guess.
- stage_to: only when the rep's intent is clear. "BANT confirmed" / "ready for sales" / "demo set" / "meeting fixed" → Working. "quote sent" / "negotiating" → QuoteSent. "lost interest" / "not interested" → Lost. "won" / "deal closed" → Won.
`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return jsonResp({ error: 'Method not allowed' }, 405)
  }

  if (!OPENAI_KEY)    return jsonResp({ error: 'OPENAI_API_KEY not configured on Supabase project.' }, 500)
  if (!ANTHROPIC_KEY) return jsonResp({ error: 'ANTHROPIC_API_KEY not configured on Supabase project.' }, 500)

  // Auth — read the caller's JWT, use it for all DB writes so RLS applies.
  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResp({ error: 'Missing bearer token.' }, 401)
  }
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return jsonResp({ error: 'Auth failed: ' + (authErr?.message || 'no user') }, 401)
  }

  // Parse body
  let body: any
  try { body = await req.json() }
  catch { return jsonResp({ error: 'Invalid JSON body.' }, 400) }

  const {
    audio_base64, mime_type, lead_id, duration_seconds, language_hint,
    gps_lat, gps_lng, gps_accuracy_m,
    mode,                    // 'lead' (default) | 'evening'
  } = body || {}
  const isEvening = mode === 'evening'
  if (!audio_base64 || typeof audio_base64 !== 'string') {
    return jsonResp({ error: 'audio_base64 (string) is required.' }, 400)
  }
  if (audio_base64.length > 10 * 1024 * 1024) {  // ~7.5 MB raw audio
    return jsonResp({ error: 'Audio too large. Keep clips under 60 seconds.' }, 413)
  }

  // 1. Insert voice_logs (pending) so we have an audit row even if Whisper fails.
  const { data: vlInsert, error: vlErr } = await supabase
    .from('voice_logs')
    .insert({
      lead_id:          lead_id || null,
      user_id:          user.id,
      duration_seconds: Number(duration_seconds) || null,
      status:           'transcribing',
    })
    .select('id')
    .single()
  if (vlErr || !vlInsert) {
    return jsonResp({ error: 'voice_logs insert failed: ' + (vlErr?.message || 'unknown') }, 500)
  }
  const voice_log_id = vlInsert.id

  // 2. Whisper transcribe.
  let transcript = ''
  let language   = language_hint || ''
  try {
    const audioBytes = base64ToBytes(audio_base64)
    const audioBlob  = new Blob([audioBytes], { type: mime_type || 'audio/webm' })
    const fd = new FormData()
    fd.append('file', audioBlob, fileNameForMime(mime_type))
    fd.append('model', 'whisper-1')
    // Phase 20c — Whisper API's `language` param uses ISO-639-1 but
    // doesn't accept 'gu' (Gujarati) even though the model can transcribe
    // it. Only pass the hint for languages OpenAI accepts. For Gujarati
    // we let Whisper auto-detect.
    if (language_hint && WHISPER_HINT_OK.has(language_hint)) {
      fd.append('language', language_hint)
    }
    // Phase 31I — owner reported (10 May 2026) Gujarati audio reliably
    // transcribes as Hindi (Devanagari script) when auto-detection runs.
    // The acoustic similarity + Whisper's Hindi-heavy training data
    // means auto-detect picks Hindi every time. Fix: when the rep
    // explicitly selected Gujarati, pass a short Gujarati-script
    // `prompt`. Whisper's prompt parameter biases the output script —
    // a Gujarati prompt makes the decoder emit Gujarati script. The
    // prompt itself doesn't appear in the transcript.
    if (language_hint === 'gu') {
      fd.append('prompt', 'આ ગુજરાતી ભાષામાં વાતચીત છે. કૃપા કરીને ગુજરાતી લિપિમાં લખો.')
    }
    fd.append('response_format', 'verbose_json')

    const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: fd,
    })
    if (!wr.ok) {
      const errText = await wr.text()
      await markFailed(supabase, voice_log_id, 'Whisper: ' + errText.slice(0, 300))
      return jsonResp({ error: 'Whisper API error: ' + errText.slice(0, 300) }, 502)
    }
    const wj = await wr.json()
    transcript = (wj.text || '').trim()
    language   = wj.language || language || 'unknown'
  } catch (e: any) {
    await markFailed(supabase, voice_log_id, 'Whisper exception: ' + (e?.message || e))
    return jsonResp({ error: 'Whisper call threw: ' + (e?.message || e) }, 502)
  }

  if (!transcript) {
    await markFailed(supabase, voice_log_id, 'Empty transcript from Whisper.')
    return jsonResp({ error: 'Whisper returned an empty transcript. Try recording again.' }, 422)
  }

  // Phase 31A.6 — owner spec (8 May 2026): morning plan textarea
  // wants voice dictation. Extends voice-process with a
  // mode='transcribe_only' branch that returns after Whisper —
  // skips Claude classify + lead_activities insert. Saves a
  // round-trip and a token bill when all the caller wants is
  // the raw transcript dropped into a textbox.
  if (mode === 'transcribe_only') {
    // Use 'completed' (in the existing CHECK enum) since transcribe-only
    // skips the Claude classify step on purpose — there's nothing more
    // to do. Avoids needing a schema migration to add a new status.
    await supabase.from('voice_logs').update({
      transcript,
      language_detected: language,
      status:            'completed',
    }).eq('id', voice_log_id)
    return jsonResp({
      voice_log_id,
      transcript,
      language,
    }, 200)
  }

  // 3. Update voice_logs with the transcript and move to classifying.
  await supabase.from('voice_logs').update({
    transcript,
    language_detected: language,
    status:            'classifying',
  }).eq('id', voice_log_id)

  // 4. Claude classify.
  const today = new Date().toISOString().slice(0, 10)
  let classified: any = null
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
        max_tokens: 600,
        system: isEvening ? EVENING_SYSTEM : CLASSIFY_SYSTEM,
        messages: [{
          role: 'user',
          content: isEvening
            ? `Today is ${today}. Summarise this evening recap:\n\n"${transcript}"`
            : `Today is ${today}. Classify this transcript:\n\n"${transcript}"`,
        }],
      }),
    })
    if (!cr.ok) {
      const errText = await cr.text()
      await markFailed(supabase, voice_log_id, 'Claude: ' + errText.slice(0, 300))
      return jsonResp({ error: 'Claude API error: ' + errText.slice(0, 300) }, 502)
    }
    const cj = await cr.json()
    const text = cj?.content?.[0]?.text || ''
    classified = parseJsonMaybeFenced(text)
    if (!classified) {
      await markFailed(supabase, voice_log_id, 'Claude returned non-JSON: ' + text.slice(0, 200))
      return jsonResp({ error: "Claude didn't return parseable JSON. Try again." }, 502)
    }
  } catch (e: any) {
    await markFailed(supabase, voice_log_id, 'Claude exception: ' + (e?.message || e))
    return jsonResp({ error: 'Claude call threw: ' + (e?.message || e) }, 502)
  }

  // 5. Insert lead_activities row (only if lead_id was provided AND
  //    we're in lead mode; evening summaries don't create per-lead
  //    activities — the UI saves them to work_sessions.evening_summary).
  let activity_id: string | null = null
  if (lead_id && !isEvening) {
    const activityInsert = {
      lead_id,
      activity_type:    sanitizeActivityType(classified.activity_type),
      outcome:          sanitizeOutcome(classified.outcome),
      notes:            (classified.notes || transcript).slice(0, 4000),
      next_action:      classified.next_action      || null,
      next_action_date: classified.next_action_date || null,
      duration_seconds: Number(duration_seconds) || null,
      gps_lat:          (typeof gps_lat === 'number') ? gps_lat : null,
      gps_lng:          (typeof gps_lng === 'number') ? gps_lng : null,
      gps_accuracy_m:   (typeof gps_accuracy_m === 'number') ? Math.round(gps_accuracy_m) : null,
      created_by:       user.id,
    }
    const { data: actData, error: actErr } = await supabase
      .from('lead_activities')
      .insert(activityInsert)
      .select('id')
      .single()
    if (actErr) {
      // Don't 500 the whole call — keep the voice_log around so the
      // user can retry the activity insert from the UI.
      await markFailed(supabase, voice_log_id, 'Activity insert failed: ' + actErr.message)
      return jsonResp({
        voice_log_id,
        activity_id: null,
        transcript,
        language,
        classified,
        warning: 'Transcribed and classified, but couldn\'t save the activity: ' + actErr.message,
      }, 200)
    }
    activity_id = actData.id
  }

  // 6. Mark voice_logs completed.
  await supabase.from('voice_logs').update({
    classified,
    activity_id,
    status:        'completed',
    completed_at:  new Date().toISOString(),
  }).eq('id', voice_log_id)

  return jsonResp({
    voice_log_id,
    activity_id,
    transcript,
    language,
    classified,
  }, 200)
})

/* ─── helpers ─── */
function base64ToBytes(b64: string): Uint8Array {
  // Strip a data URL prefix if the client sent one.
  const clean = b64.includes(',') ? b64.split(',', 2)[1] : b64
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function fileNameForMime(mime?: string) {
  if (!mime) return 'audio.webm'
  if (mime.includes('mp4'))  return 'audio.m4a'
  if (mime.includes('mpeg')) return 'audio.mp3'
  if (mime.includes('wav'))  return 'audio.wav'
  if (mime.includes('ogg'))  return 'audio.ogg'
  return 'audio.webm'
}

function parseJsonMaybeFenced(s: string): any | null {
  if (!s) return null
  // Strip ``` json fences if Claude added them despite instructions.
  let cleaned = s.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try { return JSON.parse(cleaned) }
  catch { return null }
}

function sanitizeActivityType(v: any): string {
  const allowed = ['call','whatsapp','email','meeting','site_visit','note']
  return allowed.includes(v) ? v : 'note'
}
function sanitizeOutcome(v: any): string | null {
  const allowed = ['positive','neutral','negative']
  return allowed.includes(v) ? v : null
}

async function markFailed(supabase: any, id: string, message: string) {
  await supabase.from('voice_logs').update({
    status:        'failed',
    error_message: message.slice(0, 1000),
    completed_at:  new Date().toISOString(),
  }).eq('id', id)
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  }
}

function jsonResp(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  })
}
