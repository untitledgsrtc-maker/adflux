// Phase 311 — THE single source for "when was this quote won".
//
// Every dashboard's "won this period" value/count bucket reads this so they all
// agree with the Quotes page (which dates the Won tab by won_at). Prefers the
// real quotes.won_at (stamped on the status->won flip, immutable), then falls
// back to updated_at / created_at for any row that predates the Phase 311
// backfill. Returns '' when nothing is available (never undefined, so string
// slice/compare callers are safe).
//
// NOTE: this is for the WON-month attribution only. Do NOT use it for LOST
// buckets (there is no won date on a lost quote — keep updated_at there) or for
// collection-aging metrics (those anchor on their own timestamps).
export const wonDate = (q) => (q && (q.won_at || q.updated_at || q.created_at)) || ''
