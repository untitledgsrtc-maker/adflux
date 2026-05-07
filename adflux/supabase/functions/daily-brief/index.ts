// supabase/functions/daily-brief/index.ts
//
// Phase 1.5 — daily owner WhatsApp brief at 9 AM and 7:30 PM.
//
// Cron config (set in Supabase Studio → Database → Cron):
//   9:00 AM IST  →  0 30 3 * * *   (3:30 UTC = 9:00 IST)
//   7:30 PM IST  →  0 0 14 * * *   (14:00 UTC = 19:30 IST)
//
// Required env vars:
//   ANTHROPIC_API_KEY         — for the LLM-formatted message
//   META_WABA_PHONE_NUMBER_ID — your WhatsApp Business phone number ID
//   META_WABA_ACCESS_TOKEN    — Meta Cloud API access token
//   OWNER_WHATSAPP_NUMBER     — Brijesh's WhatsApp number (no '+', e.g. '919428273686')
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided
//
// Deploy: supabase functions deploy daily-brief --no-verify-jwt
// Schedule: see cron config above.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SR_KEY        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const META_TOKEN    = Deno.env.get('META_WABA_ACCESS_TOKEN')
const META_PHONE_ID = Deno.env.get('META_WABA_PHONE_NUMBER_ID')
const OWNER_NUMBER  = Deno.env.get('OWNER_WHATSAPP_NUMBER')

