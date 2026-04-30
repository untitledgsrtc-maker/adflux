// =====================================================================
// Formatting helpers — Indian conventions (₹, lakh-comma grouping, FY).
// Pure functions. No side effects. Safe to import anywhere.
// =====================================================================

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const INR_PLAIN = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const INR_INT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Format a number as ₹1,02,660.00 (Indian grouping). */
export function fmtInr(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return INR.format(Number(n));
}

/** Format as 1,02,660.00 (no symbol — for tables). */
export function fmtInrPlain(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return INR_PLAIN.format(Number(n));
}

/** Integer Indian grouping. */
export function fmtIntIn(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return INR_INT.format(Number(n));
}

/** Indian financial year string ('2026-27') for a JS Date. */
export function fyForDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-indexed
  const startYear = m >= 3 ? y : y - 1; // April = month 3
  const endYY = String(startYear + 1).slice(-2);
  return `${startYear}-${endYY}`;
}

/** Current FY (handy default). */
export function currentFy() {
  return fyForDate(new Date());
}

/** Format dd-mm-yyyy (Indian date convention used in govt forms). */
export function fmtDateIn(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Validate GSTIN — 15 chars: 2 state + 10 PAN + 1 entity + Z + 1 checksum.
 * Returns true / false (no checksum verification — DB enforces format only).
 */
const GSTIN_RX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export function isValidGstin(s) {
  return typeof s === 'string' && GSTIN_RX.test(s.toUpperCase());
}

const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export function isValidPan(s) {
  return typeof s === 'string' && PAN_RX.test(s.toUpperCase());
}

/** Compose a bilingual label "ગુજરાતી / English". */
export function bilang(gu, en) {
  if (gu && en) return `${gu} / ${en}`;
  return gu || en || '';
}
