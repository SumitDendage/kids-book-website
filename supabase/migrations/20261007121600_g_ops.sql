-- Learn With Why on Supabase · builder G · staff operations helpers
-- 1. Sales numbers are counted by the time an order was paid or refunded (analytics, dashboard,
--    exports), so those times get small partial indexes. (Named *_idx: "orders_paid_at" is already
--    the name of the CHECK constraint that ties paid_at to the status.)
-- 2. The audit log and the review queue are filtered by action / status in the staff screens.
-- 3. The developer health page lists the applied migrations. They live in a schema the API role
--    cannot read, so this function returns only their version and name (never the SQL text),
--    and says when there is no history to read (migrations applied without the Supabase CLI).
-- Additive and safe to run again.

create index if not exists orders_paid_at_idx on public.orders (paid_at) where paid_at is not null;
create index if not exists orders_refunded_at_idx on public.orders (refunded_at) where refunded_at is not null;
create index if not exists audit_logs_action on public.audit_logs (action, at desc);
create index if not exists reviews_status on public.reviews (status, created_at desc);

-- {"readable": true, "list": [{"version": "...", "name": "..."}, ...]}
-- or {"readable": false, "reason": "no_history_table" | "no_permission", "list": []}
create or replace function private.applied_migrations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list jsonb;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return jsonb_build_object('readable', false, 'reason', 'no_history_table', 'list', '[]'::jsonb);
  end if;
  begin
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''version'', m.version::text, ''name'', m.name::text) order by m.version), ''[]''::jsonb)
             from supabase_migrations.schema_migrations m'
      into v_list;
  exception when undefined_column then
    -- older CLI versions keep only the version
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''version'', m.version::text, ''name'', null) order by m.version), ''[]''::jsonb)
             from supabase_migrations.schema_migrations m'
      into v_list;
  end;
  return jsonb_build_object('readable', true, 'list', v_list);
exception when insufficient_privilege then
  return jsonb_build_object('readable', false, 'reason', 'no_permission', 'list', '[]'::jsonb);
end;
$$;
revoke all on function private.applied_migrations() from public;
grant execute on function private.applied_migrations() to lww_api;
