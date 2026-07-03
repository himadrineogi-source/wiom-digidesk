import { sendDailyAttendance } from '../../../../lib/slack-service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  return Response.json(await sendDailyAttendance());
}
