/* The Supabase connection (the project and its public key come from frontend/.env.production).
   The site itself goes through the "api" Edge Function (src/services/api.js) for sign-in,
   worksheets, orders and the viewer, because every shop table is closed to the browser by row
   security. Use this client only for what the public key is allowed to do. */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://liaqgyskuhnxmlvmrnrl.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_la_ugszxVu2H23l5DBzmdQ_IdvFRkmG';

export const supabase = createClient(url, key);
