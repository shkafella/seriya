# Plan: Mobile Kitchen Catalog, Configurator, and Lead Capture

## What and why

Seriya will let furniture companies assemble a kitchen from the manufacturer's real serial modules, see the occupied length and preliminary price, and send a structured request. The primary customer works from a phone, so the product is designed as a touch-first mobile tool rather than a desktop planner reduced to a small screen.

The first production release covers kitchens. The catalog and row-layout foundation should be reusable for wardrobes later, but wardrobe-specific catalog data and rules do not block the kitchen launch.

Success means a new visitor can open `seriya.raspilok.ru` on a phone, build a valid kitchen without registration, understand what is and is not included in the price, and submit a request containing the exact modules, dimensions, colors, and price snapshot.

## Confirmed product scope

- Primary audience: furniture companies and their employees.
- Primary device: a smartphone used one-handed or with short touch interactions.
- Public catalog, guided kitchen configurator, live price, specification, and lead form.
- Initial data source: the Google Sheet `Кухо` and its normalized `Справочник Codex` tab.
- Current normalized source: 224 catalog rows — 104 lower modules, 73 wall-row modules, 22 mezzanine modules, 3 cornice/plinth items, and 22 false panels. The corrected initial catalog is expected to contain 225 variant records after restoring the missing 450 mm Aventos drying cabinet while retaining the existing 500 mm record.
- All valid current rows plus the restored 450 mm Aventos variant are intended for the public catalog after data cleanup.
- Current products reference 26 shared technical image assets reused across width variants.
- Body choices initially combine two material classes with five named variants: LDSP Tefi, white LDSP, white Ultrаdecor LMDF, cashmere Ultrаdecor LMDF, and graphite-gray Ultrаdecor LMDF.
- Facades are optional for the whole kitchen. When facades are enabled globally, an exceptional module can still be marked `without facade`. Initial facade choices use approximately 5–6 placeholder decors for Ultrаdecor LMDF and 5–6 placeholder decors for AGT; final decor names will be supplied later.
- Fasteners are mandatory and use an owner-editable fixed charge per catalog module. Packaging is an explicit kitchen-wide yes/no option calculated from each selected module's square-meter input imported from the table. Any component marked `Покупают сами`, including hinges, Gola profiles, Aventos sets, lifts, and other mechanisms, is excluded from the price and supply and appears only as a specification comment. Assembly is never included or sold through this product.
- Countertops are not sold. The configurator shows a neutral gray countertop for context and excludes it from the price.
- Room dimensions are optional. Without them, the result shows total kitchen length. With them, it also shows remaining space or overflow.
- The first release supports straight and L-shaped kitchens. U-shaped kitchens and islands are deferred.
- A wall overflow remains editable and may be submitted with a prominent approximate-dimensions warning.
- Wall cabinets and mezzanines remain independently editable but the system should propose an automatic arrangement based on the lower row.
- An owner-marked module may be cut down by no more than 50 mm to a customer-specified whole-millimeter width where the product rules allow it. The system uses the nearest eligible standard module that is not narrower than the requested size. Its standard module price remains unchanged and a fixed RUB 3,000 service charge is added. No more than two modules in each row may be cut down, and they may appear at any position in that row.
- The customer sees an exact furniture price for the selected configuration and options, with exclusions shown separately.
- Source commercial prices are wholesale selling prices stated without VAT.
- A protected single-owner workspace is required to maintain the imported catalog, material and packaging prices per square meter, per-module fastener charges, and published price versions.
- Customer and staff accounts, online payment, customer uploads, and real-time collaboration are deferred.
- Production URL: `seriya.raspilok.ru` on the existing rented VPS.

## Product principles

- The configurator is a guided sales tool, not a universal furniture CAD system.
- Phone usability wins over desktop-style freedom and visual complexity.
- Every essential action has a visible tap control. Drag-and-drop may enhance the interface but is never required.
- Exact composition, placement, validation, and pricing are deterministic application data.
- AI may create an inspirational render only after a valid configuration exists. AI never determines geometry, compatibility, or price.
- Product ideas such as row snapping, gap highlighting, and a final checklist may be inspired by existing planners, but implementation, interface, assets, and source code remain original to Seriya.
- The customer always sees whether a value is exact, preliminary, excluded, or awaiting manager confirmation.

## Key decisions

