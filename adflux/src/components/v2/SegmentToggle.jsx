// src/components/v2/SegmentToggle.jsx
//
// Phase 142 — shared "All / Private / Government" pill toggle. Extracted
// VERBATIM from AdminDashboardDesktop's local SegmentToggle so Quotes +
// Leads reuse the exact same look. Inline brand-token styles (no CSS
// class), matching the dashboard pill.
//
//   value:    'all' | 'private' | 'government'   (default 'all')
//   onChange: (key) => void
//   style:    optional wrapper-style override — e.g. pass
//             { marginBottom: 0 } when it sits inline in a filter bar
//             rather than as a standalone block under a hero.
//
// Use segmentKeyToValue(value) to turn the toggle key into the DB
// `segment` value ('PRIVATE' / 'GOVERNMENT', or null for 'all').

const OPTS = [
  { k: 'all',        label: 'All' },
  { k: 'private',    label: 'Private' },
  { k: 'government', label: 'Government' },
]

// `opts` defaults to the segment options (All/Private/Government). Pass a custom
// [{ k, label }] array to reuse the exact pill look for another axis — e.g. a
// Media pill row on /quotes (Phase 279). Backward-compatible: existing callers
// omit `opts` and get the segment toggle unchanged.
export default function SegmentToggle({ value = 'all', onChange, style, opts = OPTS }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 4, padding: 4,
      background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
      borderRadius: 999, marginBottom: 16,
      ...style,
    }}>
      {opts.map(o => {
        const on = value === o.k
        return (
          <button
            key={o.k}
            type="button"
            onClick={() => onChange(o.k)}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              border: 'none', borderRadius: 999, cursor: 'pointer',
              background: on ? 'var(--v2-yellow, #FFE600)' : 'transparent',
              color:      on ? 'var(--accent-fg, #0F172A)' : 'var(--v2-ink-2)',
              fontFamily: 'inherit',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// Toggle key → DB `segment` value. 'all' → null (no filter).
export function segmentKeyToValue(k) {
  if (k === 'private')    return 'PRIVATE'
  if (k === 'government') return 'GOVERNMENT'
  return null
}
