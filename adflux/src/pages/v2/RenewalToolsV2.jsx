// src/pages/v2/RenewalToolsV2.jsx
//
// Shared admin + sales page. Admin sees every won quote; sales sees only
// their own. Two tabs:
//   • Renewing — won quotes ending in the next 60 days. The 3-bucket
//     colour code (<7 red, <30 amber, else green) is preserved because
//     the team uses it at a glance.
//   • Expired (Phase 105) — won quotes whose campaign_end_date is already
//     in the past (renewal lapsed). Owner: "which campaign won and
//     expired the duration, ALL campaign must show + date filter." No
//     upper bound by default; an optional date filter on the expiry date
//     narrows the range. Newest-expired first.
//
// Rendered inside V2AppShell so this file only paints the body.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, ArrowUpRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatDate, formatCurrency, todayISO, addDaysISO } from '../../utils/formatters'
import { setPendingRenewalOf } from '../../lib/quoteIntent'
import V2Hero from '../../components/v2/V2Hero'
// Phase 105.1 — branded date-range picker (same one LeadsV2 uses) instead
// of raw native <input type="date"> (which rendered the off-brand white OS
// calendar). Owner flagged the brand violation.
import DateRangeFilter, { presetToRange } from '../../components/v2/DateRangeFilter'

// Phase 108 — media_type → card label + unit word for the Active tab.
const MEDIA = {
  AUTO_HOOD:   { label: 'Auto-rickshaw', unit: 'units' },
  GSRTC_LED:   { label: 'GSRTC',         unit: 'stations' },
  HOARDING:    { label: 'Hoarding',      unit: 'sites' },
  LED_OTHER:   { label: 'LED',           unit: 'units' },
  MALL:        { label: 'Mall',          unit: 'sites' },
  CINEMA:      { label: 'Cinema',        unit: 'screens' },
  DIGITAL:     { label: 'Digital',       unit: 'spots' },
  OTHER_MEDIA: { label: 'Other media',   unit: 'units' },
}

