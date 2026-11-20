import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const origin = 'http://127.0.0.1:3000';
assert.equal(
  url,
  'http://127.0.0.1:54321',
  'These tests require a disposable local Supabase project.',
);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
export const db = createClient(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
export function userClient() {
  return createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
}
export const ok = (result) => {
  assert.ifError(result.error);
  return result.data;
};
export async function fixture(role = 'member') {
  const email =
    (role === 'super_admin' ? 'robohaven-test-owner' : crypto.randomUUID()) +
    '@example.test';
  const password = crypto.randomUUID() + 'Aa7!';
  let id;
  if (role === 'super_admin') {
    const existing = ok(
      await db
        .from('profiles')
        .select('id')
        .eq('role', 'super_admin')
        .maybeSingle(),
    );
    if (existing) {
      const account = ok(await db.auth.admin.getUserById(existing.id)).user;
      assert.equal(
        account.email,
        email,
        'The local project already has a different owner.',
      );
      id = account.id;
      ok(await db.auth.admin.updateUserById(id, { password }));
    }
  }
  if (!id) {
    id = ok(
      await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: role + ' tester' },
      }),
    ).user.id;
    if (role !== 'member') {
      const connection = new URL(process.env.DB_URL);
      assert.equal(connection.hostname, '127.0.0.1');
      assert.equal(connection.port, '54322');
      const client = new pg.Client({ connectionString: connection.href });
      await client.connect();
      try {
        if (role === 'super_admin') {
          const sql = await readFile(
            new URL('../../scripts/provision-owner.sql', import.meta.url),
            'utf8',
          );
          await client.query(
            sql.replace('00000000-0000-0000-0000-000000000000', id),
          );
        } else {
          await client.query('update public.profiles set role=$1 where id=$2', [
            role,
            id,
          ]);
        }
      } finally {
        await client.end();
      }
    }
  }
  const client = userClient();
  const session = ok(
    await client.auth.signInWithPassword({ email, password }),
  ).session;
  return { id, email, password, client, token: session.access_token };
}
