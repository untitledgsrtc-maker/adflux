// =====================================================================
// GET /api/cron-expire-proposals
//
// Vercel scheduled job (see vercel.json crons). Runs daily at 02:00
// IST and calls public.expire_stale_proposals() to flip stale SENT
// proposals to EXPIRED.
//
// Auth model: Vercel cron sends a header `x-vercel-signature` plus an
// `Authorization: Bearer ${CRON_SECRET}` header (when CRON_SECRET is
// set in env). We verify the secret to keep the endpoint from being
// hammered by random callers.
//
// The actual write happens via the SECURITY DEFINER `expire_stale_proposals`
// function — service role just provides the auth context. The SQL
// function is idempotent: if no rows are stale, it returns 0.
// =====================================================================

import { getAdmin } from '../lib/supabaseAdmin.mjs';
import { json, errorResponse } from '../lib/respond.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  try {
    // Cron secret check — Vercel sends `Authorization: Bearer ${CRON_SECRET}`
    // automatically when CRON_SECRET is set in project env.
    const expected = process.env.CRON_SECRET;
    if (expected) {
      const auth = req.headers.get?.('authorization') ?? req.headers.authorization ?? '';
      if (auth !== `Bearer ${expected}`) {
        return json({ error: 'Unauthorized' }, { status: 401, req });
      }
    } else {
      // No secret configured → allow only when the Vercel-cron header is present.
      // This is weaker but at least keeps random Internet callers out.
      const isVercelCron = req.headers.get?.('user-agent')?.includes('vercel-cron')
                        || req.headers.get?.('x-vercel-cron');
      if (!isVercelCron) {
        return json({ error: 'CRON_SECRET not configured and request is not from Vercel cron' }, { status: 401, req });
      }
    }

    const admin = getAdmin();
    const startedAt = new Date().toISOString();

    const { data, error } = await admin.rpc('expire_stale_proposals');
    if (error) throw error;

    const expiredCount = Number(data ?? 0);
    const finishedAt = new Date().toISOString();

    console.log(`[cron-expire-proposals] expired ${expiredCount} proposals (${startedAt} → ${finishedAt})`);

    return json({
      ok: true,
      expired_count: expiredCount,
      started_at: startedAt,
      finished_at: finishedAt,
    }, { req });
  } catch (err) {
    console.error('[cron-expire-proposals] error:', err);
    return errorResponse(err, req);
  }
}
