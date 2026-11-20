import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ok, db } from './local-fixture.mjs';

test('real Auth, PostgREST, NestJS permissions and atomic operations', async () => {
  const owner = await fixture('super_admin'),
    member = await fixture(),
    secretary = await fixture('secretary');
  const api = (user, path, opts = {}) =>
    fetch('http://127.0.0.1:4000/api/v1' + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: 'Bearer ' + user.token } : {}),
      },
    });
  assert.equal((await api(null, '/me')).status, 401);
  assert.equal((await api(member, '/audit-logs')).status, 403);
  assert.equal((await api(secretary, '/members')).status, 403);
  assert.equal((await api(owner, '/audit-logs')).status, 200);
  assert.equal(
    ok(
      await member.client
        .from('workspace_members')
        .select('id')
        .eq('id', member.id)
        .single(),
    ).id,
    member.id,
  );
  const id = ok(
    await member.client.rpc('submit_contribution', {
      item: 'Motor ' + crypto.randomUUID(),
      detail: 'One motor',
      kind: 'donation',
    }),
  );
  const review = await api(secretary, '/donations/' + id + '/assess', {
    method: 'POST',
    body: JSON.stringify({ accept: true }),
  });
  assert.equal(review.status, 201, await review.text());
  const product = ok(
    await db
      .from('products')
      .select('id')
      .eq('sku', 'OFFER-' + id)
      .single(),
  ).id;
  const request = ok(
    await member.client.rpc('submit_request', {
      product,
      quantity: 1,
      purpose: 'Robotics project',
    }),
  );
  ok(
    await secretary.client.rpc('review_request', {
      target: request,
      approved: true,
    }),
  );
  assert.ok(
    (
      await secretary.client.rpc('review_request', {
        target: request,
        approved: true,
      })
    ).error,
  );
  ok(await secretary.client.rpc('close_loan', { target: request }));
  const note = ok(
    await member.client.from('workspace_notifications').select('id').limit(1),
  )[0];
  ok(await member.client.rpc('read_notification', { target: note.id }));
  assert.ok(
    ok(
      await member.client
        .from('workspace_notifications')
        .select('read_at')
        .eq('id', note.id)
        .single(),
    ).read_at,
  );
  assert.ok(
    (
      await member.client
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', member.id)
    ).error,
  );
  assert.ok(
    (
      await member.client.rpc('manage_member', {
        target: secretary.id,
        action: 'kick',
        reason: 'denied',
      })
    ).error,
  );
  const upload = await member.client.storage
    .from('club-images')
    .upload(
      member.id + '/' + crypto.randomUUID() + '.webp',
      new Uint8Array([0]),
      { contentType: 'image/webp' },
    );
  assert.ok(upload.error);

  const rotated = ok(await member.client.auth.refreshSession()).session;
  assert.ok(rotated.refresh_token);
  ok(await member.client.auth.signOut());
  assert.ok(
    (
      await member.client.auth.refreshSession({
        refresh_token: rotated.refresh_token,
      })
    ).error,
  );
});

test('REST catalogue, maintenance, group lending and partial returns', async () => {
  const admin = await fixture('admin'),
    member = await fixture(),
    teammate = await fixture();
  async function call(actor, method, path, body) {
    const res = await fetch('http://127.0.0.1:4000/api/v1' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + actor.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await res.json();
    assert.ok(res.ok, method + ' ' + path + ' ' + JSON.stringify(result));
    return result;
  }
  const category = await call(admin, 'POST', '/categories', {
    name: 'Motors ' + crypto.randomUUID(),
  });
  const product = await call(admin, 'POST', '/products', {
    name: 'Gear motor',
    sku: crypto.randomUUID(),
    category_id: category.id,
    group_cap: 2,
  });
  const units = [];
  for (let i = 0; i < 2; i++)
    units.push(
      await call(admin, 'POST', '/inventory/units', {
        product_id: product.id,
        asset_tag: crypto.randomUUID(),
      }),
    );
  const problem = await call(admin, 'POST', '/inventory/maintenance', {
    inventory_unit_id: units[0].id,
    issue: 'Inspect cable',
  });
  await call(admin, 'PATCH', '/inventory/maintenance/' + problem.id, {
    status: 'resolved',
    cost: 0,
  });
  const req = await call(member, 'POST', '/requests', {
    project_name: 'Robot',
    purpose: 'Group build',
    is_group_request: true,
    group_name: 'Rovers',
    participant_ids: [teammate.id],
    items: [{ product_id: product.id, quantity: 2 }],
  });
  const { loan_id } = await call(
    admin,
    'POST',
    '/requests/' + req.id + '/approve',
    {},
  );
  const loan = await call(member, 'GET', '/loans/' + loan_id);
  assert.equal(loan.items.length, 2);
  const partial = await call(admin, 'POST', '/loans/' + loan_id + '/return', {
    items: [{ loan_item_id: loan.items[0].id, condition: 'good' }],
  });
  assert.equal(partial.status, 'partially_returned');
  assert.equal(
    (await call(admin, 'POST', '/loans/' + loan_id + '/return', {})).status,
    'returned',
  );
  assert.equal(
    (await call(member, 'GET', '/products/' + product.id)).available,
    2,
  );
  assert.equal(
    (await call(admin, 'DELETE', '/products/' + product.id)).archived,
    true,
  );
});
