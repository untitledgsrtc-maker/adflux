// =====================================================================
// Proposal wizard state — Zustand + localStorage persistence.
//
// Why a separate store and not React Hook Form across all 6 steps?
// Because:
//   1. Steps 3 + 4 share line-item state and have to recompute totals
//      across boundaries. RHF makes cross-step derived state painful.
//   2. We need auto-save independent of submit. Persisting RHF state
//      between unmounts requires hacks.
//   3. The DB save is one transactional RPC, not 6 calls. Conceptually
//      it's one form spread across 6 screens, with one final submit.
//
// RHF still owns each step's local validation via per-step Zod schemas
// (see proposalSchema.js).
// =====================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { calcProposalTotals } from '@/lib/calc';

const STORAGE_KEY = 'up_proposal_wizard_v1';

const defaultDate = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({
  // Step 1 — client + media
  client_id: null,
  client_snapshot: null,            // populated after picking
  client_contact_id: null,
  contact_snapshot: null,
  media_id: null,
  media_code: 'AUTO',               // default; user can switch
  media_snapshot: null,
  rate_type: 'DAVP',
  language: 'gu',

  // Step 2 — subject + dates
  subject_en: '',
  subject_gu: '',
  proposal_date: defaultDate(),
  campaign_start_date: '',
  campaign_end_date: '',
  campaign_duration_days: 30,
  expire_after_days: 120,

  // Step 3 — line items
  line_items: [],

  // Step 4 — pricing
  discount_percent: 0,
  discount_amount: 0,
  discount_reason: '',
  gst_percent: 18,

  // Step 5 — signer
  team_member_id: null,
  signer_snapshot: null,

  // Step 6 — notes
  notes_internal: '',
  notes_client: '',
});

const initialState = {
  step: 1,
  form: emptyForm(),
  // Computed cache (not persisted — recomputed on demand)
  totals: { subtotal: 0, discountAmount: 0, taxable: 0, gstAmount: 0, totalAmount: 0 },
  // Validation errors per step (filled by validate() before nextStep)
  errors: {},
  // Submission state
  submitting: false,
  submitError: null,
};

export const useWizardStore = create(
  persist(
    (set, get) => ({
      ...initialState,

      // --- navigation ---
      goToStep: (n) => set({ step: Math.max(1, Math.min(6, n)) }),
      nextStep: () => set((s) => ({ step: Math.min(6, s.step + 1) })),
      prevStep: () => set((s) => ({ step: Math.max(1, s.step - 1) })),

      // --- form patch ---
      patch: (patch) =>
        set((s) => {
          const form = { ...s.form, ...patch };
          return { form, totals: recomputeTotals(form) };
        }),

      // --- line item ops ---
      addLineItem: (li) =>
        set((s) => {
          const form = { ...s.form, line_items: [...s.form.line_items, li] };
          return { form, totals: recomputeTotals(form) };
        }),

      addLineItems: (items) =>
        set((s) => {
          const form = { ...s.form, line_items: [...s.form.line_items, ...items] };
          return { form, totals: recomputeTotals(form) };
        }),

      updateLineItem: (idx, patch) =>
        set((s) => {
          const items = s.form.line_items.map((li, i) => {
            if (i !== idx) return li;
            const next = { ...li, ...patch };
            // Recompute line subtotal from units × rate (since units or
            // rate may have changed — simplest to always recompute)
            next.line_subtotal = round2(Number(next.units || 0) * Number(next.unit_rate_snapshot || 0));
            return next;
          });
          const form = { ...s.form, line_items: items };
          return { form, totals: recomputeTotals(form) };
        }),

      removeLineItem: (idx) =>
        set((s) => {
          const form = { ...s.form, line_items: s.form.line_items.filter((_, i) => i !== idx) };
          return { form, totals: recomputeTotals(form) };
        }),

      clearLineItems: () =>
        set((s) => {
          const form = { ...s.form, line_items: [] };
          return { form, totals: recomputeTotals(form) };
        }),

      // --- submit lifecycle ---
      setSubmitting: (b) => set({ submitting: b }),
      setSubmitError: (e) => set({ submitError: e }),

      // --- reset (after successful save or "discard draft") ---
      reset: () => set({ ...initialState, form: emptyForm() }),

      // --- helpers consumed by step components ---
      getTotals: () => recomputeTotals(get().form),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Don't persist transient/UI state across reloads
      partialize: (s) => ({ step: s.step, form: s.form }),
      version: 1,
    }
  )
);

// ---------- internal ----------
function round2(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  return sign * Math.round((abs + Number.EPSILON) * 100) / 100;
}

function recomputeTotals(form) {
  return calcProposalTotals({
    lines: form.line_items,
    gstPercent: Number(form.gst_percent) || 0,
    discountPercent: Number(form.discount_percent) || 0,
    discountAmount: Number(form.discount_amount) || 0,
  });
}
