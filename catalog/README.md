# Catalog source package

This directory contains the normalized, owner-approved Stage 1 import package. PostgreSQL is the runtime source of truth; the application never serves this JSON directly.

## Files

- `seed/catalog.v1.json` contains 225 approved variants, commercial inputs, normalized fastener charges, source traceability, and cut-to-width policy.
- `seed/catalog.v1.report.json` contains reconciliation counts, applied corrections, conflicting fastener rates, and launch prerequisites.
- `source-map.v1.json` assigns one immutable source-record ID to every approved spreadsheet or derived record.
- `examples/reference-kitchen.v1.json` is the deterministic 2700 mm reference kitchen and test lead, including the false-panel, plinth, and crown regression calculation.
- `OWNER_REVIEW.md` records the owner's approved decisions and the remaining external launch prerequisite.

The live Google Sheet is the catalog source of record. The four supplied Excel workbooks provide fastener lists and costs. The generator preserves the original sheet, row, name, SKU, file hashes, and immutable source-record ID. A one-field SKU rename or row move keeps the existing ID; simultaneous rename-and-move requires an explicit locator update in `source-map.v1.json`, so identity cannot silently change. New records require the explicit `--allow-new-source-records` flag once the source map exists. The generator excludes every component marked `Покупают сами` from the charge and uses the highest observed unit rate when included fastener prices conflict.

The generated catalog is marked `approved_stage_1`. The owner approved the three corrected sequences, the restored 450 mm Aventos consumption, the public family names, and cut-to-width for every module outside the explicit forbidden families. The accountant approved the customer-facing VAT calculation and wording on 21 October 2026.

## Regeneration

Install Python 3.11 or newer and `openpyxl`, then run. The repository wrapper finds a normal Python installation, `SERIYA_PYTHON`, or the bundled Codex runtime:

```powershell
bun scripts/run-python.mjs scripts/catalog/build-seed.py `
  --catalog "path/to/Кухо.xlsx" `
  --hardware "path/to/Антресоль.xlsx" `
  --hardware "path/to/Корона, Цоколь и Фальш панели.xlsx" `
  --hardware "path/to/Нижний ряд ГОЛА.xlsx" `
  --hardware "path/to/Средний ряд дно короче.xlsx" `
  --source-map catalog/source-map.v1.json `
  --output catalog/seed/catalog.v1.json `
  --report catalog/seed/catalog.v1.report.json `
  --example catalog/examples/reference-kitchen.v1.json
```

Run `bun run test:catalog` after every regeneration. It verifies immutable source identity, generated counts, approved commercial rules, accessory spans, quantities, and reference prices.

## Stage 2 import and publication

With `DATABASE_URL` configured, run `bun run --cwd backend catalog:preview` and inspect `.scratch/catalog-import.preview.json`, then run `bun run --cwd backend catalog:apply`. Preview never mutates catalog rows; apply revalidates the source checksum and database revision under a PostgreSQL lock. An identical re-import keeps database IDs stable.

`bun run catalog:assets` generates deterministic development schematics and `bun run --cwd backend catalog:assets sync` binds them to the families without ever downgrading an approved production record. Raw Basis/OBJ/B3D packages stay under `.scratch`; `bun run catalog:assets:fixtures` parses their real faces/materials, validates nominal dimensions and placement anchors, reduces the source mesh to at most one front-elevation contour per semantic body/facade mask (discarding internal fittings), enforces a 64 KiB mobile asset budget, and produces a candidate manifest for the six private examples without publishing them. The server repeats the size gate for every manifest asset. Production activation remains blocked until a complete 25-family manifest and every referenced file pass provenance, rights, checksum, size, and database checks.

Owner identity is created server-side with `OWNER_EMAIL`, `OWNER_PASSWORD`, and `bun run --cwd backend catalog:owner -- bootstrap`. Use `recover` to rotate the owner's credentials and revoke all sessions. Prepare/export/begin/mark-application/activate/verify/recover commands live under `bun run --cwd backend catalog:release -- ...`; activation requires a recent SHA-256 backup receipt for the exact target database.
