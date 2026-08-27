// src/utils/opsMaps.js
// Shared Google-Maps directions helper for the ops field surfaces (field-tech
// quick-win #1, 2026-08-28). Builds a directions URL to a depot's GPS, else a
// name search. Used by OpsHome / OpsDown / OpsTickets so the tech can go from
// "this station is down" to "driving there" in one tap. OpsWorkV2 keeps its own
// local copy (§16 — not refactored); this is the one source for the new usages.

export function depotMapsUrl(depot) {
  if (!depot) return ''
  if (depot.lat != null && depot.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${depot.lat},${depot.lng}`
  }
  if (depot.name) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(depot.name + ', Gujarat')}`
  }
  return ''
}
