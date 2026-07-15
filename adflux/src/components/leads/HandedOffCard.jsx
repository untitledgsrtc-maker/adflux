// src/components/leads/HandedOffCard.jsx
//
// Phase 100.E — "leads you handed off" card for the sales rep. Shows leads the
// rep reassigned to someone else, uncontacted (not worked since the handoff)
// FIRST so a neglected lead is visible instead of vanishing. Read-only (the rep
// no longer owns these leads — RLS); the point is sight + accountability, so
// rows are not clickable. Exception-rendered: nothing shows when the rep hasn't
// handed anything off. Data via useHandedOffLeads (the my_handed_off_leads RPC).

import { Share2, Clock } from 'lucide-react'
import useHandedOffLeads from '../../hooks/useHandedOffLeads'

const MAX_SHOWN = 10

function whenLabel(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    })
  } catch { return '' }
}

export default function HandedOffCard({ refreshKey = 0 }) {
  const { items, waiting, workedCount } = useHandedOffLeads(refreshKey)
  if (items.length === 0) return null

  const shown = waiting.slice(0, MAX_SHOWN)
  const extraWaiting = waiting.length - shown.length

  return (
    <div className="lead-card" style={{ marginBottom: 16 }}>
      <div className="lead-card-head" style={{ borderBottom: '1px solid var(--v2-line, #1f2b47)', paddingBottom: 10, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            display: 'inline-flex', width: 30, height: 30, borderRadius: 10,
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--v2-bg-2, #1a2742)', color: 'var(--v2-ink-1, #a9b3c7)',
          }}>
            <Share2 size={16} strokeWidth={1.6} />
          </span>
          <div>
            <div className="lead-card-title">Leads you handed off</div>
            <div className="lead-card-sub">
              {waiting.length > 0
                ? `${waiting.length} not called yet${workedCount > 0 ? ` · ${workedCount} being worked` : ''}`
                : `All ${workedCount} being worked`}
            </div>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div style={{ color: 'var(--v2-green, #10B981)', fontSize: 13, padding: '8px 0' }}>
          Every lead you passed on is being worked.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((it) => (
            <div key={it.lead_id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
              borderBottom: '1px solid var(--v2-line, #1f2b47)',
            }}>
              <span style={{ color: 'var(--v2-rose, #EF4444)', display: 'inline-flex' }}>
                <Clock size={16} strokeWidth={1.6} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.lead_name || it.lead_company || 'Lead'}
                </div>
                <div style={{ color: 'var(--v2-ink-2, #6a7590)', fontSize: 12 }}>
                  → {it.new_owner_name || 'someone'} · {whenLabel(it.handed_off_at)}
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                color: 'var(--v2-rose, #EF4444)',
                background: 'var(--v2-rose-soft, rgba(239,68,68,0.12))',
                border: '1px solid var(--v2-rose, #EF4444)',
                borderRadius: 999, padding: '3px 9px',
              }}>
                not called yet
              </span>
            </div>
          ))}
        </div>
      )}

      {extraWaiting > 0 && (
        <div style={{ color: 'var(--v2-ink-2, #6a7590)', fontSize: 12, paddingTop: 10 }}>
          + {extraWaiting} more not called yet
        </div>
      )}
    </div>
  )
}
