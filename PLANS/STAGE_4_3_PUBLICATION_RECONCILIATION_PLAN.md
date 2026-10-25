# Plan: Stage 4.3 publication reconciliation and explicit price acceptance

## What and why

A saved kitchen can outlive the catalog and prices with which it was created. Stage 4.3 lets a visitor reopen that draft without silently losing removed choices, compare the trusted old and current result, resolve every unavailable choice, and explicitly accept the current price before the configuration can later be submitted as a lead.

The browser is not trusted to report old prices, current prices, availability, differences, or totals. The backend reconstructs both sides from immutable publications that were actually proven public. Success is a phone-sized flow in which a stale draft with a changed price and a removed module is explained, repaired by the visitor, re-quoted, and accepted; forged browser values have no effect.

This is a complex, cross-layer, TDD-first change. It touches shared contracts, the configuration application boundary, PostgreSQL-backed publication loading, public-request abuse protection, draft state, the configurator screen, and browser-level tests. It does not add lead capture or collect contact data.

## Acceptance contract

1. Reopening a draft from an older verified publication shows its trusted old total, the current publication, the current total when calculable, and a clear per-selection change list.
2. A removed module or material stays visible in a dedicated reconciliation view until the visitor explicitly replaces or removes it. The normal editor is not hydrated with invalid current-catalog IDs, and unfinished repair work survives refresh without being mistaken for a valid current draft.
3. The visitor cannot accept or continue while any blocking issue remains. After all blockers are resolved, the backend returns a current quote and the visitor explicitly accepts the exact current publication, price version, configuration fingerprint, and total.
4. Every price-affecting mutation, undo, redo, restore, replacement, or removal clears acceptance. A reusable pre-submission check re-reconciles the configuration and rejects stale acceptance; Stage 4.5 will call this check immediately before lead submission.
5. Candidate, unverified, maintenance, inconsistent, or never-public publications fail closed. Editing request JSON, local storage, displayed totals, difference rows, or acceptance values cannot influence a trusted quote or future accepted lead payload.

**Primary signal:** the focused phone Playwright stale-draft journey passes from restore through explicit repair and acceptance, including a forged-local-data variant.

**Secondary signals:** contract tests, pure rule tests, backend unit/integration tests, website tests, typechecks, builds, architecture check, and Prisma validation pass for the changed surface.

## Dependencies and repository baseline

- Stage 4.1 and 4.2 already provide versioned no-contact local drafts, bounded undo/redo, autosave, cross-tab handling, and acceptance clearing on state mutation. The current stored format is v2; Stage 4.3 needs a v3 migration because an unfinished reconciliation must retain both its immutable source command and its working current command.
- `CatalogPublication.pricingSnapshot` already stores the immutable pricing input; `publicVerifiedAt`, publication status, `CatalogState.activePublicationId`, and `CatalogState.activationState` already provide the publication proof boundary. No Prisma schema migration is planned.
- `configurationSnapshotCalculator` and the pure kitchen quote engine already calculate one immutable snapshot. Stage 4.3 must reuse that engine for both old and current quotes.
- Shared reconciliation schemas already exist, but they are intentionally incomplete for the required UI: generic paths and variant IDs are not enough to render preserved removed choices, material replacements, or safe action targets.
- Lead capture remains disabled and Stage 4.5 does not yet exist. Stage 4.3 provides the acceptance record and pre-submission gate, but does not create contacts, intents, leads, notifications, or owner screens.

## Key decisions

- **D-1. Only proven public publications may participate.** The original publication must have a valid immutable pricing snapshot and `publicVerifiedAt`; it may be the current `ACTIVE` publication or a previously public `SUPERSEDED` publication. The current publication must be the exact active pointer, `ACTIVE`, `IDLE`, publicly verified, and internally consistent across row ID, embedded pricing-snapshot publication ID, and price version. Existing release ID plus canonical public-catalog checksum evidence remains the proof behind `publicVerifiedAt`; the pricing snapshot has no separate stored checksum today and must instead pass strict schema and embedded-ID validation. Candidate, failed, rolled-back, ambiguous, unverified, and maintenance states return a stable non-disclosing error.

- **D-2. One short database transaction establishes a coherent old/current view.** Reconciliation takes a shared lock on the singleton catalog state, verifies the public gate, and loads both immutable publication rows before calculation. Catalog activation already takes the conflicting update lock, so a response cannot be assembled across two different activation states. Pure calculation remains outside database ownership concerns and performs no writes.

