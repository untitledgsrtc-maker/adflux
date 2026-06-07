// src/components/v2/CampaignChrome.jsx
//
// Shared chrome for the Campaign module — matches the owner-approved mockup
// (_design_reference/campaign_module_mockup.html): a page head (kicker +
// Space-Grotesk title + sub) and a sub-tab bar with the yellow-underline
// active state. Each campaign page wraps its content with this so the whole
// module reads as one tabbed surface (the app routes are separate; the tabs
// just link between them).
//
// Live tabs route; the V3 tabs (Broadcast / Segments / Chatbot) render as
// disabled "soon" so the bar matches the mockup but stays honest — they need
// the edigiexpert token. Additive UI only (§45) — no data, no live touch.

import { useNavigate } from 'react-router-dom'

const TABS = [
  { key: 'campaigns', label: 'Campaigns',       to: '/campaigns' },
  { key: 'inbox',     label: 'Inbox',           to: '/campaigns/inbox' },
  { key: 'qr',        label: 'QR & Locations',  to: '/campaigns/qr' },
  { key: 'broadcast', label: 'Broadcast',  soon: true },
  { key: 'segments',  label: 'Segments',   soon: true },
  { key: 'chatbot',   label: 'Chatbot',    soon: true },
]

export default function CampaignChrome({ active, title = 'Campaigns', sub, right, children }) {
  const navigate = useNavigate()
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
            fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 28, fontWeight: 700,
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
        {TABS.map((t) => {
          const isActive = t.key === active
          const disabled = !!t.soon
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
