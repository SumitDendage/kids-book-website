#!/usr/bin/env python3
"""Writes the two seed migrations from the verified project data.

Inputs (read-only):
  catalogue.json  - built from backend/src/database/seed.cjs + frontend/src/data/catalogue.js
                    + a stat of backend/protected (105 real PDFs and 28 legacy samples)
  countries.json  - the COUNTRIES table from backend/src/services/pricing.cjs

Only the 105 sheets that have a real PDF are imported. The 28 legacy samples are not imported.
Run:  python3 supabase/scripts/build_seed_sql.py <catalogue.json> <countries.json>
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MIG = HERE.parent / 'migrations'


def q(v):
    """SQL literal."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        return q(json.dumps(v, ensure_ascii=False, separators=(',', ':'))) + '::jsonb'
    return "'" + str(v).replace("'", "''") + "'"


def arr(items):
    return "'{" + ','.join('"' + i.replace('"', '\\"') + '"' for i in items) + "}'::text[]"


PERMISSIONS = [
    ('dashboard.view', 'See the staff dashboard and its numbers'),
    ('catalogue.read', 'See every product, including drafts and archived ones'),
    ('catalogue.write', 'Add, edit, price, archive and restore products'),
    ('files.upload', 'Upload PDFs, page pictures and cover pictures'),
    ('orders.read', 'See orders and payments'),
    ('orders.write', 'Cancel unpaid orders and mark refunded orders'),
    ('entitlements.grant', 'Give a customer access to a sheet or class'),
    ('entitlements.revoke', 'Take away a customer\'s access'),
    ('customers.read', 'See customer accounts'),
    ('customers.write', 'Edit customers and block or unblock accounts'),
    ('security.read', 'See sessions, incidents, warnings and appeals'),
    ('security.write', 'Confirm incidents, issue or remove warnings, block sessions, suspend access, decide appeals'),
    ('messages.read', 'Read the contact inbox'),
    ('messages.write', 'Mark messages read, replied or archived'),
    ('coupons.write', 'Create and change coupons and class discounts'),
    ('pricing.write', 'Change plan prices, currency rates, fees and taxes'),
    ('settings.write', 'Change site settings such as how long purchases stay open'),
    ('content.write', 'Edit home-page text and chatbot answers'),
    ('reviews.moderate', 'Publish or hide customer reviews'),
    ('analytics.read', 'See sales, visitor and conversion numbers'),
    ('logs.read', 'See sign-in, payment, webhook, viewer and security logs'),
    ('audit.read', 'See the audit log of staff actions'),
    ('emails.read', 'See the email outbox'),
    ('emails.write', 'Retry or skip emails in the outbox'),
    ('exports.run', 'Download CSV exports and data backups'),
    ('developer.read', 'Open the developer diagnostics'),
    ('staff.manage', 'Add staff, change their roles and permissions'),
]
ALL = [p for p, _ in PERMISSIONS]
ROLES = [
    ('owner', 'Owner', ALL),
    ('admin', 'Administrator', ALL),
    ('support', 'Support', ['dashboard.view', 'catalogue.read', 'orders.read', 'customers.read', 'security.read',
                            'messages.read', 'messages.write', 'emails.read']),
    ('content', 'Content editor', ['dashboard.view', 'catalogue.read', 'catalogue.write', 'files.upload',
                                   'content.write', 'reviews.moderate', 'coupons.write', 'analytics.read']),
    ('developer', 'Developer', ['dashboard.view', 'catalogue.read', 'developer.read', 'logs.read',
                                'analytics.read', 'emails.read']),
]

AGREEMENT_TEXT = 'I understand that my account credentials are personal and must not be shared with anyone.'