- **D-3. Reconciliation is an application use case, not route logic.** The HTTP route validates and delegates. The application service coordinates publication loading, compatibility analysis, quoting, fingerprinting, and response assembly through explicit ports. Prisma and stored-snapshot parsing remain in infrastructure; pure classification and fingerprint rules remain database-free.

- **D-4. A stale draft opens in a reconciliation workspace before it enters the normal editor.** The workspace keeps an immutable source command from the old publication and a separate working command aimed at the current publication. It uses server-owned descriptors from the old public snapshot to list every unavailable choice with its original public name and location. Only after blockers are explicitly resolved is the working command passed into the existing editor. This avoids fake fallback variants and prevents current rendering code from receiving IDs that no longer exist.

- **D-5. The request and response keep source history separate from current repair.** The request carries the immutable `sourceCommand` from the saved historical draft and a `workingCommand` for the current publication. On the first call the working command is a semantic copy with only its publication changed; later calls carry explicit visitor repairs while the source stays unchanged. The server returns a versioned discriminated change model containing a stable target (`module`, `false_panel`, `material`, `plinth`, or `crown`), the old public descriptor, current status, and server-generated replacement options. Module options include only current public variant data required to identify the choice; material options use material IDs rather than pretending they are variant UUIDs. The browser never supplies labels, prices, or trusted difference metadata.

- **D-6. Replacements are suggestions, never silent edits.** For a removed module, options come from the same current family/row/role where possible and satisfy current eligibility and dimensional/cut constraints. Results are deterministically sorted by exact fit, then smallest span difference, then public name and ID, and capped at 20. If no safe replacement exists, removal remains available. Material options must match the material kind. The visitor confirms each replace/remove action.

- **D-7. Exact current total exists only for a fully priceable configuration.** The backend always calculates the trusted original quote from `sourceCommand` and the verified old snapshot. It returns a current quote only when `workingCommand` has no blocking availability or validity issue. With blockers, it returns the old quote and structured changes but no invented partial current total. Invalid or tampered source/working commands fail validation rather than being presented as ordinary catalog differences.

- **D-8. The configuration fingerprint is versioned, deterministic, and server-owned.** Fingerprint v1 hashes a canonical envelope containing every price- or layout-relevant command field except the transient `intentId` and publication ID. Rows use the fixed lower/wall/mezzanine order while module order inside a row is preserved. The envelope carries its schema version and is hashed with SHA-256 using the repository canonical-JSON utility. Publication ID and price version remain separate acceptance fields, so the four-part acceptance tuple has no ambiguous responsibility.

- **D-9. Acceptance is an explicit exact tuple.** The visitor may accept only a server-returned, blocker-free current quote. The saved acceptance contains `publicationId`, `priceVersionId`, `configurationFingerprint`, `totalRub`, and local `acceptedAt`. Any meaningful mutation clears it. A completed draft retains acceptance after refresh only when a fresh server reconciliation proves all four authoritative fields still match; browser time is presentation-only and is never trusted by submission. An unfinished v3 reconciliation never carries an accepted quote.

- **D-10. Publication changes require acknowledgement even if the numeric total is unchanged.** A price-version or publication change is shown explicitly and requires acceptance. This keeps the user aware that the product definition changed and matches the future submission contract.

- **D-11. Stage 4.3 provides one reusable final gate for Stage 4.5.** The website feature exposes a `reconcileBeforeSubmission`-style operation that calls the server again, compares the fresh authoritative tuple with the saved acceptance, and returns either a ready payload or a reason to return to reconciliation. Stage 4.5 must call this immediately before enabling the lead request; it must not reproduce the rules.

- **D-12. Public configuration writes receive route-specific abuse protection before parsing or pricing.** Extract the existing trusted-proxy client-address and bounded in-memory limiter into a generic HTTP utility without changing auth behavior. Apply a 64 KiB body limit and independent default buckets of 120 quote requests, 30 replacement-proposal requests, and 20 reconciliation requests per IP per 60 seconds. Limits are environment-configurable, return `413` or `429` with `Retry-After`, do not log IPs, and run before JSON parsing, database reads, or calculation.

- **D-13. Failures use stable existing public error families.** Maintenance remains `503 CATALOG_MAINTENANCE`; no current public catalog remains `404 CATALOG_NOT_PUBLISHED`; an original publication that cannot be safely proven or reconciled returns `409 RECONCILIATION_REQUIRED` without disclosing internal publication history; a current-publication race returns `409 PUBLICATION_CHANGED`. Malformed commands remain `400 VALIDATION_ERROR`.

