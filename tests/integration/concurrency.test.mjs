import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
const docker = promisify(execFile);
import { platform } from '../platform.mjs';

test('competing PostgreSQL sessions cannot duplicate ownership, stock, awards or a return', async (t) => {
  const name = 'robohaven-test-' + crypto.randomUUID();
  const password = crypto.randomUUID();
  const image = process.env.POSTGRES_TEST_IMAGE || 'postgres:17';
  await docker('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-e',
    'POSTGRES_PASSWORD=' + password,
    '-p',
    '127.0.0.1::5432',
    image,
  ]);
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.end()));
    await docker('docker', ['stop', name]);
  });
  const { stdout } = await docker('docker', ['port', name, '5432/tcp']);
  const port = Number(stdout.trim().split(':').at(-1));
  async function connect() {
    for (let i = 0; i < 100; i++) {
      const c = new pg.Client({
        host: '127.0.0.1',
        port,
        user: 'postgres',
        database: 'postgres',
        password,
      });
      try {
        await c.connect();
        clients.push(c);
        return c;
      } catch (e) {
        await c.end();
        if (i === 99) throw e;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  const admin = await connect(),
    left = await connect(),
    right = await connect();
  await admin.query(platform);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).sort()) {
    const sql = await readFile(new URL(name, migrations), 'utf8');
    await admin.query(
      sql.replace('create extension if not exists pgcrypto;', ''),
    );
  }
  const [ownerA, ownerB, member] = Array.from({ length: 3 }, () =>
    crypto.randomUUID(),
  );
  for (const id of [ownerA, ownerB, member])
    await admin.query("insert into auth.users values($1,$2,'{}')", [
      id,
      id + '@example.test',
    ]);
  async function compete(promises) {
    const outcomes = await Promise.allSettled(promises);
    assert.equal(
      outcomes.filter((r) => r.status === 'fulfilled').length,
      1,
      JSON.stringify(outcomes.map((r) => r.reason?.message)),
    );
  }
  await compete([
    left.query("update profiles set role='super_admin' where id=$1", [ownerA]),
    right.query("update profiles set role='super_admin' where id=$1", [ownerB]),
  ]);
  const owner = (
    await admin.query("select id from profiles where role='super_admin'")
  ).rows[0].id;
  async function actor(c, id) {
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await c.query('set role authenticated');
  }
  await actor(left, member);
  const offer = (
    await left.query(
      "select submit_contribution('Motor','Gear motor','donation') id",
    )
  ).rows[0].id;
  await actor(left, owner);
  await actor(right, owner);
  await compete(
    [left, right].map((c) =>
      c.query('select review_contribution($1,true)', [offer]),
    ),
  );
  const product = (await left.query('select id from workspace_products'))
    .rows[0].id;
  await actor(left, member);
  const requests = [];
  for (let i = 0; i < 2; i++)
    requests.push(
      (await left.query("select submit_request($1,1,'Robot') id", [product]))
        .rows[0].id,
    );
  await actor(left, owner);
  await compete(
    [left, right].map((c, i) =>
      c.query('select review_request($1,true)', [requests[i]]),
    ),
  );
  const approved = (
    await left.query(
      "select id from workspace_requests where status='Approved'",
    )
  ).rows[0].id;
  await compete(
    [left, right].map((c) => c.query('select close_loan($1)', [approved])),
  );
  assert.equal(
    (await admin.query('select count(*)::int as n from reputation_ledger'))
      .rows[0].n,
    2,
  );
  assert.equal(
    (await left.query('select available from workspace_products')).rows[0]
      .available,
    1,
  );
});
