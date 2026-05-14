// src/components/v2/DateRangeFilter.jsx
//
// Phase 34Z.13 — unified date-range filter pill. Owner directive
// (14 May 2026): "i want this type of simple filter and applied
// everywhere filter needed."
//
// Closed state: a pill that reads `📅 May 2026` (or whatever preset
// is active). Two arrow buttons on the sides step the period back/
// forward when the preset is single-period (day, week, month, quarter).
//
// Open state: popover with 7 quick picks (Today / Yesterday / Last 7
// days / Last 30 days / This month / Last month / This quarter) plus
// a Custom range pair of native date inputs and an "Apply range"
// button.
//
// Controlled — parent owns the value:
//   <DateRangeFilter
//     value={{ preset: 'this_month', from: '2026-05-01', to: '2026-05-31' }}
//     onChange={setRange}
//   />
//
// `presetToRange(preset)` is the single source of truth so every page
// computes the same window for the same preset.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

/* ─── Helpers ───────────────────────────────────────────────────── */

function isoDay(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0) }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function addDays(d, n)   { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function startOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3, 1)
}
function endOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3 + 3, 0)
}

function monthLabel(d) {
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' })
}

export const PRESETS = [
  { key: 'today',       label: 'Today' },
  { key: 'yesterday',   label: 'Yesterday' },
  { key: 'last_7',      label: 'Last 7 days' },
  { key: 'last_30',     label: 'Last 30 days' },
  { key: 'this_month',  label: 'This month' },
  { key: 'last_month',  label: 'Last month' },
  { key: 'this_quarter',label: 'This quarter' },
  { key: 'all',         label: 'All time' },
  { key: 'custom',      label: 'Custom' },
]

export function presetToRange(preset, anchor = new Date()) {
  const today = new Date()
  if (preset === 'today') {
    return { preset, from: isoDay(today), to: isoDay(today), label: 'Today' }
  }
  if (preset === 'yesterday') {
    const y = addDays(today, -1)
    return { preset, from: isoDay(y), to: isoDay(y), label: 'Yesterday' }
  }
  if (preset === 'last_7') {
    return { preset, from: isoDay(addDays(today, -6)), to: isoDay(today), label: 'Last 7 days' }
  }
  if (preset === 'last_30') {
    return { preset, from: isoDay(addDays(today, -29)), to: isoDay(today), label: 'Last 30 days' }
  }
  if (preset === 'this_month') {
    return { preset, from: isoDay(startOfMonth(anchor)), to: isoDay(endOfMonth(anchor)), label: monthLabel(anchor) }
  }
  if (preset === 'last_month') {
    const lm = addMonths(today, -1)
    return { preset, from: isoDay(startOfMonth(lm)), to: isoDay(endOfMonth(lm)), label: monthLabel(lm) }
  }
  if (preset === 'this_quarter') {
    return {
      preset,
      from: isoDay(startOfQuarter(today)),
      to:   isoDay(endOfQuarter(today)),
      label: 'This quarter',
    }
  }
  if (preset === 'all') {
    return { preset, from: '', to: '', label: 'All time' }
  }
  // custom — caller provides from/to/label
  return { preset, from: '', to: '', label: 'Custom' }
}

/* ─── Component ─────────────────────────────────────────────────── */

