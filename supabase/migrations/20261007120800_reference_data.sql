-- Learn With Why on Supabase · 9/10 · reference data (classes, plans, settings, staff roles,
-- sharing rules, chatbot answers). Safe to run again: existing rows are left as they are.

insert into public.classes (id, name, status, sort) values
  ('kg', 'Kindergarten', 'available', 1),
  ('c1', 'Class 1', 'coming_soon', 2),
  ('c2', 'Class 2', 'coming_soon', 3),
  ('c3', 'Class 3', 'coming_soon', 4)
on conflict (id) do nothing;

insert into public.plans (id, label, months, price_inr, regions, note, sort) values
  ('m1', '1 month', 1, 199, '{IN,INTL}', null, 1),
  ('m3', '3 months', 3, 499, '{IN,INTL}', 'save 16%', 2),
  ('m6', '6 months', 6, 899, '{IN,INTL}', 'save 25%', 3),
  ('y1', '12 months', 12, 1499, '{INTL}', 'best value', 4)
on conflict (id) do nothing;

insert into public.settings (key, value, description) values
  ('worksheet_access', '{"days":365}'::jsonb, 'How long a bought sheet stays open, in days (a class plan lasts its own number of months).'),
  ('sessions', '{"rememberDays":30,"shortHours":12,"maxDays":90}'::jsonb, 'How long a sign-in lasts: with "remember me", without it, and the absolute limit.'),
  ('login', '{"maxFailed":5,"lockMinutes":15}'::jsonb, 'Wrong passwords in a row before an account is locked, and for how long.'),
  ('auth_links', '{"verifyHours":24,"resetMinutes":30}'::jsonb, 'How long confirmation and password-reset links work.'),
  ('currency_rates', '{"INR":1,"USD":0.012,"EUR":0.011,"GBP":0.0094,"AED":0.044,"AUD":0.018,"CAD":0.016,"SGD":0.016,"NZD":0.02,"JPY":1.8}'::jsonb, 'How much one rupee is in each currency.'),
  ('fees', '{"IN":{"pct":2,"fixed":3},"INTL":{"pct":3.9,"fixed":0.3}}'::jsonb, 'Platform and payment fee: India % + rupees; elsewhere % + US dollars.'),
  ('security', '{"maxWarnings":3,"warningExpiryDays":365,"autoSuspend":true}'::jsonb, 'Sharing warnings: how many suspend paid access, and after how many days a warning stops counting.'),
  ('agreement', '{"version":"2026-10-07","text":"I understand that my account credentials are personal and must not be shared with anyone."}'::jsonb, 'The account-sharing agreement every customer accepts at sign-up.'),
  ('contact', '{"inbox":"learnwithwhy6@gmail.com"}'::jsonb, 'Where contact-form notes are emailed.'),
  ('email', '{"fromName":"Learn With Why","adminAlerts":["learnwithwhy6@gmail.com"]}'::jsonb, 'Sender name, and who gets staff alerts (warnings, new appeals, failed payments).'),
  ('quote', '{"ttlMinutes":15}'::jsonb, 'How long a price quote can be paid.'),
  ('viewer', '{"tokenHours":12,"recheckSeconds":60}'::jsonb, 'How long one opened viewer tab stays valid, and how often it checks access again.'),
  ('countries', '[{"code":"IN","name":"India","currency":"INR","tax":{"label":"GST 18%","pct":18},"postal":{"label":"PIN code","hint":"6 digits, e.g. 411001","pattern":"^[1-9][0-9]{5}$","flags":""},"state":"State","states":["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Andaman and Nicobar Islands","Chandigarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Jammu and Kashmir","Ladakh","Lakshadweep","Puducherry"],"methods":["razorpay","paypal","stripe"]},{"code":"US","name":"United States","currency":"USD","tax":{"label":"Sales tax","pct":0},"postal":{"label":"ZIP code","hint":"5 digits, e.g. 94107","pattern":"^\\d{5}(-\\d{4})?$","flags":""},"state":"State","states":["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"],"methods":["razorpay","stripe","paypal"]},{"code":"GB","name":"United Kingdom","currency":"GBP","tax":{"label":"VAT 20%","pct":20},"postal":{"label":"Postcode","hint":"e.g. SW1A 1AA","pattern":"^[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}$","flags":"i"},"state":"County","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"AE","name":"United Arab Emirates","currency":"AED","tax":{"label":"VAT 5%","pct":5},"postal":{"label":"P.O. Box / postal code","hint":"optional","pattern":"^.{0,12}$","flags":""},"state":"Emirate","states":["Abu Dhabi","Dubai","Sharjah","Ajman","Umm Al Quwain","Ras Al Khaimah","Fujairah"],"methods":["razorpay","stripe","paypal"]},{"code":"AU","name":"Australia","currency":"AUD","tax":{"label":"GST 10%","pct":10},"postal":{"label":"Postcode","hint":"4 digits, e.g. 2000","pattern":"^\\d{4}$","flags":""},"state":"State / territory","states":["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"],"methods":["razorpay","stripe","paypal"]},{"code":"CA","name":"Canada","currency":"CAD","tax":{"label":"GST 5%","pct":5},"postal":{"label":"Postal code","hint":"e.g. M5V 3L9","pattern":"^[A-Z]\\d[A-Z] ?\\d[A-Z]\\d$","flags":"i"},"state":"Province","states":["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"],"methods":["razorpay","stripe","paypal"]},{"code":"SG","name":"Singapore","currency":"SGD","tax":{"label":"GST 9%","pct":9},"postal":{"label":"Postal code","hint":"6 digits","pattern":"^\\d{6}$","flags":""},"state":"District","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"DE","name":"Germany","currency":"EUR","tax":{"label":"VAT 19%","pct":19},"postal":{"label":"PLZ","hint":"5 digits","pattern":"^\\d{5}$","flags":""},"state":"State","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"FR","name":"France","currency":"EUR","tax":{"label":"VAT 20%","pct":20},"postal":{"label":"Code postal","hint":"5 digits","pattern":"^\\d{5}$","flags":""},"state":"Region","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"NL","name":"Netherlands","currency":"EUR","tax":{"label":"VAT 21%","pct":21},"postal":{"label":"Postcode","hint":"e.g. 1012 AB","pattern":"^\\d{4} ?[A-Z]{2}$","flags":"i"},"state":"Province","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"IE","name":"Ireland","currency":"EUR","tax":{"label":"VAT 23%","pct":23},"postal":{"label":"Eircode","hint":"e.g. D02 X285","pattern":"^[A-Z\\d]{3} ?[A-Z\\d]{4}$","flags":"i"},"state":"County","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"NZ","name":"New Zealand","currency":"NZD","tax":{"label":"GST 15%","pct":15},"postal":{"label":"Postcode","hint":"4 digits","pattern":"^\\d{4}$","flags":""},"state":"Region","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"JP","name":"Japan","currency":"JPY","tax":{"label":"Consumption tax 10%","pct":10},"postal":{"label":"Postal code","hint":"e.g. 100-0001","pattern":"^\\d{3}-?\\d{4}$","flags":""},"state":"Prefecture","states":null,"methods":["razorpay","stripe","paypal"]},{"code":"OTHER","name":"Other country","currency":"USD","tax":{"label":"Tax","pct":0},"postal":{"label":"Postal / ZIP code","hint":"3–10 characters","pattern":"^[A-Z\\d \\-]{3,10}$","flags":"i"},"state":"State / region","states":null,"methods":["razorpay","stripe","paypal"]}]'::jsonb, 'Countries offered at checkout: currency, tax, postal-code rule and payment methods.')
