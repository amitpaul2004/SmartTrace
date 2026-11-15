# SmartTrace — poultry supply chain traceability

A responsive React application for farmer and retailer workflows, crate level NFC identification, and public batch traceability.

## Run locally

- Requires Node.js 20 or newer.
- Run `npm install`, then `npm run dev`.
- Run `npm run build` to compile the production frontend.

## Available workflows

- Sign-in screen separates Farmer and Retailer views. Demo sign-in accepts any non-empty ID and password; it does not authenticate accounts.
- Farmers can register batches with farm, origin, quantity, weight, destination, purchase price and NFC UID, then dispatch registered batches.
- Retailers can confirm incoming deliveries and update stock and selling prices. Price updates are timestamped in browser storage. Farmer and shipment details are read-only in retailer screens.
- NFC registry maps tag UIDs to crates, batches and public `/trace/:tag` pages. The browser page does not write a physical tag.
- Public trace pages show batch records, shipment events, sensor records and actual entered retailer prices. The app displays no price estimate when there is not enough historical data.
- IoT monitoring displays only the sample readings attached to the included demo crates. No live device data is received.
- Batch changes are saved in the current browser's local storage and are not shared with other users or devices.

## Backend required for production

This repository currently contains a frontend only. Real multi-user authentication, secure role enforcement, shared durable records, database migrations, audit log integrity, REST/MQTT sensor ingestion, live GPS maps, NFC hardware writes, and cross-retailer price comparisons require a backend and database. Do not use demo sign-in or local browser storage as production access control or verified supply chain data.
