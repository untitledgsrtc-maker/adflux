// src/components/v2/V2Hero.jsx
//
// Phase 34R — adopt the teal-gradient hero card from the new design
// package (_design_reference/salesui/sales-mobile.jsx + sales-styles.css
// .sm-hero rules). Reusable across /work, /leads, /follow-ups,
// /quotes, /telecaller, /my-performance so every page gets the same
// "what matters right now" pop at the top.
//
// Props:
//   eyebrow   — small uppercase line above the value (auto adds a
//               pulsing yellow dot ahead of it)
//   value     — the big number / phrase ("₹4.2L", "3 of 10")
//   label     — small line under the value
//   chip      — optional right-side pill text
//   right     — optional right-side body. { text, tone: 'up' | 'down' }
//   accent    — when true, paints the `value` in brand yellow
//
// Styling is inline-with-fallbacks so the component renders fine
// inside .v2 scope OR outside (e.g. dropped into a v1 page during
// migration). All colours fall back to brand hex so the gradient
// shows even before tokens.css loads.

import { TrendingUp, TrendingDown } from 'lucide-react'

const HERO_GRADIENT =
  'radial-gradient(380px 140px at 100% 0%, rgba(255,230,0,.22), transparent 60%),' +
  ' linear-gradient(135deg, #0d3d3a 0%, #134e4a 55%, #0f766e 100%)'

function YellowDot({ size = 6 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--accent, #FFE600)',
        boxShadow: '0 0 0 0 rgba(255,230,0,0.7)',
        animation: 'v2heroPulse 2s infinite',
      }}
    />
  )
}

// Phase 34Z.89 — `flat` prop. Owner reported the teal gradient
// stacked with the purple Incentive card on /work looked
// "consumer-fintech". Flat mode renders the same hero shape on
// a solid panel + token text colours. /work passes flat=true;
// /leads, /follow-ups, /quotes, /telecaller, /my-performance
// keep the gradient hero unchanged.
export default function V2Hero({
  eyebrow,
  value,
  label,
  chip,
  right,
  accent = false,
  flat = false,
}) {
  const isDown = right?.tone === 'down'
  const rightFg = isDown ? '#fca5a5' : '#86efac'

  // Flat-mode colour overrides. Kept narrow so the existing
  // gradient design remains the default for non-/work pages.
  const containerStyle = flat
    ? {
        background: 'var(--v2-bg-1, #1e293b)',
        border: '1px solid var(--v2-line, #334155)',
        color: 'var(--text, #f1f5f9)',
      }
    : {
        background: HERO_GRADIENT,
        border: '1px solid #1c5856',
        color: '#fff',
      }
  const eyebrowColor = flat ? 'var(--text-muted, #94a3b8)' : 'rgba(255,255,255,0.65)'
  const labelColor   = flat ? 'var(--text-muted, #94a3b8)' : 'rgba(255,255,255,0.7)'
  const chipBg       = flat ? 'var(--v2-bg-2, rgba(255,255,255,0.06))' : 'rgba(255,255,255,0.10)'
  const chipBorder   = flat ? '1px solid var(--v2-line, #334155)' : '1px solid rgba(255,255,255,0.18)'
  const chipColor    = flat ? 'var(--text, #f1f5f9)' : '#fff'
  const valueColor   = accent
    ? 'var(--accent, #FFE600)'
    : (flat ? 'var(--text, #f1f5f9)' : '#fff')

  return (
    <div
      style={{
        ...containerStyle,
        borderRadius: 'var(--radius-lg, 14px)',
        padding: '16px 18px',
        marginBottom: 12,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans, "DM Sans", system-ui, sans-serif)',
      }}
    >
      {eyebrow && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: eyebrowColor,
            fontWeight: 500,
          }}
        >
          <YellowDot />
          <span>{eyebrow}</span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginTop: 8,
          gap: 12,
          flexWrap: 'wrap',  // chip wraps below value on narrow screens
        }}
      >
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
              fontWeight: 600,
              fontSize: 28,
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              color: valueColor,
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </div>
          {label && (
            <div style={{ fontSize: 12, color: labelColor, marginTop: 4 }}>
              {label}
            </div>
          )}
        </div>

        <div
          style={{
            textAlign: 'right',
            fontSize: 11,
            color: labelColor,
            flex: '0 1 auto',
            maxWidth: '100%',
          }}
        >
          {chip && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                background: chipBg,
                border: chipBorder,
                color: chipColor,
                fontSize: 11,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              <YellowDot />
              <span>{chip}</span>
            </span>
          )}
          {right && (
            <div style={{ marginTop: chip ? 6 : 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              {isDown
                ? <TrendingDown size={11} color={rightFg} strokeWidth={1.8} />
                : <TrendingUp size={11} color={rightFg} strokeWidth={1.8} />}
              <span style={{ color: rightFg, fontWeight: 500 }}>{right.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* keyframes piggyback — render once per Hero mount; cheap */}
      <style>{`
        @keyframes v2heroPulse {
          0%   { box-shadow: 0 0 0 0 rgba(255,230,0,0.55); }
          70%  { box-shadow: 0 0 0 6px rgba(255,230,0,0);    }
          100% { box-shadow: 0 0 0 0 rgba(255,230,0,0);      }
        }
      `}</style>
    </div>
  )
}
