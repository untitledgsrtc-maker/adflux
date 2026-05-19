// src/components/v2/SwipeToCheckIn.jsx
//
// Phase 60 (19 May 2026) — swipe-to-confirm pill for the check-in
// landing page. Owner directive: pocket-tap protection — a 1-tap
// button risks accidental check-in (rep's phone bumping things in
// the bag). A directional drag gesture cannot fire by accident.
//
// Layout:
//   [ swipe-handle ────────────────── "Swipe to check-in" ]
//                                                  full-width pill
//
// Drag right past 80% of the pill width → release → fires onConfirm.
// Release before 80% → snaps back, no fire.
//
// Touch + pointer events both supported (covers desktop + Capacitor
// WebView). State machine: idle → dragging → released. While loading
// (after successful onConfirm), the pill shows a centered spinner
// and locks input.

import React, { useRef, useState, useCallback } from 'react'
import { ChevronRight, Loader2, CheckCircle2 } from 'lucide-react'

export default function SwipeToCheckIn({
  label = 'Swipe to check-in',
  onConfirm,
  disabled = false,
  loading = false,
  done = false,
}) {
  const trackRef = useRef(null)
  const [dragX, setDragX] = useState(0)         // px from left
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const trackWidth = useRef(0)

  const reset = useCallback(() => {
    setDragX(0)
    setDragging(false)
  }, [])

  const onPointerDown = (e) => {
    if (disabled || loading || done) return
    setDragging(true)
    startX.current = e.clientX ?? e.touches?.[0]?.clientX ?? 0
    trackWidth.current = trackRef.current?.offsetWidth ?? 0
  }

  const onPointerMove = (e) => {
    if (!dragging) return
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0
    // Handle width is 56px; clamp so the handle doesn't escape track.
    const max = Math.max(0, trackWidth.current - 56)
    const next = Math.min(max, Math.max(0, x - startX.current))
    setDragX(next)
  }

  const onPointerUp = () => {
    if (!dragging) return
    const threshold = (trackWidth.current - 56) * 0.8
    if (dragX >= threshold) {
      // Lock at the right edge while caller processes.
      setDragX(trackWidth.current - 56)
      setDragging(false)
      onConfirm?.()
    } else {
      reset()
    }
  }

  // Visual fill percentage — yellow track fills behind the handle.
  const fillPct = trackWidth.current > 0
    ? Math.min(100, (dragX / Math.max(1, trackWidth.current - 56)) * 100)
    : 0

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onTouchStart={onPointerDown}
      onTouchMove={onPointerMove}
      onTouchEnd={onPointerUp}
      style={{
        position:        'relative',
        height:          72,
        borderRadius:    999,
        background:      'var(--v2-bg-2, #1e293b)',
        border:          '1px solid var(--v2-line, #334155)',
        overflow:        'hidden',
        touchAction:     'none',
        userSelect:      'none',
        cursor:          disabled || loading || done ? 'default' : 'grab',
        opacity:         disabled ? 0.55 : 1,
        transition:      'opacity 200ms',
      }}
    >
      {/* Yellow fill behind the handle */}
      <div style={{
        position:    'absolute',
        inset:       0,
        width:       `${fillPct}%`,
        background:  'var(--v2-yellow, #FFE600)',
        opacity:     0.85,
        transition:  dragging ? 'none' : 'width 220ms ease-out',
      }} />

      {/* Label — fades as the handle slides over it */}
      <div style={{
        position:       'absolute',
        inset:          0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontFamily:     'var(--v2-display, "Space Grotesk")',
        fontSize:       17,
        fontWeight:     600,
        color:          'var(--v2-ink-0, #f1f5f9)',
        opacity:        Math.max(0, 1 - fillPct / 70),
        transition:     dragging ? 'none' : 'opacity 220ms',
        pointerEvents:  'none',
      }}>
        {done ? 'Checked in' : (loading ? 'Saving…' : label)}
      </div>

      {/* Loading / done overlay */}
      {(loading || done) && (
        <div style={{
          position:       'absolute',
          inset:          0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          color:          'var(--accent-fg, #0f172a)',
        }}>
          {done
            ? <CheckCircle2 size={28} strokeWidth={2} />
            : <Loader2 size={28} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
          }
        </div>
      )}

      {/* Draggable handle (yellow circle with chevron) */}
      {!loading && !done && (
        <div
          style={{
            position:        'absolute',
            top:             8,
            left:            8,
            width:           56,
            height:          56,
            borderRadius:    '50%',
            background:      'var(--v2-yellow, #FFE600)',
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            color:           'var(--accent-fg, #0f172a)',
            transform:       `translateX(${dragX}px)`,
            transition:      dragging ? 'none' : 'transform 220ms ease-out',
            boxShadow:       '0 4px 12px rgba(0,0,0,0.18)',
            pointerEvents:   'none',
          }}
        >
          <ChevronRight size={28} strokeWidth={2.4} />
        </div>
      )}
    </div>
  )
}
