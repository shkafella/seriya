import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(
  readFileSync(new URL("../catalog/seed/catalog.v1.json", import.meta.url), "utf8"),
);
const report = JSON.parse(
  readFileSync(new URL("../catalog/seed/catalog.v1.report.json", import.meta.url), "utf8"),
);
const example = JSON.parse(
  readFileSync(
    new URL("../catalog/examples/reference-kitchen.v1.json", import.meta.url),
    "utf8",
  ),
);
const sourceMap = JSON.parse(
  readFileSync(
    new URL("../catalog/source-map.v1.json", import.meta.url),
    "utf8",
  ),
);
const APPROVED_RATES = Object.freeze({
  body_rub_m2: 2050,
  facade_rub_m2: 2225,
  hdf_rub_m2: 600,
  agt_1_rub_m2: 3000,
  packaging_rub_m2: 350,
  customer_price_multiplier: 1.1,
  included_vat_fraction: 22 / 122,
  cut_to_width_service_rub: 3000,
});
const APPROVED_REFERENCE = Object.freeze({
  calculatedExVatRub: 50257.75,
  packagingRub: 5078.5,
  customerTotalRub: 55280,
  includedVatRub: 9968.52,
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function almostEqual(actual, expected, tolerance = 0.001) {
  return Math.abs(actual - expected) <= tolerance;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundToTen(value) {
  return Math.round(value / 10) * 10;
}

function calculatedExVat(module, rates) {
  return (
    module.consumptionM2.body * rates.body_rub_m2 +
    module.consumptionM2.facade * rates.facade_rub_m2 +
    module.consumptionM2.hdf * rates.hdf_rub_m2 +
    module.fasteners.chargeRub
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function customerSuppliedQuantity(module, itemFragment) {
  return module.fasteners.customerSupplied
    .filter((line) =>
      line.item.toLocaleLowerCase("ru").includes(itemFragment.toLocaleLowerCase("ru")),
    )
    .reduce((total, line) => total + (line.quantity ?? 0), 0);
}

assert(catalog.schemaVersion === 1, "Unsupported catalog schema version");
assert(catalog.status === "approved_stage_1", "Catalog must be approved for Stage 1");
assert(catalog.modules.length === 225, "Catalog must contain 225 variants");
assert(
  new Set(catalog.modules.map((module) => module.sku)).size === 225,
  "Every normalized SKU must be unique",
);
assert(sourceMap.schemaVersion === 1, "Unsupported source-map schema version");
assert(sourceMap.records.length === 225, "Source-map must contain 225 records");
const sourceRecordIds = catalog.modules.map((module) => module.sourceRecordId);
const mappedSourceRecordIds = sourceMap.records.map((record) => record.sourceRecordId);
assert(
  sourceRecordIds.every((recordId) => typeof recordId === "string" && recordId.length > 0),
  "Every module must have a source-record ID",
);
assert(
  new Set(sourceRecordIds).size === catalog.modules.length,
  "Every module source-record ID must be unique",
);
assert(
  JSON.stringify([...sourceRecordIds].sort()) ===
    JSON.stringify([...mappedSourceRecordIds].sort()),
  "Catalog source-record IDs must exactly match source-map",
);
assert(
  catalog.source.sourceMap.recordCount === sourceMap.records.length,
  "Catalog source-map count is stale",
);
assert(
  catalog.source.sourceMap.sha256 ===
    createHash("sha256")
      .update(JSON.stringify(canonicalJson(sourceMap)))
      .digest("hex"),
  "Catalog source-map checksum is stale",
);

const rowCounts = Object.fromEntries(
  Object.entries(
    Object.groupBy(catalog.modules, (module) => module.row),
  ).map(([row, modules]) => [row, modules.length]),
);
assert(rowCounts.lower === 104, "Expected 104 lower variants");
assert(rowCounts.wall === 74, "Expected 74 wall variants");
assert(rowCounts.mezzanine === 22, "Expected 22 mezzanine variants");
assert(rowCounts.accessory === 25, "Expected 25 accessory variants");

const bySku = new Map(catalog.modules.map((module) => [module.sku, module]));
assert(bySku.get("НГМ 601")?.dimensionsMm.width === 600, "НГМ 601 must be 600 mm");
assert(bySku.get("НГМ 601")?.variant.frontCount === 2, "НГМ 601 must have two fronts");
assert(bySku.get("НГСП 601")?.dimensionsMm.width === 600, "НГСП 601 must be restored");
assert(!bySku.has("НГСП 950"), "НГСП 950 must not be published");
assert(bySku.has("СДВ 600"), "The hood must have unique SKU СДВ 600");
assert(bySku.has("СДСУА 450"), "The restored Aventos 450 variant is missing");
assert(
  JSON.stringify(bySku.get("СДСУА 450")?.consumptionM2) ===
    JSON.stringify({ body: 0.71, facade: 0.31, hdf: 0.29 }),
  "The restored Aventos 450 consumption values changed",
);

for (const module of catalog.modules) {
  const dimensions = Object.values(module.dimensionsMm);
  assert(
    dimensions.every((value) => Number.isFinite(value) && value > 0),
    `Invalid dimensions for ${module.sku}`,
  );
  assert(
    Object.values(module.consumptionM2).every(
      (value) => Number.isFinite(value) && value >= 0,
    ),
    `Invalid consumption for ${module.sku}`,
  );
  assert(
    Number.isFinite(module.fasteners.chargeRub) &&
      module.fasteners.chargeRub >= 0,
    `Invalid fastener charge for ${module.sku}`,
  );
  const lineTotal = module.fasteners.included.reduce(
    (sum, item) => sum + item.lineTotalRub,
    0,
  );
  assert(
    almostEqual(lineTotal, module.fasteners.chargeRub),
    `Fastener breakdown does not reconcile for ${module.sku}`,
  );
  const included = new Set(module.fasteners.included.map((item) => item.item));
  assert(
    module.fasteners.customerSupplied.every((item) => !included.has(item.item)),
    `Customer-supplied item is included in price for ${module.sku}`,
  );
  assert(
    module.review.publicationStatus === "approved" &&
      module.review.pending.length === 0,
    `Owner review is still open for ${module.sku}`,
  );
  assert(
    ["allowed", "forbidden"].includes(module.cutToWidth.policy),
    `Cut-to-width policy is unresolved for ${module.sku}`,
  );
  if (module.familyId === "false-panel") {
    assert(
      Number.isInteger(module.layoutSpanMm) &&
        module.layoutSpanMm > 0 &&
        module.layoutSpanMm === module.dimensionsMm.depth,
      `False-panel layout span must equal physical thickness for ${module.sku}`,
    );
  }
}

const hingedFrontFamilies = new Set([
  "lower-sink",
  "lower-shelf",
  "lower-removable-shelf",
  "wall-shelf",
  "wall-removable-shelf",
  "wall-drying",
]);
for (const module of catalog.modules.filter((candidate) =>
  hingedFrontFamilies.has(candidate.familyId),
)) {
  assert(
    customerSuppliedQuantity(module, "петл") === module.variant.frontCount * 2,
    `Customer-supplied hinge quantity is incomplete for ${module.sku}`,
  );
}

for (const sku of ["НГХ", "НГХФл", "НГХФп"]) {
  const module = bySku.get(sku);
  assert(module, `Missing refrigerator tall unit ${sku}`);
  for (const [itemFragment, expectedQuantity] of [
    ["пуш", 1],
    ["клок", 1],
    ["петли накладные", 2],
    ["петли для холодильника", 6],
  ]) {
    assert(
      customerSuppliedQuantity(module, itemFragment) === expectedQuantity,
      `Customer-supplied ${itemFragment} quantity is incomplete for ${sku}`,
    );
  }
}

const rates = catalog.commercialRules.rates;
assert(catalog.commercialRules.currency === "RUB", "Catalog currency changed");
for (const [rateName, approvedValue] of Object.entries(APPROVED_RATES)) {
  assert(
    almostEqual(rates[rateName], approvedValue),
    `Approved commercial rate changed: ${rateName}`,
  );
}
assert(
  catalog.commercialRules.bodyEdgingIncludedInBodyRate === true &&
    catalog.commercialRules.facadeEdgingIncludedInFacadeRate === true,
  "Approved edging inclusion changed",
);
assert(
  catalog.commercialRules.countertopIncluded === false &&
    catalog.commercialRules.assemblyIncluded === false &&
    catalog.commercialRules.customerSuppliedComponentsIncluded === false,
  "Approved exclusions changed",
);
assert(
  catalog.commercialRules.finalCustomerTotalRoundingRub === 10,
  "Approved final rounding changed",
);
assert(
  catalog.materials.body.every((material) =>
    almostEqual(material.rateRubM2, APPROVED_RATES.body_rub_m2),
  ),
  "An initial body-material rate changed",
);
assert(
  catalog.materials.facade.every((material) =>
    almostEqual(
      material.rateRubM2,
      material.id === "agt-1"
        ? APPROVED_RATES.agt_1_rub_m2
        : APPROVED_RATES.facade_rub_m2,
    ),
  ),
  "An initial facade-material rate changed",
);
assert(
  catalog.materials.hdf.length === 1 &&
    almostEqual(
      catalog.materials.hdf[0].rateRubM2,
      APPROVED_RATES.hdf_rub_m2,
    ),
  "The approved white-HDF rate changed",
);
const selectedSkus = Object.values(example.rows).flat();
const selectedModules = selectedSkus.map((sku) => {
  const module = bySku.get(sku);
  assert(module, `Reference kitchen uses unknown SKU ${sku}`);
  return module;
});
const rowWidths = Object.fromEntries(
  Object.entries(example.rows).map(([row, skus]) => [
    row,
    skus.reduce((sum, sku) => sum + bySku.get(sku).dimensionsMm.width, 0),
  ]),
);
assert(
  JSON.stringify(rowWidths) === JSON.stringify(example.expected.rowWidthMm),
  "Reference kitchen row widths changed",
);

const beforePackaging = selectedModules.reduce(
  (sum, module) =>
    sum +
    module.consumptionM2.body * rates.body_rub_m2 +
    module.consumptionM2.facade * rates.facade_rub_m2 +
    module.consumptionM2.hdf * rates.hdf_rub_m2 +
    module.fasteners.chargeRub,
  0,
);
const packaging = selectedModules.reduce(
  (sum, module) =>
    sum + module.consumptionM2.body * rates.packaging_rub_m2,
  0,
);
const exVat = beforePackaging + packaging;
const customerTotal = roundToTen(exVat * rates.customer_price_multiplier);
const includedVat = roundMoney(customerTotal * rates.included_vat_fraction);
for (const [field, approvedValue] of Object.entries(APPROVED_REFERENCE)) {
  assert(
    almostEqual(example.expected[field], approvedValue),
    `Approved reference value changed: ${field}`,
  );
}
assert(
  almostEqual(exVat, APPROVED_REFERENCE.calculatedExVatRub),
  "Calculated approved reference ex-VAT total changed",
);
assert(
  customerTotal === APPROVED_REFERENCE.customerTotalRub,
  "Calculated approved customer total changed",
);
assert(
  almostEqual(includedVat, APPROVED_REFERENCE.includedVatRub),
  "Calculated approved included-VAT amount changed",
);
const accessory = example.accessoryRegression;
const falsePanel = bySku.get(accessory.falsePanel.sku);
const plinth = bySku.get(accessory.plinth.sku);
const crown = bySku.get(accessory.crown.sku);
assert(falsePanel?.familyId === "false-panel", "Accessory example false panel is invalid");
assert(plinth?.familyId === "plinth", "Accessory example plinth is invalid");
assert(crown?.familyId === "cornice", "Accessory example crown is invalid");
assert(
  accessory.falsePanel.layoutSpanMm === falsePanel.layoutSpanMm &&
    accessory.falsePanel.layoutSpanMm === 16,
  "Accessory example false-panel span changed",
);
assert(
  almostEqual(
    accessory.falsePanel.calculatedExVatRub,
    calculatedExVat(falsePanel, rates),
  ),
  "Accessory example false-panel price changed",
);
const plinthSpans = accessory.plinth.contributingSpansMm;
const crownSpans = accessory.crown.contributingSpansMm;
assert(
  accessory.plinth.coveredRunMm ===
    plinthSpans.floorStandingFrontIncludingTallUnit +
      plinthSpans.falsePanelContinuingFrontLine +
      plinthSpans.sideReturns &&
    accessory.plinth.coveredRunMm === 5416,
  "Plinth covered-run rule changed",
);
assert(
  accessory.crown.coveredRunMm ===
    crownSpans.mezzanineFront +
      crownSpans.tallUnitTop +
      crownSpans.falsePanelContinuingFrontLine +
      crownSpans.sideReturns &&
    accessory.crown.coveredRunMm === 3300,
  "Crown covered-run rule changed",
);
for (const [label, selection, product] of [
  ["Plinth", accessory.plinth, plinth],
  ["Crown", accessory.crown, crown],
]) {
  const expectedQuantity = Math.ceil(
    selection.coveredRunMm / selection.stockPieceLengthMm,
  );
  const expectedUnitPrice = calculatedExVat(product, rates);
  assert(selection.quantity === expectedQuantity, `${label} quantity changed`);
  assert(
    selection.stockPieceLengthMm === product.dimensionsMm.width,
    `${label} stock-piece length changed`,
  );
  assert(
    almostEqual(selection.unitCalculatedExVatRub, expectedUnitPrice),
    `${label} unit price changed`,
  );
  assert(
    almostEqual(
      selection.subtotalCalculatedExVatRub,
      expectedUnitPrice * expectedQuantity,
    ),
    `${label} subtotal changed`,
  );
}

assert(almostEqual(packaging, example.expected.packagingRub), "Packaging check failed");
assert(
  almostEqual(exVat, example.expected.calculatedExVatRub),
  "Reference ex-VAT price check failed",
);
assert(
  customerTotal === example.expected.customerTotalRub,
  "Reference customer total check failed",
);
assert(
  includedVat === example.expected.includedVatRub,
  "Reference included VAT check failed",
);
assert(report.checks.moduleCount === 225, "Validation report is stale");
assert(
  report.checks.uniqueSourceRecordIdCount === 225 &&
    report.checks.sourceMapRecordCount === 225,
  "Validation report source-map counts are stale",
);
assert(report.checks.missingImageSkus.length === 0, "Some variants have no source image");
assert(
  report.pendingOwnerReviews.length === 0,
  "Owner approvals must be complete",
);
assert(
  report.pendingLaunchReviews.length === 0 &&
    catalog.commercialRules.vatDisplayAccountantApproved,
  "Accountant VAT approval must be recorded",
);

console.log(
  `Catalog check passed: ${catalog.modules.length} variants, ${catalog.families.length} families, ${sourceMap.records.length} stable source records, reference total ${customerTotal} RUB.`,
);
