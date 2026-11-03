-- A sign-in code passed on to one friend is sharing: two devices on networks they never shared,
-- opening paid sheets within 15 minutes, now give a warning at once (no staff click needed).
-- Three active warnings still pause paid access (settings.security), and staff can still
-- withdraw a warning or lift the pause from the admin panel.

update public.security_rules
set params = jsonb_set(coalesce(params, '{}'::jsonb), '{devices}', '2'::jsonb),
    auto_confirm = true,
    description = 'The same account opens paid sheets from several devices on different networks within a short time (at least the set number of each). Two devices count only when they were never on the same network, as when a sign-in code is given to someone else. One new device or a changed IP address is never enough on its own.'
where id = 'concurrent_devices';
