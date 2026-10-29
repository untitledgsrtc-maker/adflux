// Phase 531 — trustworthy "internet was off" recording.
//
// Why: the Android network callback (onLost / VALIDATED flicker) fires while the
// phone is actually online. 14-day data: in every recorded "gap" the phone had
// kept uploading GPS pings live. The old code wrote an OPEN row on the first
// "offline" signal, and the closing "online" signal was often lost, so rows ran
// for hours / days.
//
// Rules here:
//   1. An "offline" signal is only a CLAIM. It is confirmed by a failed probe of
//      the backend (first probe after CONFIRM_MS). A probe that succeeds first =
//      false alarm, nothing is recorded.
//   2. Nothing is written while offline (a truly offline phone can't write, and a
//      write that succeeds proves it was online). The gap is written ONCE, as a
//      COMPLETE row, when connectivity returns.
//   3. If the native "online" signal is lost (app paused), the gap ends at the
//      last FAILED probe: a floor, never an inflated number.
//   4. Gaps shorter than MIN_GAP_MS are ignored.
//
// Pure logic with injected dependencies so it can be unit-tested without a phone.

export const NET_CONFIRM_MS = 20 * 1000
export const NET_PROBE_EVERY_MS = 30 * 1000
export const NET_MIN_GAP_MS = 2 * 60 * 1000

export function createNetGapTracker({
  probe,                       // async () => boolean   (true = backend reachable)
  record,                      // async (lostMs, regainedMs) => void
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
}) {
  let offlineSinceMs = null
  let lastFailedProbeMs = null
  let timer = null

  function stopTimer() {
    if (timer) { clearTimer(timer); timer = null }
  }

  function schedule(ms) {
    stopTimer()
    timer = setTimer(runProbe, ms)
  }

  async function finish(lostMs, regainedMs) {
    if (regainedMs - lostMs < NET_MIN_GAP_MS) return
    await record(lostMs, regainedMs)
  }

  async function runProbe() {
    timer = null
    if (offlineSinceMs == null) return
    const since = offlineSinceMs
    let reachable = false
    try { reachable = !!(await probe()) } catch { reachable = false }
    if (offlineSinceMs !== since) return          // state changed while probing
    if (!reachable) {
      lastFailedProbeMs = now()
      schedule(NET_PROBE_EVERY_MS)
      return
    }
    const knownDownTo = lastFailedProbeMs
    offlineSinceMs = null
    lastFailedProbeMs = null
    if (knownDownTo == null) return               // reachable on first probe: false alarm
    await finish(since, knownDownTo)              // end unknown -> last failed probe (floor)
  }

  // Called with the native signal: { online, atMs }.
  async function onNetworkState(online, atMs) {
    if (!online) {
      if (offlineSinceMs == null) {
        offlineSinceMs = atMs
        lastFailedProbeMs = null
        schedule(NET_CONFIRM_MS)
      }
      return
    }
    if (offlineSinceMs == null) return
    const since = offlineSinceMs
    const confirmed = lastFailedProbeMs != null
    stopTimer()
    offlineSinceMs = null
    lastFailedProbeMs = null
    if (!confirmed) return                         // never confirmed offline: false alarm
    await finish(since, atMs)                      // native timestamp = true reconnect time
  }

  function reset() {
    stopTimer()
    offlineSinceMs = null
    lastFailedProbeMs = null
  }

  return { onNetworkState, reset }
}