- **D-1.** The first release is public and works without sign-in.
- **D-2.** The phone is the primary design target. Desktop displays the same flow with more room; it is not a separate editor.
- **D-3.** Catalog pages group variants into understandable product families. Width, depth, and opening side are selected inside a family instead of showing hundreds of near-duplicate cards.
- **D-4.** PostgreSQL is the runtime source of truth. Google Sheets is an import source, not a live database queried by visitors.
- **D-5.** The importer preserves each original row and assigns every sellable variant a stable internal ID. Re-import updates known variants instead of duplicating them.
- **D-6.** Configuration is row-based. A wall has separate lower, wall-cabinet, and mezzanine rows; a module enters only its allowed row.
- **D-7.** Modules are ordered rather than freely positioned by pixel coordinates. Adding a module places it at the active end; the visitor moves it with explicit left/right controls.
- **D-8.** Rows snap together automatically. Empty spans are explicit and can suggest modules that fit.
- **D-9.** The exact MVP visualization is a scaled front elevation assembled from controlled assets. Full free-camera 3D is deferred.
- **D-10.** Body material/decor and optional facade material/decor apply globally in the first release. When facades are enabled, an explicit per-module `without facade` action handles the rare exception without changing the rest of the kitchen.
- **D-11.** Exact furniture price is calculated from versioned material rates, stored module consumption inputs, selected additions, and fixed service charges. Body edging is already included in the body-material square-meter rate and is not charged separately. The gray countertop and every excluded service are named next to the total.
- **D-12.** Every submitted lead stores an immutable configuration and price snapshot.
- **D-13.** Public pages and the configurator belong to `website`; the protected owner pricing screen belongs to `webapp`; the backend owns catalog, pricing, configuration, and lead behavior through shared contracts.
- **D-14.** The configurator is Seriya-owned software. Third-party code or assets are used only under an explicit compatible license or written permission.
- **D-15.** Straight and L-shaped kitchens launch first. Wall cabinets and mezzanines are suggested from the lower-row layout but remain independently editable.
- **D-16.** Wall overflow produces a prominent warning rather than blocking submission because customer dimensions may be approximate.
- **D-17.** Owner-marked modules can be cut down to a requested width. The system chooses the nearest eligible standard module that is not narrower than the requested size. The original standard-module calculation remains unchanged and RUB 3,000 is added. At most two modules per row may be modified, and the order snapshot preserves both catalog width and requested finished width.
- **D-18.** All valid current source rows and the restored 450 mm Aventos variant are intended for publication, but a row remains unavailable until its data and price inputs pass validation.
- **D-19.** The first import creates the application catalog database. After import, the protected owner workspace is the normal place to edit catalog records and commercial inputs; Google Sheets is not the ongoing editing interface.
- **D-20.** Wall-cabinet suggestions initially match lower-row widths. The customer may replace suggested modules with other available standard variants; changing one module may require changing a neighbor to preserve the row length, but this is not cut-to-width unless the customer explicitly enables that service.
- **D-21.** The customer-facing price equals the calculated excluding-VAT furniture amount multiplied by `1.10`. The displayed included VAT equals the final customer price multiplied by `22 / 122`. For an excluding-VAT amount of RUB 100,000, the final price is RUB 110,000 and the included VAT is RUB 19,836.07. This presentation must be approved by the accountant before launch.
- **D-22.** The customer chooses one preferred messenger—Telegram, WhatsApp, or MAX—and provides one contact value. Lead notifications launch through Telegram; MAX notification delivery is a later stage.
- **D-23.** The protected workspace has one owner account in the first release; staff roles are deferred.
- **D-24.** Live prices do not use the source spreadsheet's current `Price` column. The application calculates every price from maintained consumption inputs, published rates, fixed module charges, and selected services.
- **D-25.** When a customer changes an automatically suggested upper module, the system proposes any necessary neighboring standard-module replacement and applies it only after customer confirmation.
- **D-26.** The first release shows the exact price and specification and sends a request. It does not generate a PDF invoice.
- **D-27.** The owner catalog editor covers public name, SKU, dimensions, material-consumption inputs, image, availability, per-module fastener price, and cut-to-width eligibility.
- **D-28.** Cut-to-width modules may appear anywhere in a row. The limit is two modified modules independently in each lower, wall-cabinet, and mezzanine row.
- **D-29.** Oven, hood, dishwasher, bottle-rack, tall/pantry, and drying-rack module families cannot be cut to width. Eligibility remains an owner-editable catalog property for every variant.
- **D-30.** Customer totals are rounded to the nearest RUB 10 after all components and the `1.10` customer-price multiplier are applied. The included-VAT amount is then extracted from the rounded customer total.
- **D-31.** Anonymous server share links are deferred until after the first configurator launch. Browser-local autosave remains part of the first release.
- **D-32.** Existing technical images are used for the first prototype while a parallel image workstream develops the controlled layered assets.
- **D-33.** Wardrobes follow kitchens on the same catalog, calculation, configuration, snapshot, and lead foundation.
- **D-34.** A cut-to-width request may reduce the selected standard width by 1–50 mm in whole-millimeter steps. An exact standard width uses the standard variant without the service charge.
- **D-35.** Packaging uses the module's stored body-material square meters from the source table; no separate packaging-area field is required for the initial import.
- **D-36.** The initial database takes module height, width, depth, and consumption values from the source tabs. Missing layout-only dimensions that are not present in the source remain explicit owner decisions.
- **D-37.** The 600 mm sink module is one product family with one-facade and two-facade construction variants. The `601` source suffix distinguishes the second construction and is not a customer-facing width.
- **D-38.** The two 600 mm drying-cabinet rows are one product family with one-facade and two-facade construction variants. The facade-count choice controls the corresponding consumption record.
- **D-39.** The 450 mm and 500 mm Aventos drying cabinets are separate sellable variants. The source currently contains only a row named 450 whose SKU, dimensions, and consumption values describe 500 mm; both records must be restored correctly before import.
- **D-40.** A refrigerator tall unit uses the complete kitchen height up to the crown, excluding the crown itself. The height depends on the lower assembly, customer countertop thickness, 600 mm backsplash zone, 700 mm wall row, and 350 mm mezzanine.
- **D-41.** False panels are optional catalog items added manually by the customer. Their price is the stored facade-material square meters multiplied by the selected facade-material rate.
- **D-42.** The internal label `проем клок` is a typo. Its public family name is `подъёмник KLOK`; the original source label remains stored only for traceability.
- **D-43.** Initial body materials share one common body rate, and initial non-AGT facade decors share one common facade rate. The data model remains capable of separate future rates. Placeholder facade `AGT 1` launches at RUB 3,000/m2; additional AGT decors are added later.
- **D-44.** Countertop thickness defaults to 38 mm. The customer may instead select 20 mm or 12 mm; no free-form thickness is required in the first release.
- **D-45.** Complete kitchen height includes the 100 mm plinth. It is calculated automatically from `100 plinth + 780 lower body + selected countertop + 600 backsplash + 700 wall cabinet + 350 mezzanine`, excluding the crown. The resulting heights are 2,568 mm for a 38 mm countertop, 2,550 mm for 20 mm, and 2,542 mm for 12 mm.
- **D-46.** The customer selects only countertop thickness; the system calculates complete kitchen height and does not expose a manual total-height override in the first release.
- **D-47.** The missing 450 mm Aventos drying-cabinet consumption values are calculated from the same approved formulas as adjacent widths and require owner review before publication.
- **D-48.** Public labels replace the remaining source shorthand: `среднии` becomes `Верхние модули`, `хол` becomes `Пенал для холодильника`, and `бутыл` becomes `Бутылочница`.
- **D-49.** Initial published rates taken from the main lower-module source are RUB 2,050/m2 for all body materials, RUB 2,225/m2 for all non-AGT facade decors, and RUB 600/m2 for white HDF. `AGT 1` remains RUB 3,000/m2.
- **D-50.** Packaging launches at RUB 350/m2 and uses each selected module's stored body-material square meters.
- **D-51.** Mandatory fixed fastener charges are stored per module, imported from the owner's forthcoming updated spreadsheet, and remain editable in the owner catalog workspace.
- **D-52.** Any source component marked `Покупают сами` is excluded from the module charge even when the source also contains a numeric reference cost. The component remains visible in the specification as a customer-supplied item.
- **D-53.** When the updated sources give different unit costs for the same included fastener, the initial import uses the highest observed unit cost. The resulting per-module charge remains editable by the owner.
- **D-54.** The hood module receives the unique SKU `СДВ 600`; the duplicated source SKU `СДП 600` remains attached only to the ordinary wall-cabinet family.
- **D-55.** False-panel fastener charges launch at zero because their fastener list has not yet been supplied. The owner can add these charges later without changing the catalog model.
- **D-56.** Aventos sets are customer-supplied items. They are excluded from the price and shown only as specification comments.
- **D-57.** The live Google Sheet is authoritative when it differs from the standalone Excel exports. The importer must preserve the Google source row for traceability and must not guess a replacement SKU or width from a shifted Excel sequence.
- **D-58.** The removable-shelf lower-module sequence contains one confirmed shifted source block. The row currently labeled `НГСП 650` with duplicated 600 mm consumption is the two-facade 600 mm variant `НГСП 601`. The following source records are realigned by one 50 mm step and the sellable sequence ends at `НГСП 900`; there is no separate `НГСП 950` launch variant.

