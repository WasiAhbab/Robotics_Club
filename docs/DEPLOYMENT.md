# Deployment

## Supabase

1. Create a project. For a fresh project, link the Supabase CLI to its project reference and run the following commands from the repository root.
   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push --dry-run
   supabase db push
   ```
2. Enable the Data API for the public schema and email/password authentication. Enable “Allow new users to sign up” and email confirmation. Keep `club_private` outside the exposed schemas.
3. Set the Auth Site URL to the final HTTPS web origin. Allow the exact URLs `https://YOUR_DOMAIN/auth/confirm` and `https://YOUR_DOMAIN/auth/confirm?reset=1`. Use a separate project and matching redirect list for preview deployments.
4. Configure a sender address and SMTP service for signup and recovery. The default hosted sender is restricted to authorized team addresses. Local tests use Mailpit. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
5. The default confirmation links support completing the PKCE flow in the initiating browser. To support opening mail on another device, use a confirmation template linking to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`. Use `type=recovery` in the reset template. [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
6. After deployment, register the owner and verify their email. In Auth → Users, match the intended email and copy its UUID. Open `scripts/provision-owner.sql` in the private SQL Editor, replace the all-zero UUID and run it once. Sign in again. This script checks email confirmation, locks provisioning, and records the promotion. The database prevents a second owner or demotion, suspension and deletion of the provisioned owner. Account recovery uses the verified owner’s normal password reset flow.

To add an Admin, Moderator or Secretary, identify the verified Auth account and run `scripts/provision-staff.sql` in the Supabase SQL Editor with its UUID and intended role. For the single Super Admin, use the owner script above. Apply all pending migrations through `20261120001100_workspace_read_roles.sql` and deploy the updated application. The Members page supports promotions by Admins and the Super Admin. It opens Member registration even if the old registration switch was off.

## Upgrading an existing database

Back up the database and Storage objects and rehearse the upgrade on a restored copy. Keep the old app offline during the production switch. Check the deployed table definitions and migration history against the supplied ZIP. Identify the current owner, outstanding loans, pending requests and existing storage bucket policies.

The first three migration files correspond to the archive’s `schema.sql`, `backend.sql` and `gearvault-followup.sql`. For installations matching those definitions, record only confirmed, already-applied versions with `supabase migration repair VERSION --status applied`. Then use `supabase db push --dry-run` to review the remaining migrations before applying them. For a database missing the older membership columns or enum values, reconcile it to the archive’s schema in staging first. Resolve conflicting owner records or inactive ownership with the club owner before migration. Each SQL Editor migration should run in a single transaction.

The workspace migration restricts existing table and column grants. Review any custom views, functions, Storage policies or integrations added outside the supplied project. Verify the data counts, owner UUID, active loan units and role access after migration. Keep the backup until the owner signs off. If rollback is required, coordinate database, storage and application restoration to the same point.

Local preview accounts, roles and passwords are unverified. Real members register and verify email. If a browser contains genuine inventory or outstanding loans among sample entries, reconcile those records with physical stock and verified member IDs before importing them. The release starts with the records already present in the database. Back up the old browser profile before retiring it.

## GitHub and Vercel

1. Copy the repository contents to your intended GitHub repository or existing checkout. Retain its existing Git history and license. Review the staged files before pushing. The input ZIP contained no Git metadata or project license.
2. Import the repository into Vercel, select the Next.js preset and the repository root. Use Node 22.x, install with `npm ci` and build with `npm run build`. Vercel supplies HTTPS.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the project API settings. Set `SUPABASE_SERVICE_ROLE_KEY` as a server-only secret. It is used by the validated upload endpoint. Scope the values to the intended deployment environment and redeploy after changing public values.
4. Confirm the production redirect URLs, send a real verification and recovery email, then test with separate Member and staff accounts. Submit a photograph, approve one offer, borrow and return the resulting unit, and verify stock and notifications.
5. Check the club’s eligibility for Hobby and current usage limits before choosing the plan. The application requires no scheduled Vercel job or paid API host. Free projects still consume database, storage, mail and bandwidth allowances. [Vercel plans](https://vercel.com/pricing) · [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase)

Only run NestJS separately if external clients require the REST API. Its cron and HTTP listener require a long-lived Node process. Set its environment from `backend/.env.example` and allow only the intended web origins. The browser deployment communicates directly with Supabase and its own upload routes.

The archive’s separate `gearvault-upgrade.sql` duplicates policies already included in its v6 schema. Running it on a populated v6 copy produced a duplicate-policy error. The numbered release migrations supersede that script. The upgrade test starts with the three matching v6 baseline definitions, inserts an owner and a stocked product, and applies the remaining files.

## Deliver verification emails to Gmail and other member inboxes

Use a hosted Supabase project for real accounts. In Authentication → Email → SMTP Settings, enable custom SMTP and enter the SMTP host, port, username, password and verified sender address supplied by your mail provider. Complete any sender-domain verification the provider requires and disable link tracking for auth emails. Keep Confirm email enabled. Gmail users register with their own address and receive mail from the club sender.

For scripted setup, put the following settings in a private, gitignored `.env.smtp` file on your computer and run `node --env-file=.env.smtp scripts/configure-email.mjs` from the project root. The script updates only the hosted project's SMTP and email signup settings. Set the Site URL and redirects separately as described above.

```dotenv
SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM_ADDRESS=
```

Set the hosted Supabase URL and keys in Vercel. To test that same hosted project from the Desktop copy, replace the loopback URL and keys in its existing `.env.development.local` with the hosted values and restart Next.js. Allow the localhost callback in the hosted project's redirect settings if testing locally. Accounts created against local Docker belong to the local database. Register the address on the hosted project, open the delivered message and confirm the account. The Docker-only development setup routes email to Mailpit.

[Supabase custom SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp)
