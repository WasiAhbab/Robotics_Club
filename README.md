# RoboHaven

RoboHaven manages a robotics club’s equipment, contributions, borrow requests, returns and member reputation. The web app uses Next.js and Supabase Auth, PostgreSQL and Storage. The included NestJS API also serves existing REST integrations.

## Run locally

Start Docker Desktop and use Node 22.12 or later. From the extracted folder run:

```sh
npm ci
npm run dev
```

Open the URL printed by Next.js. With no project keys configured, development startup starts local Supabase, applies pending migrations and supplies the connection automatically. Open http://127.0.0.1:54324 for local confirmation and recovery mail. Open the confirmation link in the same browser that registered. Local accounts live in this Docker database.

To use the club’s hosted database instead, supply the values in `.env.example` through `.env.local`. Hosted deployment and initial Super Admin provisioning are covered in the deployment guide.

## Architecture

- The browser authenticates with Supabase. The database derives the actor from the session. Protected views filter reads by membership and role. Public-facing database functions authorize writes.
- Approvals allocate physical inventory units. A failed allocation rolls back the request decision, loan and inventory changes. Contribution approval creates one catalogue record and one physical unit per offer, with reputation, notification and audit entries in the same transaction.
- Account identity uses UUIDs. Profile names can change and multiple members can share a name. Return records and reputation history retain their original identifiers.
- Private uploads go through a same-origin Next.js handler. It verifies membership, checks the actual image format and dimensions, strips metadata through re-encoding, and assigns the object to the authenticated owner. The image read route uses the viewer’s session and Storage policies.
- The browser keeps workspace data in memory. Returning to a section uses the session’s loaded data. Mutations refresh affected views, and opening the notification panel fetches current notifications. A signed-in user subscribes to their own role-change signal. The app also checks their role on window focus.
- The Vercel deployment runs from the repository root. The web interface needs no separate NestJS host. The API remains available for installations using the original REST routes.

## Roles

| Role | Access |
| --- | --- |
| Member | Browse equipment and the member directory, submit requests and offers, edit a personal profile, see personal history and notifications |
| Secretary | Equipment, borrow and contribution review, loan returns and losses |
| Moderator | Operational settings, equipment, reviews, activity, eligible member achievements and reputation |
| Admin | Operational administration plus sanctions and restoration for lower-ranked members |
| Super Admin | Administrative access and management of Admin accounts |

Members register directly using their email and password. Every signup creates a Member profile. A database operator provisions the single Super Admin and can provision other staff. Admins and the Super Admin can promote active Members to Secretary, Moderator or Admin from the Members page. See the deployment guide for the two provisioning scripts.

## Checks and deployment

```sh
npm run lint
npm test
npm run build
npm ci --prefix backend
npm run build --prefix backend
```

See [deployment and migration instructions](docs/DEPLOYMENT.md) and [verification results and commands](docs/VERIFICATION.md).