## Features selected from the GrabSketch research

Seriya will implement its own mobile versions of these interaction ideas:

- automatic placement at the end of the selected row;
- automatic row compaction without manual coordinates;
- starting edge selection: fill from the left or from the right;
- visible empty-space indicator and tap-to-fill suggestions;
- explicit `left`, `right`, `replace`, and `delete` actions;
- separate lower, wall-cabinet, and mezzanine levels;
- one color choice applied to the whole row or kitchen;
- warnings for overflow and incompatible modules;
- final checklist before submission;
- shareable saved configuration;
- optional AI render generated only from an exact completed configuration.

## Decisions proposed for owner approval

- No product-direction proposals remain open. Detailed catalog data, geometry, and launch rates still require confirmation below.

## Source data assessment

### Available data

The spreadsheet already provides section, product name, short internal name, height, width, depth, price for most variants, production calculation inputs in source tabs, and a technical image URL for every normalized row.

### Required cleanup before production import

- Preserve two constructions for `Средний ряд проем сушка 600`: SKU `СДСУ 600` has one facade and SKU `СДСУ 601` has two facades. Present them as facade-count variants of one 600 mm family.
- Price all 22 false-panel variants as their stored facade square meters multiplied by the selected facade-material rate. They remain manually selected optional catalog items.
- Correct the sink sequence beginning with `Низ гола мойка 601`: retain one 600 mm module with one- and two-facade variants, then realign subsequent stored widths with their names.
- Restore separate 450 mm and 500 mm Aventos drying variants. The current row named `Средний ряд проем сушка авентос 450` contains the SKU, width, and consumption values of the 500 mm variant.
- Calculate the finished height for `Низ гола хол 600` and its left/right false-panel variants from the complete kitchen height to the crown, excluding the crown.
- Replace source labels with approved public names while preserving source values for traceability: `среднии` → `Верхние модули`, `проем клок` → `Подъёмник KLOK`, `хол` → `Пенал для холодильника`, and `бутыл` → `Бутылочница`.
- Confirm which short names are stable SKUs and ensure every sellable variant is unique.
- Use each module's stored body-material square meters as the packaging calculation input.
- Add an owner-editable fixed fastener charge to each module.
- Treat every component marked `Покупают сами`, including hinges, Gola profiles, Aventos sets, lifts, and other mechanisms, as excluded and not sold. Show it as a customer-supplied specification comment even when the source contains a numeric reference cost.
- Normalize conflicting included-fastener prices with the highest observed unit cost before calculating each module's fixed charge.
- Assign the hood module the unique SKU `СДВ 600` instead of the duplicated `СДП 600`.
- Seed false-panel fastener charges at zero until the owner supplies their fastener list.
- Use the live Google Sheet rather than the standalone Excel files to resolve source-row identity, except for the owner-confirmed removable-shelf correction in D-58. Preserve both the original source row and corrected import identity for traceability.
- Do not preserve different per-tab material rates. Seed RUB 2,050/m2 for every initial body material, RUB 2,225/m2 for every initial non-AGT facade decor, RUB 600/m2 for white HDF, and RUB 3,000/m2 for placeholder facade `AGT 1`.
- Add additional AGT decors later. Seed packaging at RUB 350/m2. Import per-module fastener charges from the forthcoming updated owner spreadsheet before affected products can publish with an exact price.
- Confirm the VAT display formula with the accountant before invoice wording is implemented.
- Copy approved assets to Seriya-controlled storage before launch instead of depending on the current external image host.

