// drm-protect — prepares a DRM-protected copy of a purchased title with
// VeryPDF DRM Protector (https://drm.verypdf.com/).
//
// Called by the storefront after checkout with { ids: ["LW-105842", ...] }.
// For each entitlement the signed-in customer owns:
//   1. sign a 10-minute URL to the master PDF in the private "masters" bucket
//   2. ask VeryPDF's Cloud API for a protected copy — logon = the customer's
//      email + a reader password we keep in their profile, print count = the
//      licence's copies, save/copy disabled, licence id in the watermark
//   3. store the protected file URL on the entitlement (drm_status = ready)
// The customer opens that URL in VeryPDF DRM Reader; the reader enforces the
// print count (brief §10) and the account credentials never leave here.
//
// Secrets (supabase secrets set ...): VERYPDF_EMAIL — the VeryPDF account.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERYPDF_UPLOAD = 'https://online.verypdf.com/app/pdfdrm/web/upload.php';
const BRAND = Deno.env.get('SITE_BRAND') ?? 'Learn With Why';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: 'sign in first' }, 401);

  const verypdfEmail = Deno.env.get('VERYPDF_EMAIL');
  if (!verypdfEmail) return json({ error: 'VERYPDF_EMAIL is not configured' }, 500);

  const { ids } = await req.json().catch(() => ({ ids: [] }));
  const results: { id: string; status: string }[] = [];

  for (const id of (ids as string[]).slice(0, 20)) {
    const { data: e } = await admin.from('entitlements')
      .select('id, product_id, licence, copies, drm_status, products(master_path, title), licences(label)')
      .eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!e) { results.push({ id, status: 'not found' }); continue; }
    if (e.drm_status === 'ready') { results.push({ id, status: 'ready' }); continue; }

    const product = e.products as unknown as { master_path: string | null; title: string } | null;
    if (!product?.master_path) {
      await admin.from('entitlements').update({ drm_status: 'none' }).eq('id', id);
      results.push({ id, status: 'none' });
      continue;
    }

    // Reader logon for this customer, created once.
    const { data: profile } = await admin.from('profiles').select('drm_password').eq('id', user.id).maybeSingle();
    let password = profile?.drm_password;
    if (!password) {
      password = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      await admin.from('profiles').upsert({ id: user.id, email: user.email, drm_password: password });
    }

    // The master never becomes public: VeryPDF fetches it through a short-lived signed URL.
    const { data: signed, error: signErr } = await admin.storage.from('masters').createSignedUrl(product.master_path, 600);
    if (signErr || !signed) {
      await admin.from('entitlements').update({ drm_status: 'failed' }).eq('id', id);
      results.push({ id, status: 'failed' });
      continue;
    }

    const licenceLabel = (e.licences as unknown as { label: string } | null)?.label ?? e.licence;
    const q = new URLSearchParams({
      InputFileType: 'WebURL',
      WebFileURL: signed.signedUrl,
      Email: verypdfEmail,
      linearize: 'on',
      VeryPDFDRM_IsNeedInternet: 'ON',            // access can be revoked later
      Check_VeryPDFDRM_LogonID_01: 'ON',
      VeryPDFDRM_LogonID_01: user.email ?? user.id,
      Check_VeryPDFDRM_Password_01: 'ON',
      VeryPDFDRM_Password_01: password,
      Check_VeryPDFDRM_ExpirePrintCount: 'ON',
      VeryPDFDRM_ExpirePrintCount: String(e.copies), // the licence's print allowance
      VeryPDFDRM_DenyClipCopy: 'ON',
      VeryPDFDRM_DenySave: 'ON',
      VeryPDFDRM_DenySaveAs: 'ON',
      Check_VeryPDFDRM_SetInvalidPWCount: 'ON',
      VeryPDFDRM_SetInvalidPWCount: '10',
      Check_VeryPDFDRM_TitleOfMessage: 'ON',
      VeryPDFDRM_TitleOfMessage: `${BRAND} — ${product.title}`,
      Check_VeryPDFDRM_DescriptionOfMessage: 'ON',
      VeryPDFDRM_DescriptionOfMessage: `Licensed copy ${e.id} (${licenceLabel} licence, ${e.copies} printed ${e.copies === 1 ? 'copy' : 'copies'}). Sign in with the reader logon shown in your Library.`,
      TextWatermark_Text: `Licensed copy ${e.id} · ${licenceLabel} licence · © ${BRAND}`,
      TextWatermark_Color: '9A9AA0',
      TextWatermark_X: '1', TextWatermark_Y: '1',
      TextWatermark_FontName: 'Arial', TextWatermark_FontSize: '9',
      TextWatermark_Opacity: '60', TextWatermark_Rotate: '0',
    });

    let url: string | undefined;
    try {
      const res = await fetch(`${VERYPDF_UPLOAD}?${q.toString()}`);
      const text = await res.text();
      // The Cloud API answers with the protected file's link (a /u/ page or a .pdf).
      url = text.match(/https?:\/\/online\.verypdf\.com\/u\/[^\s"'<>]+/i)?.[0]
         ?? text.match(/https?:\/\/[^\s"'<>]+\.pdf\b/i)?.[0];
    } catch (_) { /* recorded as failed below */ }

    await admin.from('entitlements')
      .update(url ? { drm_url: url, drm_status: 'ready' } : { drm_status: 'failed' })
      .eq('id', id);
    results.push({ id, status: url ? 'ready' : 'failed' });
  }

  return json({ results });
});
