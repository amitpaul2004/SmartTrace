# SmartTrace API

All API routes use the `/api` prefix and JSON bodies. Authenticated browser requests use the `HttpOnly` `smarttrace_session` cookie; the frontend sends credentials through Vite's same-origin proxy. API authorization is enforced by the server.

## Authentication and accounts

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Create a Farmer or Retailer account; password minimum 12 characters |
| POST | `/auth/login` | Public, rate limited | Sign in with email or Login ID and password |
| GET | `/auth/me` | Signed in | Return the current public account profile and role |
| POST | `/auth/logout` | Public | Clear the session cookie |
| GET | `/admin/users` | Administrator | List accounts without password hashes |
| POST | `/admin/users` | Administrator | Create a role account; include farm or business profile fields as appropriate |

Administrator accounts are created with `npm run db:seed:admin`; public registration cannot create an administrator.

## Batches, crates, shipments and inventory

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET/POST | `/batches` | Signed in / Farmer | List role-visible batches; register a batch, first crate, selected retailer's ready shipment, optional NFC tag, and optional farmer purchase price in one transaction |
| GET | `/batches/:id` | Owner Farmer, assigned Retailer, Administrator | Read a batch with crate, shipment, readings and prices |
| GET/POST | `/crates` | Signed in / Farmer for create | List visible crates; create an additional crate for an owned batch |
| GET | `/shipments` | Signed in | List shipments scoped to the farmer or retailer |
| POST | `/shipments` | Farmer | Create a ready shipment for an owned crate and registered retailer |
| POST | `/shipments/:id/dispatch` | Owning Farmer | Dispatch a ready shipment |
| POST | `/shipments/:id/receive` | Assigned Retailer | Confirm receipt and initialize stock |
| GET | `/stock` | Retailer, Administrator | Read stock records |
| PATCH | `/crates/:crateId/stock` | Owning Retailer | Change received stock quantity |
| POST | `/crates/:crateId/prices` | Receiving Retailer, Administrator | Record a customer selling price; retailers can also update quantity in the same request |

Farmer registration facts are immutable through retailer routes. Farmer purchase price is recorded at batch registration; price history supports `FARMER_PURCHASE`, `PROCESSING`, `TRANSPORT`, `RETAILER_PURCHASE`, and `CUSTOMER_SELLING` stages.

## NFC and public traceability

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/nfc` | Signed in | List role-visible tags and recent scan records |
| POST | `/nfc` | Owning Farmer, Administrator | Register a unique UID and assign it to an untagged crate |
| PATCH | `/nfc/:uid` | Owning Farmer, Administrator | Change UID while preserving its crate assignment |
| PATCH | `/nfc/:uid/deactivate` | Owning Farmer, Administrator | Deactivate a tag; assignments cannot be transferred |
| GET | `/public/trace/:uid` | Public | Record a scan and return an allow-listed batch, crate, retailer, price, shipment, sensor and GPS projection |

The public projection omits account IDs, login IDs, email addresses, and all password fields.

## Sensor and GPS ingestion

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/iot/readings` | Device token | Store sensor readings and/or GPS coordinates; no fake readings are generated |
| GET | `/crates/:crateId/readings` | Owning Farmer, assigned Retailer, Administrator | Read sensor history |
| GET | `/crates/:crateId/readings/latest` | Owning Farmer, assigned Retailer, Administrator | Read latest sensor sample |
| GET | `/crates/:crateId/location/latest` | Owning Farmer, assigned Retailer, Administrator | Read latest GPS fix |

Send `X-Device-Token: $IOT_INGEST_TOKEN` for ingestion and a JSON body such as:

```json
{
  "deviceId": "ESP8266-CRATE-01",
  "crateId": "a-valid-crate-uuid",
  "temperature": 4.2,
  "humidity": 68,
  "latitude": 19.076,
  "longitude": 72.877,
  "recordedAt": "2026-11-16T10:00:00.000Z"
}
```

At least a sensor value or a complete latitude/longitude pair is required. The shared ingest token is an initial integration credential; provision a unique credential per device before production deployment.

## Errors

Errors are JSON, typically `{ "error": "..." }`. Validation errors include a `details` array. Duplicate unique values return `409`; missing authentication returns `401`; insufficient role returns `403`.