## Mobile interaction model

### Screen structure

- The exact kitchen preview stays visible in the upper part of the screen.
- A compact sticky summary always shows occupied length and current price.
- Catalog, filters, module settings, warnings, and specification open as bottom sheets.
- The primary bottom action changes with context: `Add module`, `Apply`, `Review`, or `Send request`.
- The interface never requires hover, right-click, a precision pointer, or keyboard shortcuts.

### Touch behavior

- Touch targets are at least 44 by 44 CSS pixels.
- A tap selects a module and opens its actions.
- Left/right buttons are the reliable reorder control; long-press dragging is optional.
- Destructive actions require a clear confirmation or immediate undo.
- The draft saves after every meaningful action and survives a page refresh.
- The mobile browser back action closes the current sheet before leaving the configurator.
- The on-screen keyboard must not cover the active field or final submission action.

### Compact scene behavior

- Pinch zoom and dedicated zoom controls may enlarge the scene, but the user can complete the flow without gestures.
- The selected module is visibly highlighted and automatically scrolled into view.
- Long rows can be panned horizontally inside the scene without causing the whole page to drift sideways.
- Width labels appear on selection rather than covering every module on a small screen.
- Lower, wall-cabinet, and mezzanine rows can be collapsed individually when editing another row.

## Customer flow

1. Visitor opens the catalog on a phone without registration.
2. Visitor chooses a product family or starts the kitchen configurator.
3. Visitor selects straight or L-shaped kitchen, filling direction, and optionally enters wall length.
4. Visitor chooses body material/decor, whether facades are required, facade material/decor when selected, and whether packaging is required.
5. Visitor selects lower, wall-cabinet, or mezzanine row.
6. A bottom-sheet catalog shows compatible families; the visitor chooses a family and width.
7. The module appears at the active end. Scene, length, free space, specification, and total update immediately.
8. Tapping a placed module exposes move, replace, duplicate, delete, `without facade`, and supported cut-to-width actions where applicable.
9. Wall cabinets and mezzanines receive an automatic width-matched arrangement from the lower row and can then be changed to other available standard modules independently.
10. The configurator highlights gaps, overflow, missing prices, and incompatibilities.
11. Visitor reviews composition and exclusions, then enters company, contact name, phone, selects Telegram, WhatsApp, or MAX, and provides one contact value.
12. The backend stores the lead and immutable snapshot and sends a Telegram bot notification. MAX delivery is added later.

## Functional requirements

### Catalog

- **FR-CAT-1.** Show customer-facing families instead of a flat 224-item list.
- **FR-CAT-2.** Filter by row, purpose, width, and function such as sink, dishwasher, oven, drawers, shelf, corner, or hood.
- **FR-CAT-3.** A family page shows description, image, available dimensions, price range, colors, included components, and exclusions.
- **FR-CAT-4.** Each variant has a stable ID, SKU, dimensions, price status, active status, allowed row, image family, and compatibility metadata.
- **FR-CAT-5.** Incomplete or inactive variants never appear as orderable items but remain traceable in imports.
- **FR-CAT-6.** Search-critical catalog content is present in initial HTML.

### Configuration workspace