on conflict (key) do nothing;

insert into public.staff_permissions (id, description) values
  ('dashboard.view', 'See the staff dashboard and its numbers'),
  ('catalogue.read', 'See every product, including drafts and archived ones'),
  ('catalogue.write', 'Add, edit, price, archive and restore products'),
  ('files.upload', 'Upload PDFs, page pictures and cover pictures'),
  ('orders.read', 'See orders and payments'),
  ('orders.write', 'Cancel unpaid orders and mark refunded orders'),
  ('entitlements.grant', 'Give a customer access to a sheet or class'),
  ('entitlements.revoke', 'Take away a customer''s access'),
  ('customers.read', 'See customer accounts'),
  ('customers.write', 'Edit customers and block or unblock accounts'),
  ('security.read', 'See sessions, incidents, warnings and appeals'),
  ('security.write', 'Confirm incidents, issue or remove warnings, block sessions, suspend access, decide appeals'),
  ('messages.read', 'Read the contact inbox'),
  ('messages.write', 'Mark messages read, replied or archived'),
  ('coupons.write', 'Create and change coupons'),
  ('pricing.write', 'Change plan prices, class discounts, currency rates, fees and taxes'),
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
  ('staff.manage', 'Add staff, change their roles and permissions')
on conflict (id) do update set description = excluded.description;

