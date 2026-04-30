// =====================================================================
// Zod schemas for receipt creation. Mirrors the DB constraints in
// migration 004 + the create_receipt RPC validation in 009.
// =====================================================================

import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const RECEIPT_TYPES = ['ADVANCE', 'PART_PAYMENT', 'FINAL_PAYMENT', 'FULL_PAYMENT'];
export const PAYMENT_MODES = ['CASH', 'CHEQUE', 'DRAFT', 'NEFT', 'RTGS', 'UPI'];

export const receiptCreateSchema = z.object({
  proposal_id: z.string().uuid('Pick a proposal'),
  receipt_date: isoDate,
  receipt_type: z.enum(RECEIPT_TYPES),
  gross_amount: z.coerce.number().positive('Gross must be > 0'),
  tds_income_percent: z.coerce.number().min(0).max(100).default(2),
  tds_gst_percent:    z.coerce.number().min(0).max(100).default(2),
  payment_mode: z.enum(PAYMENT_MODES),
  cheque_or_ref_no: z.string().max(100).optional().or(z.literal('')),
  cheque_date: z.string().optional().or(z.literal('')),
  bank_name: z.string().max(200).optional().or(z.literal('')),
  subject_to_realisation: z.coerce.boolean().default(true),
  hsn_sac_code: z.string().default('998361'),
  gst_percent_applied: z.coerce.number().min(0).max(100).default(18),
  notes: z.string().max(1000).optional().or(z.literal('')),
}).refine(
  // Cheque + DD MUST have a reference number
  (d) => !((d.payment_mode === 'CHEQUE' || d.payment_mode === 'DRAFT')
            && !d.cheque_or_ref_no?.trim()),
  { message: 'Cheque/DD requires a reference number', path: ['cheque_or_ref_no'] }
).refine(
  // Cheque MUST have a cheque date
  (d) => !(d.payment_mode === 'CHEQUE' && !d.cheque_date),
  { message: 'Cheque date required for CHEQUE payment mode', path: ['cheque_date'] }
);

export const softDeleteSchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
});

export function validateReceipt(data) {
  const r = receiptCreateSchema.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  const errors = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
