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

// Phase 35.0 — `percent` prop renders a 60x60 circular SVG ring on
// the right side of the hero (replaces the chip pill when set).
// `footerStats` + `footerCta` add a dashed-border bottom row inside
// the hero. Reference: _design_reference/newsalesui/project/app.jsx
// (Progress component, lines 188-247). Optional — only kicks in for
// /work's B_ACTIVE state; other pages pass nothing and render the
// existing layout.
export default function V2Hero({
  eyebrow,
  value,
  label,
  chip,
  right,
  accent = false,
  percent,        // number 0..100 — when set, renders the SVG progress ring
  footerStats,    // optional array of { label, value, tint } — bullet stats row
  footerCta,      // optional { label, onClick } — green "View pipeline →" CTA
}) {
  const isDown = right?.tone === 'down'
  const rightFg = isDown ? '#fca5a5' : '#86efac'

  // Ring math. r=26, stroke=6, on a 62x62 canvas. Dasharray =
  // (pct/100)*circumference, remaining length on the next segment.
  const ringPct = typeof percent === 'number'
    ? Math.min(100, Math.max(0, percent))
    : null
  const ringR = 26
  const ringCirc = 2 * Math.PI * ringR
  const ringDash = ringPct !== null
    ? `${(ringPct / 100) * ringCirc} ${ringCirc}`
    : null

  return (
    <div
      style={{
        background: HERO_GRADIENT,
        border: '1px solid #1c5856',
        color: '#fff',
        borderRadius: 'var(--radius-lg, 14px)',
        padding: '16px 18px',
        // Phase 35.0 pass 8 — tightened from 12 → 8 to match the
        // overall page rhythm. Owner audit: stacks above the V2Hero
        // (Log buttons / TodaySummaryCard) were giving too much air.
        marginBottom: 8,
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
            color: 'rgba(255,255,255,0.65)',
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
              color: accent ? 'var(--accent, #FFE600)' : '#fff',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </div>
          {label && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
              {label}
            </div>
          )}
        </div>

        <div
          style={{
            textAlign: 'right',
            fontSize: 11,
            color: 'rgba(255,255,255,0.7)',
            // Phase 35.0 pass 7 — when the circular ring is rendered
            // (`percent` set) the right column MUST NOT shrink below
            // the ring's 62 px or it clips the card's right edge.
            // `flex: 0 0 auto` locks the column width to the ring's
            // natural size on every viewport. Without ring, falls
            // back to the original `0 1 auto` shrinkable column for
            // text-only chip layouts.
            flex: ringPct !== null ? '0 0 auto' : '0 1 auto',
            maxWidth: '100%',
          }}
        >
          {/* Phase 35.0 — when `percent` is provided, render the
              circular progress ring INSTEAD of the chip pill. Mockup
              line 213-228 of app.jsx. */}
          {ringPct !== null && (
            <div style={{ position: 'relative', width: 62, height: 62 }}>
              <svg width="62" height="62" viewBox="0 0 62 62">
                <circle cx="31" cy="31" r={ringR}
                  stroke="rgba(255,255,255,0.12)" strokeWidth="6" fill="none" />
                <circle cx="31" cy="31" r={ringR}
                  stroke="url(#v2heroRingGrad)" strokeWidth="6" fill="none"
                  strokeDasharray={ringDash}
                  strokeLinecap="round"
                  transform="rotate(-90 31 31)" />
                <defs>
                  <linearGradient id="v2heroRingGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#7BE3BD" />
                    <stop offset="100%" stopColor="#2BD8A0" />
                  </linearGradient>
                </defs>
              </svg>
              <div style={{
                position: 'absolute', inset: 0,
                display: 'grid', placeItems: 'center',
                fontFamily: 'var(--font-display, "Space Grotesk", system-ui)',
                fontSize: 13, fontWeight: 600, color: '#fff',
              }}>
                {Math.round(ringPct)}%
              </div>
            </div>
          )}
          {chip && ringPct === null && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#fff',
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

      {/* Phase 35.0 — bottom dashed-border row with bullet stats
          and optional green CTA. Mockup line 235-245 of app.jsx.
          Shows only when footerStats OR footerCta are passed. */}
      {(footerStats?.length || footerCta) && (
        <div style={{
          marginTop: 14, paddingTop: 14,
          borderTop: '1px dashed rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          {footerStats?.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {footerStats.map((s, i) => (
                <span key={s.label}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {i > 0 && (
                    <span style={{
                      width: 3, height: 3, borderRadius: 999,
                      background: 'rgba(255,255,255,0.3)',
                    }} />
                  )}
                  <span style={{
                    width: 6, height: 6, borderRadius: 999,
                    background: s.tint || 'var(--v2-yellow, #FFE600)',
                  }} />
                  <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.86)' }}>
                    <span style={{
                      fontFamily: 'var(--font-display, "Space Grotesk")',
                      color: '#fff', fontWeight: 600,
                    }}>
                      {s.value}
                    </span>
                    {' '}{s.label}
                  </span>
                </span>
              ))}
            </div>
          )}
          {footerCta && (
            <button
              type="button"
              onClick={footerCta.onClick}
              style={{
                background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                fontSize: 12.5, color: '#2BD8A0', fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              {footerCta.label}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

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
