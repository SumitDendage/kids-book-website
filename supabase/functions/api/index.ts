// Learn With Why API — one Supabase Edge Function serving every /api/* route.
// Deploy with verify_jwt = false: the function checks Supabase Auth tokens itself (lib/auth.ts),
// and payment webhooks must reach it without a Supabase token.
import { handle } from './lib/app.ts';
import './routes/index.ts';

Deno.serve((req) => handle(req));