insert into public.staff_role_templates (role, label, permissions) values
  ('owner', 'Owner', '{"dashboard.view","catalogue.read","catalogue.write","files.upload","orders.read","orders.write","entitlements.grant","entitlements.revoke","customers.read","customers.write","security.read","security.write","messages.read","messages.write","coupons.write","pricing.write","settings.write","content.write","reviews.moderate","analytics.read","logs.read","audit.read","emails.read","emails.write","exports.run","developer.read","staff.manage"}'::text[]),
  ('admin', 'Administrator', '{"dashboard.view","catalogue.read","catalogue.write","files.upload","orders.read","orders.write","entitlements.grant","entitlements.revoke","customers.read","customers.write","security.read","security.write","messages.read","messages.write","coupons.write","pricing.write","settings.write","content.write","reviews.moderate","analytics.read","logs.read","audit.read","emails.read","emails.write","exports.run","developer.read","staff.manage"}'::text[]),
  ('support', 'Support', '{"dashboard.view","catalogue.read","orders.read","customers.read","security.read","messages.read","messages.write","emails.read"}'::text[]),
  ('content', 'Content editor', '{"dashboard.view","catalogue.read","catalogue.write","files.upload","content.write","reviews.moderate","coupons.write","analytics.read"}'::text[]),
  ('developer', 'Developer', '{"dashboard.view","catalogue.read","developer.read","logs.read","analytics.read","emails.read"}'::text[])
on conflict (role) do update set label = excluded.label, permissions = excluded.permissions;

