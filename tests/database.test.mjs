import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

import { platform } from './platform.mjs';
test('fresh schema, membership boundaries and transactional club workflows', async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(platform);
  for (const name of (await readdir('supabase/migrations')).sort()) {
    let sql = await readFile('supabase/migrations/' + name, 'utf8');
    // gen_random_uuid is built into PostgreSQL. PGlite omits the pgcrypto extension.
    await db.exec(sql.replace('create extension if not exists pgcrypto;', ''));
  }
  const actor = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const value = async (sql, params = []) =>
    Object.values((await query(sql, params))[0])[0];
  const [owner, member, other, secretary, moderator] = Array.from(
    { length: 5 },
    () => crypto.randomUUID(),
  );
  for (const id of [owner, member, other, secretary, moderator])
    await query("insert into auth.users values($1,$2,'{}')", [
      id,
      id + '@example.test',
    ]);
  await actor(member);
  assert.equal(await value('select public.current_role()'), 'member');
  await db.exec('reset role; set role service_role');
  await assert.rejects(
    query("update profiles set role='admin' where id=$1", [member]),
    /assigned in the database/,
  );
  await db.exec('reset role');
  for (const [id, role] of [
    [owner, 'super_admin'],
    [secretary, 'secretary'],
    [moderator, 'moderator'],
  ])
    await query('update profiles set role=$2 where id=$1', [id, role]);
  await assert.rejects(
    query("update profiles set role='member' where id=$1", [owner]),
    /demoted/,
  );
  await assert.rejects(
    query('delete from auth.users where id=$1', [owner]),
    /deleted/,
  );
  await assert.rejects(
    query("update profiles set role='super_admin' where id=$1", [other]),
    /unique/,
  );
  await actor(member);
  await assert.rejects(
    query("update profiles set role='admin' where id=$1", [member]),
    /permission/,
  );
  await assert.rejects(
    query('select approve_request($1,$2)', [crypto.randomUUID(), owner]),
    /permission/,
  );
  await assert.rejects(
    query("select manage_member($1,'role',new_role=>'admin')", [other]),
    /Permission/,
  );
  await assert.rejects(query("select save_equipment(null,'{}')"), /Permission/);
  const offer = await value(
    "select submit_contribution('Arduino','One new board','donation')",
  );
  await actor(other);
  assert.equal(await value('select count(*)::int from workspace_donations'), 0);
  await actor(secretary);
  await assert.rejects(
    query("select manage_member($1,'kick','test')", [other]),
    /Permission/,
  );
  await query('select review_contribution($1,true)', [offer]);
  await assert.rejects(
    query('select review_contribution($1,true)', [offer]),
    /PENDING/,
  );
  const product = await value('select id from workspace_products');
  await actor(member);
  assert.equal(
    await value('select rep from workspace_members where id=$1', [member]),
    5,
  );
  assert.equal(
    await value('select count(*)::int from workspace_notifications'),
    1,
  );
  await query('select read_notification(id) from workspace_notifications');
  assert.equal(
    await value(
      'select count(*)::int from workspace_notifications where read_at is null',
    ),
    0,
  );
  // A second member can read a published cover and gallery, but not an unattached upload.
  await db.exec('reset role');
  const images = Array.from({ length: 3 }, () => owner + '/' + crypto.randomUUID() + '.webp');
  for (const image of images)
    await query("insert into storage.objects(bucket_id,name) values('club-images',$1)", [image]);
  await query("update products set image_path=$2,views=array[$3::text] where id=$1",
    [product, '/api/images/' + images[0], '/api/images/' + images[1]]);
  await actor(other);
  const visible = await query("select name from storage.objects where bucket_id='club-images'");
  assert.deepEqual(visible.map(row => row.name).sort(), images.slice(0, 2).sort());
  await actor(member);
  const request = await value("select submit_request($1,1,'Rover')", [product]);
  const second = await value("select submit_request($1,1,'Rover 2')", [
    product,
  ]);
  await actor(other);
  assert.equal(await value('select count(*)::int from workspace_requests'), 0);
  await actor(secretary);
  await query('select review_request($1,true)', [request]);
  await assert.rejects(
    query('select review_request($1,true)', [request]),
    /PENDING/,
  );
  await assert.rejects(
    query('select review_request($1,true)', [second]),
    /STOCK/,
  );
  await assert.rejects(
    query("select review_request($1,false,'  ')", [second]),
    /Enter text/,
  );
  await query("select review_request($1,false,'Needed for competition')", [
    second,
  ]);
  async function assertVisibility(status) {
    for (const [id, expected] of [[member, [status]], [other, []], [secretary, [status]]]) {
      await actor(id);
      assert.deepEqual((await query('select status from workspace_requests where id=$1', [request])).map(r => r.status), expected);
    }
  }
  await assertVisibility('Approved');
  await query('select close_loan($1)', [request]);
  await assertVisibility('Returned');
  await actor(owner);
  const borrowerName = await value('select name from workspace_members where id=$1', [member]);
  for (const title of ['Loan approved', 'Loan returned']) {
    assert.equal(
      await value('select detail from workspace_activity where title=$1', [title]),
      borrowerName + ' · 1 × Arduino',
    );
  }
  await actor(other);
  assert.equal(await value('select count(*)::int from workspace_activity'), 0);
  await actor(secretary);

  await assert.rejects(query('select close_loan($1)', [request]), /RETURNED/);
  assert.equal(await value('select available from workspace_products where id=$1', [product]), 1);
  await actor(member);
  const privateOffer = await value("select submit_contribution('Loaned tool','Private lending terms','lend',current_date+7)");
  await actor(secretary);
  await query('select review_contribution($1,true)', [privateOffer]);
  for (const [id, count] of [[member, 1], [other, 0], [secretary, 1]]) {
    await actor(id);
    assert.equal(await value('select count(*)::int from workspace_donations where id=$1', [privateOffer]), count);
    assert.equal(await value('select points from workspace_contribution_total'), 8);
  }
  await actor(moderator);
  await query("select set_preference('borrowDays',9)");
  await assert.rejects(
    query("select manage_member($1,'suspend','test',days=>1)", [member]),
    /Permission/,
  );
  await actor(owner);
  await query("select manage_member($1,'rep','Workshop support',5)", [member]);
  for (const points of [-5, 7])
    await query("select manage_member($1,'rep','Adjustment',$2)", [
      member,
      points,
    ]);
  await query("select manage_member($1,'suspend','Late return',days=>2)", [
    member,
  ]);
  await actor(member);
  assert.equal(
    await value("select (account_access_status()->>'allowed')::boolean"),
    false,
  );
  assert.equal(await value('select count(*)::int from workspace_products'), 0);
  await db.exec('reset role');
  await query(
    "update profiles set suspended_until=now()-interval '1 minute' where id=$1",
    [member],
  );
  await actor(member);
  assert.equal(
    await value("select (account_access_status()->>'allowed')::boolean"),
    true,
  );
  await actor(owner);
  await query("select manage_member($1,'kick','Club decision')", [member]);
  await query("select manage_member($1,'restore')", [member]);
  await actor(member);
  assert.equal(
    await value(
      'select count(*)::int from workspace_reputation where actor is not null',
    ),
    6,
  );
  assert.equal(
    await value(
      "select body from workspace_notifications where title='Request rejected'",
    ),
    'Needed for competition',
  );
  await assert.rejects(
    query(
      "select submit_contribution('Board','Photo','donation',null,'/api/images/fake/key.webp')",
    ),
    /Invalid image/,
  );
  await assert.rejects(
    query(
      "insert into storage.objects values('club-images','other/image.webp')",
    ),
    /permission/,
  );

  const rejected = await value(
    "select submit_contribution('Probe','Test probe','donation')",
  );
  await actor(owner);
  await assert.rejects(
    query("select review_contribution($1,false,'')", [rejected]),
    /REJECTION_REASON/,
  );
  await query("select review_contribution($1,false,'Missing accessories')", [
    rejected,
  ]);
  await assert.rejects(
    query("select manage_member($1,'role',new_role=>'admin')", [other]),
    /assigned in the database/,
  );
  await db.exec('reset role');
  for (const requested of ['super_admin', 'admin', 'moderator', 'secretary']) {
    const id = crypto.randomUUID();
    await query('insert into auth.users values($1,$2,$3)', [
      id,
      id + '@example.test',
      JSON.stringify({ role: requested }),
    ]);
    assert.equal(
      await value('select role from profiles where id=$1', [id]),
      'member',
    );
  }
  await actor(member);
  assert.match(
    await value(
      "select body from workspace_notifications where title='Donation rejected'",
    ),
    /Missing accessories/,
  );

  await assert.rejects(
    query("select promote_member($1,'admin')", [other]),
    /Permission/,
  );
  await actor(moderator);
  await assert.rejects(
    query("select promote_member($1,'admin')", [other]),
    /Permission/,
  );
  await actor(owner);
  await assert.rejects(
    query("select promote_member($1,'super_admin')", [other]),
    /Choose/,
  );
  await query("select promote_member($1,'admin')", [other]);
  await actor(other);
  await query("select promote_member($1,'secretary')", [member]);
  await assert.rejects(
    query("select promote_member($1,'admin')", [owner]),
    /active Member/,
  );
  assert.equal(
    await value(
      "select count(*)::int from workspace_members where role='Secretary'",
    ),
    2,
  );
  await actor(member);
  const lostRequest = await value("select submit_request($1,1,'Workshop')", [
    product,
  ]);
  await actor(secretary);
  await query('select review_request($1,true)', [lostRequest]);
  await query('select close_loan($1,true)', [lostRequest]);
  assert.equal(await value('select available from workspace_products where id=$1', [product]), 0);
  await assert.rejects(
    query('select close_loan($1,true)', [lostRequest]),
    /closed/,
  );
});

