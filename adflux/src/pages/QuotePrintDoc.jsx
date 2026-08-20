// src/pages/QuotePrintDoc.jsx — login-less public print page for the AI
// real-PDF pipeline. A headless-Chromium render service (a 2nd Vercel project)
// navigates a real browser to /quote-print/<ref>?t=<RENDER_SECRET>; this page
// fetches /api/quote-render-data (token-gated) and renders the EXACT
// QuotePDFHtml components as one A4-paginated print document. The service then
// waits for `data-quote-ready="1"` + fonts + images, and page.pdf()s the crisp,
// native, branded 3-page PDF (letterhead + AT-A-GLANCE + per-city photo page +
// thank-you page). Reuses the rep's components 100% — no rebuild.
//
// This route is OUTSIDE V2AppShell + RequireAuth (like /led, /present §77) —
// it's data-driven, no login, gated by the ?t secret at the data endpoint. A
// real user hitting it without the secret gets an error state (the endpoint
// 403s). It's only ever loaded by the server-side headless browser.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  QuotePage,
  QuotePDFHtmlDocument,
  CityPhotoPage,
  ThankYouPage,
  paginateCities,
} from '../components/quotes/QuotePDFHtml'

export default function QuotePrintDoc() {
  const { ref } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    const t = new URLSearchParams(window.location.search).get('t') || ''
    ;(async () => {
      try {
        const r = await fetch(`/api/quote-render-data?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(t)}`, { cache: 'no-store' })
        const d = await r.json()
        if (!alive) return
        if (!r.ok || !d?.ok) { setErr(d?.error || `http_${r.status}`); return }
        setData(d)
      } catch (e) {
        if (alive) setErr(String(e?.message || e))
      }
    })()
    return () => { alive = false }
  }, [ref])

  // Readiness handshake: the Chromium service waits for this flag before
  // page.pdf(). '1' = data fetched + DOM built; 'error' = give up (service
  // falls back to the pdf-lib renderer). Set AFTER render via layout effect.
  useEffect(() => {
    if (err) document.documentElement.setAttribute('data-quote-ready', 'error')
    else if (data) document.documentElement.setAttribute('data-quote-ready', '1')
  }, [data, err])

  if (err) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', color: '#334155' }}>
        Unable to render this quote ({err}).
      </div>
    )
  }
  if (!data) {
    return <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', color: '#94a3b8' }}>Preparing…</div>
  }

  const { quote, cities, company } = data
  const letterheadOn = !!company?.letterhead_url

  // Build the flat list of A4 page elements in the SAME order + with the SAME
  // props as renderToPdfBlob (QuotePDFHtml.jsx). Each component already sizes
  // itself to exactly 794×1123 with overflow:hidden — so each is one page.
  const pageEls = []
  if (letterheadOn) {
    const pages = paginateCities(cities)
    pages.forEach((p, i) => {
      pageEls.push(
        <QuotePage
          key={`q${i}`}
          quote={quote}
          company={company}
          cityChunk={p.cities}
          allCities={cities}
          isFirst={p.isFirst}
          isLast={p.isLast}
          pageIndex={i + 1}
          totalPages={pages.length}
        />
      )
    })
  } else {
    pageEls.push(<QuotePDFHtmlDocument key="doc" quote={quote} cities={cities} company={company} />)
  }
  cities.filter(c => c.photo_url).forEach((c, i) => {
    pageEls.push(<CityPhotoPage key={`p${i}`} city={c} quote={quote} />)
  })
  if (company?.thank_you_url) {
    pageEls.push(<ThankYouPage key="ty" url={company.thank_you_url} />)
  }

  return (
    <>
      <style>{`
        @page { size: 794px 1123px; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        #quote-print-root { background: #fff; }
        .a4wrap { position: relative; width: 794px; }
      `}</style>
      <div id="quote-print-root">
        {pageEls.map((el, i) => (
          <div
            key={i}
            className="a4wrap"
            style={{ breakAfter: i < pageEls.length - 1 ? 'page' : 'auto' }}
          >
            {el}
          </div>
        ))}
      </div>
    </>
  )
}
