// The request pipeline: CORS → route → handler → JSON (or a file stream) → background work.
import { env } from './env.ts';
import { errorResponse, HttpError, json } from './http.ts';
import { makeCtx, type Ctx } from './context.ts';
import { Router } from './router.ts';
import { mapDbError } from './db.ts';
import { sweepIfDue } from './mail.ts';

const ALLOW_HEADERS = 'authorization, content-type, x-view-token, x-device-id, x-visitor-id, apikey, x-client-info';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export const router = new Router();

let lastSweep = 0;

function corsHeaders(origin: string | null): Record<string, string> | null {
  const allowed = env().allowedOrigins;
  if (!origin) return {};
  if (allowed.length && !allowed.includes(origin.replace(/\/+$/, ''))) return null;
  return {
    'Access-Control-Allow-Origin': allowed.length ? origin : '*',
    'Access-Control-Expose-Headers': 'Content-Disposition, Retry-After, X-Pages, X-Row-Count, X-Truncated',
    Vary: 'Origin',
  };
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) if (!h.has(k)) h.set(k, v);
  if ((h.get('content-type') ?? '').startsWith('application/json')) h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export type HandleOptions = { awaitBackground?: boolean };

export async function handle(req: Request, opts: HandleOptions = {}): Promise<Response> {
  let url: URL;
  try { url = new URL(req.url); } catch { return new Response(null, { status: 400 }); }
  let path = url.pathname.replace(/^\/functions\/v1/, '');
  if (!path.startsWith('/api/')) path = '/api' + (path.startsWith('/') ? path : '/' + path);
  path = path.replace(/^\/api\/api\//, '/api/');

  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return json(403, { error: 'Cross-site request refused.' });
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': ALLOW_METHODS, 'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Max-Age': '600' } });
  }
  if (!cors) return withHeaders(json(403, { error: 'Cross-site request refused.' }), SECURITY);

  let ctx: Ctx | null = null;
  let res: Response;
  try {
    ctx = await makeCtx(req, url, path, env());
    const hit = router.match(req.method.toUpperCase(), path);
    if (!hit) {
      res = json(404, { error: 'Not found' });
    } else {
      ctx.params = hit.params;
      const out = await hit.handler(ctx);
      res = out instanceof Response ? out : json(200, out);
    }
  } catch (e) {
    const err = mapDbError(e);
    if (err instanceof HttpError) {
      res = errorResponse(err);
    } else {
      console.error('[api] unhandled', path, (e as Error)?.stack ?? e);
      res = json(500, { error: 'Something went wrong on the server.' });
    }
  }

  if (ctx && Date.now() - lastSweep > 60_000) {
    lastSweep = Date.now();
    sweepIfDue(ctx);
  }
  if (ctx && ctx.background.length) {
    const all = Promise.allSettled(ctx.background);
    if (opts.awaitBackground) await all;
    else {
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(all); else all.catch(() => {});
    }
  }
  return withHeaders(res, { ...cors, ...SECURITY });
}

export function resetSweepClockForTests() {
  lastSweep = Date.now();
}
