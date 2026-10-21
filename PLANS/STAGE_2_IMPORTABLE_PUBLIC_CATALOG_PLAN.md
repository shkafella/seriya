# Plan: Stage 2 Importable Public Catalog

## What and why

Stage 2 turns the approved 225-variant seed into the application's durable catalog. The owner gets one protected place to review and maintain product data, while visitors get fast, indexable family pages with published price ranges. Import, publication, and export must be repeatable and fail without partially changing the live catalog.

The governing product specification is `PLANS/CATALOG_CONFIGURATOR_LEADS_PLAN.md`. This plan narrows only Stage 2; it does not reopen the approved catalog or commercial decisions from Stage 1.

## Acceptance contract

Stage 2 is complete when all of the following are observable:

1. A preview of `catalog/seed/catalog.v1.json` reports the exact reconciliation without mutating catalog data; applying that preview creates 225 variants, and an identical second import creates no duplicates or ID changes.
2. Stale, concurrent, invalid, duplicate, unmapped, or owner-conflicting imports change no catalog rows; source removals deactivate only source-managed records.
3. Exactly one configured owner can view and edit catalog records and prepare a release candidate; an authenticated non-owner receives `403`, and production registration is closed.
4. Public catalog API responses and Astro's initial HTML resolve the same active release ID and contain only active, complete variants from that snapshot, grouped into 25 families with correctly labelled launch price ranges for ordinary modules, false panels, and trim products.
5. Raw Basis/B3D/OBJ files never enter the public tree. The six reference packages pass the offline provenance/bounds/mask pipeline; neutral schematics keep development unblocked, but final production activation requires owner-supplied, rights-approved derived-asset coverage for every published asset family.

## Key decisions

