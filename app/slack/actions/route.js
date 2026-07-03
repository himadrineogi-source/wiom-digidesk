import { handleSlackAction } from '../../../lib/slack-service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const result = await handleSlackAction(await request.text(), request.headers);
  return new Response(result.body, { status: result.status });
}
