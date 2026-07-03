import { sendDailyAttendance } from '../../../lib/slack-service.js';
import { requireDigideskHr } from '../../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const auth = await requireDigideskHr();
  if (auth.response) return auth.response;

  const result = await sendDailyAttendance();
  return Response.json({ ok: true, message: 'Attendance report sent', result });
}