- **D-1.** PostgreSQL remains the runtime source of truth. The Stage 1 JSON is a versioned import package, never a file queried directly by public API routes.
- **D-2.** `CatalogSourceRecord.sourceRecordId` is the stable import identity. SKU, name, and spreadsheet row remain mutable traceability values and never become database identity.
- **D-3.** Imported values and owner intent are separated. Each variant stores its last imported values plus a set of owner-overridden fields; an import reports a conflict instead of overwriting those fields.
- **D-4.** Preview is read-only for catalog data and produces a JSON artifact under `.scratch/`. Apply re-reads and validates the source, checks the preview checksum and base catalog revision, then acquires a PostgreSQL transaction lock. A stale or losing apply aborts before catalog mutation.
- **D-5.** Apply uses one transaction and increments a singleton catalog revision exactly once. Import history is written inside the same transaction as the catalog change, so failure cannot leave a false success record.
- **D-6.** Missing source records are deactivated only when they are source-managed. Owner-created records are never deleted or deactivated by an import.
- **D-7.** Initial commercial inputs are stored in one immutable published `PriceVersion`. Stage 2 exposes them read-only in the owner screen; draft price editing and publication arrive in Stage 3.
- **D-8.** One backend pricing boundary exposes three explicit public unit-price modes. Ordinary cabinet variants use body + white HDF + fixed fasteners and are labelled “without facades and packaging.” False panels use their facade square meters + fixed fasteners and show the minimum/maximum across active facade rates, labelled “per panel; depends on facade.” Crown, deep-crown, and plinth products use every non-zero stored body/facade/HDF consumption + fixed fasteners and show the minimum/maximum active-material result for one complete 2,700 mm stock piece. Every mode applies the 1.10 multiplier and RUB 10 rounding. Configuration quantity, packaging, cut service, and final selected-material totals remain Stage 3; no sellable family can present a zero price merely because its required material is not a body material.
- **D-9.** Preparing a release candidate creates an immutable database snapshot linked to one price version and one catalog revision. It does not change public API responses. Final activation records an immutable publication only after the release and backup gates pass, and never rewrites an older snapshot.
- **D-10.** `CatalogState.activePublicationId` is the only public catalog pointer. Astro exports the exact candidate DTO into a timestamped release directory and embeds its release/publication ID in generated HTML. Each complete application release contains the reviewed repository revision, installed locked dependencies, generated Prisma client, backend sources, both frontend builds, catalog export, asset manifest, and release manifest. Activation is serialized and persists an `ActivationAttempt` containing the previous/new publication IDs, previous/new application release paths, current step, and recovery decision. Before public pointers change, catalog API reads enter a persisted maintenance state. Deployment switches the complete application symlink, restarts the backend from that release, checks readiness, switches the database publication pointer, smoke-tests both frontends and API, then marks the attempt verified and reopens catalog reads. On startup and before any new activation, an idempotent recovery command reconciles the attempt, release manifest, backend runtime version, and database pointer: it either completes the intended set or restores the previous application release, restarts its backend, restores the previous publication, and verifies readiness before reopening reads. A failure or interruption can expose a short closed API, but never an open mixed application/publication. Owner edits show “not prepared”; a prepared candidate shows “awaiting release.”
- **D-11.** Owner authorization binds a singleton `OwnerIdentity` to one immutable `User.id`. Authentication by itself is insufficient. Bootstrap and recovery are server-only commands using environment input; recovery revokes every owner session.
- **D-12.** Local registration stays enabled for existing development and tests. A dedicated environment flag must be explicitly false in production; environment validation refuses a production runtime that permits registration. Both browser and token registration routes enforce the same policy.
- **D-13.** Owner catalog edits cover public name, SKU, dimensions, layout span, availability, cut eligibility, and asset selection. Commercial inputs are visible but read-only until Stage 3. Optimistic revision checks return a visible conflict instead of accepting stale edits.
- **D-14.** The asset pipeline uses only Python's standard library. It validates the source manifest, hashes OBJ/MTL/XML/PDF inputs, records OBJ bounds and approved nominal dimensions/anchors, verifies separate body/facade material mappings, and emits deterministic content-hashed SVG front assets plus a manifest. It never publishes raw source files.
- **D-15.** The six supplied Basis packages are private regression inputs under `.scratch/` and are not committed. Their derived assets stay internal until rights are confirmed. Public development pages initially use generated Seriya-owned schematic SVGs for all families, so missing owner exports or uncertain textures cannot block the remaining engineering work. Once the fixture pipeline passes, request the complete owner export batch, require an explicit rights/provenance decision for every mapped source, batch-convert it, and prove that every published asset family resolves to an approved derived asset. Any missing, rejected, or unmapped family blocks final production activation; neutral schematics are not accepted as the production completion substitute unless the governing product specification is explicitly revised.
- **D-16.** Public paths are `/catalog` and `/catalog/<family-slug>`. SEO-critical family name, description, available dimensions, price range, image, and exclusions are rendered into initial HTML without client JavaScript.
- **D-16a.** `/catalog` renders all published family cards in initial HTML and progressively enhances them with phone-usable filters for row, purpose, width, and function. Filters can be combined, are reflected in the URL, and show a clear empty result with a reset action; filtering never makes the underlying SEO content depend on JavaScript.
- **D-17.** Backend ownership follows the existing modular-monolith rules: contracts in `packages/contracts`, import/publication/application behavior in `backend/src/modules/catalog`, pure price calculation in `backend/src/modules/pricing`, Prisma only in infrastructure, owner UI in `webapp/src/features/catalog`, and public pages in `website/src/pages/catalog`.
- **D-18.** Schema changes are declared in Prisma and generated with the repository migration command. Migration SQL is never handwritten. The migration is additive so the previous auth-only release remains compatible.
- **D-19.** Deployment scripts are aligned to require a successful production database backup before migration and again require a valid backup receipt before publication activation; generate the Prisma client, apply migrations, export the selected candidate, build both frontends, assemble outside the active release, and switch only after pre-switch checks. A backup receipt contains an opaque backup ID, completion time, database identity, and integrity evidence; a missing, failed, stale, or wrong-database receipt blocks migration/activation without changing the active release. This stage validates those commands locally; changing the live VPS or DNS is a separate release action after the reviewed commit is pushed.
- **D-20.** No new package dependency is introduced. Existing Prisma, Zod, Hono, TanStack, Astro, Bun, PostgreSQL, and Python standard-library capabilities are sufficient.

## What we deliberately do NOT do

- No kitchen row editor, exact configuration total, material selector, facade/packaging toggle, or cut-to-width customer flow; those belong to Stage 3.
- No price-draft editor; Stage 2 publishes the approved launch price and keeps commercial inputs read-only.
- No lead form, Telegram delivery, customer data, local configuration drafts, or share links.
- No public raw OBJ/B3D, free-camera 3D, AI render, or unapproved reused image.
- No staff roles, customer accounts, public owner creation, or browser-based owner transfer.
- No automatic live deployment or DNS mutation as part of code implementation.

