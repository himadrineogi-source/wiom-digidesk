import { notifyLeave } from '../../../lib/slack-service.js';
import { requireDigideskUser } from '../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const auth = await requireDigideskUser();
  if (auth.response) return auth.response;

  const payload = await request.json();
  if (payload.empId && payload.empId !== auth.context.employee.id && auth.context.appUser.role !== 'hr') {
    return Response.json(
      { ok: false, error: 'You can only notify leave for your own employee record.' },
      { status: 403 }
    );
  }

  return Response.json(await notifyLeave(payload));
}
