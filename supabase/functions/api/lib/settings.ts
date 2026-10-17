// Site settings (the settings table), cached briefly in memory. Defaults apply when a key is
// missing or malformed, so a bad edit can never take the site down.
import { tx, type Tx } from './db.ts';

export type Country = {
  code: string; name: string; currency: string; tax: { label: string; pct: number };
  postal: { label: string; hint: string; pattern: string; flags: string };
  state: string; states: string[] | null; methods: string[];
};

export type Settings = {
  /** How long a bought sheet opens: hours (days is the same rounded up, kept for older readers). */
  worksheet_access: { days: number; hours: number };
  sessions: { rememberDays: number; shortHours: number; maxDays: number };
  login: { maxFailed: number; lockMinutes: number };
  auth_links: { verifyHours: number; resetMinutes: number };
  currency_rates: Record<string, number>;
  fees: { IN: { pct: number; fixed: number }; INTL: { pct: number; fixed: number } };
  security: { maxWarnings: number; warningExpiryDays: number; autoSuspend: boolean };
  agreement: { version: string; text: string };
  contact: { inbox: string };
  email: { fromName: string; adminAlerts: string[] };
  quote: { ttlMinutes: number };
  viewer: { tokenHours: number; recheckSeconds: number };
  /** Prints of each sheet per access record, by account type (sheets whose print rule is 'account'). */
  prints: { parent: number; teacher: number; organization: number };
  countries: Country[];
};

export const DEFAULTS: Settings = {
  worksheet_access: { days: 1, hours: 24 },
  sessions: { rememberDays: 30, shortHours: 12, maxDays: 90 },
  login: { maxFailed: 5, lockMinutes: 15 },
  auth_links: { verifyHours: 24, resetMinutes: 30 },
  currency_rates: { INR: 1, USD: 0.012, EUR: 0.011, GBP: 0.0094, AED: 0.044, AUD: 0.018, CAD: 0.016, SGD: 0.016, NZD: 0.02, JPY: 1.8 },
  fees: { IN: { pct: 2, fixed: 3 }, INTL: { pct: 3.9, fixed: 0.3 } },
  security: { maxWarnings: 3, warningExpiryDays: 365, autoSuspend: true },
  agreement: { version: '2026-10-07', text: 'I understand that my account credentials are personal and must not be shared with anyone.' },
  contact: { inbox: 'learnwithwhy6@gmail.com' },
  email: { fromName: 'Learn With Why', adminAlerts: ['learnwithwhy6@gmail.com'] },
  quote: { ttlMinutes: 15 },
  viewer: { tokenHours: 12, recheckSeconds: 60 },
  prints: { parent: 2, teacher: 4, organization: 300 },
  countries: [],
};

let cache: { at: number; value: Settings } | null = null;
const TTL = 20_000;

export function clearSettingsCache() {
  cache = null;
}

function merge<T>(def: T, v: unknown): T {
  if (Array.isArray(def)) return (Array.isArray(v) ? v : def) as T;
  if (def && typeof def === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return def;
    const out: Record<string, unknown> = { ...(def as Record<string, unknown>) };
    for (const [k, dv] of Object.entries(def as Record<string, unknown>)) {
      const vv = (v as Record<string, unknown>)[k];
      if (vv === undefined) continue;
      if (typeof dv === 'number') out[k] = typeof vv === 'number' && Number.isFinite(vv) ? vv : dv;
      else if (typeof dv === 'boolean') out[k] = typeof vv === 'boolean' ? vv : dv;
      else if (typeof dv === 'string') out[k] = typeof vv === 'string' && vv ? vv : dv;
      else out[k] = merge(dv, vv);
    }
    // keep extra keys for open maps (currency_rates)
    if (Object.keys(def as Record<string, unknown>).length === 0 || def === DEFAULTS.currency_rates) {
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) if (!(k in out)) out[k] = vv;
    }
    return out as T;
  }
  return (v ?? def) as T;
}

export async function getSettings(q?: Tx): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const load = (t: Tx) => t<{ key: string; value: unknown }[]>`select key, value from settings`;
  const rows = q ? await load(q) : await tx(load);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const value = {} as Settings;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    // deno-lint-ignore no-explicit-any
    (value as any)[k] = merge(DEFAULTS[k], map.get(k));
  }
  value.currency_rates = { ...DEFAULTS.currency_rates, ...(map.get('currency_rates') as Record<string, number> ?? {}) };
  value.currency_rates.INR = 1;
  // a stored value from before hours (days only) keeps meaning those days, not the default hours
  const wa = map.get('worksheet_access') as Record<string, unknown> | undefined;
  if (wa && typeof wa === 'object' && wa.hours === undefined && typeof wa.days === 'number' && wa.days >= 1) {
    value.worksheet_access = { days: value.worksheet_access.days, hours: value.worksheet_access.days * 24 };
  }
  cache = { at: Date.now(), value };
  return value;
}
