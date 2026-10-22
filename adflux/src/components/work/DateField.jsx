// Phase 458: a date box that ALWAYS shows dd/mm/yyyy.
// The native <input type="date"> shows the language of the PC / browser (mm/dd/yyyy on most Windows PCs), which the
// team could not read. This keeps the native calendar (so picking works the same everywhere) but draws the date
// itself as dd/mm/yyyy. Same props and same onChange event as a normal date input.
import { useRef } from 'react'
import { CalendarDays } from 'lucide-react'

function show(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return ''
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
}

export default function DateField({ value, onChange, className = '', style, min, max, id, required, disabled, 'aria-label': ariaLabel }) {
  const ref = useRef(null)
  const text = show(value)
  const open = () => { try { ref.current?.showPicker?.() } catch { /* older engines: the native input still opens on its own icon */ } }
  return (
    <span style={{ position: 'relative', display: style?.width ? 'inline-block' : 'block', ...(style || {}) }}>
      <span className={className} aria-hidden="true"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', minHeight: style?.minHeight, boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ opacity: text ? 1 : 0.55 }}>{text || 'dd/mm/yyyy'}</span>
        <CalendarDays size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
      </span>
      <input ref={ref} id={id} type="date" value={value || ''} min={min} max={max} required={required} disabled={disabled} aria-label={ariaLabel}
        onChange={onChange} onClick={open}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, padding: 0, margin: 0 }} />
    </span>
  )
}
