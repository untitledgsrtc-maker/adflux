// =====================================================================
// Brand block — pulled from env vars so they're configurable per
// deployment without code changes.
// =====================================================================

export function brandFromEnv() {
  return {
    brandName:    process.env.BRAND_NAME    || 'Untitled Advertising',
    brandNameGu:  process.env.BRAND_NAME_GU || 'અનટાઈટલ્ડ એડવર્ટાઇઝિંગ',
    gstin:        process.env.BRAND_GSTIN   || '24XXXXX0000X1ZX',
    pan:          process.env.BRAND_PAN     || 'XXXXX0000X',
    hsn:          process.env.BRAND_HSN     || '998361',
  };
}
