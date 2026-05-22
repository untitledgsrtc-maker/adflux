// src/components/work/GpsOffBanner.jsx
//
// Phase 76 — red banner shown above the /work hero whenever the
// rep's GPS toggle is OFF. Replaces the 6 productive buttons with
// a "Turn on GPS" CTA. One tap fires SettingsClient.checkLocation-
// Settings (native) which shows the system dialog without leaving
// the app.
//
// Brand tokens only — v2-rose tint for the danger background,
// v2-yellow CTA per CLAUDE.md §28 (brand+CTA only).
//
// Mount pattern (WorkV2 + LeadDetailV2):
//   const { gpsOn, requestEnable, isNative } = useGpsLock()
//   if (gpsOn === false) return <GpsOffBanner onEnable={requestEnable} isNative={isNative} />

import React from 'react'
import { MapPin, AlertTriangle } from 'lucide-react'

export default function GpsOffBanner({ onEnable, isNative, compact = false }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:           12,
        padding:       compact ? '10px 12px' : '14px 16px',
        marginBottom:  compact ? 8 : 14,
        background:    'var(--v2-rose-soft, rgba(239,68,68,0.10))',
        border:        '1px solid var(--v2-rose, #EF4444)',
        borderRadius:  10,
        color:         'var(--v2-ink-0, #f1f5f9)',
      }}
    >
      {/* Guardian fix (§7) — Lucide icons must inherit color from
          parent, not take a `color` prop. The icon wrapper below
          provides the rose tint; the icon picks it up via
          currentColor. */}
      <span
        style={{
          display:    'inline-flex',
          flexShrink: 0,
          color:      'var(--v2-rose, #EF4444)',
        }}
      >
        <AlertTriangle size={20} strokeWidth={1.6} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize:   compact ? 13 : 14,
            lineHeight: 1.3,
          }}
        >
          GPS is off — turn on to continue work
        </div>
        <div
          style={{
            marginTop:  2,
            fontSize:   12,
            color:      'var(--v2-ink-2, #94a3b8)',
            lineHeight: 1.4,
          }}
        >
          {isNative
            ? 'Tap below to enable Location in one tap.'
            : 'Open phone Settings → Location and turn it ON.'}
        </div>
      </div>
      <button
        type="button"
        onClick={onEnable}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            6,
          padding:        '8px 14px',
          background:     'var(--v2-yellow, #FFE600)',
          color:          'var(--accent-fg, #0f172a)',
          fontWeight:     600,
          fontSize:       13,
          border:         'none',
          borderRadius:   10,
          cursor:         'pointer',
          flexShrink:     0,
        }}
      >
        <MapPin size={14} strokeWidth={1.6} />
        Turn on GPS
      </button>
    </div>
  )
}