export default function DateRangeFilter({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(value?.from || '')
  const [customTo,   setCustomTo]   = useState(value?.to   || '')
  const [popPos, setPopPos] = useState({ top: 0, left: 12 })
  const wrapRef = useRef(null)
  const popRef  = useRef(null)

  // Close on outside-click.
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

  // Phase 34Z.15 — viewport-fixed positioning so the popover doesn't
  // clip off either edge on narrow phones. Clamp to viewport.
  useEffect(() => {
    if (!open || !wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    const popWidth = 340
    let left = r.left
    if (left + popWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - popWidth - 12)
    }
    setPopPos({ top: r.bottom + 6, left })
  }, [open])

  // Keep custom inputs in sync when parent changes value externally.
  useEffect(() => {
    setCustomFrom(value?.from || '')
    setCustomTo(value?.to || '')
  }, [value?.from, value?.to])

  const label = value?.label || 'All time'
  // Step arrows only render for single-period presets that have a clear
  // "next / previous" — month + day + quarter. Custom + last_N stay flat.
  const canStep = value?.preset === 'this_month' || value?.preset === 'last_month'
    || value?.preset === 'today' || value?.preset === 'yesterday'
    || value?.preset === 'this_quarter'

  function step(dir) {
    if (!canStep) return
    if (value.preset === 'today' || value.preset === 'yesterday') {
      const anchor = new Date(value.from)
      const next = addDays(anchor, dir)
      onChange({
        preset: 'custom',
        from: isoDay(next),
        to: isoDay(next),
        label: next.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      })
      return
    }
    if (value.preset === 'this_month' || value.preset === 'last_month') {
      const anchor = addMonths(new Date(value.from), dir)
      onChange({
        preset: 'custom',
        from: isoDay(startOfMonth(anchor)),
        to:   isoDay(endOfMonth(anchor)),
        label: monthLabel(anchor),
      })
      return
    }
    if (value.preset === 'this_quarter') {
      const anchor = addMonths(new Date(value.from), dir * 3)
      onChange({
        preset: 'custom',
        from: isoDay(startOfQuarter(anchor)),
        to:   isoDay(endOfQuarter(anchor)),
        label: `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`,
      })
    }
  }

  function applyPreset(key) {
    if (key === 'custom') return // handled by Apply range button
    onChange(presetToRange(key))
    setOpen(false)
  }

  function applyCustom() {
    if (!customFrom && !customTo) return
    onChange({
      preset: 'custom',
      from: customFrom,
      to:   customTo,
      label: customFrom && customTo
        ? `${customFrom} → ${customTo}`
        : (customFrom ? `From ${customFrom}` : `To ${customTo}`),
    })
    setOpen(false)
  }

  /* ── Pill styles share the same chrome as the tab row above. ── */
  const pillBase = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    color: 'var(--text)',
    fontSize: 12,
    fontFamily: 'var(--font-sans, "DM Sans", system-ui, sans-serif)',
    cursor: 'pointer',
    userSelect: 'none',
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {/* Step left */}
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={!canStep}
        title="Previous"
        style={{
          ...pillBase,
          width: 32,
          padding: 0,
          justifyContent: 'center',
          opacity: canStep ? 1 : 0.4,
          cursor: canStep ? 'pointer' : 'not-allowed',
        }}
      >
        <ChevronLeft size={14} />
      </button>

      {/* Main pill */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...pillBase,
          background: open ? 'var(--accent, #FFE600)' : 'var(--surface)',
          color:      open ? 'var(--accent-fg, #0f172a)' : 'var(--text)',
          fontWeight: 600,
        }}
      >
        <Calendar size={14} />
        <span>{label}</span>
      </button>

      {/* Step right */}
      <button
        type="button"
        onClick={() => step(1)}
        disabled={!canStep}
        title="Next"
        style={{
          ...pillBase,
          width: 32,
          padding: 0,
          justifyContent: 'center',
          opacity: canStep ? 1 : 0.4,
          cursor: canStep ? 'pointer' : 'not-allowed',
        }}
      >
        <ChevronRight size={14} />
      </button>

      {/* Popover */}
      {open && createPortal(
        <div
          ref={popRef}
          style={{
            // Phase 34Z.18 — portal-render to document.body so the
            // popover escapes any ancestor containing block. Same
            // root cause as FilterDrawer fix.
            position: 'fixed',
            top: popPos.top,
            left: popPos.left,
            zIndex: 1000,
            width: 'min(340px, calc(100vw - 24px))',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong, var(--border))',
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
              marginBottom: 8,
            }}
          >
            Picks
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            {PRESETS.filter((p) => p.key !== 'custom').map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                style={{
                  ...pillBase,
                  height: 36,
                  justifyContent: 'center',
                  background: value?.preset === p.key ? 'var(--accent, #FFE600)' : 'var(--surface-2)',
                  color: value?.preset === p.key ? 'var(--accent-fg, #0f172a)' : 'var(--text)',
                  fontWeight: 500,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            Custom range
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Start</div>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{
                  width: '100%',
                  height: 34,
                  padding: '0 10px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>End</div>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{
                  width: '100%',
                  height: 34,
                  padding: '0 10px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={applyCustom}
            style={{
              width: '100%',
              height: 38,
              background: 'var(--accent, #FFE600)',
              color: 'var(--accent-fg, #0f172a)',
              border: 'none',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Apply range
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
