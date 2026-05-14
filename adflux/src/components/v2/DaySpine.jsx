// src/components/v2/DaySpine.jsx
//
// Phase 36 — Day Spine. A vertical 2px hairline pinned to the LEFT
// edge of /work content, with 13 dots representing the rep's
// working hours (08:00 → 20:00, one dot per hour).
//
// Dot states:
//   • future        — small slate, half opacity
//   • past          — small ink, full opacity
//   • current hour  — bigger yellow circle with a pulse halo
//   • has activity  — yellow filled overlay on top of the hour dot
//
// Tapping a dot scrolls /work to that time's surface. The mapping
// from hour → DOM target is owner-defined (see `hourTargets` prop);
// callers pass a record like { 11: 'planned-meeting-1' }, the spine
// finds the DOM node by that id and scrolls.
//
// The spine reads its "current hour" from `new Date()` in IST. The
// "activity hours" come from `activities` prop — a list of ISO
// timestamps from the rep's work session (meetings logged + tasks
// done). The component bins them into hourly buckets.

import { useEffect, useMemo, useState } from 'react'

const FIRST_HOUR = 8
const LAST_HOUR  = 20
const HOURS      = []
for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) HOURS.push(h)

function istHour(date = new Date()) {
  // Browser-local date adjusted to IST (UTC+5:30). Good enough for
  // a single-region app; if we ever go multi-tz this needs a real
  // tz library.
  const local = new Date(date)
  const utcMs = local.getTime() + local.getTimezoneOffset() * 60000
  const istMs = utcMs + 5.5 * 60 * 60 * 1000
  return new Date(istMs).getHours()
}

/**
 * @param {object} props
 * @param {string[]} [props.activities=[]] — ISO timestamps to mark on
 *   the spine (typically meetings logged + tasks completed today)
 * @param {Record<number, string>} [props.hourTargets={}] — map of
 *   hour → DOM id; clicking a dot scrolls that element into view
 */
export default function DaySpine({ activities = [], hourTargets = {} }) {
  const [now, setNow] = useState(() => istHour())

  // Update the "current hour" indicator every minute. Cheap; one
  // setState call. Stops updating after the last working hour.
  useEffect(() => {
    const id = setInterval(() => setNow(istHour()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Bucket activity timestamps into hourly bins. Set lookup avoids
  // N×M comparison in render.
  const activeHours = useMemo(() => {
    const s = new Set()
    for (const iso of activities) {
      if (!iso) continue
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) continue
      s.add(istHour(d))
    }
    return s
  }, [activities])

  function scrollToHour(h) {
    const targetId = hourTargets[h]
    if (!targetId) return
    const el = document.getElementById(targetId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="v3-spine" aria-hidden="false" aria-label="Day timeline">
      {HOURS.map((h, idx) => {
        const isPast    = h < now
        const isCurrent = h === now
        const hasAct    = activeHours.has(h)
        // 13 dots, evenly spaced from 4% to 96% so the gradient
        // line's faded ends don't cut the top + bottom dots.
        const pct = 4 + (idx * (92 / (HOURS.length - 1)))
        const classes = [
          'v3-spine-dot',
          isPast ? 'v3-spine-dot--past' : '',
          isCurrent ? 'v3-spine-dot--current' : '',
          hasAct ? 'v3-spine-dot--activity' : '',
        ].filter(Boolean).join(' ')
        return (
          <span key={h}>
            <span
              role="button"
              tabIndex={hourTargets[h] ? 0 : -1}
              className={classes}
              style={{ top: `${pct}%` }}
              onClick={() => scrollToHour(h)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && hourTargets[h]) {
                  e.preventDefault()
                  scrollToHour(h)
                }
              }}
              aria-label={`${String(h).padStart(2, '0')}:00${hasAct ? ' · activity logged' : ''}${isCurrent ? ' · current hour' : ''}`}
            />
            {/* Hour label every 4 hours (08, 12, 16, 20) — keeps
                the spine readable without crowding. */}
            {(h - FIRST_HOUR) % 4 === 0 && (
              <span className="v3-spine-hour" style={{ top: `calc(${pct}% - 4px)` }}>
                {String(h).padStart(2, '0')}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