const supa = createClient(SUPABASE_URL, SR_KEY)

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const slot = url.searchParams.get('slot') || 'morning'  // morning | evening
    const today = new Date().toISOString().slice(0, 10)
    const startOfDay = `${today}T00:00:00`

    // 1. Pull aggregates
    const [
      yesterdayPaymentsRes,
      mtdQuotesRes,
      pipelineRes,
      teamRes,
      sessionsRes,
      slaRes,
      noCheckInTeamRes,
    ] = await Promise.all([
      supa.from('payments').select('amount_received, payment_date').gte('payment_date', isoDaysAgo(1)).lt('payment_date', today).eq('approval_status', 'approved'),
      supa.from('quotes').select('total_amount, status, created_at').gte('created_at', isoMonthStart()),
      supa.from('leads').select('stage, expected_value'),
      supa.from('users').select('id, name, team_role').eq('is_active', true).in('team_role', ['sales','telecaller','sales_manager','agency']),
      supa.from('work_sessions').select('user_id, check_in_at, daily_counters').eq('work_date', today),
      // Phase 30A — SalesReady stage removed. SLA breach = any
      // active lead with handoff_sla_due_at in the past.
      supa.from('leads').select('id').not('stage', 'in', '(Won,Lost)').lt('handoff_sla_due_at', new Date().toISOString()),
      supa.from('users').select('id, name, team_role').eq('is_active', true).in('team_role', ['sales','telecaller','sales_manager','agency']),
    ])

    const yesterdayCollection = (yesterdayPaymentsRes.data || []).reduce((s, p) => s + Number(p.amount_received || 0), 0)
    const mtdRevenue = (mtdQuotesRes.data || []).filter(q => q.status === 'won').reduce((s, q) => s + Number(q.total_amount || 0), 0)
    const pipelineValue = (pipelineRes.data || []).filter(l => !['Won','Lost'].includes(l.stage)).reduce((s, l) => s + Number(l.expected_value || 0), 0)

    const checkedInIds = new Set((sessionsRes.data || []).filter(s => s.check_in_at).map(s => s.user_id))
    const noCheckIn = (noCheckInTeamRes.data || []).filter(u => !checkedInIds.has(u.id))

    const totalActivities = (sessionsRes.data || []).reduce((s, ws) => {
      const c = ws.daily_counters || {}
      return {
        meetings: s.meetings + (c.meetings || 0),
        calls:    s.calls    + (c.calls || 0),
        leads:    s.leads    + (c.new_leads || 0),
      }
    }, { meetings: 0, calls: 0, leads: 0 })

    const slaBreaches = (slaRes.data || []).length

    const data = {
      slot,
      date: today,
      yesterday_collection_inr: yesterdayCollection,
      mtd_revenue_inr: mtdRevenue,
      pipeline_value_inr: pipelineValue,
      team_total: (teamRes.data || []).length,
      checked_in: checkedInIds.size,
      no_checkin: noCheckIn.map(u => u.name),
      total_meetings: totalActivities.meetings,
      total_calls: totalActivities.calls,
      total_new_leads: totalActivities.leads,
      sla_breaches: slaBreaches,
    }

    // 2. Format the message via Claude (LLM picks format)
    let message = ''
    if (ANTHROPIC_KEY) {
      message = await llmFormat(data)
    } else {
      message = ruleBasedFormat(data)
    }

    // 3. Log the run
    await supa.from('ai_runs').insert([{
      run_type: 'daily_brief_' + slot,
      input_json: data,
      output_json: { message },
      model: ANTHROPIC_KEY ? 'claude-haiku-4-5' : 'rule-based',
      success: true,
    }]).then(() => null, () => null)

    // 4. Send via Meta WABA
    if (META_TOKEN && META_PHONE_ID && OWNER_NUMBER) {
      await sendWhatsApp(OWNER_NUMBER, message)
    } else {
      console.log('[daily-brief] WABA env not set — message logged only:')
      console.log(message)
    }

    return new Response(JSON.stringify({ ok: true, message }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    console.error('[daily-brief] FATAL:', e)
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

async function llmFormat(data: any): Promise<string> {
  const prompt = data.slot === 'morning'
    ? `Format the morning ops brief for Brijesh (owner of Untitled Advertising, Vadodara). Use this structure:

📊 UNTITLED — ${data.date}
💰 Yesterday's collection: ₹${(data.yesterday_collection_inr / 100000).toFixed(2)}L
📈 MTD revenue: ₹${(data.mtd_revenue_inr / 100000).toFixed(2)}L
📋 Pipeline value: ₹${(data.pipeline_value_inr / 100000).toFixed(2)}L
👥 Team: ${data.checked_in}/${data.team_total} checked in
${data.sla_breaches > 0 ? `⚠️ ${data.sla_breaches} SLA breaches on Sales Ready leads` : ''}
${data.no_checkin.length > 0 ? `❌ Missing check-in: ${data.no_checkin.slice(0,5).join(', ')}` : ''}

Rewrite this in Hinglish (Gujarati script can be used) for thumb-scroll readability. Max 280 words. Add a Top 3 Attention section if relevant. Return only the message text, no preamble.`
    : `Format the end-of-day ops brief for Brijesh. Today's totals:

📊 UNTITLED — EOD ${data.date}
👥 ${data.checked_in}/${data.team_total} checked in
🤝 ${data.total_meetings} meetings · ${data.total_calls} calls · ${data.total_new_leads} new leads
${data.sla_breaches > 0 ? `⚠️ ${data.sla_breaches} SLA breaches still open` : ''}
${data.no_checkin.length > 0 ? `❌ Missed check-in today: ${data.no_checkin.slice(0,5).join(', ')}` : ''}

Rewrite in Hinglish for thumb-scroll readability. Max 280 words. Single message.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) return ruleBasedFormat(data)
  const j = await res.json()
  return j?.content?.[0]?.text || ruleBasedFormat(data)
}

function ruleBasedFormat(data: any): string {
  const eod = data.slot === 'evening'
  return [
    `📊 UNTITLED — ${eod ? 'EOD ' : ''}${data.date}`,
    `💰 Yesterday: ₹${(data.yesterday_collection_inr / 100000).toFixed(2)}L collected`,
    `📈 MTD: ₹${(data.mtd_revenue_inr / 100000).toFixed(2)}L | Pipeline: ₹${(data.pipeline_value_inr / 100000).toFixed(2)}L`,
    `👥 Team: ${data.checked_in}/${data.team_total} checked in`,
    eod ? `📞 ${data.total_meetings} meetings · ${data.total_calls} calls · ${data.total_new_leads} leads` : '',
    data.sla_breaches > 0 ? `⚠️ ${data.sla_breaches} SLA breaches on Sales Ready leads` : '',
    data.no_checkin.length > 0 ? `❌ No check-in: ${data.no_checkin.slice(0,5).join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

async function sendWhatsApp(toNumber: string, body: string) {
  const url = `https://graph.facebook.com/v20.0/${META_PHONE_ID}/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'text',
      text: { body },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error('[daily-brief] WABA send failed:', text)
  }
}

function isoDaysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function isoMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}
