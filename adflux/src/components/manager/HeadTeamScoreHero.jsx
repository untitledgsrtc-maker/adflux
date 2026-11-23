// Phase 659 - sales head's Today hero shows his TEAM score, not his own
// meetings (owner 23 Nov 2026). Reads his own daily_performance row for
// today, which compute_daily_score fills with the team average (Phase 658):
// score_pct = team average, meetings_done = reps counted, meetings_target = reps.
import { useCallback, useEffect, useState } from 'react'
import V2Hero from '../v2/V2Hero'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import useAutoRefresh from '../../hooks/useAutoRefresh'

export default function HeadTeamScoreHero({ userId, eyebrow, footerStats, footerCta }) {
  const [row, setRow] = useState(undefined)   // undefined = loading, null = no row yet

  const load = useCallback(async () => {
    if (!userId) return
    const { data, error } = await supabase.from('daily_performance')
      .select('score_pct, meetings_done, meetings_target, is_excluded')
      .eq('user_id', userId).eq('work_date', istTodayISO()).maybeSingle()
    if (!error) setRow(data || null)
  }, [userId])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load, { pollSeconds: 120, userId })

  const pct = row && !row.is_excluded ? Math.round(Number(row.score_pct) || 0) : null
  const counted = row?.meetings_done || 0
  const reps = row?.meetings_target || 0

  return (
    <V2Hero
      eyebrow={eyebrow}
      value={row === undefined ? '…' : pct === null ? 'No score yet' : `${pct}%`}
      label={pct === null ? 'team score shows once a rep logs work' : `team score · ${counted} of ${reps} reps counted`}
      percent={pct ?? 0}
      right={pct === null ? undefined : { tone: pct >= 100 ? 'up' : 'down', text: pct >= 100 ? 'target hit' : `${100 - pct}% to go` }}
      accent={pct !== null && pct >= 100}
      footerStats={footerStats}
      footerCta={footerCta}
    />
  )
}
