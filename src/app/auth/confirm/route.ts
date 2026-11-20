import { createClient } from '@/lib/supabase/server';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const token = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const db = await createClient();
  const result =
    token && (type === 'signup' || type === 'recovery' || type === 'email')
      ? await db.auth.verifyOtp({ type, token_hash: token })
      : code
        ? await db.auth.exchangeCodeForSession(code, {
            flowId: url.searchParams.get('sb_flow_id') ?? undefined,
          })
        : null;
  const destination =
    !result || result.error
      ? '/?auth=invalid'
      : type === 'recovery' ||
          url.searchParams.get('reset') === '1' ||
          ('redirectType' in result.data &&
            result.data.redirectType === 'recovery')
        ? '/?reset=1'
        : '/';
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
