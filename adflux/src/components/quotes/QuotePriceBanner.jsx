// src/components/quotes/QuotePriceBanner.jsx
//
// Phase 360 - the admin dashboard banner: "N quote prices waiting for approval".
// Self-contained (own head-count query + realtime) so the 18-query dashboard
// loader is untouched. Renders nothing when there is nothing to decide and
// nothing on a read failure.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PRICE_FLOOR } from '../../utils/quotePriceGate'

export default function QuotePriceBanner({ to = '/pending-approvals' }) {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)

  const load = useCallback(async () => {
    const { count: n, error } = await supabase
      .from('quote_price_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    if (!error) setCount(n || 0)
  }, [])

  useEffect(() => {
    load()
    let t = null
    let ch = null
    try {
      // unique topic per mount: supabase-js reuses a channel by topic, and a
      // remount before the old leave is acknowledged throws "subscribe multiple times"
      ch = supabase
        .channel(`qpa-banner-${Math.random().toString(36).slice(2, 9)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_price_approvals' }, () => {
          clearTimeout(t)
          t = setTimeout(load, 1500)   // collapse a burst of changes into one count
        })
        .subscribe()
    } catch { /* realtime unavailable - the count still loads on mount */ }
    return () => {
      clearTimeout(t)
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
    }
  }, [load])

  if (count <= 0) return null
  return (
    <section
      className="v2d-banner"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: 'var(--warning-soft, rgba(245,158,11,0.12))',
        border: '1px solid var(--warning, #F59E0B)',
        borderRadius: 'var(--radius-lg, 14px)',
        marginBottom: 16,
      }}
    >
      <span style={{ color: 'var(--warning, #F59E0B)', flex: '0 0 auto', display: 'inline-flex' }}>
        <ShieldAlert size={18} strokeWidth={1.6} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {count} quote price{count > 1 ? 's' : ''} waiting on approval
        </div>
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.6))' }}>
          A rep priced a screen below Rs {PRICE_FLOOR}. The quote cannot be sent until you decide.
        </div>
      </div>
      <button className="v2d-banner-cta" onClick={() => navigate(to)} style={{ flex: '0 0 auto' }}>
        Review
      </button>
    </section>
  )
}
