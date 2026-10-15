# Security and account-sharing policy

This is how the Supabase backend protects accounts, payments and worksheets, and what it
deliberately does not claim to do.

## Keys and secrets

- The website gets only the API address (`VITE_API_BASE_URL`). It never holds a Supabase secret
  key, a gateway secret or an email key. Those live in **Edge Function secrets** (see
  `.env.example`), are read only by the `api` function and are never returned or logged. The
  developer health page shows whether each one is set, never its value.
- The Edge Function talks to the database as `postgres` and switches every transaction to the
  role `lww_api`, which only has the table privileges each feature needs (for example audit logs,
  payments and the access log cannot be deleted through it).
- Every table has row-level security switched on. Visitors (the `anon` role) can read only the
  public catalogue, active plans, published FAQ, published site text and published reviews.
  Signed-in customers can read only their own profile, orders, entitlements, notifications and
  warnings, and only while their session is valid. Nothing else is reachable with the public key.
- Worksheet PDFs are in a **private** storage bucket. The API streams them to a customer after
  checking access; it never hands out a lasting link. If a signed link is ever used, it ends
  within minutes and never after the customer's access ends.

## Sign-in

- Passwords are stored by Supabase Auth only. The server generates the customer's first password
  (16 characters, no look-alike letters) and emails it once; it is never stored or logged in plain
  text, and the welcome email's text is not kept in the email log. It works until the customer
  resets it — there is no forced change at first sign-in.
- Every API request checks the token **and** the database: the sign-in session must be one the API
  opened, not ended, not blocked and not past its end (12 hours, or 30 days with "Keep me signed
  in", never more than 90 days — the settings cannot raise this and the database refuses a longer
  sign-in). The account must be confirmed and not blocked.
- Five wrong passwords lock the account for 15 minutes. Sign-in, sign-up, email and reset requests
  are rate-limited per address and per email. Every sign-in attempt is recorded (success or the
  reason it failed).
- Customers accept the account-sharing agreement when they sign up; the version and the exact text
  they accepted are recorded. When the agreement changes, they accept it again at their next sign-in.
- Staff sign in with their own accounts. The old shared admin key and the browser-only staff demo
  are gone. Only an owner can create owners and admins or give the right to manage staff; the last
  owner cannot be removed. Every staff change is written to the audit log, which cannot be edited.

## Payments

- The customer's browser never decides a price or a payment result. Prices come from the database
  through a stored quote that lasts 15 minutes; the order is created from that stored quote.
- Access is granted in one place only, after the payment is verified with the gateway (signature
  **and** a server-side check of order, amount and currency). Gateway notifications (webhooks)
  are signature-checked, recorded once per event id and processed once, so a repeated message or a
  repeated "payment done" call never grants twice.
- Staff cannot mark an order as paid. To give someone access without a payment, staff use a grant,
  which always has an end date and is audited. Refunds revoke the access that order gave.
- A gateway refund is recorded by its payment even when it arrives before the payment itself, so a
  refunded payment never opens access later. When an order was paid twice, refunding either one of
  the two payments leaves the order and its access in place (the other payment still pays for it)
  and tells staff; only when no captured payment of the full amount is left is the order refunded
  and its access ended.
- Coupon limits (total uses and uses per customer) are checked when the price is quoted, when the
  order is made — an unpaid order holds its use for 48 hours — and again when the payment is
  verified. If a payment arrives after the code ran out, the customer still gets what they paid for,
  the extra use is not counted and staff are told.

## Worksheet access

- A bought sheet opens for the number of days set by staff (365 by default), counted from the
  moment the payment is verified. Class plans last their months. Dates are stored in UTC and shown
  with the time zone named.
- Expired sheets disappear from the active list but stay in order history and staff records, with
  **Buy Access Again**.
- Every viewer request (sheet details, the file, each page picture, print and download) re-checks
  ownership, expiry, the session, the account and any suspension. The viewer asks again every
  minute and clears the pages as soon as the answer is no.
