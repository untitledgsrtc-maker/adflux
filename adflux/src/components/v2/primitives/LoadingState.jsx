// src/components/v2/primitives/LoadingState.jsx
//
// Phase 35 PR 1 — canonical loading state.
//
// Replaces 4 patterns:
//   • v2d-loading + v2d-spinner class (RenewalToolsV2, etc.)
//   • inline <Loader2> with spin animation (MasterV2, GovtProposalDetailV2)
//   • bare <div padding:60>Loading…</div> (SalesDashboard)
//   • <em>Loading…</em> in <td> (AutoDistrictsV2, GsrtcStationsV2)
//
// Variants:
//   page   — full-page centered spinner with label
//   inline — small spinner + label inline
//   table  — N skeleton rows matching column count (rows defaults to 3)

import { Loader2 } from 'lucide-react'

/**
 * @param {object} props
 * @param {'page'|'inline'|'table'} [props.type='page']
 * @param {string} [props.label='Loading…']
 * @param {number} [props.rows=3]      — for type='table' only
 * @param {number} [props.columns=4]   — for type='table' only
 */
export default function LoadingState({
  type = 'page',
  label = 'Loading…',
  rows = 3,
  columns = 4,
}) {
  if (type === 'table') {
    return (
      <>
        {Array.from({ length: rows }).map((_, i) => (
          <tr key={i}>
            {Array.from({ length: columns }).map((__, j) => (
              <td key={j} style={{ padding: '12px 14px' }}>
                <div style={{
                  height: 12,
                  background: 'var(--surface-2)',
                  borderRadius: 6,
                  width: j === 0 ? '60%' : '40%',
                  animation: 'pulse 1.6s ease-in-out infinite',
                }} />
              </td>
            ))}
          </tr>
        ))}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50%      { opacity: 1; }
          }
        `}</style>
      </>
    )
  }

  if (type === 'inline') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        <Loader2 size={14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
        {label}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </span>
    )
  }

  // page (default)
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: '60px 20px',
      color: 'var(--text-muted)',
      fontSize: 13,
    }}>
      <Loader2 size={22} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
      {label}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
