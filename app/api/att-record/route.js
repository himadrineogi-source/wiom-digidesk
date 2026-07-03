import { updateDataKey } from '../../../lib/data-store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { attKey, attValue } = await request.json();
  if (!attKey) return Response.json({ ok: false }, { status: 400 });

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