- **D-14. No schema migration or new dependency is needed.** The required publication evidence and snapshots already exist, and the repository already has canonical JSON, SHA-256 support, Hono body limits, Zod, Prisma transactions, and Playwright. If implementation evidence contradicts this, work stops and the plan is revised before adding storage or a package.

- **D-15. Historical quoting has an explicit codec/calculator version.** New pricing snapshots carry `snapshotSchemaVersion: 1` and `quoteCalculatorVersion: 1`; legacy stored snapshots without these fields decode as v1. The v1 calculation path remains stable when future pricing semantics introduce v2. An unsupported historical version fails closed with `RECONCILIATION_REQUIRED` instead of being reinterpreted by newer rules.

- **D-16. A second catalog switch safely restarts unfinished repair.** If the current publication changes while an A → B repair is unfinished, the client discards only the unaccepted B working edits, preserves source A, creates a fresh working copy for C, and explains that catalog changes require reviewing replacements again. This deliberately prefers trustworthy labels and bounded storage over an unbounded per-selection publication provenance chain.

- **D-17. Ordinary current configurations receive the same authoritative acceptance tuple from `/quote`.** The quote response includes the server fingerprint. The ordinary editor can therefore accept its latest successful quote without manufacturing a stale/source pair or calling reconciliation with identical commands. Reconciliation remains required for historical drafts; the future pre-submission gate reuses reconciliation.

- **D-18. Removing the last unavailable module intentionally starts a new empty current draft.** The UI warns that this action abandons the saved historical kitchen, clears the stored draft and acceptance, and opens the ordinary current editor with no price until a module is added. The backend reconciliation request continues to require at least one module and never invents a quote for an empty kitchen.

## What we deliberately do NOT do

- Do not add the contact form, consent, lead intent, lead transaction, receipt recovery, Telegram delivery, owner inbox, or erasure. Those belong to Stages 4.4 and 4.5.
- Do not enable lead capture or change production rollout gates.
- Do not auto-replace or auto-remove unavailable choices, calculate misleading partial totals, or silently accept a new price.
- Do not trust local-storage labels, totals, issues, fingerprints, availability, replacement lists, or acceptance fields.
- Do not expose arbitrary historical or candidate publications. The endpoint accepts only the publication ID carried by the validated draft command and returns a generic conflict when it lacks public proof.
- Do not introduce a generic repository layer, event system, state-machine library, background job, or new frontend framework.
- Do not redesign the configurator. Add the smallest mobile-first reconciliation and acceptance states that fit the existing visual language.
- Do not add cosmetic snapshot tests. Browser tests protect behavior, accessibility semantics, navigation, persistence, and recovery states.

## User-visible flow

1. The visitor returns to the configurator and sees that a saved kitchen was created with an older catalog.
2. The screen offers restore or delete. Restore calls `/api/configurator/reconcile`; editing stays blocked while the request is pending.
3. If all selections still exist, the screen shows the trusted old and current totals, highlights publication/price changes, and offers “Use the current price”.
4. If a module or material is unavailable, the screen keeps the original choice visible with its row/location and offers current compatible replacements plus an explicit remove action. No current total is shown until all blockers are resolved.
5. Each confirmed repair changes only the working current-publication command, keeps the historical source command intact, clears any old acceptance, calls reconciliation again, and refreshes the change list. Both commands are saved in the no-contact v3 draft so network errors or refresh retain the unresolved workspace and offer retry. Removing the last remaining module follows D-18 instead of sending an invalid empty quote command.
6. When no blockers remain, the normal editor opens with the repaired current command and a current server quote. The visitor explicitly accepts the exact quote. The accepted state is saved with the no-contact draft.
7. Any later configuration change clears the accepted state and visibly requires a new quote acceptance.
8. When Stage 4.5 asks to submit, the shared final gate reconciles once more. A catalog/price race sends the visitor back to the comparison instead of submitting stale data.

## Contract changes

