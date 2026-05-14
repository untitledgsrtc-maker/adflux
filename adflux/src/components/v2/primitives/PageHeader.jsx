// src/components/v2/primitives/PageHeader.jsx
//
// Phase 35 PR 1 — canonical page heading.
//
// Replaces 4 page-heading patterns previously scattered across V2:
//   • <h1 className="v2d-page-title"> with .v2d-page-head wrapper (13 pages)
//   • <div className="lead-page-title"> with .lead-page-head wrapper (6 pages)
//   • Bare <V2Hero /> at top of page (2 pages)
//   • Bespoke v2d-hero v2d-hero--action markup (4 pages)
//
// Single rule of use: every V2 page mounts ONE <PageHeader /> at the top
// of its page body. Hero variant is reserved for the rep's daily home
// view (/work) and the daily-numbers view (/my-performance); every
// other page uses hero="none" or hero="compact".

import V2Hero from '../V2Hero'

/**
 * @param {object}    props
 * @param {string}    props.title            — required
 * @param {string}   [props.eyebrow]         — small caps line above title
 * @param {string}   [props.subtitle]        — one-line subtitle under title
 * @param {React.ReactNode} [props.actions]  — right-aligned action slot
 * @param {'none'|'compact'|'full'} [props.hero='none']
 */
export default function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  hero = 'none',
}) {
  if (hero === 'full') {
    return (
      <V2Hero
        eyebrow={eyebrow || ''}
        value={title}
        label={subtitle}
        right={actions ? { text: '', tone: 'up' } : undefined}
      />
    )
  }

  const isCompact = hero === 'compact'

  return (
    <div
      className="v2d-page-head"
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: isCompact ? 8 : 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div style={{
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--v2-ink-2, var(--text-muted))',
            fontWeight: 700,
            marginBottom: 4,
          }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{
          margin: 0,
          fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
          fontWeight: 700,
          fontSize: isCompact ? 20 : 26,
          letterSpacing: '-0.01em',
          color: 'var(--text)',
          lineHeight: 1.1,
        }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            marginTop: 4,
          }}>
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          {actions}
        </div>
      )}
    </div>
  )
}
