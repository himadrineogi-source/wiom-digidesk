import { createSupabaseAuthClient } from '../../../lib/supabase-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function signOut(request) {
  const requestUrl = new URL(request.url);
  const supabase = await createSupabaseAuthClient();
  if (supabase) await supabase.auth.signOut();

  const redirectUrl = new URL('/', requestUrl);
  redirectUrl.searchParams.set('signedOut', '1');
  return Response.redirect(redirectUrl);
}

export async function GET(request) {
  return signOut(request);
}

export async function POST(request) {
  return signOut(request);
}