test('upgrade keeps populated archive profiles and physical inventory', async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(platform);
  const files = (await readdir('supabase/migrations')).sort();
  async function apply(names) {
    for (const name of names) {
      const sql = await readFile('supabase/migrations/' + name, 'utf8');
      await db.exec(
        sql.replace('create extension if not exists pgcrypto;', ''),
      );
    }
  }
  await apply(files.slice(0, 3));
  const owner = crypto.randomUUID();
  await db.query(
    "insert into auth.users values($1,'legacy@example.test','{}')",
    [owner],
  );
  await db.query("update profiles set role='super_admin' where id=$1", [owner]);
  await db.exec(
    "insert into products(name,sku) values('Existing item','LEGACY-1');insert into inventory_units(product_id,asset_tag) select id,'EX-1' from products",
  );
  const boundary = files.indexOf('20261120000700_member_signup.sql');
  await apply(files.slice(3, boundary));
  await db.exec(
    "insert into club_settings(key,value) values('registration_open','false')",
  );
  await apply(files.slice(boundary));
  const applicant = crypto.randomUUID();
  await db.query(
    "insert into auth.users values($1,'self-service@example.test','{}')",
    [applicant],
  );
  assert.equal(
    (await db.query('select role from profiles where id=$1', [applicant]))
      .rows[0].role,
    'member',
  );
  await db.exec(
    'alter table auth.users add column email_confirmed_at timestamptz',
  );
  const staffSql = (await readFile('scripts/provision-staff.sql', 'utf8'))
    .replace('00000000-0000-0000-0000-000000000000', applicant)
    .replace('public.club_role := null', "public.club_role := 'secretary'");
  await assert.rejects(db.exec(staffSql), /verified/);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [
    applicant,
  ]);
  await db.exec(staffSql);
  assert.equal(
    (await db.query('select role from profiles where id=$1', [applicant]))
      .rows[0].role,
    'secretary',
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.exec('set role authenticated');
  assert.deepEqual(
    (await db.query('select code,total,available from workspace_products'))
      .rows,
    [{ code: 'LEGACY-1', total: 1, available: 1 }],
  );
  assert.equal(
    (await db.query('select id from workspace_members where id=$1', [owner]))
      .rows[0].id,
    owner,
  );
});
