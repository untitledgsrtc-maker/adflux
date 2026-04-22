// <Money> — Adflux money primitive (Batch 1 · Sales Core spec).
//
// mode="display" (default): flips to L / Cr at ₹1,00,000.
//   ₹0 · ₹1,250 · ₹1.25L · ₹18.64L · ₹1.2Cr · -₹500
//
// mode="inline": always full form. Use in tables, history, PDFs.
//   ₹0 · ₹1,250 · ₹1,25,000 · ₹18,64,000 · ₹1,20,00,000 · -₹500
import { formatMoneyDisplay, formatMoneyInline } from '../../utils/formatters'

export function Money({ value, mode = 'display', className = '', ...rest }) {
  const text = mode === 'inline' ? formatMoneyInline(value) : formatMoneyDisplay(value)
  return (
    <span className={className} {...rest}>
      {text}
    </span>
  )
}