SETTINGS = [
    ('worksheet_access', {'days': 365},
     'How long a bought sheet stays open, in days (a class plan lasts its own number of months).'),
    ('sessions', {'rememberDays': 30, 'shortHours': 12, 'maxDays': 90},
     'How long a sign-in lasts: with "remember me", without it, and the absolute limit.'),
    ('login', {'maxFailed': 5, 'lockMinutes': 15},
     'Wrong passwords in a row before an account is locked, and for how long.'),
    ('auth_links', {'verifyHours': 24, 'resetMinutes': 30},
     'How long confirmation and password-reset links work.'),
    ('currency_rates', {'INR': 1, 'USD': 0.012, 'EUR': 0.011, 'GBP': 0.0094, 'AED': 0.044, 'AUD': 0.018,
                        'CAD': 0.016, 'SGD': 0.016, 'NZD': 0.02, 'JPY': 1.8},
     'How much one rupee is in each currency.'),
    ('fees', {'IN': {'pct': 2, 'fixed': 3}, 'INTL': {'pct': 3.9, 'fixed': 0.3}},
     'Platform and payment fee: India % + rupees; elsewhere % + US dollars.'),
    ('security', {'maxWarnings': 3, 'warningExpiryDays': 365, 'autoSuspend': True},
     'Sharing warnings: how many suspend paid access, and after how many days a warning stops counting.'),
    ('agreement', {'version': '2026-10-07', 'text': AGREEMENT_TEXT},
     'The account-sharing agreement every customer accepts at sign-up.'),
    ('contact', {'inbox': 'learnwithwhy6@gmail.com'},
     'Where contact-form notes are emailed.'),
    ('email', {'fromName': 'Learn With Why', 'adminAlerts': ['learnwithwhy6@gmail.com']},
     'Sender name, and who gets staff alerts (warnings, new appeals, failed payments).'),
    ('quote', {'ttlMinutes': 15},
     'How long a price quote can be paid.'),
    ('viewer', {'tokenHours': 12, 'recheckSeconds': 60},
     'How long one opened viewer tab stays valid, and how often it checks access again.'),
]

SECURITY_RULES = [
    ('concurrent_devices', 'Paid sheets open on several devices at once',
     'The same account opens paid sheets from several devices on different networks within a short '
     'time. One new device or a changed IP address is never enough on its own.',
     'high', {'devices': 3, 'networks': 2, 'windowMinutes': 15}),
    ('many_devices_day', 'Many new devices in one day',
     'The account signs in from more distinct devices in one day than a family normally uses.',
     'medium', {'devices': 6, 'windowHours': 24}),
    ('many_countries_day', 'Paid sheets opened from several countries in one day',
     'Paid sheets are opened from several different countries within one day.',
     'high', {'countries': 3, 'windowHours': 24}),
    ('rapid_page_requests', 'Very many viewer requests',
     'Far more viewer requests in an hour than a person reading sheets would make (possible copying).',
     'medium', {'requests': 600, 'windowMinutes': 60}),
    ('manual_report', 'Reported by staff',
     'A member of staff confirmed sharing from evidence outside these rules (for example a customer report).',
     'medium', {}),
]

