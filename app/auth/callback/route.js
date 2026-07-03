import { createSupabaseAuthClient } from '../../../lib/supabase-auth.js';
import {
  getAuthorizedDigideskUser,
  safeInternalPath
} from '../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authRedirect(requestUrl, params) {
  const url = new URL('/', requestUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url);
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = safeInternalPath(requestUrl.searchParams.get('next'), '/');
  const providerError =
    requestUrl.searchParams.get('error_description') ||
    requestUrl.searchParams.get('error');

  if (providerError) {
    return authRedirect(requestUrl, { authError: providerError });
  }

  if (!code) {
    return authRedirect(requestUrl, { authError: 'No OAuth code was returned.' });
  }

  const supabase = await createSupabaseAuthClient();

  if (!supabase) {
    return authRedirect(requestUrl, { authError: 'Supabase Auth is not configured.' });
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return authRedirect(requestUrl, { authError: error.message });
  }

  const authorized = await getAuthorizedDigideskUser(data.user);

  if (authorized.error) {
    await supabase.auth.signOut();
    return authRedirect(requestUrl, { authError: authorized.error });
  }

  const redirectUrl = new URL(next, requestUrl);
  redirectUrl.searchParams.set('auth', 'success');
  return Response.redirect(redirectUrl);
}
