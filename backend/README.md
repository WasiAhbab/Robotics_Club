# RoboHaven REST API

This optional NestJS service supports existing REST integrations. The default Next.js deployment uses Supabase directly.

Use Node 22.x. Copy `.env.example` to `.env`, supply the project URL, public key, private service key and allowed origins, then run `npm ci`, `npm run build` and `npm start`. Routes use the `/api/v1` prefix. Authenticated routes expect a Supabase access token in the Authorization bearer header. Health is available at `/api/v1/health`.

The authentication guard validates the token and looks up active membership. Role guards protect staff routes. Scoped RPC calls perform contribution assessment and request rejection in the same transactions used by the browser. The service-role client supports legacy catalogue, inventory, maintenance and reporting endpoints. Configure this server only in a trusted environment. The service key belongs exclusively in server configuration.