- Replace the ambiguous single-command request with `sourceCommand` and `workingCommand`. Require `sourceCommand.publicationId` to identify the original publication, require `workingCommand.publicationId` to equal the server-observed current publication, and require both commands to share the same non-semantic correlation intent. Validate and price both commands independently; security must not depend on the browser honestly describing how the working command changed.
- Add a reconciliation schema version or make the expanded response structurally versioned before it is persisted or reused by later stages.
- Replace `replacementVariantIds` with typed replacement options for variants and materials.
- Add a stable action target and original server-owned descriptor to unavailable-selection issues. Keep human-readable messages bounded, but do not make UI behavior depend on parsing message text or generic path arrays.
- Add an explicit normalized current command in a successful/blocker-free result, or a contract equivalent that lets the browser hydrate the existing editor without locally rewriting publication authority.
- Add configurator draft v3 with either a normal current `command` or an unfinished reconciliation envelope containing `sourceCommand`, `workingCommand`, and UI-only options. Migrate v0/v1/v2 to the normal v3 form; never infer or manufacture a historical source for an already-current draft.
- Preserve the invariant that `currentQuote` exists if and only if blocking issues are absent.
- Preserve exact `PRICE_CHANGED` and `PUBLICATION_CHANGED` invariants, and require acceptance if either is present.
- Define response invariants for issue target uniqueness, replacement option type, original/current publication ownership, fingerprint format, and normalized command ownership.
- Export all new types from `@seriya/contracts` and add negative tests for unknown fields, mismatched publication IDs, fake replacement metadata, duplicate targets, contradictory quote/issue states, and over-limit arrays.

## Backend ownership and flow

The vertical path is:

`POST /api/configurator/reconcile` → request guard → configuration transport → reconciliation application use case → public publication loader → pure compatibility/fingerprint/quote rules → validated shared response.

- Extend `ConfigurationHttpService` with `reconcile(input)` and keep route code limited to body reading and response mapping.
- Extract the stored pricing-snapshot parser from the private service constant so bootstrap, quote, replacement, and reconciliation use one validated shape.
- Add an infrastructure loader that, in one short transaction, locks and validates catalog state, loads the exact original/current publication pair, and returns domain-safe immutable snapshots without leaking Prisma types.
- Reuse the existing pure quote calculator for both publications. Do not create a second pricing implementation.
- Add a pure compatibility analyzer that walks materials, rows/modules, false panels, plinth, and crown; reports typed target-specific issues; and produces deterministic replacement candidates from the current snapshot.
- Treat calculator failures that represent a malformed command or impossible geometry separately from ordinary item unavailability. Do not classify by parsing exception message strings; introduce typed domain outcomes/errors where needed.
- Add the canonical fingerprint function beside the pure configuration rules and export only the application/domain capability required later by the lead unit of work.
- Make bootstrap, quote, and replacement proposal adopt the same current-publication proof checks (`ACTIVE`, `IDLE`, `publicVerifiedAt`, coherent embedded IDs), closing the existing gap where a non-null active pricing snapshot is currently sufficient.
- Apply the generic body/rate guards to all three public POST routes before `c.req.json()`.

## Website ownership and state

- Keep storage parsing/migration in the existing draft-storage feature and migrate it to v3 before the UI can persist repair progress.
- Extend compatibility handling so a stale but valid draft becomes `reconciliation-required` instead of an unrestorable dead end.
- Add a reconciliation state with explicit `idle`, `loading`, `blocked`, `ready-to-accept`, `accepted`, and `error` outcomes. Persist the no-contact v3 source/working commands and accepted tuple where allowed, but never persist trusted server descriptors, difference rows, prices, or replacement options; refresh obtains those again from the server.
- Render reconciliation in a dedicated accessible region with old/current price summary, change list, per-target actions, pending state, retry, and focus movement to the first unresolved issue.
- Use stable controls and labels suitable for phone Playwright tests. Disable duplicate actions while a reconciliation request is in flight.
- Apply replacements/removals through a small pure reconciliation reducer that owns the working command, history, autosave, and acceptance clearing without invoking the normal renderer. After blockers clear, hydrate the existing state model once; all later edits use its established mutation boundary.
- Do not enter the ordinary editor until all stale IDs have been resolved. Once resolved, restore a current-publication command through the existing state model and immediately request the authoritative current quote.
- Store explicit acceptance through the state model; no direct local-storage mutation may bypass its invalidation rules.
- Keep cross-tab behavior fail-safe: a newer draft or deletion discovered in another tab cancels the active reconciliation result and asks the visitor to review the newer state.

## Stages

### Stage 1 — Lock the shared contract and pure rules

