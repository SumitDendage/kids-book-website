import { escapeHtml } from '../lib/util.ts';
export function brandedEmail(title: string, text: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#f4f8e9;font-family:Arial,sans-serif;color:#234934"><main style="max-width:560px;margin:24px auto;padding:28px;background:white;border-radius:20px"><p>LEARN WITH WHY</p><h1 style="font-size:24px">${escapeHtml(title)}</h1><p style="line-height:1.7;white-space:pre-line">${escapeHtml(text)}</p><p>Your account is personal. Never share your login code.</p></main></body></html>`;
}
