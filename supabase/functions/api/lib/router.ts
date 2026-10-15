// A tiny method + path router. Paths use :name for one segment, e.g. /api/admin/orders/:id
import type { Ctx } from './context.ts';

export type Handler = (ctx: Ctx) => Promise<Response | Record<string, unknown> | unknown[]> | Response | Record<string, unknown>;

type Route = { method: string; re: RegExp; names: string[]; handler: Handler; pattern: string };

export class Router {
  routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler) {
    const names: string[] = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_m, n) => { names.push(n); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method: method.toUpperCase(), re, names, handler, pattern });
  }
  get(p: string, h: Handler) { this.add('GET', p, h); }
  post(p: string, h: Handler) { this.add('POST', p, h); }
  put(p: string, h: Handler) { this.add('PUT', p, h); }
  patch(p: string, h: Handler) { this.add('PATCH', p, h); }
  delete(p: string, h: Handler) { this.add('DELETE', p, h); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      let ok = true;
      r.names.forEach((n, i) => {
        try { params[n] = decodeURIComponent(m[i + 1]); } catch { ok = false; }
      });
      if (!ok) continue;
      return { handler: r.handler, params };
    }
    return null;
  }

  /** Is there any route for this path (under another method)? */
  hasPath(path: string): boolean {
    return this.routes.some((r) => r.re.test(path));
  }
}
