import { notifyLeave } from '../../../lib/slack-service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  return Response.json(await notifyLeave(await request.json()));
}
