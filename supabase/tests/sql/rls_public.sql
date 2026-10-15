-- Row-security check that runs on the live project (SQL editor or MCP) and locally.
-- Everything happens in one transaction that is rolled back. Any failed expectation raises
-- an error naming it; success ends with one row: rls_public ok.
begin;

-- 1. A visitor with the public key (role anon)
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare
  t text;
  n integer;
  open_tables text[] := array['classes', 'plans', 'products', 'faq_entries', 'site_content', 'reviews'];
begin
  select count(*) into n from public.products;
  if n = 0 then raise exception 'anon: the public catalogue is empty'; end if;
  if exists (select 1 from public.products where status <> 'active') then raise exception 'anon: sees inactive products'; end if;
  begin
    perform pdf_path from public.products limit 1;
    raise exception 'anon: can read products.pdf_path';
  exception when insufficient_privilege then null;
  end;
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'v', 'p') and not (c.relname = any (open_tables)) loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'anon: can read public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  foreach t in array open_tables loop
    begin
      execute format('insert into public.%I default values', t);
      raise exception 'anon: can insert into public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform private.make_owner('nobody@example.com');
    raise exception 'anon: can run private.make_owner';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.fulfil_order('LWO-AAAAAAAAAA', 'razorpay', 'pay_x', 100, 'INR', 'test');
    raise exception 'anon: can run private.fulfil_order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from private.app_secrets;
    raise exception 'anon: can read private.app_secrets';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 2. A signed-in token for an account and session the API never opened (role authenticated)
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', gen_random_uuid(), 'session_id', gen_random_uuid())::text, true);
do $$
declare
  t text;
  own_tables text[] := array['profiles', 'entitlements', 'orders', 'order_items', 'notifications', 'account_warnings'];
  open_tables text[] := array['classes', 'plans', 'products', 'faq_entries', 'site_content', 'reviews'];
  n integer;
begin
  foreach t in array own_tables loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then
      -- column grants: count(*) is allowed, a missing table grant is not expected here
      raise exception 'authenticated: no select grant on public.%', t;
    end;
    if n <> 0 then raise exception 'authenticated stranger sees % rows in public.%', n, t; end if;
    begin
      execute format('insert into public.%I default values', t);
      raise exception 'authenticated: can insert into public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'v', 'p')
             and not (c.relname = any (own_tables)) and not (c.relname = any (open_tables)) loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'authenticated: can read public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform private.consume_delivery(1, 'print', 5);
    raise exception 'authenticated: can run private.consume_delivery';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 3. Storage: the worksheets bucket is private, covers is public
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'worksheets' and public = false) then
    raise exception 'storage: worksheets bucket missing or public';
  end if;
  if not exists (select 1 from storage.buckets where id = 'covers' and public = true) then
    raise exception 'storage: covers bucket missing or not public';
  end if;
end $$;

select 'rls_public ok' as result;
rollback;
