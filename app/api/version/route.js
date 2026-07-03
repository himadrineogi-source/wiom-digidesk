import { getDataBackend } from '../../../lib/data-store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ version: '3.0.0', feature: `nextjs-data-backend-${getDataBackend()}` });
}
