// WaBillingBanner — surfaces a WhatsApp Cloud API billing/eligibility failure to the
// admin as an inline banner (like the "payment waiting on approval" one), with a one-tap
// "Fix billing" link straight to the Meta billing page. Owner ask (2026-08-06): when a
// send fails on a payment issue (Meta error 131042 "Business eligibility payment issue"),
// don't leave it buried in the inbox — flag it up top so it gets fixed fast.
//
// Read-only, additive (§45): one bounded SELECT on whatsapp_messages (status='failed' +
// error_detail, §126 Phase 253). Renders null when there's no recent billing failure.
import { useState, useEffect } from 'react'
import { AlertTriangle, CreditCard } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { openExternalUrl } from '../../utils/openExternal'

// Stable Meta billing page for the marketing WABA (2870129030006085). The owner's
// copied link carried a SESSION token (external_flow_id=SU-...) that expires — dropped.
// payment_account + asset + business ids are stable → land on the same billing screen.
const META_BILLING_URL =
  'https://business.facebook.com/latest/billing_hub/accounts/details/?payment_account_id=2030445634235764&asset_id=2870129030006085&business_id=125328062238966'

export default function WaBillingBanner() {
  const [issue, setIssue] = useState(null)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('wa-billing-dismissed') === '1')

  useEffect(() => {
    let alive = true
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    supabase.from('whatsapp_messages')
      .select('id, error_detail, at')
      .eq('status', 'failed')
      // 131042 = business eligibility payment issue; also catch the generic payment/eligibility class.
      .or('error_detail.ilike.%131042%,error_detail.ilike.%payment%,error_detail.ilike.%eligibility%')
      .gte('at', since)
      .order('at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => { if (alive && !error && data && data.length) setIssue(data[0]) })
    return () => { alive = false }
  }, [])

  if (!issue || dismissed) return null
  return (
    <section
      className="v2d-banner"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.28)',
        borderRadius: 12,
        marginBottom: 16,
      }}
    >
      <AlertTriangle size={18} style={{ color: 'var(--danger, #ef4444)', flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <CreditCard size={14} strokeWidth={1.6} />
          WhatsApp sending is blocked — payment issue on your business number
        </div>
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.6))' }}>
          Meta error 131042 (business eligibility / payment). Add a valid card on the WhatsApp account to resume sending.
        </div>
      </div>
      <button
        className="v2d-banner-cta"
        onClick={() => openExternalUrl(META_BILLING_URL)}
        style={{ flex: '0 0 auto' }}
      >
        Fix billing
      </button>
      <button
        onClick={() => { sessionStorage.setItem('wa-billing-dismissed', '1'); setDismissed(true) }}
        style={{ background: 'none', border: 'none', color: 'var(--v2-ink-2, rgba(255,255,255,.5))', cursor: 'pointer', fontSize: 12, flex: '0 0 auto' }}
      >
        Dismiss
      </button>
    </section>
  )
}