FAQ = [
    ('Which sheets are free?', 'Eight sheets are free to try: Alphabet A and B tracing, and the first three Colours and first three Shapes sheets in Vocabulary. Open the shop, pick Free, and sign in to open them. Every other sheet is bought on its own or opens with a class plan.',
     ['free', 'sample', 'try']),
    ('How do subscriptions work?', 'You can subscribe to Kindergarten for 1, 3 or 6 months (12 months too outside India). Pick a plan in the shop’s Subscription view; the price shows on the payment page. Your plan ends after its months, and My Account → My Worksheets shows the end date.',
     ['subscribe', 'subscription', 'plan', 'month', 'renew']),
    ('How do I pay?', 'You can buy single sheets or subscribe to Kindergarten. Each sheet card in the shop shows its price, and you pay on our secure payment page.',
     ['price', 'cost', 'pay', 'buy', 'rupee', '₹', 'payment']),
    ('How long can I open a sheet I bought?', 'Each sheet you buy stays open for {accessDays} days from the moment you buy it. The exact date and time is in your Purchase Successful email and in My Account → My Worksheets. After that it moves to your purchase history, and you can choose Buy Access Again.',
     ['expire', 'expiry', 'expires', 'forever', 'how long', 'access', 'valid', 'days']),
    ('Are Class 1, 2 and 3 ready?', 'Class 1, 2 and 3 sheets are coming soon. The Kindergarten sheets are ready now.',
     ['class 1', 'class 2', 'class 3', 'grade', 'standard']),
    ('What is in Kindergarten?', 'Kindergarten has seven Alphabet sections: A–Z letter tracing, letter recognition, matching uppercase and lowercase, letter before and after, beginning sounds, ending sounds, and finding the missing letters. Vocabulary has Colours and Shapes sheets.',
     ['kindergarten', 'kg', 'alphabet', 'letter', 'tracing', 'phonics', 'sound', 'abc', 'colours', 'shapes', 'vocabulary']),
    ('Which subjects do you cover?', 'Our sheets cover English, Maths and Science. Use the filters in the shop to see one subject at a time.',
     ['english', 'maths', 'math', 'science', 'subject']),
    ('How do I open my sheets?', 'Your sheets open in our protected viewer after you sign in. Find them in My Account → My Worksheets.',
     ['print', 'download', 'pdf', 'open', 'view', 'my worksheets']),
    ('Can I share my account?', 'No. Your sign-in details are personal. If we see signs of a shared account we send a warning; after three warnings, access to paid sheets is paused until we review it. You can reply to a warning from My Account if you think it is a mistake.',
     ['share', 'sharing', 'warning', 'suspended', 'blocked', 'family']),
    ('How do I contact you?', 'You can write to us at learnwithwhy6@gmail.com, or use the form in the Contact section of this page.',
     ['contact', 'email', 'mail', 'phone', 'help', 'support', 'query']),
    ('How do I sign in or sign up?', 'Use the sign-in card on the first screen of this page. New here? Sign up with your name and email, and we will email you a password. Use Forgot password any time to choose a new one.',
     ['sign in', 'login', 'log in', 'sign up', 'account', 'password']),
    ('Hello', 'Hello! I can help you find worksheets, explain how plans work, or tell you how to reach us. What would you like to know?',
     ['hello', 'hi', 'hey', 'namaste', 'good morning', 'good evening']),
    ('Thank you', 'You’re welcome! Ask me anything else whenever you like.',
     ['thank', 'thanks', 'great', 'nice']),
]
# never shown to customers: staff-only notes and answers still being planned
FAQ_HIDDEN = [
    ('How do staff grant access by hand?', 'Admin → Customers → Grant access. Grants always have an end date.', ['grant'], 'staff', 'published'),
    ('Do you offer refunds?', 'Refund policy is being written.', ['refund'], 'public', 'planned'),
]