export default function RenewalToolsV2() {
  const navigate = useNavigate()
  const { profile, isAdmin, isPrivileged } = useAuth()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  // Phase 105 — Expired Campaigns tab.
  const [tab, setTab] = useState('renewing')        // 'renewing' | 'expired'
  const [expired, setExpired] = useState([])
  const [expiredLoading, setExpiredLoading] = useState(false)
  // Default 'all time' = every expired campaign; presets narrow by expiry date.
  const [expRange, setExpRange] = useState(() => presetToRange('all'))

  // Phase 108 — Active campaigns tab (won, currently running or starting soon).
  const [active, setActive] = useState([])
  const [activeLoading, setActiveLoading] = useState(false)

  const today = todayISO()
  const future60 = addDaysISO(60)

  useEffect(() => {
    if (profile?.id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, isAdmin, isPrivileged])

  // Phase 105 — load expired list when its tab is active (or its filter
  // changes). Kept separate from the renewing load so the renewing path
  // is byte-unchanged.
  useEffect(() => {
    if (tab === 'expired' && profile?.id) loadExpired()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, expRange, profile?.id, isPrivileged])

  // Phase 108 — load active campaigns when its tab opens.
  useEffect(() => {
    if (tab === 'active' && profile?.id) loadActive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profile?.id, isPrivileged])

  async function load() {
    setLoading(true)
    // Phase 62.5 — drop the users(name) FK embed (null-payloads under some
    // RLS/cache combos), fetch names in a second query + merge.
    let q = supabase
      .from('quotes')
      .select('id, quote_number, client_name, campaign_end_date, created_by, total_amount')
      .eq('status', 'won')
      .gte('campaign_end_date', today)
      .lte('campaign_end_date', future60)
      .order('campaign_end_date', { ascending: true })

    if (!isPrivileged) q = q.eq('created_by', profile.id)

    const { data: qRows, error: qErr } = await q
    if (qErr) {
      console.warn('[renewal-tools] quotes query failed:', qErr.message)
      setQuotes([])
      setLoading(false)
      return
    }

    let rows = qRows || []
    if (isPrivileged && rows.length > 0) {
      const ids = Array.from(new Set(rows.map(r => r.created_by).filter(Boolean)))
      if (ids.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, name')
          .in('id', ids)
        const byId = Object.fromEntries((users || []).map(u => [u.id, u.name]))
        rows = rows.map(r => ({ ...r, users: { name: byId[r.created_by] || '—' } }))
      }
    }

    setQuotes(rows)
    setLoading(false)
  }

  // Phase 105 — expired campaigns: won, campaign_end_date < today. Same
  // privilege scope + two-query name merge as `load`.
  async function loadExpired() {
    setExpiredLoading(true)
    let q = supabase
      .from('quotes')
      .select('id, quote_number, client_name, campaign_start_date, campaign_end_date, gsrtc_campaign_months, created_by, total_amount')
      .eq('status', 'won')
      .lt('campaign_end_date', today)
    // Narrow by expiry date when a non-'all' preset/range is active.
    if (expRange?.preset && expRange.preset !== 'all') {
      if (expRange.from) q = q.gte('campaign_end_date', expRange.from)
      if (expRange.to)   q = q.lte('campaign_end_date', expRange.to)
    }
    q = q.order('campaign_end_date', { ascending: false })   // most recently expired first

    if (!isPrivileged) q = q.eq('created_by', profile.id)

    const { data: qRows, error: qErr } = await q
    if (qErr) {
      console.warn('[renewal-tools] expired query failed:', qErr.message)
      setExpired([])
      setExpiredLoading(false)
      return
    }

    let rows = qRows || []
    if (isPrivileged && rows.length > 0) {
      const ids = Array.from(new Set(rows.map(r => r.created_by).filter(Boolean)))
      if (ids.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, name')
          .in('id', ids)
        const byId = Object.fromEntries((users || []).map(u => [u.id, u.name]))
        rows = rows.map(r => ({ ...r, users: { name: byId[r.created_by] || '—' } }))
      }
    }

    setExpired(rows)
    setExpiredLoading(false)
  }

  // Phase 108 — won campaigns running now or starting within 14 days.
  // Same privilege scope + two-query name merge. Unit counts come from
  // quote_cities (one extra query, merged client-side).
  async function loadActive() {
    setActiveLoading(true)
    let q = supabase
      .from('quotes')
      .select('id, quote_number, client_name, media_type, campaign_start_date, campaign_end_date, created_by, total_amount')
      .eq('status', 'won')
      .not('campaign_start_date', 'is', null)
      .lte('campaign_start_date', addDaysISO(14))
      .gte('campaign_end_date', today)
      .order('campaign_end_date', { ascending: true })
    if (!isPrivileged) q = q.eq('created_by', profile.id)

    const { data: qRows, error: qErr } = await q
    if (qErr) {
      console.warn('[renewal-tools] active query failed:', qErr.message)
      setActive([])
      setActiveLoading(false)
      return
    }
    let rows = qRows || []

    // Unit counts (number of quote_cities rows per campaign).
    if (rows.length > 0) {
      const ids = rows.map(r => r.id)
      const { data: cities } = await supabase
        .from('quote_cities')
        .select('quote_id')
        .in('quote_id', ids)
      const cnt = {}
      ;(cities || []).forEach(c => { cnt[c.quote_id] = (cnt[c.quote_id] || 0) + 1 })
      rows = rows.map(r => ({ ...r, unit_count: cnt[r.id] || 0 }))
    }

    if (isPrivileged && rows.length > 0) {
      const uids = Array.from(new Set(rows.map(r => r.created_by).filter(Boolean)))
      if (uids.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, name')
          .in('id', uids)
        const byId = Object.fromEntries((users || []).map(u => [u.id, u.name]))
        rows = rows.map(r => ({ ...r, users: { name: byId[r.created_by] || '—' } }))
      }
    }

    setActive(rows)
    setActiveLoading(false)
  }

  // Phase 108 — campaign status + progress for a won campaign.
  //   SOON   = not started yet (start > today)
  //   ENDING = running, <= 7 days left   (rose)
  //   LIVE   = running, > 7 days left     (green)
  function campaignStatus(q) {
    const dEnd   = daysRemaining(q.campaign_end_date)
    const dStart = q.campaign_start_date ? daysRemaining(q.campaign_start_date) : 0
    let pct = 0
    if (q.campaign_start_date && q.campaign_end_date) {
      const s = new Date(q.campaign_start_date).getTime()
      const e = new Date(q.campaign_end_date).getTime()
      const n = new Date(today).getTime()
      pct = e > s ? Math.max(0, Math.min(100, Math.round(((n - s) / (e - s)) * 100))) : 0
    }
    if (dStart > 0) return { key: 'SOON',   tone: 'var(--warning, #F59E0B)', soft: 'var(--warning-soft, rgba(245,158,11,0.12))', pct: 0, daysLeft: dEnd }
    if (dEnd <= 7)  return { key: 'ENDING', tone: 'var(--danger, #EF4444)',  soft: 'var(--danger-soft, rgba(239,68,68,0.12))',   pct,    daysLeft: dEnd }
    return { key: 'LIVE', tone: 'var(--success, #10B981)', soft: 'var(--success-soft, rgba(16,185,129,0.12))', pct, daysLeft: dEnd }
  }

  function daysRemaining(endDate) {
    const end = new Date(endDate)
    const now = new Date(today)
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
  }

  // Phase 105 — positive whole days since a past end date.
  function daysAgo(endDate) {
    return Math.max(0, -daysRemaining(endDate))
  }

  // Phase 105 — campaign duration label: "1 Apr 26 → 30 Jun 26" when both
  // dates exist, else fall back to the stored month count.
  function durationLabel(q) {
    if (q.campaign_start_date && q.campaign_end_date) {
      return `${formatDate(q.campaign_start_date)} → ${formatDate(q.campaign_end_date)}`
    }
    if (q.gsrtc_campaign_months) return `${q.gsrtc_campaign_months} mo`
    return q.campaign_end_date ? `ends ${formatDate(q.campaign_end_date)}` : '—'
  }

  // Phase 159 — tapping a campaign card opens its quote. Govt media routes
  // to /proposal/:id, private (LED / other media) to /quotes/:id (§10).
  function quoteRoute(q) {
    return (q.media_type === 'AUTO_HOOD' || q.media_type === 'GSRTC_LED')
      ? `/proposal/${q.id}`
      : `/quotes/${q.id}`
  }

  function bucketFor(days) {
    if (days < 7)  return 'hot'
    if (days < 30) return 'warm'
    return 'cool'
  }

  const bucketStats = {
    hot:  quotes.filter(q => daysRemaining(q.campaign_end_date) < 7).length,
    warm: quotes.filter(q => {
      const d = daysRemaining(q.campaign_end_date)
      return d >= 7 && d < 30
    }).length,
    cool: quotes.filter(q => daysRemaining(q.campaign_end_date) >= 30).length,
  }

  // Phase 35.1 pass 2 — hero stats for V2Hero.
  const totalRenewing = bucketStats.hot + bucketStats.warm + bucketStats.cool
  // % "safe" (>= 30 days out). Inverted urgency — higher = better.
  const safePct = totalRenewing > 0
    ? Math.round((bucketStats.cool / totalRenewing) * 100)
    : 100

  const tabBtn = (k) => ({
    padding: '8px 16px',
    borderRadius: 999,
    border: `1px solid ${tab === k ? 'var(--accent, #FFE600)' : 'var(--border, #334155)'}`,
    background: tab === k ? 'var(--accent, #FFE600)' : 'transparent',
    color: tab === k ? 'var(--accent-fg, #0f172a)' : 'var(--text-muted, #94a3b8)',
    fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div className="v2d-rt">
      {tab === 'renewing' && totalRenewing > 0 && (
        <V2Hero
          eyebrow={isAdmin ? 'Renewals · 60 days' : 'Your renewals'}
          value={String(totalRenewing)}
          label={`campaign${totalRenewing === 1 ? '' : 's'} ending in 60 days`}
          percent={safePct}
          footerStats={[
            { label: '<7d',     value: bucketStats.hot,  tint: '#FF6F61' },
            { label: '7-30d',   value: bucketStats.warm, tint: 'var(--accent, #FFE600)' },
            { label: '30-60d',  value: bucketStats.cool, tint: '#2BD8A0' },
          ]}
          accent={bucketStats.hot === 0}
        />
      )}
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">Keep revenue recurring</div>
          <h1 className="v2d-page-title">Renewal Tools</h1>
          <div className="v2d-page-sub">
            {tab === 'expired'
              ? (isAdmin ? 'Won campaigns whose duration has ended — across all reps.'
                         : 'Your won campaigns whose duration has ended.')
              : (isAdmin ? 'Campaigns ending in the next 60 days across all reps.'
                         : 'Your campaigns ending in the next 60 days.')}
          </div>
        </div>
      </div>

      {/* Phase 105 — tab toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" style={tabBtn('renewing')} onClick={() => setTab('renewing')}>
          Renewing · 60d
        </button>
        <button type="button" style={tabBtn('active')} onClick={() => setTab('active')}>
          Active
        </button>
        <button type="button" style={tabBtn('expired')} onClick={() => setTab('expired')}>
          Expired
        </button>
      </div>

      {tab === 'renewing' ? (
        <>
          {/* Bucket KPIs */}
          <div className="v2d-rt-kpis">
            <div className="v2d-panel v2d-rt-kpi v2d-rt-kpi--hot">
              <div className="v2d-rt-kpi-l">Under 7 days</div>
              <div className="v2d-rt-kpi-v">{bucketStats.hot}</div>
              <div className="v2d-rt-kpi-s">call today</div>
            </div>
            <div className="v2d-panel v2d-rt-kpi v2d-rt-kpi--warm">
              <div className="v2d-rt-kpi-l">7 – 30 days</div>
              <div className="v2d-rt-kpi-v">{bucketStats.warm}</div>
              <div className="v2d-rt-kpi-s">start renewal convo</div>
            </div>
            <div className="v2d-panel v2d-rt-kpi v2d-rt-kpi--cool">
              <div className="v2d-rt-kpi-l">30 – 60 days</div>
              <div className="v2d-rt-kpi-v">{bucketStats.cool}</div>
              <div className="v2d-rt-kpi-s">queue up</div>
            </div>
          </div>

          {loading ? (
            <div className="v2d-loading"><div className="v2d-spinner" />Loading…</div>
          ) : quotes.length === 0 ? (
            <div className="v2d-panel v2d-empty-card">
              <div className="v2d-empty-ic"><Calendar size={22} /></div>
              <div className="v2d-empty-t">Nothing due</div>
              <div className="v2d-empty-s">
                {isAdmin
                  ? 'No campaigns ending in the next 60 days.'
                  : 'None of your clients have campaigns ending in the next 60 days.'}
              </div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="v2d-panel v2d-table-wrap">
                <table className="v2d-qt">
                  <thead>
                    <tr>
                      <th>Quote #</th>
                      <th>Client</th>
                      {isAdmin && <th>Sales Person</th>}
                      <th>Value</th>
                      <th>End Date</th>
                      <th>Remaining</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map(q => {
                      const days = daysRemaining(q.campaign_end_date)
                      const bucket = bucketFor(days)
                      return (
                        <tr key={q.id}>
                          <td><strong>{q.quote_number}</strong></td>
                          <td>{q.client_name}</td>
                          {isAdmin && <td className="v2d-muted">{q.users?.name || '—'}</td>}
                          <td>{q.total_amount ? formatCurrency(q.total_amount) : '—'}</td>
                          <td>{formatDate(q.campaign_end_date)}</td>
                          <td>
                            <span className={`v2d-rt-days v2d-rt-days--${bucket}`}>
                              {days} day{days !== 1 ? 's' : ''}
                            </span>
                          </td>
                          <td>
                            <button
                              className="v2d-btn v2d-btn--primary v2d-btn--sm"
                              onClick={() => navigate(`/quotes/renew/${q.id}`)}
                            >
                              <Plus size={13} /><span>Renew</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="v2d-rt-list">
                {quotes.map(q => {
                  const days = daysRemaining(q.campaign_end_date)
                  const bucket = bucketFor(days)
                  return (
                    <div key={q.id} className="v2d-panel v2d-rt-card">
                      <div className="v2d-rt-card-top">
                        <div className="v2d-rt-card-client">{q.client_name}</div>
                        <span className={`v2d-rt-days v2d-rt-days--${bucket}`}>
                          {days}d
                        </span>
                      </div>
                      <div className="v2d-rt-card-meta">
                        <span>{q.quote_number}</span>
                        <span>· Ends {formatDate(q.campaign_end_date)}</span>
                        {q.total_amount && <span>· {formatCurrency(q.total_amount)}</span>}
                      </div>
                      {isAdmin && (
                        <div className="v2d-rt-card-sub">Rep: {q.users?.name || '—'}</div>
                      )}
                      <button
                        className="v2d-btn v2d-btn--primary v2d-rt-card-cta"
                        onClick={() => navigate(`/quotes/renew/${q.id}`)}
                      >
                        <Plus size={13} /><span>Create Renewal</span>
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      ) : tab === 'expired' ? (
        /* ── Phase 105 — Expired tab ── */
        <>
          {/* Phase 105.1 — branded DateRangeFilter (filters by expiry date) */}
          <div style={{
            display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>
              Expired in
            </span>
            <DateRangeFilter value={expRange} onChange={setExpRange} />
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>
              {expired.length} expired
            </span>
          </div>

          {expiredLoading ? (
            <div className="v2d-loading"><div className="v2d-spinner" />Loading…</div>
          ) : expired.length === 0 ? (
            <div className="v2d-panel v2d-empty-card">
              <div className="v2d-empty-ic"><Calendar size={22} /></div>
              <div className="v2d-empty-t">No expired campaigns</div>
              <div className="v2d-empty-s">
                {(expRange?.preset && expRange.preset !== 'all')
                  ? 'No won campaigns expired in this date range.'
                  : (isAdmin ? 'No won campaign has reached its end date yet.'
                             : 'None of your won campaigns have ended yet.')}
              </div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="v2d-panel v2d-table-wrap">
                <table className="v2d-qt">
                  <thead>
                    <tr>
                      <th>Quote #</th>
                      <th>Client</th>
                      {isAdmin && <th>Sales Person</th>}
                      <th>Value</th>
                      <th>Duration</th>
                      <th>Expired</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expired.map(q => (
                      <tr key={q.id}>
                        <td><strong>{q.quote_number}</strong></td>
                        <td>{q.client_name}</td>
                        {isAdmin && <td className="v2d-muted">{q.users?.name || '—'}</td>}
                        <td>{q.total_amount ? formatCurrency(q.total_amount) : '—'}</td>
                        <td className="v2d-muted">{durationLabel(q)}</td>
                        <td>
                          <span className="v2d-rt-days v2d-rt-days--hot">
                            {daysAgo(q.campaign_end_date)} day{daysAgo(q.campaign_end_date) !== 1 ? 's' : ''} ago
                          </span>
                        </td>
                        <td>
                          <button
                            className="v2d-btn v2d-btn--primary v2d-btn--sm"
                            onClick={() => navigate(`/quotes/renew/${q.id}`)}
                          >
                            <Plus size={13} /><span>Renew</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="v2d-rt-list">
                {expired.map(q => (
                  <div key={q.id} className="v2d-panel v2d-rt-card">
                    <div className="v2d-rt-card-top">
                      <div className="v2d-rt-card-client">{q.client_name}</div>
                      <span className="v2d-rt-days v2d-rt-days--hot">
                        {daysAgo(q.campaign_end_date)}d ago
                      </span>
                    </div>
                    <div className="v2d-rt-card-meta">
                      <span>{q.quote_number}</span>
                      <span>· {durationLabel(q)}</span>
                      {q.total_amount && <span>· {formatCurrency(q.total_amount)}</span>}
                    </div>
                    {isAdmin && (
                      <div className="v2d-rt-card-sub">Rep: {q.users?.name || '—'}</div>
                    )}
                    <button
                      className="v2d-btn v2d-btn--primary v2d-rt-card-cta"
                      onClick={() => navigate(`/quotes/renew/${q.id}`)}
                    >
                      <Plus size={13} /><span>Create Renewal</span>
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        /* ── Phase 108 — Active campaigns tab ── */
        <>
          {activeLoading ? (
            <div className="v2d-loading"><div className="v2d-spinner" />Loading…</div>
          ) : active.length === 0 ? (
            <div className="v2d-panel v2d-empty-card">
              <div className="v2d-empty-ic"><Calendar size={22} /></div>
              <div className="v2d-empty-t">No active campaigns</div>
              <div className="v2d-empty-s">
                {isAdmin
                  ? 'No won campaign is running right now.'
                  : 'None of your campaigns are running right now.'}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12,
            }}>
              {active.map(q => {
                const st = campaignStatus(q)
                const media = MEDIA[q.media_type] || { label: q.media_type || 'Campaign', unit: 'units' }
                return (
                  <div key={q.id} className="v2d-panel" style={{
                    padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
                    cursor: 'pointer',
                  }}
                    onClick={() => navigate(quoteRoute(q))}
                    role="button" tabIndex={0}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                        textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999,
                        color: st.tone, background: st.soft,
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: st.tone }} />
                        {st.key}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                        {st.key === 'SOON'
                          ? `starts in ${Math.abs(daysRemaining(q.campaign_start_date))}d`
                          : `${st.daysLeft}d left`}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
                      textTransform: 'uppercase', color: 'var(--text-subtle, #64748b)',
                    }}>
                      {media.label}{q.unit_count ? ` · ${q.unit_count} ${media.unit}` : ''}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>
                      {q.client_name}
                    </div>
                    {isAdmin && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                        {q.users?.name || '—'}
                      </div>
                    )}
                    <div style={{
                      fontFamily: 'var(--font-display, "Space Grotesk")',
                      fontSize: 20, fontWeight: 700, color: 'var(--text, #f1f5f9)',
                    }}>
                      {q.total_amount ? formatCurrency(q.total_amount) : '—'}
                    </div>
                    <div style={{
                      height: 4, borderRadius: 999, marginTop: 2, overflow: 'hidden',
                      background: 'var(--surface-3, #475569)',
                    }}>
                      <div style={{ height: '100%', width: `${st.pct}%`, background: st.tone, borderRadius: 999 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
