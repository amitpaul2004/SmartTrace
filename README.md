# SmartTrace — Poultry Traceability Demo

Responsive React + TypeScript frontend for poultry crate operations, shipment monitoring, and public traceability lookup. All readings, GPS locations, price details, and activity records are demonstration data; no hardware or backend is connected.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL printed by Vite.
4. Run `npm run build` for a production build.

## Demo flows

- Admin overview and crate list: `/` and `/crates`; add crates from the register flow.
- Monitoring and transport dashboards: `/monitoring` and `/transport`.
- Simulated location map and supply chain timeline: `/tracking` and `/supply-chain`.
- Public trace lookup: `/trace`; try `ST-2841` or `BAT-2025-087`.
- The NFC page describes planned tag operations; browser writing to a physical tag is not simulated.
- All data shown is labeled demo and does not constitute a food safety, freshness, or certification claim.

## Integration notes

`src/types` defines crate data, `src/data/mock.ts` keeps sample content separate, and `src/services/api.ts` provides a small async adapter that can be replaced with API calls. Authentication, permission enforcement, durable writes, alert delivery, reports, real maps/GPS, and sensor/device integrations require a backend and are not implemented in this frontend phase.