## Data and state invariants

- There is one catalog state row, at most one owner identity, at most one current catalog publication, and at most one non-terminal activation attempt.
- Stable source IDs and SKUs are unique among current variants; database UUIDv7 IDs never change across imports.
- Every public variant belongs to one public family, has valid positive dimensions and non-negative consumption/fastener values, has an approved schematic or asset, and can be priced by the publication's price version.
- A release candidate points to an exact catalog revision and immutable price version; its snapshot checksum matches its canonical JSON payload. An activated publication additionally records the release ID and accepted backup receipt and can be reached only through the singleton active pointer.
- Public catalog API reads are allowed only when activation state is verified/idle. A persisted in-progress or inconsistent activation returns a temporary-unavailable response until idempotent recovery restores one coherent release/publication pair.
- Preview contains source checksum, source-map checksum, base database revision, normalized reconciliation, and validation result. Apply recomputes all binding values rather than trusting caller-provided status.
- Imported deactivation, owner edits, publication, and revision changes are auditable.
- Public API and Astro export validate the shared public DTO before returning or writing it.

## Stages

### Stage 2.1 — Contracts, schema, and migration

- Add shared public/owner catalog, import reconciliation, publication, and price-version schemas.
- Add Prisma models for catalog state, owner identity, source records, families, variants, assets, price versions, import history, edit history, and immutable publications.
- Generate and validate one additive migration and Prisma client.
- **Done when:** contract tests reject invalid dimensions, negative prices, malformed snapshots, and unsafe edit payloads; Prisma validation and migration on an empty PostgreSQL test database succeed.

### Stage 2.2 — Read-only preview and atomic apply

- Add a CLI and catalog application service that load the Stage 1 package, validate every record, compute the reconciliation, and write/read preview artifacts only under `.scratch/`.
- Add the PostgreSQL repository and serialized apply transaction with revision, checksum, source identity, deactivation, conflict, and history rules.
- **Done when:** real PostgreSQL tests prove first import 225, identical import unchanged, stable identity after allowed source locator changes, no duplicate IDs/SKUs, invalid input no-op, source-only deactivation, owner conflict no-op, stale preview no-op, and exactly one concurrent apply winner.

### Stage 2.3 — Launch prices, owner identity, and protected API

- Create the immutable launch price version and shared three-mode public unit-price calculator from D-8.
- Add production-closed registration, owner bootstrap/recovery services and commands, owner middleware, catalog read/edit endpoints, and an explicit release-candidate preparation endpoint.
- **Done when:** ordinary-module, false-panel, and trim-piece pricing matches approved inputs and rounding and no published family has a false zero-price range; one owner can edit and prepare a candidate, a normal authenticated user receives `403`, stale edits return `409`, recovery revokes owner sessions, and production registration returns `403` for both cookie and token transports.

### Stage 2.4 — Controlled assets

- Add the source manifest format, offline validator/converter for the six private Basis fixtures, deterministic neutral family schematic generator, batch manifest/converter, rights/provenance status, and asset manifest/check command.
- Store only derived content-hashed SVGs under `website/public/catalog`; never copy source archives, OBJ, B3D, XML, PDF, or source textures there.
- After the six-fixture converter is green, request the remaining Basis exports already confirmed to exist and run the same controlled batch flow for every asset family.
- **Done when:** all six fixtures produce stable bounds/provenance/mask metadata in a temporary output; all 25 families have deterministic neutral development schematics; the full supplied batch has explicit rights status and maps every production-published asset family to an approved content-hashed derived asset; regeneration is byte-identical; and missing source packages, rights, provenance, material mappings, family coverage, or approved nominal-dimension mismatches fail the final production-activation gate.

### Stage 2.5 — Owner workspace and public catalog

