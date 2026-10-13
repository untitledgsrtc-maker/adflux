// ONE leaderboard definition for the admin dashboard and both sales dashboards
// (section 71, Phase 363). Owner rule 13 Oct 2026: quotes SENT vs quotes WON AND
// PAID in the period. The numbers come from the database function
// team_leaderboard_month (db/functions/team_leaderboard_month.sql) - display only.
//
// from/to: 'YYYY-MM-DD' (an IST day, to is EXCLUSIVE) or a full ISO timestamp.
// Returns null when the function is unavailable (caller shows "couldn't load").

const toBound = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? `${v}T00:00:00+05:30` : v)

export async function fetchTeamLeaderboard(supabase, from, to) {
  try {
    const { data, error } = await supabase.rpc('team_leaderboard_month', {
      p_from: toBound(from),
      p_to: toBound(to),
    })
    if (error) {
      console.warn('[leaderboard] team_leaderboard_month failed', error)
      return null
    }
    return (data || [])
      .map((r) => {
        const sent = Number(r.sent_count) || 0
        const wonPaid = Number(r.won_paid_count) || 0
        return {
          id: r.user_id,
          name: r.name,
          role: r.role,
          sent,
          sentAmt: Number(r.sent_amount) || 0,
          wonPaid,
          wonPaidAmt: Number(r.won_paid_amount) || 0,
          wonUnpaid: Number(r.won_unpaid_count) || 0,
          conv: sent > 0 ? Math.round((wonPaid / sent) * 100) : null,
        }
      })
      .sort((a, b) =>
        b.wonPaidAmt - a.wonPaidAmt || b.wonPaid - a.wonPaid || b.sent - a.sent
        || String(a.name).localeCompare(String(b.name)))
  } catch (e) {
    console.warn('[leaderboard] unexpected error', e)
    return null
  }
}

// Share of the team's won-and-paid value (drives the thin bar / % cell).
export function lbShare(row, rows) {
  const total = (rows || []).reduce((s, r) => s + (r.wonPaidAmt || 0), 0)
  return total > 0 ? Math.round(((row.wonPaidAmt || 0) / total) * 100) : 0
}
