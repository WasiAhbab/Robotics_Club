import { createClient } from '@/lib/supabase/server';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/.test(path.join('/')))
    return new Response(null, { status: 404 });
  const db = await createClient();
  const { data, error } = await db.storage
    .from('club-images')
    .download(path.join('/'));
  if (error || !data) return new Response(null, { status: 404 });
  return new Response(data, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
