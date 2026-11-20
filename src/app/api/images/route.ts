import sharp from 'sharp';
import { createClient as adminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

const maxBytes = 3 * 1024 * 1024;
export async function POST(request: Request) {
  const db = await createClient();
  const origin = request.headers.get('origin');
  if (
    !origin ||
    !URL.canParse(origin) ||
    new URL(origin).host !== request.headers.get('host')
  )
    return new Response(null, { status: 403 });
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  const { data: access } = await db.rpc('current_role');
  if (!access) return new Response(null, { status: 403 });
  const formats: Record<string, string> = {
    'image/jpeg': 'jpeg',
    'image/webp': 'webp',
    'image/png': 'png',
  };
  const format = formats[request.headers.get('content-type') || ''];
  if (!format || !request.body) return new Response(null, { status: 415 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  let image: Buffer;
  try {
    const input = sharp(Buffer.concat(chunks), {
      limitInputPixels: 24_000_000,
    });
    if ((await input.metadata()).format !== format)
      return new Response(null, { status: 415 });
    image = await input
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return new Response(null, { status: 422 });
  }
  const storage = adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const path = user.id + '/' + crypto.randomUUID() + '.webp';
  const { error } = await storage.storage
    .from('club-images')
    .upload(path, image, { contentType: 'image/webp', upsert: false });
  return error
    ? new Response(null, { status: 502 })
    : Response.json({ path: '/api/images/' + path }, { status: 201 });
}