- Print and download limits count deliveries from the server and are enforced atomically, for each
  sheet separately (every sheet of a class plan has its own allowance). Imported sheets start with
  both set to 0, as before.
- **"View only" (both limits 0) is not a copy lock.** It removes the Print and Download buttons and
  the server refuses those copies, but the viewer draws most sheets from a stamped PDF copy sent to
  the browser, and a determined customer can save that copy. It is sent only to a signed-in customer
  with live access and a valid viewer link, stamped with their name and email, logged, and limited
  to 60 an hour per account.
- Staff cannot upload a PDF that the stamp cannot handle (over 20 MB, password-protected or
  unreadable). If stamping still fails when a copy is sent, the original goes out and the failure is
  recorded as a security event for staff.
- What cannot be prevented: anyone who can see a page can photograph or screenshot it, and a copy
  that was printed or downloaded cannot be recalled. The viewer discourages copying, stamps the
  customer's name and email on every page and on every delivered PDF (the email alone when the name
  cannot be printed in the PDF's letters; the email, order and date come first and are sized to stay
  on the page, so a long or misleading name the customer chooses cannot hide them), and the server
  notices unusual
  use — but no website can make copying impossible, and we do not claim it can.

## Account sharing

- **What is observed:** each sign-in session (device label, network, country when the platform
  reports it, a random per-browser device id) and each viewer request. A device is a sign-in: one
  sign-in counts as one device even if the browser's device id changes (for example when the
  browser blocks site data).
- **Rules** (staff can switch each on or off, change its limits and choose whether it confirms
  itself):
  - several devices on different networks opening paid sheets within 15 minutes (at least 3
    devices and 2 networks by default);
  - more than 6 devices in a day (signed in or opening sheets);
  - paid sheets opened from more than 3 countries in a day;
  - more than 600 viewer requests in an hour;
  - a manual report by staff.
  A new IP address or one new device alone is never treated as sharing. For the two paid-sheet
  rules only paid sheets that actually opened count; signing in or opening free sheets does not.
- **Incidents** are suspicions. One pattern in one time window is one incident, however many
  requests trip it. An incident becomes a **warning** only when staff confirm it (or automatically,
  if staff set that rule to confirm itself). Each incident can give at most one warning. Once staff
  have confirmed or dismissed an incident, its evidence stays as they saw it; if the activity then
  grows beyond it (more devices, networks, countries or requests), a new incident opens for staff to
  decide, and it never confirms itself. The same staff report sent again within 10 minutes (a double
  click or a retry) is the same report: no second incident or warning.
- **Warnings 1/3, 2/3 and 3/3** each email the customer and notify staff (email and the admin
  notifications list). If paid access was already paused (by staff), the email says so instead of
  calling it the last warning. Warnings stop counting after 365 days (staff can change this).
- **Suspension scope:** at 3 active warnings the customer's **paid access** is suspended
  automatically: bought sheets and class plans do not open and new purchases are refused. Sign-in,
  My Account, order history, free sheets, notifications and appeals keep working. Their purchases
  are not deleted; when the suspension is lifted they open again until their original end date
  (time that passed while suspended is not added back).
- **Appeals:** a customer can send one appeal at a time from My Account. Staff accept or reject it
  with a reply that is emailed. Accepting lifts the suspension and can clear the warnings.
- **Warning reset:** staff can revoke a single warning or clear all of them when lifting a
  suspension. Each reset is audited with who, when and why.
- **Separate controls for staff:**
  - block or unblock **one sign-in session** (for example a device the customer does not
    recognise) — the customer's other sessions keep working;
  - suspend or restore **paid access** (the warnings scope above);
  - block or unblock the **whole account** — sign-in is refused and every session ends.
  All three need the security or customer permission, are checked on the server and are audited.

## Logs kept

Sign-in attempts, security events, sharing incidents and warnings, viewer access, payment events
(gateway notifications, with a fingerprint rather than the full payload), the email log (never the
text of emails holding passwords or links) and the staff audit log. Exports and backups are limited
to staff with the export permission and never include passwords, tokens or keys.
