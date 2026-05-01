// =====================================================================
// buildProposalPayload + buildLineItemsPayload — shape the form into
// the exact JSON the create_proposal_with_lines RPC expects.
//
// Pure functions, no Supabase deps — see ./proposalPayload.js.
// (File is named proposalApi.test.js for discoverability with the API
// it backs; the imports come from the pure module.)
// =====================================================================

import { describe, it, expect } from 'vitest';
// Import from proposalPayload directly (the pure module). proposalApi
// re-exports them but also imports supabase, which fails in the unit
// test sandbox without env vars.
import { buildProposalPayload, buildLineItemsPayload } from './proposalPayload';

const sampleForm = {
  client_id: 'client-uuid',
  client_snapshot: {
    name_en: 'Government of Gujarat — Information',
    name_gu: 'ગુજરાત સરકાર — માહિતી',
    department_en: 'Information Department',
    department_gu: 'માહિતી ખાતું',
    address_en: 'Block 7',
    address_gu: 'બ્લોક 7',
    gst_number: '24AAAGG0123A1ZK',
  },
  client_contact_id: 'contact-uuid',
  contact_snapshot: { name_en: 'Vikram', name_gu: 'વિક્રમ', designation_en: 'JD', designation_gu: 'સંયુક્ત નિયામક' },
  team_member_id: 'team-uuid',
  signer_snapshot: { name_en: 'Brijesh Patel', name_gu: 'બ્રિજેશ પટેલ', designation_en: 'Proprietor', designation_gu: 'માલિક', mobile: '+91 98765 43210' },
  media_id: 'media-uuid',
  media_code: 'AUTO',
  media_snapshot: { code: 'AUTO' },
  rate_type: 'DAVP',
  language: 'gu',
  proposal_date: '2026-04-22',
  subject_en: 'Test subject',
  subject_gu: 'ટેસ્ટ વિષય',
  campaign_duration_days: 30,
  campaign_start_date: '',
  campaign_end_date: '',
  expire_after_days: 120,
  discount_percent: 0,
  discount_amount: 0,
  discount_reason: '',
  gst_percent: 18,
  notes_internal: '',
  notes_client: '',
  line_items: [
    {
      location_type: 'AUTO_DISTRICT',
      auto_district_id: 'd1', gsrtc_station_id: null,
      location_name_snapshot: 'Ahmedabad', location_name_gu_snapshot: 'અમદાવાદ',
      units: 100, duration_days: 30,
      unit_rate_snapshot: 825, rate_type_snapshot: 'DAVP',
      meta_snapshot: { available_rickshaws: 5000 },
      line_subtotal: 82500,
    },
  ],
};

const sampleTotals = {
  subtotal: 82500,
  discountAmount: 0,
  taxable: 82500,
  gstAmount: 14850,
  totalAmount: 97350,
};

describe('buildProposalPayload', () => {
  it('extracts snapshots into flat fields', () => {
    const p = buildProposalPayload(sampleForm, sampleTotals);
    expect(p.client_id).toBe('client-uuid');
    expect(p.client_name_snapshot).toBe(sampleForm.client_snapshot.name_en);
    expect(p.client_name_gu_snapshot).toBe(sampleForm.client_snapshot.name_gu);
    expect(p.client_gst_snapshot).toBe('24AAAGG0123A1ZK');
    expect(p.contact_name_snapshot).toBe('Vikram');
    expect(p.signer_name_snapshot).toBe('Brijesh Patel');
    expect(p.signer_mobile_snapshot).toBe('+91 98765 43210');
  });

  it('applies hardcoded HSN and DRAFT status', () => {
    const p = buildProposalPayload(sampleForm, sampleTotals);
    expect(p.hsn_sac_code).toBe('998361');
    expect(p.status).toBe('DRAFT');
  });

  it('passes totals through verbatim (no recompute)', () => {
    const p = buildProposalPayload(sampleForm, sampleTotals);
    expect(p.subtotal).toBe(82500);
    expect(p.gst_amount).toBe(14850);
    expect(p.total_amount).toBe(97350);
    expect(p.discount_amount).toBe(0);
  });

  it('passes empty contact gracefully', () => {
    const p = buildProposalPayload(
      { ...sampleForm, client_contact_id: null, contact_snapshot: null },
      sampleTotals
    );
    expect(p.client_contact_id).toBe('');
    expect(p.contact_name_snapshot).toBe(null);
  });
});

describe('buildLineItemsPayload', () => {
  it('flattens line items, normalising null FKs to empty strings', () => {
    const items = buildLineItemsPayload(sampleForm.line_items);
    expect(items).toHaveLength(1);
    expect(items[0].location_type).toBe('AUTO_DISTRICT');
    expect(items[0].auto_district_id).toBe('d1');
    expect(items[0].gsrtc_station_id).toBe('');
    expect(items[0].units).toBe(100);
    expect(items[0].line_subtotal).toBe(82500);
    expect(items[0].meta_snapshot).toEqual({ available_rickshaws: 5000 });
  });

  it('empties meta_snapshot to {} when missing', () => {
    const items = buildLineItemsPayload([{ ...sampleForm.line_items[0], meta_snapshot: undefined }]);
    expect(items[0].meta_snapshot).toEqual({});
  });
});