- **FR-CONF-1.** The complete primary journey works at 360 by 640 CSS pixels without horizontal page scrolling.
- **FR-CONF-2.** The scene contains lower, wall-cabinet, and mezzanine rows.
- **FR-CONF-3.** A module may be added only to an allowed row and wall segment.
- **FR-CONF-4.** Adding a module appends it from the configured starting edge.
- **FR-CONF-5.** Selecting a module exposes tap controls for move left, move right, replace, duplicate, and delete.
- **FR-CONF-6.** Reordering never creates overlaps and recalculates positions from module widths.
- **FR-CONF-7.** `Close row` packs modules against the starting edge.
- **FR-CONF-8.** With a known wall width, each row shows occupied, remaining, or overflow millimeters.
- **FR-CONF-9.** Tapping an empty span filters the catalog to variants that fit it.
- **FR-CONF-10.** Undo and redo cover add, remove, replace, reorder, color, wall, and dimension changes.
- **FR-CONF-11.** Local autosave survives refresh without collecting contact information.
- **FR-CONF-12.** The specification lists every variant, quantity, dimensions, unit price, and subtotal.
- **FR-CONF-13.** No required action depends on drag-and-drop, pinch, or another hidden gesture.
- **FR-CONF-14.** The system can generate an initial wall-cabinet and mezzanine suggestion from lower-row widths without locking those rows.
- **FR-CONF-15.** For an eligible module, the visitor can enable cut-to-width, enter the finished width, see the RUB 3,000 charge, and return to the standard width.
- **FR-CONF-16.** A modified module visibly shows its original catalog width and requested finished width in the scene and specification.
- **FR-CONF-17.** When facades are enabled globally, a selected module can be marked `without facade`; the scene, specification, and price update immediately.
- **FR-CONF-18.** Replacing an automatically suggested wall module uses only available standard variants and is distinct from the paid cut-to-width service.
- **FR-CONF-19.** Final review asks for countertop thickness using three options: 38 mm by default, 20 mm, or 12 mm.
- **FR-CONF-20.** Final review shows the automatically calculated complete kitchen height to the crown, excludes the crown itself, and records the value in the request snapshot. The customer cannot override total height directly in the first release.
- **FR-CONF-21.** False panels are added manually from the compatible catalog and are never inserted into the configuration without a customer action.
- **FR-CONF-22.** Public category and family labels use `Верхние модули`, `Подъёмник KLOK`, `Пенал для холодильника`, and `Бутылочница` instead of source shorthand.

### Placement and compatibility

- **FR-RULE-1.** Lower modules occupy the lower row only.
- **FR-RULE-2.** Wall cabinets occupy the row above the countertop/backsplash zone.
- **FR-RULE-3.** Mezzanine modules occupy the top row.
- **FR-RULE-4.** Full-height modules reserve every vertical zone they cross.
- **FR-RULE-5.** Left and right corner modules preserve orientation and work only at a compatible wall junction.
- **FR-RULE-6.** Dishwasher, oven, sink, refrigerator, and hood modules expose their appliance roles to validation.
- **FR-RULE-7.** Rules return understandable warnings and identify the affected module instead of silently changing the project.
- **FR-RULE-8.** Blocking issues prevent submission; warning-level issues follow the approved commercial policy.
- **FR-RULE-9.** Overflow is a warning and does not block submission; the snapshot records wall length, overflow, and acknowledgement.
- **FR-RULE-10.** Cut-to-width permits a 1–50 mm whole-millimeter reduction only on owner-marked variants and never silently changes another module.
- **FR-RULE-11.** Each lower, wall-cabinet, and mezzanine row may contain no more than two cut-to-width modules, at any positions in the row.
- **FR-RULE-12.** The cut-to-width flow selects the nearest eligible standard variant that is not narrower than the requested finished width. If the reduction would exceed 50 mm, the request is invalid; an exact standard width uses the standard variant without a cut charge.
- **FR-RULE-13.** Oven, hood, dishwasher, bottle-rack, tall/pantry, and drying-rack variants default to cut-to-width disabled and cannot be modified by the customer.
- **FR-RULE-14.** The refrigerator tall-unit height follows the confirmed complete kitchen height to the crown instead of using a fixed catalog height.
- **FR-RULE-15.** Complete kitchen height includes the 100 mm plinth and equals `100 + 780 + countertop thickness + 600 + 700 + 350` mm. The crown is excluded.

### Visualization and colors

- **FR-VIS-1.** The scene is scaled from real dimensions, so wider variants appear wider.
- **FR-VIS-2.** Body and facade selections update appearance and exact price from their material rates and consumption inputs.
- **FR-VIS-3.** A neutral gray countertop is shown and labelled as not included.
- **FR-VIS-4.** Public assets use a consistent camera, scale, transparent background, and named color layers or masks.
- **FR-VIS-5.** The configuration produces a stable preview image for the request.
- **FR-VIS-6.** Future AI output is separate and labelled as an illustrative visualization.

### Pricing

