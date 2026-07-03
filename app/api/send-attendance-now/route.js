import { sendDailyAttendance } from '../../../lib/slack-service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const result = await sendDailyAttendance();
  return Response.json({ ok: true, message: 'Attendance report sent', result });
}
