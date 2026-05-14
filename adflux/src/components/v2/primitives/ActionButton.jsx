// src/components/v2/primitives/ActionButton.jsx
//
// Phase 35 PR 1 — single button primitive.
//
// Replaces ~200 bare <button style={{…}}> sites scattered across V2
// pages. Single source of truth for :hover / :focus-visible / :disabled /
// :active states. Tap target ≥40px on every variant. Loading state
// replaces label with a spinner without resizing the button.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

const VARIANT_STYLES = {
  primary: {
    bg:     'var(--accent, #FFE600)',
    fg:     'var(--accent-fg, #0f172a)',
    border: 'transparent',
    hoverBg:'var(--accent-hover, #F0D800)',
  },
  ghost: {
    bg:     'transparent',
    fg:     'var(--text)',
    border: 'var(--border-strong)',
    hoverBg:'var(--surface-2)',
  },
  danger: {
    bg:     'var(--danger, #EF4444)',
    fg:     '#fff',
    border: 'transparent',
    hoverBg:'#dc2626',
  },
  subtle: {
    bg:     'var(--surface-2)',
    fg:     'var(--text)',
    border: 'var(--border)',
    hoverBg:'var(--surface-3, #475569)',
  },
}

const SIZE_PADDING = {
  sm: { padY: 6,  padX: 12, fontSize: 12, minH: 32, gap: 6 },
  md: { padY: 9,  padX: 16, fontSize: 13, minH: 40, gap: 7 },
  lg: { padY: 12, padX: 22, fontSize: 14, minH: 48, gap: 8 },
}

/**
 * @param {object} props
 * @param {'primary'|'ghost'|'danger'|'subtle'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {React.ComponentType<any>} [props.iconLeft]
 * @param {React.ComponentType<any>} [props.iconRight]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.loading] — replaces label with spinner; button stays disabled
 * @param {() => void | Promise<void>} props.onClick
 * @param {React.ReactNode} props.children
 * @param {React.CSSProperties} [props.style] — escape hatch; avoid if possible
 */
export default function ActionButton({
  variant = 'primary',
  size = 'md',
  iconLeft: IconL,
  iconRight: IconR,
  disabled,
  loading,
  onClick,
  children,
  style = {},
}) {
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const v = VARIANT_STYLES[variant]
  const s = SIZE_PADDING[size]
  const isDisabled = disabled || loading

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        padding: `${s.padY}px ${s.padX}px`,
        minHeight: s.minH,
        borderRadius: 999,
        background: hover && !isDisabled ? v.hoverBg : v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
        fontWeight: 700,
        fontSize: s.fontSize,
        letterSpacing: '0.02em',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled && !loading ? 0.5 : 1,
        outline: focused ? '2px solid var(--accent, #FFE600)' : 'none',
        outlineOffset: 2,
        transition: 'background 120ms ease, transform 80ms ease',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {loading
        ? <Loader2 size={size === 'sm' ? 12 : 14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
        : (IconL && <IconL size={size === 'sm' ? 12 : 14} strokeWidth={1.6} />)
      }
      {!loading && children}
      {!loading && IconR && <IconR size={size === 'sm' ? 12 : 14} strokeWidth={1.6} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  )
}
