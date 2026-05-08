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

const SYSTEM = `You convert a sales rep's morning plan into a discrete actionable task list.

The rep speaks/writes in Gujarati, Hindi, English, or any mix. Their description is informal — "આજે રાજેશભાઈ ને મળવા જવું છે, પછી 5 cold calls કરવી છે, અને Patel ne quote send કરવી છે" — translate intent into clean English task titles.

Return JSON only, no commentary, with this exact shape:
{
  "tasks": [
    {
      "id": "t1",  // sequential t1..tN
      "title": "Visit Rajeshbhai for meeting",  // English, action-oriented, <= 60 chars
      "type": "meeting",  // one of: call | meeting | visit | quote | followup | other
      "due_time": "11:00",  // 24-hour HH:MM if rep specified a time, else null
      "done": false  // always false for newly-parsed tasks
    }
  ]
}

Rules:
- Max 8 tasks. If rep listed more, take the most concrete first.
- Skip vague items ("be productive", "stay positive") — only actionable.
- "5 cold calls" or similar batches → ONE task with title "Make 5 cold calls", type 'call'.
- "Send quote to X" → type 'quote'.
- "Follow up with X" → type 'followup'.
- "Site visit Y" → type 'visit'.
- "Meeting with X" / "go meet X" → type 'meeting'.
- Anything else → type 'other'.
- Preserve client / person names from the rep's text.
- If a time is given ("11 AM", "after lunch"), put it in due_time. "Morning"/"after lunch"/"evening" without specific hour → null.

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
          { role: 'user', content: `Today's date: ${new Date().toISOString().slice(0,10)}\n\nRep's morning plan:\n${text}` },
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

    return new Response(JSON.stringify({ tasks: safeTasks }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
