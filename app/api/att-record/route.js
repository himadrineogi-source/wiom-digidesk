import { updateDataKey } from '../../../lib/data-store.js';
import { requireDigideskUser } from '../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const auth = await requireDigideskUser();
  if (auth.response) return auth.response;

  const { attKey, attValue } = await request.json();
  if (!attKey) return Response.json({ ok: false }, { status: 400 });

  const empId = String(attKey).split('__')[0];
  const role = auth.context.appUser.role;
  if (role !== 'hr' && empId !== auth.context.employee.id) {
    return Response.json(
      { ok: false, error: 'You can only update your own attendance.' },
      { status: 403 }
    );
  }

  const { saved } = await updateDataKey('wiom_att', {}, attendance => {
    if (attValue === null || attValue === undefined) {
      delete attendance[attKey];
    } else {
      attendance[attKey] = { ...(attendance[attKey] || {}), ...attValue };
    }
    return attendance;
  });

  return Response.json({ ok: saved });
}
