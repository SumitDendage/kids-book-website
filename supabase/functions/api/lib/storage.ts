// Supabase Storage over its REST API, always with the server's secret key. The "worksheets"
// bucket is private: nothing here ever hands a browser a long-lived link to it.
import { env } from './env.ts';
import { HttpError } from './http.ts';

export const WORKSHEETS = 'worksheets';
export const COVERS = 'covers';

const isJwt = (k: string) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k);

function headers(extra: Record<string, string> = {}) {
  const k = env().secretKey;
  const h: Record<string, string> = { apikey: k, ...extra };
  if (isJwt(k)) h.Authorization = `Bearer ${k}`;
  return h;
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

function base() {
  const b = env().supabaseUrl;
  if (!b || !env().secretKey) throw new HttpError(503, 'File storage is not set up on the server yet.', { code: 'storage_unavailable' });
  return `${b}/storage/v1`;
}

/** Streams a private object. Returns null when it does not exist. */
export async function download(bucket: string, path: string): Promise<{ body: ReadableStream<Uint8Array>; type: string; size: number | null } | null> {
  let res: Response;
  try {
    res = await fetch(`${base()}/object/${bucket}/${enc(path)}`, { headers: headers(), signal: AbortSignal.timeout(20000) });
  } catch {
    throw new HttpError(503, 'Files are briefly unavailable — please try again in a minute.', { code: 'storage_unavailable' });
  }
  if (res.status === 404 || res.status === 400) { await res.body?.cancel(); return null; }
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new HttpError(503, 'Files are briefly unavailable — please try again in a minute.', { code: 'storage_unavailable' });
  }
  const size = Number(res.headers.get('content-length') ?? '');
  return { body: res.body, type: res.headers.get('content-type') ?? 'application/octet-stream', size: Number.isFinite(size) && size > 0 ? size : null };
}

export async function downloadBytes(bucket: string, path: string): Promise<Uint8Array | null> {
  const f = await download(bucket, path);
  if (!f) return null;
  return new Uint8Array(await new Response(f.body).arrayBuffer());
}

export async function upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base()}/object/${bucket}/${enc(path)}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'no-store' }),
      body: bytes as BodyInit,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new HttpError(503, 'Could not reach file storage — please try again.', { code: 'storage_unavailable' });
  }
  if (!res.ok) {
    const t = await res.text();
    throw new HttpError(502, 'File storage refused the upload.', { code: 'upload_failed', detail: t.slice(0, 200) });
  }
  await res.body?.cancel();
}

export async function remove(bucket: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const res = await fetch(`${base()}/object/${bucket}`, {
    method: 'DELETE',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
    signal: AbortSignal.timeout(20000),
  });
  await res.body?.cancel();
  if (!res.ok) throw new HttpError(502, 'File storage refused the delete.', { code: 'storage_failed' });
}

/** A signed link that ends at `expiresAt` or after `maxSeconds`, whichever is sooner (never later
 *  than the customer's access). Only used for page pictures if a caller asks for one. */
export async function signedUrl(bucket: string, path: string, maxSeconds: number, expiresAt: number | null): Promise<string> {
  const left = expiresAt ? Math.floor((expiresAt - Date.now()) / 1000) : maxSeconds;
  const seconds = Math.max(1, Math.min(maxSeconds, left));
  const res = await fetch(`${base()}/object/sign/${bucket}/${enc(path)}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: seconds }),
    signal: AbortSignal.timeout(10000),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || !b.signedURL) throw new HttpError(502, 'Could not prepare the file.', { code: 'storage_failed' });
  return `${env().supabaseUrl}/storage/v1${b.signedURL}`;
}

export function publicUrl(bucket: string, path: string): string {
  return `${env().supabaseUrl}/storage/v1/object/public/${bucket}/${enc(path)}`;
}