- **FR-PRICE-1.** The visible exact furniture total changes immediately after every priced change.
- **FR-PRICE-2.** A protected owner screen maintains versioned per-square-meter rates for body materials, facade materials, packaging, and any other approved rate-driven inputs.
- **FR-PRICE-3.** The owner can prepare rate changes, review their effect, and explicitly publish a new price version; editing a draft rate does not silently change public prices.
- **FR-PRICE-4.** Authoritative server data defines rates, consumption inputs, fixed charges, and calculations; the client may mirror the calculation only for instant feedback.
- **FR-PRICE-5.** The module result separates body, white HDF rear panel, optional facade, optional packaging, mandatory fixed per-module fasteners, cut-to-width service, and future additions. Body and facade edging and processing are included in their square-meter material rates and are not separate line items.
- **FR-PRICE-6.** Every total references a price version and calculation time.
- **FR-PRICE-7.** Missing inputs are visible and prevent presentation of a complete exact total.
- **FR-PRICE-8.** Assembly is never included. Countertop, delivery, installation, appliances, and sink remain excluded unless a later decision explicitly adds them.
- **FR-PRICE-9.** Wholesale source prices are treated as excluding VAT. The customer total is the calculated furniture amount multiplied by `1.10`; included VAT is extracted from that customer total as `22 / 122`. The formula and invoice wording require accountant approval before launch.
- **FR-PRICE-10.** The server recalculates and validates the submitted total before storing a lead.
- **FR-PRICE-11.** Cut-to-width does not recalculate material consumption: it retains the selected standard module price and adds RUB 3,000.
- **FR-PRICE-12.** Fastener price is stored and editable per module. When packaging is enabled for the kitchen, every selected module contributes its stored body-material square meters multiplied by the published packaging rate.
- **FR-PRICE-13.** White HDF rear-panel price equals the module's stored HDF square meters multiplied by the published white-HDF rate.
- **FR-PRICE-14.** When `without facade` is enabled for a module, its facade square-meter component becomes zero without changing any other component.
- **FR-PRICE-15.** The imported source `Price` value is not used in live calculations.
- **FR-PRICE-16.** Hinges and Gola profiles are excluded from both price and supply; this exclusion is visible in the specification where relevant.
- **FR-PRICE-17.** The final customer total is rounded to the nearest RUB 10. Included VAT is calculated from that rounded total as `22 / 122` and displayed to kopecks where required.
- **FR-PRICE-18.** Every initial body material shares the RUB 2,050/m2 published body rate. Every initial non-AGT facade decor shares the RUB 2,225/m2 published facade rate. White HDF uses RUB 600/m2, and `AGT 1` uses RUB 3,000/m2 until the owner publishes changed rates.
- **FR-PRICE-19.** A manually added false panel costs its stored facade square meters multiplied by the selected facade-material rate.
- **FR-PRICE-20.** Packaging uses the published RUB 350/m2 launch rate multiplied by each selected module's stored body-material square meters.
- **FR-PRICE-21.** Every module that requires fasteners must have a fixed fastener charge from the updated source table before it can publish with an exact price.

### Drafts, sharing, and leads

- **FR-DRAFT-1.** Anonymous local autosave requires no contact data.
- **FR-DRAFT-2.** A later post-launch public draft uses an unguessable identifier and contains no contact data.
- **FR-DRAFT-3.** When post-launch sharing is enabled, opening a shared draft creates an editable copy by default.
- **FR-LEAD-1.** Required fields are company name, contact name, phone, preferred messenger selection, and one messenger contact value. Supported selections are Telegram, WhatsApp, and MAX.
- **FR-LEAD-2.** Submission records consent to personal-data processing.
- **FR-LEAD-3.** A lead contains contact data, snapshot, preview, specification, dimensions, colors, warnings, price version, total, and exclusions.
- **FR-LEAD-4.** Repeated taps or network retries do not create duplicate leads.
- **FR-LEAD-5.** The visitor receives a clear success state and reference number.
- **FR-LEAD-6.** Notification failure never loses the stored lead.
- **FR-LEAD-7.** Lead notifications launch through a Telegram bot. MAX bot delivery is a later stage; all notification credentials remain server-side secrets.

### Catalog operations

- **FR-OPS-1.** An import command validates a spreadsheet export before changing production data.
- **FR-OPS-2.** Import reports created, updated, unchanged, deactivated, duplicate, and invalid variants.
- **FR-OPS-3.** Price publication is explicit and versioned; incomplete imports cannot silently become public.
- **FR-OPS-4.** A protected owner workspace can create, edit, activate, and deactivate catalog families and variants, including public name, SKU, dimensions, material-consumption inputs, image, availability, per-module fastener charge, and cut-to-width eligibility.
- **FR-OPS-5.** Catalog and pricing edits are available only to the single owner account in the first release.
- **FR-OPS-6.** Imported source identity and change history remain traceable after records are edited in the application.

## Proposed product data model

- **Category:** lower, wall cabinet, mezzanine, trim/accessory, false panel, and future wardrobe categories.
- **Product family:** customer-facing type such as lower shelf cabinet or three-drawer cabinet.
- **Variant:** unique SKU with dimensions, orientation, material-consumption inputs, fastener charge, cut-to-width eligibility, source identity, and active state.
- **Material and decor:** selectable body and facade materials, placeholder/final decor names, units, active state, and versioned rates.
- **Option:** optional facade, packaging, profile, and future hardware choices.
- **Asset family:** controlled technical image/layers shared by compatible variants.
- **Compatibility rule:** allowed row, junction, appliance role, reserved zones, and validation severity.
- **Modification:** eligible cut-to-width selection with original width, requested width, limits, and fixed charge.
- **Price version:** immutable published price set.
- **Configuration draft:** anonymous structured layout, options, and optional wall dimensions.
- **Configuration snapshot:** immutable submitted composition and calculated result.
- **Lead:** contact data, consent, snapshot reference, delivery status, and processing status.

## Public screens

- Landing page explaining the serial-kitchen offer.
- Kitchen catalog and family filters.
- Product-family page with variant selector.
- Mobile configurator with fixed scene, bottom-sheet catalog, sticky price, and specification.
- Final review and lead form.
- Shareable configuration page after the first configurator launch.
- Privacy policy and personal-data consent text.
- Protected single-owner catalog and pricing workspace for module data, availability, cut-to-width eligibility, material and packaging rates, fastener charges, and price-version publication.

