// supabase/functions/scorecard/index.ts
//
// Phase 1.5 — Individual Daily Scorecard at 7:30 PM.
//
// Sends a personalized WhatsApp to each active sales/telecaller user
// with their day's counters vs targets and rank vs team.
//
// Cron config: 0 0 14 * * *  (14:00 UTC = 19:30 IST)

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SR_KEY        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const META_TOKEN    = Deno.env.get('META_WABA_ACCESS_TOKEN')
const META_PHONE_ID = Deno.env.get('META_WABA_PHONE_NUMBER_ID')

const supa = createClient(SUPABASE_URL, SR_KEY)

serve(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10)

    // Pull all active sales+telecaller users with their targets + today's session.
    const { data: users } = await supa
      .from('users')
      .select('id, name, daily_targets, signature_mobile, team_role')
      .eq('is_active', true)
      .in('team_role', ['sales','telecaller','sales_manager','agency'])

    if (!users) return new Response('No users', { status: 200 })

    const { data: sessions } = await supa
      .from('work_sessions')
      .select('user_id, daily_counters, check_in_at')
      .eq('work_date', today)

    const sessionByUser = new Map((sessions || []).map(s => [s.user_id, s]))

    // Compute total revenue scoring per user (won quotes today + prior month)
    const { data: payments } = await supa
      .from('payments')
      .select('quote_id, amount_received, approval_status, payment_date, quotes!inner(created_by)')
      .eq('approval_status', 'approved')
      .gte('payment_date', isoMonthStart())

    const revenueByUser = new Map<string, number>()
    ;(payments || []).forEach((p: any) => {
      const uid = p.quotes?.created_by
      if (uid) revenueByUser.set(uid, (revenueByUser.get(uid) || 0) + Number(p.amount_received || 0))
    })

    // Rank users by today's calls + meetings combined.
    const ranked = users.map(u => {
      const sess = sessionByUser.get(u.id)
      const c = sess?.daily_counters || {}
      const score = (c.calls || 0) + (c.meetings || 0) * 3 + (c.new_leads || 0) * 2
      return { ...u, counters: c, score, checkedIn: !!sess?.check_in_at, mtdRevenue: revenueByUser.get(u.id) || 0 }
    }).sort((a, b) => b.score - a.score)

    let sent = 0, skipped = 0
    for (let i = 0; i < ranked.length; i++) {
      const u = ranked[i]
      if (!u.signature_mobile) { skipped++; continue }
      const targets = u.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
      const c = u.counters
      const message = formatScorecard(u, targets, i + 1, ranked.length)

      if (META_TOKEN && META_PHONE_ID) {
        await sendWhatsApp(u.signature_mobile, message)
        sent++
      } else {
        console.log(`[scorecard] would send to ${u.name} (${u.signature_mobile}):\n${message}`)
      }
    }

    await supa.from('ai_runs').insert([{
      run_type: 'scorecard',
      input_json: { date: today, user_count: ranked.length },
      output_json: { sent, skipped },
      model: 'rule-based',
      success: true,
    }]).then(() => null, () => null)

    return new Response(JSON.stringify({ ok: true, sent, skipped }))
  } catch (e) {
    console.error('[scorecard] FATAL:', e)
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

function formatScorecard(u: any, targets: any, rank: number, total: number): string {
  const c = u.counters
  const hit = (val: number, t: number) => val >= t
  const meetings = `${hit(c.meetings || 0, targets.meetings) ? '✅' : '⚠️'} Meetings ${c.meetings || 0}/${targets.meetings}`
  const calls    = `${hit(c.calls || 0, targets.calls) ? '✅' : '⚠️'} Calls ${c.calls || 0}/${targets.calls}`
  const leads    = `${hit(c.new_leads || 0, targets.new_leads) ? '✅' : '⚠️'} New leads ${c.new_leads || 0}/${targets.new_leads}`

  const rankEmoji = rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#'

  return [
    `🎯 ${u.name} — ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`,
    meetings,
    calls,
    leads,
    `${rankEmoji} Rank ${rank} of ${total} on activity`,
    `💰 MTD revenue: ₹${(u.mtdRevenue / 100000).toFixed(2)}L`,
    !u.checkedIn ? '❌ No check-in today — submit morning plan tomorrow.' : '',
  ].filter(Boolean).join('\n')
}

async function sendWhatsApp(toNumber: string, body: string) {
  const cleaned = String(toNumber).replace(/\D/g, '')
  const phone = cleaned.length === 10 ? '91' + cleaned : cleaned
  const url = `https://graph.facebook.com/v20.0/${META_PHONE_ID}/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body },
    }),
  })
  if (!res.ok) console.error('[scorecard] WABA send failed:', await res.text())
}

function isoMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}