def reference_sql(countries):
    out = ['-- Learn With Why on Supabase · 9/10 · reference data (classes, plans, settings, staff roles,',
           '-- sharing rules, chatbot answers). Safe to run again: existing rows are left as they are.', '']
    out.append("insert into public.classes (id, name, status, sort) values")
    out.append(",\n".join([
        "  ('kg', 'Kindergarten', 'available', 1)",
        "  ('c1', 'Class 1', 'coming_soon', 2)",
        "  ('c2', 'Class 2', 'coming_soon', 3)",
        "  ('c3', 'Class 3', 'coming_soon', 4)"]) + "\non conflict (id) do nothing;\n")
    out.append("insert into public.plans (id, label, months, price_inr, regions, note, sort) values")
    out.append(",\n".join([
        "  ('m1', '1 month', 1, 199, '{IN,INTL}', null, 1)",
        "  ('m3', '3 months', 3, 499, '{IN,INTL}', 'save 16%', 2)",
        "  ('m6', '6 months', 6, 899, '{IN,INTL}', 'save 25%', 3)",
        "  ('y1', '12 months', 12, 1499, '{INTL}', 'best value', 4)"]) + "\non conflict (id) do nothing;\n")
    rows = list(SETTINGS) + [('countries', countries, 'Countries offered at checkout: currency, tax, postal-code rule and payment methods.')]
    out.append("insert into public.settings (key, value, description) values")
    out.append(",\n".join(f"  ({q(k)}, {q(v)}, {q(d)})" for k, v, d in rows) + "\non conflict (key) do nothing;\n")
    out.append("insert into public.staff_permissions (id, description) values")
    out.append(",\n".join(f"  ({q(p)}, {q(d)})" for p, d in PERMISSIONS) + "\non conflict (id) do update set description = excluded.description;\n")
    out.append("insert into public.staff_role_templates (role, label, permissions) values")
    out.append(",\n".join(f"  ({q(r)}, {q(l)}, {arr(p)})" for r, l, p in ROLES) + "\non conflict (role) do update set label = excluded.label, permissions = excluded.permissions;\n")
    out.append("insert into public.security_rules (id, name, description, severity, params) values")
    out.append(",\n".join(f"  ({q(i)}, {q(n)}, {q(d)}, {q(s)}, {q(p)})" for i, n, d, s, p in SECURITY_RULES) + "\non conflict (id) do nothing;\n")
    faq_rows = [(qq, a, k, 'public', 'published') for qq, a, k in FAQ] + FAQ_HIDDEN
    out.append("insert into public.faq_entries (question, answer, keywords, audience, status, sort)")
    out.append("select v.question, v.answer, v.keywords, v.audience, v.status, v.sort from (values")
    out.append(",\n".join(f"  ({q(qq)}, {q(a)}, {arr(k)}, {q(au)}, {q(st)}, {i + 1})" for i, (qq, a, k, au, st) in enumerate(faq_rows)))
    out.append(") as v (question, answer, keywords, audience, status, sort)")
    out.append("where not exists (select 1 from public.faq_entries);\n")
    return '\n'.join(out)


def catalogue_sql(items):
    real = [i for i in items if not i.get('legacy') and i.get('pdf_exists')]
    out = ['-- Learn With Why on Supabase · 10/10 · the catalogue',
           f'-- {len(real)} Kindergarten sheets that have a real PDF (verified against backend/protected).',
           '-- The 28 old sample products have no PDF and are NOT imported. Prices are whole rupees;',
           '-- price 0 = free. A sheet only opens once its PDF has been uploaded to the "worksheets" bucket.',
           '-- Print and download limits start at 0 (view in the protected viewer only), as today.', '']
    out.append('insert into public.products (id, title, description, class_id, subject, group_id, section, section_label,'
               ' pages, price_inr, was_price_inr, status, pdf_path, thumb_url, landscape, tags, sort, seed) values')
    rows = []
    for n, i in enumerate(real):
        f = i.get('flags') or {}
        tags = [t for t, on in (('new', f.get('new')), ('best', f.get('best'))) if on]
        pages = i.get('pdf_pages_actual') or i.get('pages') or 1
        seed = {'title': i['title'], 'price_inr': i['price_inr'], 'pages': pages}
        rows.append('  (' + ', '.join([
            q(i['id']), q(i['title']), q(i.get('description') or ''), q(i['cls']), q(i['subject']),
            q(i.get('group_id')), q(i.get('section')), q(i.get('section_label')), q(pages),
            q(i['price_inr']), q(i.get('was_inr')), q('active'), q(i['pdf_path']), q(i.get('frontend_img')),
            q(bool(f.get('landscape'))), arr(tags), q((n + 1) * 10), q(seed)]) + ')')
    out.append(',\n'.join(rows))
    out.append('on conflict (id) do nothing;\n')
    free = [i['id'] for i in real if i['price_inr'] == 0]
    out.append(f'-- free sheets ({len(free)}): ' + ', '.join(free))
    return '\n'.join(out) + '\n', len(real), free


def main():
    items = json.loads(Path(sys.argv[1]).read_text())
    countries = json.loads(Path(sys.argv[2]).read_text())
    (MIG / '20261007120800_reference_data.sql').write_text(reference_sql(countries) + '\n')
    sql, n, free = catalogue_sql(items)
    (MIG / '20261007120900_catalogue_data.sql').write_text(sql)
    print(f'products: {n}, free: {free}')


if __name__ == '__main__':
    main()
