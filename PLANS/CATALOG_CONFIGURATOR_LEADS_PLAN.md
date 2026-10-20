# Plan: Public Catalog, Configurator, and Lead Capture

## What and why

Seriya will help a visitor explore serial furniture, tailor a suitable configuration, and send a clear request to the team. The first release is a public website only: it does not require sign-in and does not process payments. Success means a visitor can find a furniture series, understand its options, configure a product, and submit a request that contains enough information for the team to respond.

## Confirmed product scope

- The public website is the only active surface in the first release.
- The first release includes a catalog of serial furniture, a configurator, and lead capture.
- Customer and staff accounts are deferred.
- Payments, file uploads, and real-time features are out of scope.
- The future production URL is `seriya.raspilok.ru`.

## Key decisions

- **D-1.** Build the first release as a public, search-indexable website. The catalog must be accessible without sign-in because it is the entry point for prospective customers.
- **D-2.** Treat the configurator as a request-preparation tool in the first release. Online payment and account-based order tracking are deferred so the product can validate demand quickly.
- **D-3.** Keep product catalog data, configuration rules, and requests in the application database. This creates a clean path to a future customer account and internal workspace without introducing separate systems now.

## What we deliberately do not do

- Customer or staff accounts, authentication flows, and role-based workspaces.
- Online payments, invoices, or order status tracking.
- Uploading drawings, documents, or other customer files.
- Real-time chat, live stock, or collaborative editing.
- A separate service or microservice for the catalog or configurator.

## Stages

### Stage 1 — Product discovery and catalog model

- Define the first furniture series, the audience, the catalog taxonomy, and the data needed for each product.
- Define which configuration options change the result and which values need a price calculation.
- **Done when:** one example product can be described completely, including visible content, options, a calculated or requested result, and the information sent with a lead.

### Stage 2 — Public catalog

- Build the public catalog and product pages with search-friendly content.
- **Done when:** a visitor can browse the first series, open a product, understand its main parameters, and start configuration.

### Stage 3 — Configurator and request

- Build the configuration flow and the lead form.
- **Done when:** the submitted request contains the selected product, configuration, contact details, and the agreed commercial result.

### Stage 4 — Operations and production launch

- Connect the public domain, deploy the website and API to the existing VPS, enable HTTPS, and configure backups.
- **Done when:** `seriya.raspilok.ru` is available over HTTPS and a test request reaches the application database.

## Risks and open questions

- Which furniture category and series should appear first?
- Who is the primary visitor: an end customer, a dealer, a designer, or a furniture manufacturer?
- Does the configurator need to show a price, an estimated range, or only prepare a specification for a manager?
- Which product parameters and restrictions determine a valid configuration?
- Where will initial catalog data, photos, drawings, and pricing rules come from?
- What contact fields and follow-up channel should each request use?
- Who will work with incoming requests until an internal workspace is built?

## Status

- [ ] Product discovery is complete
- [ ] Plan approved by the owner
- [ ] Plan passed independent review
- [ ] Stage 1 complete
- [ ] Stage 2 complete
- [ ] Stage 3 complete
- [ ] Stage 4 complete
