// src/components/v2/primitives/MonoNumber.jsx
//
// Phase 35 PR 1 — JetBrains-Mono wrapper for numbers / IDs / phone
// numbers / dates. Replaces scattered `fontFamily: 'monospace'` literals
// (the system fallback renders as Menlo or Courier; the spec says
// JetBrains Mono).

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {number} [props.size]
 * @param {React.CSSProperties} [props.style]
 */
export default function MonoNumber({ children, size, style = {} }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono, "JetBrains Mono", Menlo, monospace)',
      fontVariantNumeric: 'tabular-nums',
      fontSize: size,
      ...style,
    }}>
      {children}
    </span>
  )
}
