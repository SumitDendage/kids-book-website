-- Learn With Why on Supabase · builder D · end one Supabase Auth session
-- POST /api/me/sessions/:id/end lets a customer end one of their other sign-ins. The API revokes
-- the app_sessions row (its access tokens stop working at once) and deletes the matching
-- auth.sessions row here, so that sign-in's refresh token stops working too.
-- private.end_auth_sessions() can only end all-but-one, hence this small companion.

create or replace function private.end_auth_session(p_user uuid, p_session uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v integer;
begin
  delete from auth.sessions where user_id = p_user and id = p_session;
  get diagnostics v = row_count;
  return v;
end;
$$;
revoke all on function private.end_auth_session(uuid, uuid) from public;
grant execute on function private.end_auth_session(uuid, uuid) to lww_api;