- Write failing contract tests for source/working publication and intent invariants, typed targets/descriptors, material and variant replacement options, response invariants, and hostile extra fields.
- Write failing draft v3 migration/validation tests for normal drafts, unfinished reconciliation, impossible source/working combinations, and the invariant that unfinished reconciliation has no accepted quote.
- Write failing pure tests for canonical fingerprint determinism and sensitivity to every meaningful field, while proving `intentId` and publication ID do not alter it.
- Write the compatibility matrix for unchanged, price-only change, publication-only change, unavailable module/material/accessory, invalid cut, removed false panel/trim, and malformed geometry.
- Implement the minimum contract and pure rule changes to make these tests pass.
- **Done when:** one immutable old/current snapshot pair deterministically produces a validated response model and fingerprint without database or browser state.

### Stage 2 — Prove publication eligibility and coherent loading

- Add focused integration fixtures for a publicly verified old publication and an active verified current publication.
- Implement the transaction-scoped loader and exact proof checks from D-1/D-2.
- Cover maintenance, candidate, missing `publicVerifiedAt`, mismatched active pointer/status, malformed pricing snapshot, embedded ID mismatch, superseded-but-verified original, and catalog activation racing reconciliation.
- Align bootstrap/quote/replacement current-publication checks with the same proof policy.
- **Done when:** only an actually public original and a coherent active current publication can reach calculation, and activation cannot produce a mixed response.

### Stage 3 — Expose the guarded reconciliation endpoint

- Extend the application port/service and add `POST /api/configurator/reconcile`.
- Add the reusable public body-limit/rate-limit middleware, environment schema/defaults, example environment documentation, and middleware tests.
- Validate all successful responses with the shared contract and map expected failures to the stable codes in D-13.
- Add route/service tests proving guards run before JSON/database/calculation, response data is server-owned, and fake client totals/differences are ignored or rejected as unknown fields.
- **Done when:** the endpoint safely returns old/current trusted results and typed actions, while oversized or abusive traffic is rejected before expensive work.

### Stage 4 — Build the stale-draft repair experience

- Add the reconciliation state and UI to the configurator page using existing components and visual conventions.
- Preserve and display unavailable selections; implement explicit replace/remove actions and deterministic retry/error behavior.
- Hydrate the normal editor only after all blockers are resolved, then quote the current command.
- Handle cross-tab replacement/deletion and navigation/refresh without collecting or persisting contact data.
- **Done when:** on a phone viewport a visitor can understand every change, intentionally repair each blocker, and reach a valid current configuration without silent mutation.

### Stage 5 — Bind explicit acceptance and the future submission gate

- Add the explicit “Use the current price” action and save the exact accepted tuple through the state model.
- Audit every price-affecting mutation path, including undo/redo, restore, replacement/removal, materials, wall/options, cuts, trims, and cross-tab changes, to prove acceptance clears.
- Implement and unit-test the reusable fresh-reconciliation pre-submission gate for Stage 4.5.
- Prove a publication switch or changed total after acceptance returns to reconciliation; exact fresh matches remain ready.
- **Done when:** acceptance can only represent the latest authoritative current quote, and the later lead flow has one tested API for enforcing that rule immediately before submission.

### Stage 6 — End-to-end validation and documentation alignment

- Extend the focused configurator Playwright spec with the full stale-draft journey: changed price, removed module, visible preserved choice, explicit repair, current quote, explicit acceptance, refresh, mutation invalidation, and pre-submission recheck.
- Add hostile browser cases that alter local totals, issues, fingerprints, publication IDs, and acceptance fields; server output and readiness must remain authoritative.
- Run the validation set below and fix all regressions in the touched surface.
- Update `docs/TESTING.md`, backend environment examples, and relevant README text only where commands, configuration, or user flow actually change. The architecture document needs an update only if implementation deviates from the existing configuration-module boundary.
- **Done when:** the acceptance contract is green, documentation matches real setup, no contact data exists in storage/network for this flow, and no unresolved blocker or stale acceptance can advance.

## Test matrix

### Contracts and pure rules

- Request publication equality; strict unknown-field rejection; response quote/issue/acceptance invariants.
- Fingerprint stability across key order and transient intent/publication changes; fingerprint changes for every material, module, order, cut, facade, wall, packaging, countertop, false-panel, plinth, and crown mutation.
- Unchanged configuration; price-only change; publication-only change with equal price; combined change.
- Removed/inactive module, material, false panel, plinth, and crown; several blockers; no replacement candidate; deterministic capped candidates.
- Invalid cut, impossible geometry, wrong row/role, duplicate targets, and corrupted historical command fail as validation, not ordinary availability.
- Original/current quote ownership and current quote absence while any blocker exists.

### Backend and PostgreSQL integration

