import { getDigideskAuthContext } from '../../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getDigideskAuthContext();

  if (context.error) {
    return Response.json(
      { ok: false, error: context.error },
      { status: context.status || 401 }
    );
  }

  return Response.json({
    ok: true,
    user: context.appUser,
    auth: {
      email: context.authUser.email,
      name: context.authUser.user_metadata?.full_name || context.authUser.email
    }
  });
}
