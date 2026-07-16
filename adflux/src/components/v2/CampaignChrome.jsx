// src/components/v2/CampaignChrome.jsx
//
// Shared chrome for the Campaign module — matches the owner-approved mockup
// (_design_reference/campaign_module_mockup.html): a page head (kicker +
// Space-Grotesk title + sub) and a sub-tab bar with the yellow-underline
// active state + a live count pill per tab. Each campaign page wraps its
// content with this so the whole module reads as one tabbed surface (the app
// routes are separate; the tabs just link between them).
//
// Live tabs route; the V3 tabs (Broadcast / Segments / Chatbot) render as
// disabled "soon" so the bar matches the mockup but stays honest — they need
// the edigiexpert token. Additive UI only (§45) — the only data here is four
// cheap head-count queries on campaign tables (decorative; never block render).

import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const TABS = [
  { key: 'campaigns', label: 'Campaigns',       to: '/campaigns' },
  { key: 'inbox',     label: 'Inbox',           to: '/campaigns/inbox' },
  { key: 'qr',        label: 'QR & Locations',  to: '/campaigns/qr' },
  { key: 'clients',   label: 'Client QRs',      to: '/campaigns/clients' },
  { key: 'broadcast', label: 'Broadcast',  to: '/campaigns/broadcast' },
  { key: 'segments',  label: 'Segments',   to: '/campaigns/segments' },
  { key: 'chatbot',   label: 'Chatbot',    to: '/campaigns/chatbot' },
  { key: 'integrations', label: 'Integrations', to: '/campaigns/integrations' },
]

export default function CampaignChrome({ active, title = 'Campaigns', sub, right, children }) {
  const navigate = useNavigate()
  const [counts, setCounts] = useState(null)

  // Reps (sales / telecaller / agency) get the INBOX tab only — they reply to
  // their own chats, nothing else. Admin / co_owner run the whole module and
  // see every tab. Fail-closed while the profile hydrates (null role → Inbox
  // only) so a rep never flashes the admin tabs. The non-inbox routes are
  // already role-guarded; this hides the tabs so they don't even show.
  const role = useAuthStore((s) => s.profile?.role)
  const isPriv = role === 'admin' || role === 'co_owner'
  const visibleTabs = isPriv ? TABS : TABS.filter((t) => t.key === 'inbox')

  // Live per-tab counts (mockup's mono count pills). head-only counts on the
  // campaign tables — cheap, decorative, never block the page (§45).
  useEffect(() => {
    let alive = true
    const headCount = async (build) => {
      try { const { count, error } = await build; return error ? null : (count ?? 0) }
      catch { return null }
    }
    ;(async () => {
      const [campaigns, inbox, qr0, clients] = await Promise.all([
        headCount(supabase.from('campaigns').select('id', { count: 'exact', head: true })),
        headCount(supabase.from('whatsapp_conversations').select('id', { count: 'exact', head: true })),
        // QR boards = client_name IS NULL; Client QRs = client_name NOT NULL.
        headCount(supabase.from('campaign_locations').select('id', { count: 'exact', head: true }).is('client_name', null)),
        headCount(supabase.from('campaign_locations').select('id', { count: 'exact', head: true }).not('client_name', 'is', null)),
      ])
      // client_name column not added yet → fall back to a plain board count.
      const qr = qr0 != null
        ? qr0
        : await headCount(supabase.from('campaign_locations').select('id', { count: 'exact', head: true }))
      if (alive) setCounts({ campaigns, inbox, qr, clients })
    })()
    return () => { alive = false }
  }, [])

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px 80px' }}>
      {/* page head */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{
            fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'var(--v2-ink-2, #6a7590)', fontWeight: 600,
          }}>
            Lead capture · WhatsApp · QR · Routing
          </div>
          <h1 style={{
            fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 30, fontWeight: 700,
            margin: '6px 0 4px', color: 'var(--v2-ink-0, #f5f7fb)', letterSpacing: '-.01em',
          }}>
            {title}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2, #6a7590)', maxWidth: 740 }}>
            {sub || 'WhatsApp + QR leads land here, route to a telecaller, and stay in one conversation. Two-way reply + broadcast unlock once the number is live.'}
          </div>
        </div>
        {right && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{right}</div>}
      </div>

      {/* sub-tabs */}
      <div style={{
        display: 'flex', gap: 4, borderBottom: '1px solid var(--v2-line, #1f2b47)',
        margin: '22px 0', flexWrap: 'wrap',
      }}>
        {visibleTabs.map((t) => {
          const isActive = t.key === active
          const disabled = !!t.soon
          const n = counts && !disabled ? counts[t.key] : null
          return (
            <button
              key={t.key}
              type="button"
              disabled={disabled}
              onClick={() => { if (!disabled && t.to) navigate(t.to) }}
              style={{
                padding: '11px 16px', fontSize: 13, fontWeight: 600,
                color: isActive ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-2, #6a7590)',
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? 'default' : 'pointer',
                background: 'none', border: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                borderBottom: isActive ? '2px solid var(--v2-yellow, #FFE600)' : '2px solid transparent',
                fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 7,
              }}
            >
              {t.label}
              {/* live count pill (mockup) — only when we have a real, non-zero number */}
              {n != null && n > 0 && (
                <span style={{
                  fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 10.5, fontWeight: 700,
                  minWidth: 18, textAlign: 'center', padding: '1px 6px', borderRadius: 999,
                  background: isActive ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-bg-2, #1a2742)',
                  color: isActive ? 'var(--accent-fg, #0b1220)' : 'var(--v2-ink-2, #6a7590)',
                  border: isActive ? 'none' : '1px solid var(--v2-line, #1f2b47)',
                }}>
                  {n}
                </span>
              )}
              {t.soon && (
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                  color: 'var(--v2-ink-2, #6a7590)', background: 'var(--v2-bg-2, #1a2742)',
                  border: '1px solid var(--v2-line, #1f2b47)', padding: '2px 6px', borderRadius: 999,
                }}>
                  soon
                </span>
              )}
            </button>
          )
        })}
      </div>

      {children}
    </div>
  )
}
