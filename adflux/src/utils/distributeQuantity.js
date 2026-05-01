// src/utils/distributeQuantity.js
//
// Auto Hood quantity distribution algorithm.
//
// Rule (locked decision, owner 30 Apr 2026):
//
//   You enter a total rickshaw quantity (e.g. 5000) and pick which
//   districts to include. Each district has a baseline percentage
//   share (sum across all 33 districts = 100). The system distributes
//   the total across the selected subset, RE-NORMALIZING those
//   selected districts' share_pct so they sum to 100% within the
//   subset.
//
//   Example: pick only Ahmedabad (20%) + Surat (15%) = 35% combined.
//   Total 5000 → Ahmedabad gets 5000 * (20/35) = 2857; Surat gets
//   5000 * (15/35) = 2143; sum = 5000.
//
// We round each per-district quantity to the nearest integer, then
// fix the residual on the largest-share district so the sum exactly
// equals the requested total — no fractional rickshaws and no
// off-by-one due to rounding.

export function distributeAutoHoodQuantity(total, districts) {
  // Defensive — if no districts or zero total, nothing to distribute.
  const safeTotal = Math.max(0, Math.round(Number(total) || 0))
  const selected = (districts || [])
    .filter(d => d && d.share_pct != null && Number(d.share_pct) > 0)

  if (!selected.length || safeTotal === 0) {
    return selected.map(d => ({ ...d, allocated_qty: 0, normalized_pct: 0 }))
  }

  const sumPct = selected.reduce((s, d) => s + Number(d.share_pct), 0)
  if (sumPct <= 0) {
    return selected.map(d => ({ ...d, allocated_qty: 0, normalized_pct: 0 }))
  }

  // First pass — proportional rounding.
  const rows = selected.map(d => {
    const norm = Number(d.share_pct) / sumPct       // 0..1
    const raw  = safeTotal * norm
    return {
      ...d,
      normalized_pct: norm * 100,                    // % for display
      _raw: raw,
      allocated_qty: Math.round(raw),
    }
  })

  // Residual fix — push the off-by-N onto the largest-share row.
  const allocSum = rows.reduce((s, r) => s + r.allocated_qty, 0)
  const residual = safeTotal - allocSum
  if (residual !== 0 && rows.length) {
    const biggest = rows.reduce(
      (best, r) => (r.normalized_pct > best.normalized_pct ? r : best),
      rows[0],
    )
    biggest.allocated_qty = Math.max(0, biggest.allocated_qty + residual)
  }

  // Strip the internal _raw scratch.
  return rows.map(({ _raw, ...rest }) => rest)
}
