// =====================================================================
// Per-target Zod schemas for the status-transition modal. Mirrors the
// validation in transition_proposal_status() RPC and the existing
// proposal triggers (enforce_office_copy_on_sent, enforce_po_for_won).
// =====================================================================

import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const httpUrl = z.string().url('Must be a valid URL').refine(
  (v) => /^https?:\/\//i.test(v),
  { message: 'URL must start with http(s)://' }
);

export const sentSchema = z.object({
  submission_mode: z.enum(['PHYSICAL', 'EMAIL', 'COURIER']),
  office_copy_url: z.string().optional().or(z.literal('')),
}).refine(
  (d) => !(d.submission_mode === 'PHYSICAL' && !d.office_copy_url?.trim()),
  { message: 'Office-copy URL (Drive link) is required for PHYSICAL submissions', path: ['office_copy_url'] }
).refine(
  (d) => !d.office_copy_url || /^https?:\/\//i.test(d.office_copy_url),
  { message: 'Office-copy URL must start with http(s)://', path: ['office_copy_url'] }
);

export const wonSchema = z.object({
  po_number:  z.string().trim().min(1, 'PO number is required').max(120),
  po_date:    isoDate,
  po_amount:  z.coerce.number().positive('PO amount must be > 0'),
  po_file_url: httpUrl,
});

export const rejectedSchema = z.object({
  rejected_reason: z.string().max(1000).optional().or(z.literal('')),
});

export const cancelledSchema = z.object({
  cancelled_reason: z.string().trim().min(5, 'A reason of at least 5 characters is required').max(1000),
});

export const SCHEMAS_BY_TARGET = {
  SENT:      sentSchema,
  WON:       wonSchema,
  REJECTED:  rejectedSchema,
  CANCELLED: cancelledSchema,
};

export function validateTransition(targetStatus, payload) {
  const schema = SCHEMAS_BY_TARGET[targetStatus];
  if (!schema) return { ok: true, value: payload };
  const r = schema.safeParse(payload);
  if (r.success) return { ok: true, value: r.data };
  const errors = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
