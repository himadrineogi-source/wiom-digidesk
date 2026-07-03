import { readData, setDataKey } from '../../lib/data-store.js';
import { requireDigideskUser } from '../../lib/digidesk-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const auth = await requireDigideskUser();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const data = await readData();

  if (url.searchParams.get('action') === 'getAll') {
    return Response.json({ ok: true, data });
  }

  const key = url.searchParams.get('key');
  return Response.json({ ok: true, value: key ? (data[key] || null) : null });
}

export async function POST(request) {
  const auth = await requireDigideskUser();
  if (auth.response) return auth.response;

  const { key, value } = await request.json();
  if (!key) return Response.json({ ok: false }, { status: 400 });

  await setDataKey(key, typeof value === 'string' ? value : JSON.stringify(value));
  return Response.json({ ok: true });
}