- Verified current plus verified superseded original succeeds.
- Missing, candidate, failed, rolled-back, unverified, or malformed original returns the same non-disclosing reconciliation conflict.
- Maintenance, missing active pointer, non-`ACTIVE` pointer, unverified current, embedded ID/price mismatch, or malformed snapshot fails closed.
- Activation/reconciliation race cannot return a mixed publication pair.
- Browser-supplied totals, labels, replacement IDs, issues, or fingerprints are rejected/ignored and never become response authority.
- Body limit and independent per-IP buckets execute before parsing/database/calculation; trusted-proxy first/last behavior matches existing deployment rules; IPs are not persisted or logged.

### Website unit and browser behavior

- Stale valid draft enters reconciliation; unfinished v3 repair survives refresh; current valid draft retains the existing restore path; corrupt/unknown draft remains recoverable by deletion.
- Removed choices remain visible until explicit action; normal editor never receives an unresolved ID.
- Replace/remove, undo/redo, all material/options/layout changes, restore, and cross-tab updates clear acceptance.
- Loading, retryable error, maintenance, no-publication, blocked, ready, accepted, and publication-raced states remain understandable and operable at the phone viewport.
- Acceptance survives refresh only after a fresh exact server match; forged local acceptance does not make the configuration ready.
- Pre-submission gate accepts an exact fresh tuple and rejects every changed tuple component.

## Validation commands

Run narrow checks first, then the cross-workspace gates:

1. `bun test packages/contracts/src/leads.test.ts packages/contracts/src/drafts.test.ts`
2. `bun run --cwd backend test:unit` with focused configuration/security tests included in the unit script.
3. `bun run test:backend:integration`
4. `bun run test:website`
5. `bun run e2e:configurator`
6. `bun run typecheck`
7. `bun run build`
8. `bun run architecture:check`
9. `bun run --cwd backend prisma:validate`

The full repository test suite is run if the touched shared contract or middleware changes show any cross-workspace regression signal.

## Rollout and rollback

- This stage is additive and lead capture stays disabled, so it can ship independently after review.
- The reconciliation endpoint is safe to deploy before the UI consumes it. The UI must not expose acceptance until the endpoint and proof checks are live.
- Rollback removes the new UI and endpoint together. Existing v0-v2 drafts continue to work. A v3 draft remains stored but the old client reports it as a newer unsupported version and blocks restore until Stage 4.3 is redeployed or the visitor explicitly deletes it; rollback must not claim seamless v3 editing.
- No database rollback or data migration is expected.

## Risks and open questions

- **Historical snapshot corruption:** fail closed with the same reconciliation conflict and preserve the local draft so support or a later compatible codec can recover it.
- **No compatible replacement:** keep the original choice visible and require explicit removal; never guess.
- **Catalog changes during review:** the saved acceptance becomes stale and the fresh gate returns the visitor to reconciliation.
- **Large configurator script:** extract feature-owned reconciliation state/API/render helpers when this reduces responsibility in the Astro composition script; do not create generic abstractions.
- **In-memory rate limits reset on process restart:** acceptable for this pre-lead abuse boundary because no durable resource is allocated. Stage 4.4/4.5 add durable global admission for intents and leads.
- **Product copy:** use concise neutral Russian copy consistent with the current configurator. Copy refinement must not weaken explicit acceptance or hide unavailable choices.

There are no owner decisions blocking implementation in this plan. If plan review finds that the existing response shape can meet D-5 without a contract revision, preserve the behavioral requirements and choose the smaller compatible change.

## Status

- [x] Plan approved by the owner (2026-10-25)
- [ ] Plan passed `/loop-plan-review-3`
- [x] Stage 1 — Shared contract and pure rules
- [x] Stage 2 — Publication eligibility and coherent loading
- [x] Stage 3 — Guarded reconciliation endpoint
- [x] Stage 4 — Stale-draft repair experience
- [x] Stage 5 — Explicit acceptance and pre-submission gate
- [ ] Stage 6 — End-to-end validation and documentation alignment
- [ ] Code passed iterative independent review

Stage 6 progress (2026-10-25): contracts (30), backend unit (96), website (25), webapp (47),
typecheck, build, architecture (240 files), Prisma validation, and configurator E2E (4) pass.
The five-round levels 1–5 code-review loop completed; every reported finding was fixed and
covered, but the final reviewer scored before the last two fixes and the loop's five-pass limit
prevents claiming independent acceptance without a sixth pass. The full backend integration
suite remains at 37 passing and the same five existing local test-database/schema drift failures
outside this stage, so the final validation and independent-review checkboxes remain open.
