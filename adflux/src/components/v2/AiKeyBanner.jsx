// AiKeyBanner - red admin warning when the Claude API (WhatsApp AI) is failing:
// credit finished, key invalid/expired, or Claude overloaded. api/wa/ai-reply.js records each
// refusal in ai_failures (Phase 524). Shown for a failure in the last 24 h that no later AI reply
// has cleared (an outbound WhatsApp message after it = the AI is working again).
// Read-only, additive (section 45): two bounded SELECTs, null when healthy.
import { useState, useEffect } from 'react'
import { AlertTriangle, KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { openExternalUrl } from '../../utils/openExternal'

const BILLING_URL = 'https://platform.claude.com/settings/billing'

function whyText(f) {
  const d = String(f?.detail || '').toLowerCase()
  if (d.includes('credit balance')) return 'Claude credit is finished.'
  if (f?.http_status === 401 || d.includes('authentication') || d.includes('invalid x-api-key')) return 'The Claude API key is invalid or expired.'
  if (f?.http_status === 429) return 'Claude is rate-limiting requests.'
  if (f?.http_status >= 500) return 'Claude is temporarily unavailable.'
  return 'Claude refused the request (error ' + (f?.http_status || '?') + ').'
}

export default function AiKeyBanner() {
  const [fail, setFail] = useState(null)
  const [dismissed, setDismissed] = useState(() => { try { return sessionStorage.getItem('ai-key-dismissed') === '1' } catch { return false } })

  useEffect(() => {
    let alive = true
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    ;(async () => {
      const { data, error } = await supabase.from('ai_failures').select('id, at, http_status, detail')
        .gte('at', since).order('at', { ascending: false }).limit(1)
      if (error || !data || !data.length) return
      const f = data[0]
      const { data: ok } = await supabase.from('whatsapp_messages').select('id').eq('direction', 'out').gt('at', f.at).limit(1)
      if (alive && !(ok && ok.length)) setFail(f)
    })()
    return () => { alive = false }
  }, [])

  if (!fail || dismissed) return null
  return (
    <section className="v2d-banner" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.28)', borderRadius: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <AlertTriangle size={18} style={{ color: 'var(--danger, #ef4444)', flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={14} strokeWidth={1.6} />
          WhatsApp AI replies are failing
        </div>
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.6))' }}>
          {whyText(fail)} Customers are not getting AI replies until this is fixed.
        </div>
      </div>
      <button className="v2d-banner-cta" onClick={() => openExternalUrl(BILLING_URL)} style={{ flex: '0 0 auto' }}>Fix in Claude console</button>
      <button onClick={() => { try { sessionStorage.setItem('ai-key-dismissed', '1') } catch {} setDismissed(true) }}
        style={{ background: 'none', border: 'none', color: 'var(--v2-ink-2, rgba(255,255,255,.5))', cursor: 'pointer', fontSize: 12, flex: '0 0 auto' }}>Dismiss</button>
    </section>
  )
}
