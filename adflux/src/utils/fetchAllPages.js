// Read every row of a PostgREST query in 1000-row pages (the server caps one request near 1000).
// First page alone: small lists (reps) still cost one round trip. A full first page means more rows, so the
// rest come in parallel waves instead of one-after-another (admin: 13 sequential requests -> ~4 waves).
// makeQuery(from, to) must return a fresh query with .range(from, to) applied and a stable order.
// Returns { data, error } like one query; on an error `data` holds the pages read before it.
export async function fetchAllPages(makeQuery, { chunk = 1000, max = 20000, wave = 4 } = {}) {
  const first = await makeQuery(0, chunk - 1)
  if (first.error) return { data: [], error: first.error }
  let all = first.data || []
  if (all.length < chunk) return { data: all, error: null }
  for (let offset = chunk; offset < max; offset += wave * chunk) {
    const starts = Array.from({ length: wave }, (_, i) => offset + i * chunk).filter((o) => o < max)
    const pages = await Promise.all(starts.map((o) => makeQuery(o, o + chunk - 1)))
    for (const p of pages) {
      if (p.error) return { data: all, error: p.error }
      const rows = p.data || []
      all = all.concat(rows)
      if (rows.length < chunk) return { data: all, error: null }
    }
  }
  return { data: all, error: null }
}
