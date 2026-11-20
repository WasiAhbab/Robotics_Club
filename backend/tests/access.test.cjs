const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthGuard } = require('../dist/auth/auth.guard');
const { RolesGuard } = require('../dist/auth/roles.guard');

const context = (request) => ({
  getHandler() {},
  getClass() {},
  switchToHttp: () => ({ getRequest: () => request }),
});
test('private routes require a verified bearer token', async () => {
  const guard = new AuthGuard(
    { getAllAndOverride: () => false },
    {
      admin: {
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: { message: 'expired' },
          }),
        },
      },
    },
  );
  await assert.rejects(
    guard.canActivate(context({ headers: {} })),
    /Missing bearer token/,
  );
  await assert.rejects(
    guard.canActivate(
      context({ headers: { authorization: 'Bearer expired-test-token' } }),
    ),
    /Invalid or expired/,
  );
});
test('staff endpoints check the server-assigned role', () => {
  const guard = new RolesGuard({
    getAllAndOverride: () => ['admin', 'super_admin'],
  });
  assert.throws(
    () => guard.canActivate(context({ user: { role: 'member' } })),
    /Insufficient role/,
  );
  assert.equal(guard.canActivate(context({ user: { role: 'admin' } })), true);
});
