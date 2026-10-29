// Industry pre-fill for the lead form. Two sources, both only ever a
// suggestion (the form fills Industry only when it is still empty and the rep
// can overwrite it):
//   1. Google place types from the listing the rep picked (best signal, comes
//      free with the details call already made for phone / city).
//   2. Keywords in the company name (works with no API at all).
// Output labels follow the spellings already most used in the leads table.

const FROM_TYPES = [
  [/hospital|doctor|dentist|dental|pharmacy|drugstore|physiotherapist|health|medical|veterinary|clinic/, 'Healthcare'],
  [/school|university|college|library|education/, 'Education'],
  [/car_dealer|car_repair|car_wash|car_rental|motorcycle|auto_parts|gas_station|tire|automotive/, 'Automobile'],
  [/bank|atm|finance|accounting|insurance|loan/, 'Finance'],
  [/restaurant|cafe|bakery|meal_|food|sweet|ice_cream|dairy|bar$/, 'Food'],
  [/lodging|hotel|resort|guest_house|hostel/, 'Hospitality'],
  [/real_estate|construction|general_contractor|home_builder/, 'Real Estate'],
  [/jewelry|jewellery/, 'Jewellery'],
  [/electronics|mobile|computer|appliance/, 'Electronics'],
  [/clothing|shoe|fashion|textile|boutique/, 'Fashion'],
  [/gym|fitness|yoga|sports/, 'Fitness'],
  [/beauty_salon|hair_care|spa|salon/, 'Salon'],
  [/supermarket|grocery|convenience|department_store|shopping_mall|furniture|home_goods|store/, 'Retail'],
]

const FROM_NAME = [
  [/\b(hospital|clinic|diagnostic|diagnostics|dental|pharma|pharmacy|medical|medicare|healthcare|nursing|ayurved\w*|path\s?lab)\b/i, 'Healthcare'],
  [/\b(school|college|academy|institute|classes|university|tuition|vidyalaya|vidyamandir|coaching)\b/i, 'Education'],
  [/\b(motors|automobiles?|autos?|cars?|bikes?|tyres?|tires?|showroom|honda|maruti|hyundai|suzuki|mahindra|toyota)\b/i, 'Automobile'],
  [/\b(bank|finance|financial|capital|insurance|loans?|credit|securities|broking)\b/i, 'Finance'],
  [/\b(restaurant|cafe|foods?|sweets?|bakery|kitchen|dairy|caterers?|snacks|farsan|namkeen)\b/i, 'Food'],
  [/\b(hotel|resort|inn|lodge|guest\s?house)\b/i, 'Hospitality'],
  [/\b(realty|real\s?estate|builders?|developers?|infra\w*|construction|properties|township)\b/i, 'Real Estate'],
  [/\b(jewel\w*|gold|diamonds?|ornaments?)\b/i, 'Jewellery'],
  [/\b(electronics?|electricals?|mobiles?|computers?|appliances?|digital)\b/i, 'Electronics'],
  [/\b(textiles?|fashion|garments?|sarees?|cloth\w*|boutique|apparels?)\b/i, 'Fashion'],
  [/\b(gym|fitness|yoga)\b/i, 'Fitness'],
  [/\b(salon|beauty|spa|parlou?r)\b/i, 'Salon'],
]

export function guessIndustry({ types, name } = {}) {
  const t = Array.isArray(types) ? types.join(' ').toLowerCase() : ''
  if (t) {
    for (const [re, label] of FROM_TYPES) if (re.test(t)) return label
  }
  const n = String(name || '')
  if (n) {
    for (const [re, label] of FROM_NAME) if (re.test(n)) return label
  }
  return ''
}
