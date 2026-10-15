-- Learn With Why on Supabase · who may run the private functions
-- Postgres lets everyone (PUBLIC) run a new function until that right is taken away function by
-- function; "alter default privileges ... in schema private revoke execute ... from public" in
-- foundation.sql cannot undo that built-in default. The browser roles could not misuse these
-- functions anyway (the Data API does not expose the private schema, and the functions that are
-- not security definer run with the caller's table rights, which anon and authenticated lack), but
-- now each one runs only for the roles that were granted it: lww_api (row_security.sql and later
-- files) and, for the row-security check, authenticated. Trigger functions need no grant to fire.
-- Safe to run again.

revoke execute on all functions in schema private from public;
grant execute on function private.jwt_session_ok() to authenticated;
