// supabase/functions/parse-day-plan/index.ts
//
// Phase 30D — owner spec (7 May 2026): "after check in he/she must
// need submit plan of the day via voice or manually typing, task must
// be created according their morning description".
//
// Input: a free-text description (any of Gujarati / Hindi / English /
// transliterated mix). The rep dictated it via Whisper or typed it.
// Output: array of discrete tasks the rep can tick off through the
// day.
//
// Output schema (returned as JSON):
//   {
//     tasks: [
//       { id: string, title: string, type: 'call'|'meeting'|'visit'|'quote'|'followup'|'other',
//         due_time: 'HH:MM' or null, done: false }
//     ]
//   }
//
// We keep it small (max 8 tasks). Reps who write a 30-line plan will
// get the top 8 actionable items; the rest stays in the raw text on
// work_sessions.morning_plan_text for reference.

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Phase 31Y (10 May 2026) — schema extended.
// Owner reported (a) Gujarati audio still returned in Devanagari
// despite Phase 31I/X bias prompts, and (b) the voice transcript
// went into the textarea but never auto-filled the structured form
// fields (Planned Meetings rows, Calls, New Leads, Focus area).
// Both fixed in one pass:
//   1. transcript_corrected — Claude re-renders the rep's words in
//      the language they selected (gu/hi/en script). Reliable script
//      transliteration since Claude handles Indic scripts natively;
//      doesn't depend on Whisper's bias prompt working.
//   2. meetings[], calls_planned, new_leads_target, focus — Claude
//      extracts the structured fields the WorkV2 morning plan form
//      already has manual inputs for. Voice fills them in one tap.
const SYSTEM = `You parse a sales rep's morning plan into structured fields.

The rep speaks/writes in Gujarati, Hindi, English, or any mix. Their description is informal — "આજે રાજેશભાઈ ને બાર વાગ્યે વડોદરામાં મળવા જવું છે, પછી 5 cold calls કરવી છે, અને Patel ne quote send કરવી છે, focus is close Sunrise deal" — extract everything you can.

Return JSON only, no commentary, with this exact shape:
{
  "transcript_corrected": "...",   // The rep's exact words, but rewritten in the SCRIPT specified by the 'language' field in the user message. If language='gu', emit Gujarati script (ગુજરાતી લિપિ). If language='hi', Devanagari. If language='en', Roman. Preserve word choice — only the script changes. If the input is already in the right script, return it unchanged.
  "meetings": [
    {
      "time": "12:00",     // 24-hour HH:MM if specified, else empty string
      "client": "Rajesh",  // person/company name, else empty string
      "where": "Vadodara"  // location if specified, else empty string
    }
  ],
  "calls_planned": 5,                // integer count of planned calls (0 if not mentioned)
  "new_leads_target": 0,             // integer count of new leads to add today (0 if not mentioned)
  "focus": "Close Sunrise deal",     // 1-line focus area in English (empty string if not mentioned)
  "tasks": [
    {
      "id": "t1",                     // sequential t1..tN
      "title": "Visit Rajesh in Vadodara",  // English, action-oriented, <= 60 chars
      "type": "meeting",              // one of: call | meeting | visit | quote | followup | other
      "due_time": "12:00",            // 24-hour HH:MM if specified, else null
      "done": false
    }
  ]
}

Rules:
- transcript_corrected: just script transliteration. NEVER add or remove words. NEVER translate to English. If language is unknown or 'auto', echo input unchanged.
- meetings: include every meeting the rep mentioned (max 5). If rep gave a time-only ("12 baje meeting"), client and where stay empty strings.
- calls_planned: only set if the rep said a number ("5 cold calls", "10 calls") or implied one ("call all hot leads" → 0; only set when rep gave an explicit count).
- new_leads_target: same — only when rep said a number.
- focus: 1 short line capturing the rep's primary goal of the day. English is fine even if input was Gujarati.
- tasks: max 8. Skip vague items. "5 cold calls" → ONE task with title "Make 5 cold calls", type 'call'. "Send quote to X" → 'quote'. "Follow up with X" → 'followup'. "Site visit Y" → 'visit'. "Meeting with X" → 'meeting'. Else 'other'.
- Preserve client / person names from the rep's text.
- If a time is given in input ("11 AM", "બાર વાગ્યે"), put it in HH:MM. "morning" / "after lunch" without specific hour → null/empty.

Return only valid JSON. No preamble, no trailing text.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const text = String(body?.text || '').trim()
    // Phase 31Y — caller passes language='gu' | 'hi' | 'en' so Claude
    // knows what script transcript_corrected should land in. Defaults
    // to 'auto' which means echo input unchanged.
    const language = String(body?.language || 'auto')
    if (!text) {
      return new Response(JSON.stringify({ error: 'text required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:       'claude-haiku-4-5-20251001',
        max_tokens:  2000,
        system:      SYSTEM,
        messages: [
          { role: 'user', content: `Today's date: ${new Date().toISOString().slice(0,10)}\nlanguage: ${language}\n\nRep's morning plan:\n${text}` },
        ],
      }),
    })

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text()
      return new Response(JSON.stringify({ error: `Claude API ${claudeRes.status}: ${errBody.slice(0, 200)}` }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const claudeJson = await claudeRes.json()
    const raw = claudeJson?.content?.[0]?.text || '{}'

    // Strip markdown code fences if Claude added them despite the
    // "JSON only" instruction.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch (_) {
      return new Response(JSON.stringify({ error: 'Claude returned non-JSON', raw: cleaned }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks.slice(0, 8) : []
    // Normalise + force done:false on output (paranoia).
    const safeTasks = tasks.map((t: any, i: number) => ({
      id:       String(t?.id || `t${i + 1}`),
      title:    String(t?.title || '').slice(0, 80),
      type:     ['call','meeting','visit','quote','followup','other'].includes(t?.type) ? t.type : 'other',
      due_time: typeof t?.due_time === 'string' && /^\d{1,2}:\d{2}$/.test(t.due_time) ? t.due_time : null,
      done:     false,
    })).filter((t: any) => t.title)

    // Phase 31Y — sanitise the new structured fields. We don't want a
    // hallucinated 'calls_planned: 999' to break the form so each
    // numeric is clamped, each string is bounded, and meetings get
    // capped at 5 entries.
    const safeMeetings = Array.isArray(parsed?.meetings)
      ? parsed.meetings.slice(0, 5).map((m: any) => ({
          time:   typeof m?.time   === 'string' && /^\d{1,2}:\d{2}$/.test(m.time) ? m.time : '',
          client: String(m?.client || '').slice(0, 80),
          where:  String(m?.where  || '').slice(0, 80),
        })).filter((m: any) => m.time || m.client || m.where)
      : []
    const callsPlanned    = Number.isFinite(Number(parsed?.calls_planned))
      ? Math.max(0, Math.min(200, Math.round(Number(parsed.calls_planned))))
      : 0
    const newLeadsTarget  = Number.isFinite(Number(parsed?.new_leads_target))
      ? Math.max(0, Math.min(200, Math.round(Number(parsed.new_leads_target))))
      : 0
    const focus           = String(parsed?.focus || '').slice(0, 200)
    const transcriptCorr  = typeof parsed?.transcript_corrected === 'string'
      ? parsed.transcript_corrected.slice(0, 4000)
      : text  // fall back to input unchanged if Claude didn't return one

    return new Response(JSON.stringify({
      tasks:                 safeTasks,
      meetings:              safeMeetings,
      calls_planned:         callsPlanned,
      new_leads_target:      newLeadsTarget,
      focus,
      transcript_corrected:  transcriptCorr,
    }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
