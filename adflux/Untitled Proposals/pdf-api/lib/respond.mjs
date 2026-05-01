// =====================================================================
// Tiny response helpers for Vercel's Web-Fetch-style handler signature.
// Centralised so error handling + CORS stay consistent.
// =====================================================================

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function preflight(req) {
  const origin = req.headers.get?.('origin') ?? '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function json(body, { status = 200, req } = {}) {
  const origin = req?.headers?.get?.('origin') ?? '';
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

export function pdfResponse(buf, filename, { req } = {}) {
  const origin = req?.headers?.get?.('origin') ?? '';
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

export function errorResponse(err, req) {
  const status = err?.status ?? 500;
  const body = {
    error: err?.message || 'Internal error',
    ...(process.env.NODE_ENV === 'production' ? {} : { stack: err?.stack?.split('\n').slice(0, 5) }),
  };
  return json(body, { status, req });
}
