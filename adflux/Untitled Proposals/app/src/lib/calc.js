// =====================================================================
// Pricing & TDS calculators — pure, deterministic, easy to unit-test.
// Mirrors the math the DB triggers do, so the wizard can show the
// final number BEFORE saving.
// =====================================================================

/**
 * Round to 2 decimals, away-from-zero. Matches Postgres `round(x, 2)` for
 * the values we actually care about (currency to 2dp).
 *
 * Naive Math.round(v*100)/100 is wrong for values like 1.005 because
 * IEEE 754 stores 1.005 as 1.00499… so it rounds DOWN. The +EPSILON
 * trick nudges over the boundary in those cases without breaking
 * already-correct values.
 *
 * Tested boundaries: 1.005→1.01, 1.004→1.00, 1.015→1.02, 0.1+0.2→0.3.
 * If we ever start hitting precision pain (>9-digit amounts) we'll
 * switch to a string-based decimal lib.
 */
export function round2(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  return sign * Math.round((abs + Number.EPSILON) * 100) / 100;
}

/**
 * GSRTC line item subtotal.
 *   units = monthly_spots × duration_months (passed pre-multiplied)
 *   rate  = per-slot rate (DAVP) OR monthly rate (AGENCY)
 */
export function calcLineSubtotal({ units, unitRate }) {
  return round2(Number(units || 0) * Number(unitRate || 0));
}

/**
 * Auto line item subtotal.
 *   rickshaws × duration_days (or × campaign_duration if you bill per-campaign)
 *   × per-rickshaw rate
 */
export function calcAutoSubtotal({ rickshaws, perRickshawRate }) {
  return round2(Number(rickshaws || 0) * Number(perRickshawRate || 0));
}

/** Sum of line subtotals → proposal subtotal. */
export function sumLineItems(lines) {
  return round2((lines ?? []).reduce((acc, l) => acc + Number(l.line_subtotal || 0), 0));
}

/** GST math. discount is applied BEFORE GST. */
export function calcProposalTotals({ lines, gstPercent = 18, discountPercent = 0, discountAmount = 0 }) {
  const subtotal = sumLineItems(lines);

  // Discount: percent and flat are mutually exclusive in the UI but we
  // tolerate both being set; flat wins because it's the more specific override.
  let discount = 0;
  if (discountAmount > 0) {
    discount = round2(discountAmount);
  } else if (discountPercent > 0) {
    discount = round2(subtotal * Number(discountPercent) / 100);
  }

  const taxable = round2(subtotal - discount);
  const gstAmount = round2(taxable * Number(gstPercent) / 100);
  const total = round2(taxable + gstAmount);

  return {
    subtotal,
    discountAmount: discount,
    taxable,
    gstAmount,
    totalAmount: total,
  };
}

/**
 * Receipt TDS math (mirrors the DB compute_receipt_tds_amounts trigger).
 * Defaults: 2% income (sec 194C for company contractors)
 *           2% GST    (sec 51 for notified deductors).
 */
export function calcReceiptTds({ gross, tdsIncomePercent = 2, tdsGstPercent = 2 }) {
  const g = Number(gross || 0);
  const tdsIncome = round2(g * Number(tdsIncomePercent) / 100);
  const tdsGst    = round2(g * Number(tdsGstPercent) / 100);
  const totalTds  = round2(tdsIncome + tdsGst);
  const net       = round2(g - tdsIncome - tdsGst);
  return { gross: round2(g), tdsIncome, tdsGst, totalTds, net };
}

/**
 * Outstanding balance + payment status — same logic as the DB rollup
 * trigger, used for client-side previews before save.
 */
export function calcPaymentStatus({ expected, grossReceived }) {
  const exp = Number(expected || 0);
  const got = Number(grossReceived || 0);
  const outstanding = round2(exp - got);

  let status = 'NOT_STARTED';
  if (got === 0) status = 'NOT_STARTED';
  else if (got > exp) status = 'OVERPAID';
  else if (got >= exp) status = 'FULL';
  else status = 'PARTIAL';

  return { outstanding, paymentStatus: status };
}
