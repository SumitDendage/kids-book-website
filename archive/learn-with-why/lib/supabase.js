/* Supabase client. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see
   .env.example) to run against a real project; without them the site keeps
   working as the front-end demo with accounts and the Library in
   localStorage. The anon key is safe in the browser — row-level security in
   supabase/migrations decides what it can read. */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;
export const online = !!supabase;