## Non-functional requirements

- Primary validation viewport: 360 by 640 CSS pixels; also test common Android and iPhone widths.
- All essential controls meet a minimum 44 by 44 CSS pixel touch target.
- No required registration, payment, or customer file upload.
- No required hover, precision dragging, keyboard shortcut, or landscape orientation.
- Catalog pages have unique title, description, canonical URL, and social-preview metadata.
- Placement and price interactions do not trigger full-page reloads.
- Core editing remains responsive on an average non-flagship Android phone.
- The first usable catalog screen and configuration draft remain usable on an ordinary 4G connection.
- Double submission and stale price versions are handled safely.
- Contact data never enters public share links or analytics events.
- Public inputs use shared validation and abuse protection.
- Images use responsive modern formats from Seriya-controlled storage/CDN.
- Critical catalog, pricing, rule, and lead behavior has backend tests; the main phone flow has an end-to-end browser test.

## Analytics events

- Catalog family opened.
- Configurator started.
- Kitchen shape and dimensions selected or skipped.
- Module added, replaced, moved, or removed.
- Gap suggestion used.
- Blocking validation shown.
- Configuration shared.
- Lead form opened, failed, or submitted successfully.
- AI render requested or completed when introduced.

Analytics never includes phone numbers, names, emails, comments, or complete private configuration URLs.

## What we deliberately do not do in the kitchen MVP

- Customer or staff accounts and role-based workspaces.
- Online payment, invoices, or order-status tracking.
- Customer image, drawing, or document uploads.
- Real-time chat or collaborative editing.
- Free-form cabinet construction or arbitrary dimension editing.
- Production cut lists, drilling maps, CNC output, or ERP integration.
- U-shaped kitchens, islands, and multi-room projects unless approved before implementation.
- Full free-camera 3D as a required step on a phone.
- AI-generated geometry, prices, or compatibility decisions.
- A multi-user staff admin panel or roles beyond the required single-owner catalog and pricing workspace.

## Stages

### Stage 1 — Confirm catalog and commercial rules

- Resolve source blockers and approve families, names, SKUs, inclusions, placeholder colors, material rates, and price formulas.
- Map HDF inputs, set material and packaging rates and per-module fastener charges, approve VAT wording, and finish cut-to-width eligibility.
- Define one complete example kitchen and submitted lead.
- **Done when:** no unresolved question can change the catalog or price schema.

### Stage 2 — Importable public catalog

- Implement contracts, database model, validated importer, protected owner catalog editor, backend reads, catalog pages, and owned image storage.
- **Done when:** approved variants import with a reconciliation report, the owner can maintain them in the application, and incomplete variants cannot be selected.

### Stage 3 — Phone-first straight-kitchen configurator and price management

- Implement the owner material-rate screen, per-module fastener pricing, price publication, fixed mobile scene, bottom-sheet catalog, row layout, tap controls, optional wall length, gaps, materials/decors, whole-kitchen facade and packaging options, per-module `without facade`, cut-to-width, front elevation, specification, and price.
- **Done when:** a visitor reproduces the approved example at 360 by 640 pixels using only taps and receives the expected length, specification, and server-validated total.

### Stage 4 — Validation, drafts, sharing, and leads

- Add checks, undo/redo, local autosave, final review, consent, lead storage, and Telegram notification. Add anonymous share links immediately after the initial launch.
- **Done when:** local work survives refresh, one submission creates one durable immutable lead, and the post-launch share-link increment reopens a project without contact-data exposure.

### Stage 5 — L-shaped kitchens and launch hardening

- Add wall junctions, corner semantics, multi-wall view, rules, analytics, accessibility, performance, and production operations.
- **Done when:** approved L-shaped references pass automated phone tests and `seriya.raspilok.ru` passes an HTTPS production smoke test with backup verification.

### Stage 6 — Optional AI visualization experiment

- Compare at least two providers using exact reference configurations and a fixed evaluation set.
- Set a cost limit, generation limit, retention policy, and failure fallback.
- **Done when:** the owner accepts fidelity and cost, and AI never replaces the exact scene.

### Stage 7 — Wardrobe extension

- Reuse catalog, option, price, draft, share, and lead foundations; add wardrobe-specific sections, doors, shelves, drawers, and rails.
- **Done when:** a separate approved wardrobe specification and data source exist and one reference wardrobe passes the phone flow.

## Acceptance scenario for the first kitchen release

1. On a 360 by 640 phone viewport, a visitor starts without an account.
2. The visitor chooses straight or L-shaped layout and may skip dimensions or enter wall lengths.
3. The visitor selects body material/decor, optional facade material/decor, and optional packaging.
4. Using only taps, the visitor adds lower, wall, and mezzanine modules.
5. Every module appears in the correct row and proportional width.
6. The visitor reorders and replaces modules without precision dragging or overlaps.
7. The visitor cuts an eligible module down to an allowed width and sees the RUB 3,000 charge.
8. Wall-cabinet and mezzanine suggestions are created from the lower row but remain editable.
9. The sticky summary shows occupied length and exact recalculated furniture price throughout the flow.
10. The result shows free/overflow space, specification, warnings, and exclusions.
11. Overflow warns but does not prevent submission.
12. Assembly, countertop, and other approved exclusions are explicitly not included.
13. The visitor submits once and receives a reference number.
14. The stored lead contains exact configuration, original and modified widths, price version, preview, consent, and exclusions.
15. A later rate or catalog change does not alter the submitted snapshot.