- Add a protected, phone-usable catalog workspace with list/filter, variant edit form, saved/error/conflict/unprepared states, read-only launch rates, and release-candidate preparation action.
- Add public API routes with the activation maintenance gate, deterministic candidate export, serialized persisted activation/recovery commands, `/catalog` with combined row/purpose/width/function filters, and static family pages using the exported DTO.
- **Done when:** owner UI persists an edit and reports conflicts clearly; preparing a candidate does not change public output; activation makes the running backend, API, generated HTML, and assets expose the same release/publication ID; failed build, failed backend startup/readiness, and failed post-switch smoke scenarios leave or restore the complete previous application and publication; interruption after each persisted activation step followed by recovery produces either the complete new set or complete previous set before public catalog API reads reopen; public API and generated HTML exclude inactive/incomplete/unpriced records; initial HTML contains all family names, correctly labelled price ranges, dimensions, filter metadata, image references, and exclusions; combined filters and their empty/reset state work at a phone viewport; generated links resolve for all 25 families.

### Stage 2.6 — Release alignment and complete validation

- Update docs, systemd/nginx templates, and deploy/build scripts for pre-migration backup, backup receipt validation, migration, candidate export, locked dependencies and generated Prisma client inside a timestamped full application release, both frontend builds, backend release switch/restart/readiness, coordinated publication activation, and rollback-safe failure order without mutating the live VPS.
- Run catalog checks, contract/unit/integration tests, architecture check, typecheck, builds, focused browser coverage, migration from the existing auth schema, and a clean-database first import/candidate/export/activation cycle.
- **Done when:** every validation is green; failure injection before apply, export, or frontend build leaves the previous publication/release usable; no task-unrelated file is staged; code review levels 1–4 accepts the implementation.

## Validation matrix

- **Contracts:** valid public/owner DTOs; invalid dimensions, rates, status, edit field, checksum, and reconciliation data.
- **Pricing:** ordinary body-only range; false-panel facade-rate range; crown/plinth whole-piece material range; HDF; fixed fasteners; multiplier; RUB 10 half-up rounding; missing input and false-zero rejection.
- **Import unit:** canonical checksum, duplicate source ID, duplicate SKU, invalid family reference, invalid source mapping, reconciliation categories.
- **Import integration:** empty database, idempotent re-import, rename/move identity, deactivation, owner conflict, stale preview, concurrent apply, rollback on injected failure.
- **Authorization:** unauthenticated `401`, authenticated non-owner `403`, owner success, stale owner edit `409`, production registration `403` on both transports.
- **Publication/release:** immutable candidate and checksum, preparation leaves active pointer unchanged, backup receipt required for activation, prior publication unchanged, unpublished edit marker, backend/API/HTML/assets parity by release ID, one activation at a time, maintenance-state denial, interruption/retry after every transition, and complete application rollback after failed backend readiness or smoke.
- **Assets:** source provenance and rights, bounds, masks, nominal tolerance, no raw public files, deterministic hashes, development-placeholder coverage, full production-family coverage, and a blocking activation check for missing or unapproved assets.
- **Public HTML and filters:** 25 family links, initial-HTML names/ranges/dimensions/exclusions/filter metadata, canonical metadata, inactive records absent, combined row/purpose/width/function filtering, URL restoration, and empty/reset behavior at the phone viewport.
- **Regression:** existing auth/session, architecture, storage, catalog generator, webapp, typecheck, build, and database integration suites remain green.

## Rollout and fallback

- A production deploy first creates and verifies a database backup receipt. Backup failure blocks migration and leaves the active application and publication untouched. Apply the additive migration only after that gate; the old auth-only release ignores the new tables.
- Run preview and inspect its machine-readable summary before apply. Apply aborts on any invalid, stale, conflicting, or concurrent state.
- Prepare the initial candidate only after the 225-record import and launch price version pass validation. Candidate preparation alone is not public.
- Export, install locked dependencies, generate the Prisma client, and build into a new full application release directory. A failed preparation never touches the active release or public pointer. Activation verifies backup and production-asset coverage, persists the old/new set, closes public catalog API reads, advances the application symlink, restarts and readiness-checks the backend from the new release, then advances the active publication through recorded idempotent steps. Success verifies backend version, API, HTML, assets, and publication before reopening reads. Failure or process interruption is recovered on retry/startup by completing or restoring the recorded set; a failed backend start/readiness or post-switch smoke restores the previous application symlink, restarts/verifies its backend, and restores the previous publication. The additive database remains backward compatible.
- If Basis conversion fails or rights remain unconfirmed, keep the neutral schematic for local development while final production activation stays blocked. Catalog data and prices never fall back to an external image host.

