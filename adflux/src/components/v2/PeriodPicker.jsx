// src/components/v2/PeriodPicker.jsx
//
// Unified period picker for admin/sales dashboards. Replaces the old
// "◀ Apr 2026 ▶" pill with a single button that opens a popover
// offering month navigation, quick presets, AND a custom date range.
//
// Why one component: both dashboards had near-identical period
// switcher JSX. Keeping one source of truth avoids the usual drift
// where admin grows a feature sales doesn't.
//
// Keyboard: the popover closes on click-outside and on Escape. The
// two date inputs use native <input type="date"> — no library — so
// keyboard, mobile pickers, and locale formatting all come for free.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import {
  monthPeriod, rangePeriod, thisMonth, shiftMonth, isFutureMonth,
  presetToday, presetYesterday, presetLastNDays,
  presetThisMonth, presetLastMonth, presetThisQuarter,
} from '../../utils/period'

export function PeriodPicker({ period, onChange }) {
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(period.startIso)
  const [draftEnd, setDraftEnd] = useState(toInclusiveEndIso(period.endIso))
  const rootRef = useRef(null)

  // Keep the custom-range drafts synced when the period changes from
  // outside (e.g., arrow clicks). Without this, opening the popover
  // after a month shift would show stale dates in the inputs.
  useEffect(() => {
    setDraftStart(period.startIso)
    setDraftEnd(toInclusiveEndIso(period.endIso))
  }, [period.startIso, period.endIso])

  // Click-outside + Escape-to-close.
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(p) {
    onChange(p)
    setOpen(false)
  }

  function applyCustomRange() {
    if (!draftStart || !draftEnd) return
    pick(rangePeriod(draftStart, draftEnd))
  }

  const canGoNext = !isFutureMonth(shiftMonth(period, +1))

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}
      className="v2d-period"
      role="group"
      aria-label="Period"
    >
      <button
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(period, -1))}
      >
        <ChevronLeft size={14} />
      </button>

      <button
        className="is-active"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Change period"
      >
        <CalendarIcon size={12} />
        {period.label}
      </button>

      <button
        aria-label="Next month"
        onClick={() => onChange(shiftMonth(period, +1))}
        disabled={!canGoNext}
        title={canGoNext ? 'Next month' : 'Already at current month'}
      >
        <ChevronRight size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose period"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 40,
            minWidth: 320,
            background: 'var(--v2-bg-1, #151922)',
            border: '1px solid var(--v2-line, rgba(255,255,255,.08))',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,.5)',
            padding: 14,
            color: 'var(--v2-ink-0, #fff)',
            fontFamily: 'var(--v2-sans)',
          }}
          // Prevent the outer v2d-period hover/click styles from
          // bleeding into the popover body.
          onClick={e => e.stopPropagation()}
        >
          <div style={sectionLabel}>Quick picks</div>
          <div style={presetGrid}>
            <PresetBtn onClick={() => pick(presetToday())}         label="Today" />
            <PresetBtn onClick={() => pick(presetYesterday())}     label="Yesterday" />
            <PresetBtn onClick={() => pick(presetLastNDays(7))}    label="Last 7 days" />
            <PresetBtn onClick={() => pick(presetLastNDays(30))}   label="Last 30 days" />
            <PresetBtn onClick={() => pick(presetThisMonth())}     label="This month" />
            <PresetBtn onClick={() => pick(presetLastMonth())}     label="Last month" />
            <PresetBtn onClick={() => pick(presetThisQuarter())}   label="This quarter" />
          </div>

          <div style={{ ...sectionLabel, marginTop: 14 }}>Custom range</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <div style={miniLabel}>Start</div>
              <input
                type="date"
                value={draftStart}
                max={draftEnd || undefined}
                onChange={e => setDraftStart(e.target.value)}
                style={dateInput}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={miniLabel}>End</div>
              <input
                type="date"
                value={draftEnd}
                min={draftStart || undefined}
                onChange={e => setDraftEnd(e.target.value)}
                style={dateInput}
              />
            </div>
          </div>
          <button
            onClick={applyCustomRange}
            disabled={!draftStart || !draftEnd}
            style={{
              marginTop: 10, width: '100%',
              background: 'var(--v2-yellow, #fbc42d)',
              color: 'var(--v2-yellow-ink, #1a1200)',
              border: 0, borderRadius: 8,
              padding: '8px 12px', fontWeight: 700,
              fontFamily: 'var(--v2-display, inherit)',
              fontSize: 12, letterSpacing: '0.04em',
              cursor: (!draftStart || !draftEnd) ? 'not-allowed' : 'pointer',
              opacity: (!draftStart || !draftEnd) ? 0.4 : 1,
            }}
          >
            Apply range
          </button>

          {period.kind === 'range' && (
            <button
              onClick={() => pick(thisMonth())}
              style={{
                marginTop: 8, width: '100%',
                background: 'transparent',
                color: 'var(--v2-ink-2, rgba(255,255,255,.6))',
                border: '1px solid var(--v2-line, rgba(255,255,255,.1))',
                borderRadius: 8,
                padding: '6px 12px', fontWeight: 600,
                fontSize: 11, cursor: 'pointer',
              }}
            >
              Reset to this month
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Period stores endIso as exclusive (first-day-after). The <input type="date">
// needs the inclusive end the user would recognize, so we subtract a day
// for display and add it back in applyCustomRange (rangePeriod handles it).
function toInclusiveEndIso(exclusiveIso) {
  if (!exclusiveIso) return ''
  const [y, m, d] = exclusiveIso.split('-').map(Number)
  const dt = new Date(y, m - 1, d - 1)
  const pad = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function PresetBtn({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '1px solid var(--v2-line, rgba(255,255,255,.08))',
        color: 'var(--v2-ink-1, rgba(255,255,255,.85))',
        fontFamily: 'var(--v2-sans)',
        fontSize: 11, fontWeight: 600,
        padding: '7px 10px',
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}

const sectionLabel = {
  fontSize: 10, letterSpacing: '0.14em', fontWeight: 700,
  color: 'var(--v2-ink-2, rgba(255,255,255,.55))',
  textTransform: 'uppercase',
  marginBottom: 8,
}

const miniLabel = {
  fontSize: 10, color: 'var(--v2-ink-2, rgba(255,255,255,.55))',
  textTransform: 'uppercase', letterSpacing: '0.1em',
  marginBottom: 4, fontWeight: 700,
}

const presetGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 6,
}

const dateInput = {
  width: '100%',
  background: 'var(--v2-bg-2, #0f1219)',
  border: '1px solid var(--v2-line, rgba(255,255,255,.1))',
  borderRadius: 8,
  padding: '8px 10px',
  color: 'var(--v2-ink-0, #fff)',
  fontFamily: 'var(--v2-sans)',
  fontSize: 12,
  colorScheme: 'dark',
}