## Risks

- Technical images may not support accurate scaling or recoloring.
- Source pricing may omit components or mix cost and selling-price logic.
- Corner and tall-module rules may require production expertise not present in the sheet.
- Public B2B prices may expose dealer pricing.
- Full 3D, precision dragging, and too many visible controls can make the phone flow unusable.
- Mobile browsers may discard memory-heavy scenes; the MVP must keep graphics simple.
- AI may invent modules or appliances and must never be treated as an exact order image.
- Live dependencies on Google Sheets or third-party image hosting would reduce control.

## Pending source inputs in priority order

1. Normalize the four received fastener workbooks using D-52 through D-58.
2. Import and validate every included fastener charge against its stable module identifier before catalog publication.

## Estimated delivery after decisions and assets are ready

- First straight-kitchen phone prototype: approximately 7–10 working days.
- Production-ready kitchen MVP: approximately 4–6 weeks.
- Straight and L-shaped launch with sharing and hardening: approximately 6–8 weeks.
- Wardrobe extension: approximately 3–4 additional weeks after its catalog and rules are ready.

These estimates assume timely decisions and usable controlled assets. Creating all technical or 3D assets from scratch is a separate schedule risk.

## Status

- [x] Initial product direction confirmed
- [x] Primary phone usage confirmed
- [x] Source spreadsheet inspected
- [x] Comparable configurators researched
- [x] Own configurator selected over third-party rental
- [x] GrabSketch-inspired feature set selected for original implementation
- [x] All current source rows selected for the public catalog
- [x] Exact material-rate pricing direction confirmed
- [x] Straight and L-shaped launch scope confirmed
- [x] Overflow warning and independent upper-row editing confirmed
- [x] Optional facade, packaging, and cut-to-width direction confirmed
- [x] Core lead fields and Telegram/MAX notification direction confirmed
- [x] Owner-managed catalog and single-owner access confirmed
- [x] Base VAT uplift and included-VAT extraction formula confirmed, pending accountant approval
- [x] Fastener, packaging, facade-exception, and cut-to-width pricing direction confirmed
- [x] White-HDF, facade-edge, source-price, and no-facade calculations confirmed
- [x] Maximum two cut-to-width modules per row confirmed at any row positions
- [x] Hinges and Gola excluded from calculation and supply
- [x] Exact-price, specification, and lead-only MVP confirmed; PDF invoices deferred
- [x] Initial owner catalog-editor fields confirmed
- [x] Cut-to-width position, one-millimeter precision, and per-row limit confirmed
- [x] Cut-to-width exclusions identified for appliance, bottle-rack, tall, and drying modules
- [x] Hardware wording confirmed: only fasteners are included
- [x] Final customer total rounding to RUB 10 confirmed
- [x] Share links deferred until after first launch
- [x] Technical-image prototype and parallel asset workstream confirmed
- [x] Wardrobes confirmed on the same foundation after kitchens
- [x] Cut-to-width reduction limited to 50 mm with one-millimeter precision
- [x] Source module dimensions and consumption inputs selected for initial import
- [x] Packaging calculation tied to source body-material square meters
- [x] Exact source anomalies and conflicting initial rates identified
- [x] Sink and 600 mm drying modules modeled with one- and two-facade variants
- [x] Separate 450 mm and 500 mm Aventos drying variants confirmed; source repair remains
- [x] Refrigerator tall-unit height tied to complete kitchen height excluding crown
- [x] Countertop thickness added to final customer questions with 38 mm default
- [x] False panels confirmed as manually added facade-rate items
- [x] `проем клок` corrected to public name `подъёмник KLOK`
- [x] Common initial body and non-AGT facade rate policy confirmed
- [x] Placeholder `AGT 1` rate set to RUB 3,000/m2
- [x] Countertop thickness options confirmed as 38, 20, and 12 mm
- [x] Complete kitchen height confirmed to include the 100 mm plinth
- [x] Total height calculated automatically from countertop selection with no customer override
- [x] Missing Aventos 450 values approved for formula calculation and owner review
- [x] Public labels approved for upper modules, KLOK lift, refrigerator tall unit, and bottle rack
- [x] Initial source rates selected: body 2,050, facade 2,225, white HDF 600, and AGT 1 at 3,000 RUB/m2
- [x] Packaging launch rate confirmed at 350 RUB/m2
- [x] Updated fastener workbooks received and reviewed
- [x] Customer-supplied component, conflicting-price, hood-SKU, false-panel, and Aventos rules confirmed
- [x] Removable-shelf `НГСП 601` source correction confirmed; shifted variants realign through `НГСП 900`
- [x] Priority product questions answered
- [ ] Updated fastener charges normalized and validated against stable module identifiers
- [ ] Source catalog cleaned and commercially approved
- [ ] Plan approved by the owner
- [ ] Plan passed `/loop-plan-review-3`
- [ ] Stage 1 complete
- [ ] Stage 2 complete
- [ ] Stage 3 complete
- [ ] Stage 4 complete
- [ ] Stage 5 complete
- [ ] Production launch complete

Last updated: 2026-10-21.
