// Phase 181 — "Presentations this month" stat for My Performance.
// Self-fetching (like the other cards on the page). Reads the rep's
// presentation_sessions for the current IST month; hidden until they've
// presented at least once. Additive, read-only.
import { useState, useEffect } from 'react'
import { Presentation } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istCurrentMonthYM } from '../../utils/istDate'

function fmtTotal(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export default function PresentationStatCard() {
  const profile = useAuthStore((s) => s.profile)
  const [stat, setStat] = useState(null) // { count, totalSec }

  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    ;(async () => {
      const monthStart = `${istCurrentMonthYM()}-01`
      const { data, error } = await supabase
        .from('presentation_sessions')
        .select('duration_seconds')
        .eq('user_id', profile.id)
        .gte('started_at', monthStart)
        .not('duration_seconds', 'is', null)
      if (cancelled || error || !data) return
      const totalSec = data.reduce((s, r) => s + (r.duration_seconds || 0), 0)
      setStat({ count: data.length, totalSec })
    })()
    return () => {
      cancelled = true
    }
  }, [profile?.id])

  if (!stat || stat.count === 0) return null

  return (
    <div
      style={{
        marginTop: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        borderRadius: 14,
        background: 'var(--surface, #1e293b)',
        border: '1px solid var(--border, #334155)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 42,
          height: 42,
          borderRadius: 12,
          flex: '0 0 auto',
          background: 'var(--accent-soft, rgba(255,230,0,0.14))',
          color: 'var(--accent, #FFE600)',
        }}
      >
        <Presentation size={20} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>
          Presentations this month
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle, #64748b)' }}>
          {stat.count} session{stat.count === 1 ? '' : 's'} · total time on the deck
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div
          className="tabular-nums"
          style={{
            fontFamily: 'var(--font-display, "Space Grotesk", system-ui)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text, #f1f5f9)',
            lineHeight: 1,
          }}
        >
          {fmtTotal(stat.totalSec)}
        </div>
        <div className="tabular-nums" style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
          {stat.count}&times;
        </div>
      </div>
    </div>
  )
}
