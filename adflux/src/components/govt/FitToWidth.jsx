import { useEffect, useRef, useState } from 'react'

// Phone preview of an A4 letter: render at the real width, then zoom it down to
// fit, so the layout matches the PDF instead of reflowing into a narrow strip.
export function FitToWidth({ width = 794, children }) {
  const ref = useRef(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={ref}>
      <div style={scale < 1 ? { width, zoom: scale } : undefined}>{children}</div>
    </div>
  )
}