insert into public.security_rules (id, name, description, severity, params) values
  ('concurrent_devices', 'Paid sheets open on several devices at once', 'The same account opens paid sheets from several devices on different networks within a short time. One new device or a changed IP address is never enough on its own.', 'high', '{"devices":3,"networks":2,"windowMinutes":15}'::jsonb),
  ('many_devices_day', 'Many new devices in one day', 'The account signs in from more distinct devices in one day than a family normally uses.', 'medium', '{"devices":6,"windowHours":24}'::jsonb),
  ('many_countries_day', 'Paid sheets opened from several countries in one day', 'Paid sheets are opened from several different countries within one day.', 'high', '{"countries":3,"windowHours":24}'::jsonb),
  ('rapid_page_requests', 'Very many viewer requests', 'Far more viewer requests in an hour than a person reading sheets would make (possible copying).', 'medium', '{"requests":600,"windowMinutes":60}'::jsonb),
  ('manual_report', 'Reported by staff', 'A member of staff confirmed sharing from evidence outside these rules (for example a customer report).', 'medium', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.faq_entries (question, answer, keywords, audience, status, sort)
select v.question, v.answer, v.keywords, v.audience, v.status, v.sort from (values
  ('Which sheets are free?', 'Eight sheets are free to try: Alphabet A and B tracing, and the first three Colours and first three Shapes sheets in Vocabulary. Open the shop, pick Free, and sign in to open them. Every other sheet is bought on its own or opens with a class plan.', '{"free","sample","try"}'::text[], 'public', 'published', 1),
  ('How do subscriptions work?', 'You can subscribe to Kindergarten for 1, 3 or 6 months (12 months too outside India). Pick a plan in the shop’s Subscription view; the price shows on the payment page. Your plan ends after its months, and My Account → My Worksheets shows the end date.', '{"subscribe","subscription","plan","month","renew"}'::text[], 'public', 'published', 2),
  ('How do I pay?', 'You can buy single sheets or subscribe to Kindergarten. Each sheet card in the shop shows its price, and you pay on our secure payment page.', '{"price","cost","pay","buy","rupee","₹","payment"}'::text[], 'public', 'published', 3),
  ('How long can I open a sheet I bought?', 'Each sheet you buy stays open for {accessDays} days from the moment you buy it. The exact date and time is in your Purchase Successful email and in My Account → My Worksheets. After that it moves to your purchase history, and you can choose Buy Access Again.', '{"expire","expiry","expires","forever","how long","access","valid","days"}'::text[], 'public', 'published', 4),
  ('Are Class 1, 2 and 3 ready?', 'Class 1, 2 and 3 sheets are coming soon. The Kindergarten sheets are ready now.', '{"class 1","class 2","class 3","grade","standard"}'::text[], 'public', 'published', 5),
  ('What is in Kindergarten?', 'Kindergarten has seven Alphabet sections: A–Z letter tracing, letter recognition, matching uppercase and lowercase, letter before and after, beginning sounds, ending sounds, and finding the missing letters. Vocabulary has Colours and Shapes sheets.', '{"kindergarten","kg","alphabet","letter","tracing","phonics","sound","abc","colours","shapes","vocabulary"}'::text[], 'public', 'published', 6),
  ('Which subjects do you cover?', 'Our sheets cover English, Maths and Science. Use the filters in the shop to see one subject at a time.', '{"english","maths","math","science","subject"}'::text[], 'public', 'published', 7),
  ('How do I open my sheets?', 'Your sheets open in our protected viewer after you sign in. Find them in My Account → My Worksheets.', '{"print","download","pdf","open","view","my worksheets"}'::text[], 'public', 'published', 8),
  ('Can I share my account?', 'No. Your sign-in details are personal. If we see signs of a shared account we send a warning; after three warnings, access to paid sheets is paused until we review it. You can reply to a warning from My Account if you think it is a mistake.', '{"share","sharing","warning","suspended","blocked","family"}'::text[], 'public', 'published', 9),
  ('How do I contact you?', 'You can write to us at learnwithwhy6@gmail.com, or use the form in the Contact section of this page.', '{"contact","email","mail","phone","help","support","query"}'::text[], 'public', 'published', 10),
  ('How do I sign in or sign up?', 'Use the sign-in card on the first screen of this page. New here? Sign up with your name and email, and we will email you a password. Use Forgot password any time to choose a new one.', '{"sign in","login","log in","sign up","account","password"}'::text[], 'public', 'published', 11),
  ('Hello', 'Hello! I can help you find worksheets, explain how plans work, or tell you how to reach us. What would you like to know?', '{"hello","hi","hey","namaste","good morning","good evening"}'::text[], 'public', 'published', 12),
  ('Thank you', 'You’re welcome! Ask me anything else whenever you like.', '{"thank","thanks","great","nice"}'::text[], 'public', 'published', 13),
  ('How do staff grant access by hand?', 'Admin → Customers → Grant access. Grants always have an end date.', '{"grant"}'::text[], 'staff', 'published', 14),
  ('Do you offer refunds?', 'Refund policy is being written.', '{"refund"}'::text[], 'public', 'planned', 15)
) as v (question, answer, keywords, audience, status, sort)
where not exists (select 1 from public.faq_entries);

