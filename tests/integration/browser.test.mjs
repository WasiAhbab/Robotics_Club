import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixture, ok, db, origin } from './local-fixture.mjs';

import {emailLink} from './mailpit.mjs';
async function login(page, email, password) {
  await page.goto(origin);
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[name=password]').fill(password);
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page
    .getByRole('button', { name: 'Notifications', exact: true })
    .waitFor();
}
test(
  'account email lifecycle, layout, cookie restoration, upload ownership and offer review',
  { timeout: 150000 },
  async (t) => {
    const owner = await fixture('super_admin');
    const browser = process.env.PLAYWRIGHT_WS_ENDPOINT
      ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT, {
          exposeNetwork: '<loopback>',
        })
      : await chromium.launch();
    t.after(() => browser.close());
    const ctx = await browser.newContext({ reducedMotion: 'reduce' }),
      page = await ctx.newPage();
    t.after(async () => {
      if (t.passed === false && !page.isClosed())
        console.log(
          'Page',
          new URL(page.url()).origin,
          new URL(page.url()).pathname,
          (await page.locator('body').innerText()).slice(-1000),
        );
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(12000);
    await page.goto(origin);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.getByLabel('Email address').waitFor();
      const layout = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const form = box('.auth-card'),
          art = box('.auth-side');
        return {
          width: document.documentElement.scrollWidth,
          form: form.width,
          side: art.right <= form.left + 1,
        };
      });
      assert.ok(layout.width <= width, JSON.stringify({ width, layout }));
      assert.ok(layout.form >= 200);
      if (width === 1440) assert.ok(layout.side);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const email = crypto.randomUUID() + '@example.test',
      password = crypto.randomUUID() + 'aA7!',
      newPassword = crypto.randomUUID() + 'aA7!';
    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel('Full name').fill('Robotics Test Member');
    await page.getByLabel('Email address').fill(email);
    await page.locator('[name=password]').fill(password);
    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click();
    await page
      .getByText('Check your inbox to verify your email address.')
      .waitFor();
    await page.goto(await emailLink(email, 'confirm'));
    await page
      .getByRole('button', { name: 'Notifications', exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole('button', { name: 'Notifications', exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await page.getByLabel('Email address').waitFor();
    await page.reload();
    await page.getByLabel('Email address').waitFor();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email reset link' }).click();
    await page
      .getByText(/If this address has an account/)
      .waitFor();
    await page.goto(await emailLink(email, 'reset'));
    await page.locator('[name=password]').fill(newPassword);
    await page.getByRole('button', { name: 'Save password' }).click();
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await login(page, email, newPassword);
    const asset = await readFile(
      new URL('../../public/products/arduino-uno.webp', import.meta.url),
    );
    const post = async (data, type) =>
      page.request.post(origin + '/api/images', {
        headers: { origin, 'content-type': type },
        data,
      });
    assert.equal((await post('wrong', 'image/png')).status(), 422);
    assert.equal((await post(asset, 'image/jpeg')).status(), 415);
    assert.equal(
      (await post(Buffer.alloc(3 * 1024 * 1024 + 1), 'image/png')).status(),
      413,
    );
    const upload = await post(asset, 'image/webp');
    assert.equal(upload.status(), 201, await upload.text());
    const { path } = await upload.json();
    assert.equal((await page.request.get(origin + path)).status(), 200);
    const anonymous = await browser.newContext();
    assert.equal((await anonymous.request.get(origin + path)).status(), 404);
    await anonymous.close();
    const outsider = await fixture();
    assert.ok(
      (
        await outsider.client.storage
          .from('club-images')
          .download(path.slice(12))
      ).error,
    );
    await page
      .getByRole('button', { name: 'Donation / Lend', exact: true })
      .click();
    await page
      .getByRole('button', { name: /Contribute equipment/i })
      .first()
      .click();
    const title = 'Test board ' + crypto.randomUUID().slice(0, 8);
    await page.getByLabel('Item name').fill(title);
    await page
      .getByLabel('Details', { exact: true })
      .fill('Working board and cable');
    await page
      .getByLabel('Item photograph')
      .setInputFiles({
        name: 'board.webp',
        mimeType: 'image/webp',
        buffer: asset,
      });
    await page.getByAltText('Your contribution item').waitFor();
    await page.getByRole('button', { name: 'Submit offer' }).click();
    await page.getByText('Offer submitted.').waitFor();
    const staff = await browser.newContext({ reducedMotion: 'reduce' }),
      review = await staff.newPage();
    review.on('dialog', (d) => d.accept());
    await login(review, owner.email, owner.password);
    await review.getByRole('button', { name: 'Requests', exact: true }).click();
    const row = review.locator('.activity-row').filter({ hasText: title });
    await row.locator('.reject-btn').click();
    const rejection = review.getByRole('dialog', { name: 'Reject donation?' });
    assert.equal(await rejection.getByRole('button', { name: 'Reject donation' }).isDisabled(), true);
    await review.keyboard.press('Escape');
    await row.locator('.approve-btn').click();
    await review.getByRole('dialog', { name: 'Approve donation?' }).getByRole('button', { name: 'Approve donation' }).click();
    await review.getByText('Offer accepted.').waitFor();
    assert.equal(
      ok(await db.from('products').select('id').eq('name', title)).length,
      1,
    );
    await page
      .getByRole('button', { name: 'Notifications', exact: true })
      .click();
    await page
      .getByText('Donation accepted', { exact: true })
      .first()
      .waitFor();
    await page.getByText('Donation accepted', { exact: true }).first().click();
    await page.getByText('Marked as read.').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => innerWidth === 390);
    const rect = await page.locator('.notification-item').first().boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 391, JSON.stringify(rect));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page
      .getByRole('button', { name: 'Equipment', exact: true })
      .first()
      .click();
    await page
      .locator('.equipment-card')
      .filter({ hasText: title })
      .getByRole('button', { name: 'Request', exact: true })
      .click();
    const quantity = page.getByLabel('Quantity', {exact: true});
    await quantity.fill('');
    assert.equal(await quantity.inputValue(), '');
    await quantity.pressSequentially('02');
    assert.equal(await quantity.inputValue(), '2');
    await page.getByText('Not enough quantity available.', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Submit request'}).isDisabled(), true);
    await page.getByLabel('Choose request quantity').selectOption('1');
    assert.equal(await quantity.inputValue(), '1');
    await page.getByLabel('Project / purpose').fill('Build a test robot');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.getByText('Request submitted.', { exact: true }).waitFor();
    await review.reload();
    await review
      .getByRole('button', { name: 'Requests', exact: true })
      .first()
      .click();
    const requestRow = review
      .locator('tr')
      .filter({ hasText: title })
      .filter({ hasText: 'Build a test robot' });
    await requestRow.getByRole('button', { name: /Approve request/ }).click();
    await review.getByRole('dialog', { name: 'Approve request?' }).getByRole('button', { name: 'Approve request' }).click();
    await review.getByText('Request approved.', { exact: true }).waitFor();
    await review
      .getByRole('button', { name: 'Loans & returns', exact: true })
      .first()
      .click();
    const loan = review.locator('.ov-row').filter({ hasText: title });
    await loan.getByRole('button', { name: 'Record return' }).click();
    await review.getByText('Return recorded.', { exact: true }).waitFor();
    assert.equal(
      ok(
        await owner.client
          .from('workspace_products')
          .select('available')
          .eq('name', title)
          .single(),
      ).available,
      1,
    );
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        'Equipment overflow at ' + width,
      );
    }
    assert.deepEqual(errors, []);
  },
);