## Risks and bounded experiments

- **Prisma transaction serialization:** hypothesis — one PostgreSQL transaction advisory lock plus revision check gives one winner. Earliest experiment: concurrent integration test in Stage 2.2. Threshold: exactly one apply increments revision and the other changes no catalog row. Fallback: acquire a locked singleton state row with `SELECT ... FOR UPDATE` inside the same transaction.
- **Full-release parity and coordinated activation:** hypothesis — canonical shared DTO parsing, one release/publication ID, persisted maintenance state, full application release symlinks, and a resumable activation attempt keep backend, API, Astro HTML, and assets aligned. Earliest experiment: candidate/export/activation test in Stage 2.5 that fails backend readiness and terminates after every release/pointer/status transition before rerunning recovery. Threshold: matching runtime version/checksums/IDs after success; during interruption catalog API is unavailable; after recovery the complete new set or complete previous set is running and ready. Fallback: keep/restore the old application and publication, and require operator recovery before any later activation.
- **Basis material mapping:** hypothesis — the six samples consistently expose body and AGT facade materials. Earliest experiment: fixture pipeline test in Stage 2.4. Threshold: every fixture has both semantic masks and finite bounds. Fallback: record validated geometry metadata and keep the authored neutral schematic for development while production activation remains blocked until an explicit per-family mapping is supplied.
- **Owner edit/import conflict:** hypothesis — field-level override metadata is sufficient for Stage 2 fields. Earliest experiment: integration matrix in Stage 2.2. Threshold: owner value survives and apply returns a deterministic conflict. Fallback: require explicit owner resolution and rerun preview; never overwrite.

## Repository anchors

- Governing specification: `PLANS/CATALOG_CONFIGURATOR_LEADS_PLAN.md` Stage 2, D-4/D-5/D-18/D-19/D-24/D-27/D-59 through D-64/D-66/D-68/D-78, FR-CAT, FR-PRICE, FR-VIS, and FR-OPS.
- Approved input: `catalog/seed/catalog.v1.json`, `catalog/source-map.v1.json`, `catalog/seed/catalog.v1.report.json`, and `scripts/catalog-check.mjs`.
- Contracts: `packages/contracts/src/catalog.ts`, `packages/contracts/src/pricing.ts`, tests, and `packages/contracts/src/index.ts`.
- Persistence: `backend/prisma/schema.prisma` and a generated migration under `backend/prisma/migrations/`.
- Backend: `backend/src/modules/catalog`, `backend/src/modules/pricing`, `backend/src/app.ts`, `backend/src/env.ts`, and server-only scripts under `backend/scripts/`.
- Owner UI: `webapp/src/features/catalog`, `webapp/src/routes.tsx`, and focused tests/E2E.
- Public catalog: `website/src/pages/catalog`, generated data under `website/src/data`, and derived assets under `website/public/catalog`.
- Asset tools: `scripts/catalog-assets/` with private fixture input under `.scratch/bazis-shef/`.
- Operations: root/backend package scripts, `docs/TESTING.md`, catalog README, backend/webapp/website README files, and existing VPS deployment scripts.

## Status

- [x] Owner authorized Stage 2 and the full plan-review → implementation → code-review → commit/push workflow
- [x] Plan accepted by the main orchestrator as development-ready after three `/loop-plan-review-3` rounds at levels 1–4
- [x] Stage 2.1 complete
- [x] Stage 2.2 complete
- [x] Stage 2.3 complete
- [ ] Stage 2.4 complete — the conversion pipeline and six fixtures are ready, but production activation still requires the full owner-approved, rights-cleared 25-family Basis asset batch
- [ ] Stage 2.5 complete — the release implementation and automated contract checks are ready; a live Linux/systemd failure-injection rehearsal remains
- [ ] Stage 2.6 complete — the five-pass review limit was reached at 8.3/10; every reported finding was fixed and post-fix validation is green, but no sixth acceptance score was permitted
- [ ] Code accepted by `/loop-code-review-3` at levels 1–4 — review loop stopped incomplete at its mandatory five-pass limit
- [x] Implementation committed and pushed in `eb2f651` (`feat: build importable public catalog`)

Last updated: 2026-10-21.
