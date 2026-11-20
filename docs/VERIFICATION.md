# Verification report

Tested on 20 November 2026 with Node 22.23.5, npm 10.9.9, Next.js 16.4.6, the Supabase CLI 3.2.0 local Docker stack, PostgreSQL 17 and Chromium driven by Playwright 1.65.1.

## Results

| Check | Command or entry point | Outcome |
| --- | --- | --- |
| Fresh install | `npm ci`, `npm ci --prefix backend`, `npm ci --prefix tests/integration` | All three lockfiles installed successfully |
| Frontend | `npm run lint`, `npm run build`, `npm start` | Lint and production build passed. Browser checks used the production server |
| Fresh database | `supabase db reset --local` on the disposable project | The original six migrations applied to real Supabase Auth and Storage schemas |
| Business rules and migration | `npm test` | Two suites passed. Covered upgrades preserving a populated owner and catalogue, visibility, direct-write denial, role restrictions, approvals, stock rollback, rejection reasons, lost equipment, returns, reputation, suspension expiry, kick, restoration, independent Member registration and notifications |
| Concurrent writes | `npm test --prefix tests/integration` | Independent PostgreSQL connections raced owner assignment, donation review, last-unit allocation and loan closure. Each race committed exactly once. Stock and ledger counts matched |
| Backend | `npm test --prefix backend` | NestJS compiled and both guard tests passed, including missing/invalid bearer tokens and restricted roles |
| Live service integration | `node --test tests/integration/services.test.mjs` | Real Supabase Auth, PostgREST, Storage and NestJS passed. Anonymous API access returned 401 and Member audit access and Secretary roster access returned 403. Contribution approval created inventory. Duplicate approval failed. Notification reads persisted. The session refreshed successfully and the revoked refresh token failed after logout |
| Browser workflows | `node --test tests/integration/browser.test.mjs` | Chromium registered through the form, verified a Mailpit confirmation, restored the session on refresh, logged out, reset via email and signed in with the new password. A member uploaded a photo and submitted an offer. The owner approved it, issued the resulting item and recorded its return. The member marked the decision notification as read |
| Image boundaries | Browser and service suites | A valid WebP uploaded and downloaded. Anonymous and unrelated-member reads of a private pending image failed. Direct browser writes to the bucket failed. Oversize content returned 413, a mismatched format returned 415 and invalid image bytes returned 422 |
| Layout | Browser suite | Login checked at widths 1440, 768, 390 and 320 CSS pixels. Desktop illustration and form shared a row. Equipment overflow checked at 768, 390 and 320 pixels. The notification item fit within the mobile viewport |
| Dependency advisories | `npm audit --omit=dev` at root and in `backend` | Both reported zero known production dependency vulnerabilities at test time |

The baseline Next.js build failed on two impossible role comparisons. The original NestJS compiled. Dependency audit identified advisories in the original frontend lockfile. During implementation the SQL suite caught an invalid preference expression, and real email verification exposed a callback redirect that switched the loopback hostname and lost access to the session cookie. The mobile notification check exposed a viewport positioning issue. The release includes the fixes and passing checks.

## Running the integration suites

Use a disposable local Supabase stack with the supplied configuration. These checks create confirmed test accounts, provision a fixture owner, submit real records and send mail into the local mail sink. The concurrency test starts and stops its own PostgreSQL container. A personal production account is unnecessary.

1. Install the three lockfiles and start Supabase. Use `supabase status` for the local credentials. Use the URLs from `supabase/config.toml` consistently.
2. Set the root `.env.local` from `.env.example`. For the test process, also add `DB_URL` from local CLI status. The fixture requires the local Auth API on port 54321, the local database on port 54322, and Mailpit on port 54324.
3. Set `backend/.env` from its example, using the same local project. Build and start the REST service from the backend directory. Start the Next.js production build from the root. Leave each service running in its own terminal.
4. Install Chromium and execute the suites from the root.
   ```sh
   npm exec --prefix tests/integration -- playwright install chromium
   npm test --prefix tests/integration
   node --env-file=.env.local --test tests/integration/services.test.mjs
   node --env-file=.env.local --test tests/integration/browser.test.mjs
   ```
   A remote Playwright server is also supported through `PLAYWRIGHT_WS_ENDPOINT`. The verification run used a loopback-only server in the official Playwright container with loopback forwarding.

## Release scope

The exercised production architecture is the Next.js web app and Supabase. Service tests cover the named REST endpoints. A second live REST suite created a category, product and physical units, opened and resolved maintenance, issued a two-unit group loan, processed a partial return and the final return, checked stock and archived the product. The browser suite covers Chromium. A migration against the club’s actual data, delivery through its production SMTP provider, and deployment on its GitHub and Vercel accounts require those environments. The seeded upgrade check exercises the supplied v6 baseline.

The open-signup revision was checked with the database regression suites, backend tests, lint, TypeScript and a Webpack production build. Its tests cover signup before owner provisioning, all four staff roles in untrusted signup metadata, and denied application-owner and service-role assignment attempts. The earlier hosted-service and Chromium results above precede this revision.

## Member access release (v8)

Migration 008 adds authorized promotions from the Members page. The browser regression at `tests/integration/promotion.test.mjs` passed against the running localhost app and local Docker Supabase. It creates a Member through public signup, confirms the email in Mailpit, signs in a database-provisioned Admin, promotes the Member to Secretary, checks the open session updates, then signs the Secretary in again with the original password. Run it with `node --env-file=.env.local --test tests/integration/promotion.test.mjs` against a disposable local stack and a frontend on localhost:3000.

Both database suites passed with `npm test`. They include successful Admin and Super Admin promotions, unauthorized role changes, multiple Secretary assignments and protected ownership. Both NestJS checks passed with `npm test --prefix backend`. Frontend lint and the Webpack production build passed. On the verification host a second development server reached its file-watcher limit. Running `WATCHPACK_POLLING=1000 npm run dev -- --port 3011` started it with local Supabase and returned HTTP 200 at the homepage.

## Private lending and hosted email (v9)

Both database suites passed with `npm test`. A separate transaction on the running Docker Supabase database checked a borrower, an unrelated Member and a Secretary through pending, approved and returned states. The unrelated Member received zero rows at every stage, including when querying by exact request ID. That Member also received zero rows for the accepted lending offer. The test transaction was rolled back. Permanent donations and aggregate club contribution points remain available.

Frontend lint, the Webpack production build and both backend checks passed. The SMTP configuration script was exercised against a mock management endpoint. Sending through a live SMTP provider and confirming receipt in Gmail requires the hosted project and sender configuration.

Migration 011 converts nine public workspace views to invoker mode. Its private projections use read-only roles subject to RLS. Local Supabase checks verified request and return visibility for two Members and a Secretary. Both database regression suites passed.
