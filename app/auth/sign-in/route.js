import { createSupabaseAuthClient } from '../../../lib/supabase-auth.js';
import { safeInternalPath } from '../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorRedirect(requestUrl, message) {
  const url = new URL('/', requestUrl);
  url.searchParams.set('authError', message);
  return Response.redirect(url);
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const next = safeInternalPath(requestUrl.searchParams.get('next'), '/');
  const supabase = await createSupabaseAuthClient();

  if (!supabase) {
    return errorRedirect(requestUrl, 'Supabase Auth is not configured.');
  }

  const callbackUrl = new URL('/auth/callback', requestUrl.origin);
  callbackUrl.searchParams.set('next', next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl.toString(),
      queryParams: {
        prompt: 'select_account'
      }
    }
  });

  if (error || !data?.url) {
    return errorRedirect(requestUrl, error?.message || 'Google sign-in could not be started.');
  }

  return Response.redirect(data.url);
}
