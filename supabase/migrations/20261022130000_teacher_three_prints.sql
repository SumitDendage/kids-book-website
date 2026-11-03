-- Teacher accounts get 3 prints per sheet (Sumit, Oct 22: "parents, teachers, organization ... print
-- limit is 2,3,300"). Parent 2 and Organization 300 stay. Only the Teacher number in the 'prints'
-- setting changes; staff can still change all three in Admin → Settings. The allowance is read live,
-- so a Teacher who already printed 3 or more times of a sheet simply has 0 left on it.

update public.settings
set value = jsonb_set(value, '{teacher}', '3'::jsonb)
where key = 'prints';
