# SmartTrace poultry traceability

SmartTrace is the existing React + TypeScript + Vite application with an Express REST API, PostgreSQL schema, and Prisma migrations. The existing Farmer, Retailer, NFC, pricing, and customer trace screens are retained.

## Local setup

Prerequisites: Node.js, npm, and a running PostgreSQL database.

1. Install dependencies:

   ~~~powershell
   npm install
   ~~~

2. Create a local environment file and set private values:

   ~~~powershell
   Copy-Item .env.example .env
   ~~~

   Set DATABASE_URL to your PostgreSQL database. Replace JWT_SECRET and IOT_INGEST_TOKEN with separate random values of at least 32 characters. Set the ADMIN_* values to the administrator account you want to bootstrap. Do not commit .env.

3. Generate Prisma Client and apply the checked-in migration:

   ~~~powershell
   npm run db:generate
   npm run db:migrate
   ~~~

4. Create the administrator account:

   ~~~powershell
   npm run db:seed:admin
   ~~~

5. Start the API and frontend in separate terminals:

   ~~~powershell
   npm run dev:api
   npm run dev
   ~~~

   The frontend is at http://localhost:5173; the API health check is http://localhost:4000/api/health. Vite proxies /api to the API.

Farmer and Retailer accounts can be registered from the sign-in page. Registration requires a unique email and Login ID and a password of at least 12 characters. There are no hard-coded test accounts. The administrator credentials are exactly the values supplied for the one-time seed.

For production, set WEB_ORIGIN, DATABASE_URL, JWT_SECRET, IOT_INGEST_TOKEN, and PORT through the hosting environment. Secure is applied to the HttpOnly JWT cookie in production. Use HTTPS and distinct, randomly generated secrets. In production, serve the API under the frontend site (for example, reverse proxy /api) so the same-site session cookie is sent.

## Commands

- npm run dev - Vite development server.
- npm run dev:api - compile TypeScript API and start Express.
- npm run db:generate - generate Prisma Client.
- npm run db:migrate - create/apply local development migrations.
- npm run db:deploy - apply checked-in migrations in deployment.
- npm run db:seed:admin - create or update the configured administrator.
- npm run build - type-check frontend and API, then build the frontend.
- npm run build:server - emit the API JavaScript into ignored dist-server.

## Project layout

- src/ - existing responsive Farmer/Retailer dashboards, NFC and customer portal; API client at src/services/client.ts.
- server/ - Express app, REST routes, Prisma client, role/JWT middleware, error handling and admin seed.
- prisma/schema.prisma - PostgreSQL relational schema.
- prisma/migrations/ - initial PostgreSQL migration.
- docs/API.md - endpoint, authorization, and request documentation.

## Data and hardware status

The database is the source of truth for authenticated accounts, batches, crates, NFC assignments, shipments, stock, and prices. Browser local storage retains only a non-secret signed-in indicator; JWTs are stored in HttpOnly, same-site cookies. The customer trace endpoint is public and returns an allow-listed projection.

The dashboard's historical temperature chart remains explicitly labeled DEMO DATA. No sensor, GPS, PN532, ESP8266, or ESP32 hardware is connected. /api/iot/readings accepts authenticated device posts and persists real readings, but must not be treated as a live feed until a device sends data. The current shared ingest token is a bootstrap mechanism; provision per-device credentials before production.

## Verification and current boundary

npm run build checks and builds the frontend and API. API health, weak-password rejection, unauthenticated administrator access, and unauthenticated IoT ingestion can be smoke-tested with a placeholder DATABASE_URL without a running PostgreSQL service. Account creation/login, relational persistence, and Farmer/Retailer workflows require a configured database and should be tested against that database after setup.

This workspace did not have a PostgreSQL URL or server available, so no database migration was applied and no database-backed accounts or workflow tests are claimed as completed.
