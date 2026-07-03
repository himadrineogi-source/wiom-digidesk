import { updateDataKey } from '../../../lib/data-store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { empId, empName, role, time } = await request.json();
  if (!empId) return Response.json({ ok: true });

  await updateDataKey('wiom_logins', [], logins => {
    logins.unshift({ empId, empName, role, time, date: new Date().toISOString().split('T')[0] });
    if (logins.length > 1000) logins.splice(1000);
    return logins;
  });

  return Response.json({ ok: true });
}
