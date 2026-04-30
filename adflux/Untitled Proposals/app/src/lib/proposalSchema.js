// =====================================================================
// Per-step Zod schemas for the proposal wizard.
//
// Each step exports a schema that validates JUST the fields that step
// owns. The wizard runs the appropriate schema before allowing
// nextStep(). The full schema (proposalFullSchema) is run once on
// final submit, as a belt-and-braces check before the RPC call.
// =====================================================================

import { z } from 'zod';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

// ------- Step 1 — client + media -------
export const step1Schema = z.object({
  client_id: uuid.nullable().refine((v) => v != null, { message: 'Pick a client' }),
  media_id: uuid.nullable().refine((v) => v != null, { message: 'Pick a media type' }),
  media_code: z.enum(['AUTO', 'GSRTC']),
  rate_type: z.enum(['DAVP', 'AGENCY']),
  language: z.enum(['gu', 'en']),
});

// ------- Step 2 — subject + dates -------
export const step2Schema = z.object({
  proposal_date: isoDate,
  subject_en: z.string().trim().min(1, 'Subject (English) is required').max(500),
  subject_gu: z.string().trim().min(1, 'વિષય (ગુજરાતી) જરૂરી છે').max(500),
  campaign_duration_days: z.coerce.number().int().min(1).max(365),
  campaign_start_date: z.string().optional().or(z.literal('')),
  campaign_end_date: z.string().optional().or(z.literal('')),
  expire_after_days: z.coerce.number().int().min(7).max(365).default(120),
}).refine(
  (d) => {
    if (!d.campaign_start_date || !d.campaign_end_date) return true;
    return new Date(d.campaign_end_date) >= new Date(d.campaign_start_date);
  },
  { message: 'Campaign end date must be on or after start date', path: ['campaign_end_date'] }
);

// ------- Step 3 — line items -------
const lineItemSchema = z.object({
  location_type: z.enum(['GSRTC_STATION', 'AUTO_DISTRICT', 'AUTO_FULL_STATE', 'CUSTOM']),
  location_name_snapshot: z.string().min(1),
  location_name_gu_snapshot: z.string().optional().nullable(),
  units: z.coerce.number().int().positive('Units must be > 0'),
  duration_days: z.coerce.number().int().positive(),
  unit_rate_snapshot: z.coerce.number().nonnegative(),
  line_subtotal: z.coerce.number().nonnegative(),
  // optional FK columns — populated based on location_type
  gsrtc_station_id: uuid.nullable().optional(),
  auto_district_id: uuid.nullable().optional(),
  meta_snapshot: z.record(z.any()).optional(),
});

export const step3Schema = z.object({
  line_items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
});

// ------- Step 4 — pricing -------
export const step4Schema = z.object({
  gst_percent: z.coerce.number().min(0).max(100),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
  discount_amount: z.coerce.number().min(0).default(0),
  discount_reason: z.string().max(300).optional().or(z.literal('')),
}).refine(
  (d) => !(d.discount_percent > 0 && d.discount_amount > 0),
  { message: 'Use either percent or flat discount, not both', path: ['discount_amount'] }
).refine(
  (d) => (d.discount_percent > 0 || d.discount_amount > 0)
    ? (d.discount_reason && d.discount_reason.trim().length >= 3)
    : true,
  { message: 'Discount reason required when discount applied', path: ['discount_reason'] }
);

// ------- Step 5 — signer -------
export const step5Schema = z.object({
  team_member_id: uuid.nullable().refine((v) => v != null, { message: 'Pick a signer' }),
});

// ------- Step 6 — final review (notes optional) -------
export const step6Schema = z.object({
  notes_internal: z.string().max(2000).optional().or(z.literal('')),
  notes_client:   z.string().max(2000).optional().or(z.literal('')),
});

export const STEP_SCHEMAS = {
  1: step1Schema,
  2: step2Schema,
  3: step3Schema,
  4: step4Schema,
  5: step5Schema,
  6: step6Schema,
};

/**
 * Validate the form for a given step. Returns { ok: true } or
 * { ok: false, errors: { fieldPath: 'message', ... } }.
 */
export function validateStep(step, form) {
  const schema = STEP_SCHEMAS[step];
  if (!schema) return { ok: true };
  const res = schema.safeParse(form);
  if (res.success) return { ok: true };
  const errors = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
