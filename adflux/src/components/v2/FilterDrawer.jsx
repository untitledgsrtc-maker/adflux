// src/components/v2/FilterDrawer.jsx
//
// Phase 34Z.14 — single gear-button filter popover. Owner directive
// (14 May 2026):
//
//   "🔍 Search leads...   [⚙]    ← Filter icon (with count badge)
//    🟡 Segment: All
//    🟢 Source: Any                ← Show as removable chips only
//    🔵 City: All                     when active"
//
// One control instead of a row of dropdowns. Tap the gear → popover
// with every available filter; close → only the ACTIVE filters show
// as removable chips beneath. Clean default state, full power on tap.
//
// Schema-driven so /leads, /quotes, /telecaller etc. all reuse the
// same component just by declaring their own filter list.
//
// Props:
//   fields:  Array<{
//     key:     'segment',                       // state key
//     label:   'Segment',                       // chip + popover label
//     value:   <current value>,                 // controlled
//     onChange: (next) => void,
//     options: Array<{ value, label }>,         // dropdown options
//     defaultValue: 'all',                      // chip hidden when equal
//     dotColor?: '#FFE600',                     // chip leading dot
//   }>
//
// activeChips counts: fields.filter(f => f.value !== f.defaultValue).length.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal, X } from 'lucide-react'

export default function FilterDrawer({ fields = [] }) {
  const [open, setOpen] = useState(false)
  const [popPos, setPopPos] = useState({ top: 0, left: 12 })
  const wrapRef = useRef(null)
  const popRef  = useRef(null)

  useEffect(() => {
    function down(e) {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target) &&
        popRef.current && !popRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [])

  // Phase 34Z.22 — popover position math rewritten. Phases 34Z.15 +
  // 34Z.18 anchored via `right: window.innerWidth - r.right` which
  // computed the distance from the right edge of the VIEWPORT to the
  // right edge of the GEAR. But a 320px popover anchored at that right
  // edge spans 320px LEFT — and on a phone where the gear sits in the
  // middle of the row, the popover's left edge landed off-screen by
  // ~(width - gear's left margin). Switching to LEFT anchor with a
  // proper clamp so the panel always sits fully inside [12, viewport
  // - 12 - width].
  useEffect(() => {
    if (!open || !wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    const popWidth = Math.min(320, window.innerWidth - 24)
    // Prefer right-aligning the popover with the gear's right edge so
    // it visually drops "from" the gear; clamp left so the entire
    // panel fits in the viewport.
    let left = r.right - popWidth
    if (left < 12) left = 12
    if (left + popWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - 12 - popWidth)
    }
    setPopPos({ top: r.bottom + 6, left })
  }, [open])

  const activeCount = fields.filter((f) => f.value !== f.defaultValue).length

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filters"
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          background: open ? 'var(--accent, #FFE600)' : 'var(--surface)',
          color:      open ? 'var(--accent-fg, #0f172a)' : 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <SlidersHorizontal size={15} />
        {activeCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              padding: '0 5px',
              background: 'var(--accent, #FFE600)',
              color: 'var(--accent-fg, #0f172a)',
              borderRadius: 999,
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid var(--bg)',
            }}
          >
            {activeCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          style={{
            // Phase 34Z.18 — portal-render to document.body. iOS Safari
            // treats `position: fixed` as containing-block relative when
            // ANY ancestor uses transform / filter / will-change /
            // contain. Owner reported the panel still clipped after
            // Phase 34Z.15's fixed positioning, even on a fresh PWA
            // bundle. Rendering via createPortal escapes every
            // ancestor stacking / containing context.
            position: 'fixed',
            top: popPos.top,
            left: popPos.left,
            zIndex: 1000,
            width: 'min(320px, calc(100vw - 24px))',
            background: 'var(--v2-bg-1, var(--surface))',
            border: '1px solid var(--v2-line, var(--border))',
            borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,0.40)',
            padding: 14,
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            Filters
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {fields.map((f) => (
              <div key={f.key}>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginBottom: 4,
                  }}
                >
                  {f.label}
                </div>
                <select
                  className="lead-filter-select"
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => {
                fields.forEach((f) => {
                  if (f.value !== f.defaultValue) f.onChange(f.defaultValue)
                })
                setOpen(false)
              }}
              style={{
                marginTop: 12,
                width: '100%',
                height: 34,
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reset all
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ─── Sibling export: removable chip row ─────────────────────────── */
//
// Renders only the fields whose value !== defaultValue. Each chip
// shows a coloured dot + "Label: Value × ".

export function ActiveFilterChips({ fields = [] }) {
  const active = fields.filter((f) => f.value !== f.defaultValue)
  if (active.length === 0) return null
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
      }}
    >
      {active.map((f) => {
        const labelValue = (f.options.find((o) => o.value === f.value)?.label || f.value)
          // strip the "Label: " prefix if the option label already includes it
          .replace(new RegExp(`^${f.label}:\\s*`, 'i'), '')
        return (
          <span
            key={f.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              fontSize: 12,
              color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: f.dotColor || 'var(--accent, #FFE600)',
                flexShrink: 0,
              }}
            />
            <span style={{ color: 'var(--text-muted)' }}>{f.label}:</span>
            <span style={{ fontWeight: 600 }}>{labelValue}</span>
            <button
              type="button"
              onClick={() => f.onChange(f.defaultValue)}
              title={`Clear ${f.label}`}
              style={{
                marginLeft: 2,
                width: 16,
                height: 16,
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={11} />
            </button>
          </span>
        )
      })}
    </div>
  )
}
