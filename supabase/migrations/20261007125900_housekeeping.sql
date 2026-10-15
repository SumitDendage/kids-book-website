-- Learn With Why on Supabase · housekeeping (applied last)
--
-- A tidy-up routine the API calls about once an hour: it removes rate-limit counters older than
-- two days, unused price quotes and sign-in links that expired long ago, and marks sign-ins and
-- unpaid orders that ran out. It only touches rows the API itself made, and the API keeps working
-- without it (the tables just grow). It lives in its own file because the Supabase tool asks the
-- project owner to confirm SQL that deletes rows, so the owner adds it from the SQL Editor
-- (docs/SETUP.md, step 4).

-- Housekeeping, called now and then by the API. Keeps the tables small.
create or replace function private.housekeeping()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_rl int; v_q int; v_t int;
begin
  delete from private.rate_limits where window_start < now() - interval '2 days';
  get diagnostics v_rl = row_count;
  delete from public.quotes where expires_at < now() - interval '7 days' and used_at is null;
  get diagnostics v_q = row_count;
  delete from public.auth_tokens where expires_at < now() - interval '30 days';
  get diagnostics v_t = row_count;
  update public.app_sessions set revoked_at = now(), revoke_reason = 'expired'
  where revoked_at is null and expires_at < now();
  update public.orders set status = 'expired'
  where status = 'created' and created_at < now() - interval '2 days';
  return jsonb_build_object('rate_limits', v_rl, 'quotes', v_q, 'tokens', v_t);
end;
$$;

revoke all on function private.housekeeping() from public;
grant execute on function private.housekeeping() to lww_api;
