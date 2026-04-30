// =====================================================================
// Pure-helper tests for the P&L module. Mirrors:
//   - public.proposal_pnl.business_profit (DB-generated column)
//   - public.resolve_partner_commission() trigger
// Both are computed client-side for live preview; the DB recomputes
// on save and is the source of truth.
//
// We can't import pnlApi.js directly here (it pulls in supabase which
// fails without env vars in tests). Re-export the pure helpers via
// a tiny dynamic import wouldn't help either. Instead we duplicate
// the canonical implementation here as a black-box reference and
// import the actual functions through a CJS-friendly path.
//
// Approach: import the helpers directly; the test runner has supabase
// stubbed only at module level for files that import the supabase
// client. Since pnlApi.js imports `./supabase`, the stub fires the
// same way it does in proposalApi tests. Solution: import via
// vi.mock to short-circuit `./supabase`.
// =====================================================================

import { describe, it, expect, vi } from 'vitest';

// Mock supabase before pnlApi loads — same pattern other tests use
// indirectly via proposalPayload.js. Here we mock the module surface
// the file actually consumes.
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
  callRpc: vi.fn(async () => null),
}));

const { calcBusinessProfit, calcPartnerCommissionAmount } = await import('./pnlApi');

describe('calcBusinessProfit', () => {
  it('subtracts every cost component from net revenue', () => {
    expect(calcBusinessProfit({
      net_revenue: 100000,
      media_owner_payout: 30000,
      production_cost: 5000,
      partner_commission_amount: 10000,
      other_direct_cost: 2000,
    })).toBe(53000);
  });

  it('handles zero costs', () => {
    expect(calcBusinessProfit({ net_revenue: 100000 })).toBe(100000);
  });

  it('handles missing fields (treats as 0)', () => {
    expect(calcBusinessProfit({})).toBe(0);
  });

  it('can go negative when costs exceed revenue', () => {
    expect(calcBusinessProfit({
      net_revenue: 50000,
      media_owner_payout: 60000,
    })).toBe(-10000);
  });

  it('rounds to 2 decimals (matches Postgres)', () => {
    // Boundary: same EPSILON-trick as round2 in calc.js
    expect(calcBusinessProfit({
      net_revenue: 1.005,
      media_owner_payout: 0,
      production_cost: 0,
    })).toBe(1.01);
  });
});

describe('calcPartnerCommissionAmount', () => {
  it('takes percent of net revenue', () => {
    expect(calcPartnerCommissionAmount(100000, 10)).toBe(10000);
  });
  it('zero percent → zero', () => {
    expect(calcPartnerCommissionAmount(100000, 0)).toBe(0);
  });
  it('handles fractional percent', () => {
    expect(calcPartnerCommissionAmount(100000, 7.5)).toBe(7500);
  });
  it('rounds to 2 decimals', () => {
    expect(calcPartnerCommissionAmount(33333, 2.5)).toBe(833.33);
  });
});
