-- Administrators may not open the Developer panel (Sumit, Oct 23: "no right for admin enter in the
-- developer panel"). Only owners and the Developer role keep developer.read.
-- 1. The Administrator role template no longer lists developer.read.
-- 2. Every admin staff row loses it now.
-- 3. A trigger takes it off any admin row from now on, whoever saves it (the API or SQL), so it
--    can't be handed back by ticking the box. Changing someone to Developer gives it again.

update public.staff_role_templates
set permissions = array_remove(permissions, 'developer.read')
where role = 'admin';

create or replace function private.admin_without_developer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'admin' then
    new.permissions := array_remove(new.permissions, 'developer.read');
  end if;
  return new;
end;
$$;
create trigger staff_members_admin_no_developer before insert or update of role, permissions on public.staff_members
  for each row execute function private.admin_without_developer();

update public.staff_members
set permissions = array_remove(permissions, 'developer.read')
where role = 'admin' and 'developer.read' = any(permissions);
