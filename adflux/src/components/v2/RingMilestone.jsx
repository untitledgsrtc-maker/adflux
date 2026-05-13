// src/components/v2/RingMilestone.jsx
//
// Phase 34R — 3-up ring milestones, ported from
// _design_reference/salesui/sales-mobile.jsx (RingMilestone + Milestones)
// + sales-styles.css .milestones / .milestone rules.
//
// Usage:
//   <RingMilestoneRow
//     items={[
//       { value: 3, target: 5,  label: 'Visits' },
//       { value: 5, target: 10, label: 'Leads'  },
//       { value: 3, target: 20, label: 'Follow-ups', sub: '2 done' },
//     ]}
//   />
//
// Or use the lower-level <RingMilestone /> alone.
//
// Ring color logic (matches the design):
//   pct >= 1.0  → success green     (target hit)
//   pct >= 0.5  → brand yellow       (on track)
//   pct >= 0.2  → warning amber      (slow start)
//   else        → danger red         (almost nothing yet)

const RADIUS = 26
const STROKE = 6
const SIZE   = 64

function ringColor(pct) {
  if (pct >= 1)   return 'var(--success, #10B981)'
  if (pct >= 0.5) return 'var(--accent,  #FFE600)'
  if (pct >= 0.2) return 'var(--warning, #F59E0B)'
  return 'var(--danger, #EF4444)'
}

export function RingMilestone({ value = 0, target = 1, label = '', sub = '' }) {
  const safeTarget = Math.max(1, Number(target) || 1)
  const v          = Math.max(0, Number(value) || 0)
  const pct        = Math.min(1, v / safeTarget)
  const circumference = 2 * Math.PI * RADIUS
  const offset     = circumference * (1 - pct)

  return (
    <div
      style={{
        background: 'var(--surface, #1e293b)',
        border: '1px solid var(--border, #334155)',
        borderRadius: 'var(--radius, 10px)',
        padding: '12px 8px 10px',
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <div style={{ width: SIZE, height: SIZE, margin: '0 auto 6px', position: 'relative' }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none"
            stroke="var(--surface-2, #334155)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none"
            stroke={ringColor(pct)}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
            fontWeight: 600,
            fontSize: 16,
            color: 'var(--text, #f1f5f9)',
          }}
        >
          {v}
          <span style={{ color: 'var(--text-subtle, #64748b)', fontSize: 10, fontWeight: 500, marginLeft: 1 }}>
            /{safeTarget}
          </span>
        </div>
      </div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-subtle, #64748b)',
          marginTop: 2,
        }}
      >
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export function RingMilestoneRow({ items = [] }) {
  if (!items.length) return null
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        gap: 8,
        marginBottom: 12,
      }}
    >
      {items.map((it, i) => (
        <RingMilestone
          key={`${it.label || ''}-${i}`}
          value={it.value}
          target={it.target}
          label={it.label}
          sub={it.sub}
        />
      ))}
    </div>
  )
}
