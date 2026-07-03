import { updateDataKey } from '../../../lib/data-store.js';
import { requireDigideskUser } from '../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const auth = await requireDigideskUser();
  if (auth.response) return auth.response;

  const { time } = await request.json();
  const { employee, appUser } = auth.context;
  const empId = employee.id;
  const empName = employee.name;
  const role = appUser.role;

  await updateDataKey('wiom_logins', [], logins => {
    logins.unshift({ empId, empName, role, time, date: new Date().toISOString().split('T')[0] });
    if (logins.length > 1000) logins.splice(1000);
    return logins;
  });

  return Response.json({ ok: true });
}
