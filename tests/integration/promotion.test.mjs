import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import pg from 'pg';
import { fixture } from './local-fixture.mjs';
import { emailLink } from './mailpit.mjs';

test(
  'localhost signup, live promotion and staff password login',
  { timeout: 100000 },
  async (t) => {
    const origin = 'http://localhost:3000';
    const browser = process.env.PLAYWRIGHT_WS_ENDPOINT
      ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT, {
          exposeNetwork: '<loopback>',
        })
      : await chromium.launch();
    t.after(() => browser.close());
    const admin = await fixture('admin');
    const email = crypto.randomUUID() + '@example.test',
      password = crypto.randomUUID() + 'Aa7!';
    const name = 'Signup check ' + crypto.randomUUID().slice(0, 8);
    t.after(async () => {
      const c = new pg.Client({ connectionString: process.env.DB_URL });
      await c.connect();
      try {
        await c.query('begin');
        const users = (
          await c.query(
            'select id from auth.users where email=any($1::text[])',
            [[email, admin.email]],
          )
        ).rows.map((u) => u.id);
        await c.query(
          'delete from notifications where recipient_id=any($1::uuid[])',
          [users],
        );
        await c.query(
          'delete from audit_logs where actor_id=any($1::uuid[]) and entity_id=any($1::uuid[])',
          [users],
        );
        await c.query('delete from auth.users where id=any($1::uuid[])', [
          users,
        ]);
        await c.query('commit');
      } finally {
        await c.end();
      }
    });
    const member = await (
      await browser.newContext({ reducedMotion: 'reduce' })
    ).newPage();
    const leader = await (
      await browser.newContext({ reducedMotion: 'reduce' })
    ).newPage();
    await member.goto(origin);
    await member.getByRole('tab', { name: 'Create account' }).click();
    await member.getByLabel('Full name').fill(name);
    await member.getByLabel('Email address').fill(email);
    await member.locator('input[name=password]').fill(password);
    const signup = member.getByRole('button', {
      name: 'Create account',
      exact: true,
    });
    assert.equal(await signup.isEnabled(), true);
    await signup.click();
    await member
      .getByText('Check your inbox to verify your email address.')
      .waitFor();
    await member.goto(await emailLink(email, 'confirm'));
    await member
      .locator('.role-chip')
      .getByText('Member', { exact: true })
      .waitFor();
    async function signIn(page, email, password) {
      await page.goto(origin);
      await page.getByLabel('Email address').fill(email);
      await page.locator('input[name=password]').fill(password);
      await page.getByRole('button', { name: 'Enter workspace' }).click();
    }
    await signIn(leader, admin.email, admin.password);
    await leader
      .locator('.role-chip')
      .getByText('Admin', { exact: true })
      .waitFor();
    await leader
      .locator('nav')
      .getByRole('button', { name: 'Members', exact: true })
      .click();
    leader.on('dialog', (dialog) => dialog.accept());
    await leader
      .getByRole('combobox', { name: 'Promote ' + name, exact: true })
      .selectOption('Secretary');
    await leader.getByText('Member promoted.', { exact: true }).waitFor();
    await member
      .locator('.role-chip')
      .getByText('Secretary', { exact: true })
      .waitFor({ timeout: 15000 });
    await member.getByRole('button', { name: 'Log out', exact: true }).click();
    await signIn(member, email, password);
    await member
      .locator('.role-chip')
      .getByText('Secretary', { exact: true })
      .waitFor();
    assert.equal(
      await member
        .locator('nav')
        .getByRole('button', { name: 'Members', exact: true })
        .count(),
      0,
    );
  },
);
