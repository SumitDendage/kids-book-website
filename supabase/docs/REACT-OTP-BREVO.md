# React email-code login with Brevo

This change uses the existing React/Vite app. It does not create a separate HTML website. Email bodies contain HTML because email clients require it.

## What changed

- `frontend/src/components/home/AuthCard.jsx`: name, email, Parent/Teacher, agreement, six-digit code, resend cooldown, loading/errors; existing signed-in panel retained.
- `frontend/src/services/api.js`: OTP request/verify calls; the SDK adopts only the API-approved session.
- `supabase/functions/api/routes/auth.ts` and `lib/gotrue.ts`: Supabase-generated single-use OTPs, rate limits, email verification, existing session registration and agreement/audit checks. Customer password login is disabled; existing staff password login remains.
- `routes/auth_email.ts` and `services/otp_email.ts`: signed Supabase Send Email Hook → Brevo API. Rejects forged/stale hooks, escapes template text, deduplicates successful hook retries, and logs metadata without OTP bodies.
- `services/sharing.ts`, `routes/admin_security.ts`, and the React admin Security page: automated signals always wait for staff review before warnings. A new IP alone does not prove sharing.
- Frontend API tests and `functions/api/tests/otp.test.ts` cover token adoption, bad OTP handling, hook signatures, expiry, template escaping and Supabase request contracts.

Existing profiles, app_sessions, agreement_acceptances, login_activity, account_warnings, security_incidents, audit_logs and email_outbox are reused. No schema migration is required. Existing RLS and protected-content checks remain in force.

## Configure and deploy

1. In Brevo, verify your sender/domain and create a transactional API key.
2. Set these Supabase Edge Function secrets (never put them in VITE variables):

   ```env
   MAIL_PROVIDER=brevo
   BREVO_API_KEY=your-private-brevo-key
   MAIL_FROM=Learn With Why <verified-sender@your-domain.com>
   SEND_EMAIL_HOOK_SECRET=v1,whsec_secret-from-supabase
   SITE_URL=https://your-website-domain.com
   ALLOWED_ORIGINS=https://your-website-domain.com
   ```

   Preserve the existing SUPABASE_DB_URL and Supabase server keys used by this API. Keep the existing frontend VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.

3. Deploy the existing `api` function with its `verify_jwt=false` configuration. The application verifies bearer tokens itself; the email hook verifies its own signature. Deploy the backend before the React build.
4. In Supabase Authentication → Hooks → Send Email, set the HTTPS endpoint:

   `https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/auth/send-email`

   Generate/copy the hook signing secret into SEND_EMAIL_HOOK_SECRET. Enable the hook only once Brevo and the function are ready. Configure email OTP length **6**, expiry **600 seconds**, and resend interval **60 seconds**. Keep email confirmation enabled. Configure Supabase Auth's own rate limits as well, because its public Auth endpoint can be called directly.
5. Build the frontend with `npm ci` and `npm run build` inside `frontend`, then deploy its dist directory through the existing hosting workflow. Keep all public assets from the complete repository.

Templates are source-controlled in `otp_email.ts` and the existing `emails.ts`. No Brevo template IDs are needed. Existing warning, restoration and purchase emails use the existing Brevo outbox when MAIL_PROVIDER is brevo. Email status `sent` means Brevo accepted the API request, not proof that the recipient opened or received it; use Brevo's delivery dashboard for delivery/bounce details.

## Test before switching production login

- Sign up with a test inbox, Parent/Teacher and agreement. Verify the code, profile, app session and one welcome email.
- Sign out and sign in with a new code. Try wrong, expired and already-used codes. Confirm none creates an app session.
- Resend after 60 seconds; verify the previous code fails. Exceed server limits and confirm a rate-limit response.
- Retry a signed hook and confirm one successful receipt; altered/old signatures must fail. Test a Brevo failure and retry with a new OTP. OTPs must not appear in email_outbox bodies or logs.
- Use another device/network: review an incident in Admin → Security. Ordinary network changes must not auto-issue warnings.
- Confirm separate violations, check warning emails and counters, pause/restore paid access, block/unblock accounts, end sessions, and test protected worksheets after suspension.
- Try admin endpoints without authentication and as a customer; verify rejection.
- Verify checkout and existing prepaid access remain unchanged.

Automated checks:

```sh
cd frontend
npm test
npm run build
```

From the repository root with Deno installed:

```sh
deno check --config supabase/functions/api/deno.json supabase/functions/api/index.ts
deno test --allow-env --config supabase/functions/api/deno.json supabase/functions/api/tests/otp.test.ts
```

## Scope and remaining setup

This is the requested smaller React/Brevo change, not the entire original specification. Existing admin warnings, paid-access suspension, whole-account blocking, session controls and appeals are reused. The existing warning-limit policy pauses paid access; whole-account blocking remains a separate admin action. Existing `subscriptions` is a view of prepaid entitlements, not Razorpay/Stripe recurring billing. This change does not implement recurring-provider cancellation or turn prepaid purchases into recurring subscriptions.

Brevo credentials, hook settings and live inbox tests must be completed before deploying the React login. The changes have not been applied to the production database or deployed by this PR. Email-change auth actions are deliberately rejected by this hook; the current customer UI does not offer email changes. Existing staff recovery/invitation emails remain supported by the hook, but must be checked with the deployed staff flow before rollout. A provider timeout after accepting an email can still result in a duplicate on retry; no distributed system can atomically commit both Brevo delivery and the local receipt.

References: https://supabase.com/docs/guides/auth/auth-email-passwordless , https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook , https://developers.brevo.com/reference/send-transac-email
