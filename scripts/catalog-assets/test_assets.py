import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from build_production_package import build_package
from generate_schematics import generate
from inspect_basis import MAX_DERIVED_ASSET_BYTES, mtl_materials, obj_bounds, parse_obj, projected_svg, validate_dimensions


class AssetPipelineTests(unittest.TestCase):
    def test_production_package_uses_six_approved_basis_assets_and_owned_fallbacks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            schematic_dir = root / "schematics"
            basis_dir = root / "basis"
            output = root / "production"
            schematic_dir.mkdir()
            basis_dir.mkdir()
            schematic_assets = []
            basis_assets = []
            for index in range(1, 8):
                family_key = f"family-{index}"
                schematic_bytes = f"<svg><title>{family_key}</title></svg>".encode()
                schematic_checksum = hashlib.sha256(schematic_bytes).hexdigest()
                schematic_name = f"{family_key}-{schematic_checksum[:12]}.svg"
                (schematic_dir / schematic_name).write_bytes(schematic_bytes)
                schematic_assets.append({
                    "familyKey": family_key,
                    "publicPath": f"/catalog/{schematic_name}",
                    "derivedChecksum": schematic_checksum,
                    "status": "DEVELOPMENT",
                    "rightsApproved": True,
                    "productionApproved": False,
                    "provenance": {"kind": "seriya-owned-schematic"},
                })
                if index <= 6:
                    basis_bytes = f"<svg><title>basis-{family_key}</title></svg>".encode()
                    basis_checksum = hashlib.sha256(basis_bytes).hexdigest()
                    basis_name = f"{family_key}-{basis_checksum[:12]}.svg"
                    (basis_dir / basis_name).write_bytes(basis_bytes)
                    basis_assets.append({
                        "familyKey": family_key,
                        "publicPath": f"/catalog/{basis_name}",
                        "sourceChecksum": hashlib.sha256(f"source-{family_key}".encode()).hexdigest(),
                        "derivedChecksum": basis_checksum,
                        "status": "APPROVED",
                        "rightsApproved": True,
                        "productionApproved": True,
                        "provenance": {"kind": "basis-obj-derived"},
                    })
            schematic_manifest = root / "schematics.json"
            basis_manifest = root / "basis.json"
            schematic_manifest.write_text(json.dumps({"schemaVersion": 1, "assets": schematic_assets}), encoding="utf-8")
            basis_manifest.write_text(json.dumps({"schemaVersion": 1, "assets": basis_assets}), encoding="utf-8")

            production = build_package(schematic_manifest, schematic_dir, basis_manifest, basis_dir, output)

            self.assertEqual(len(production["assets"]), 7)
            self.assertTrue(all(asset["productionApproved"] for asset in production["assets"]))
            fallback = next(asset for asset in production["assets"] if asset["familyKey"] == "family-7")
            self.assertEqual(fallback["sourceChecksum"], fallback["derivedChecksum"])
            self.assertEqual(len(list(output.glob("*.svg"))), 7)

    def test_basis_fixture_family_keys_exist_in_catalog_seed(self):
        repository = Path(__file__).resolve().parents[2]
        fixtures = json.loads((repository / "scripts/catalog-assets/basis-fixtures.v1.json").read_text(encoding="utf-8"))
        seed = json.loads((repository / "catalog/seed/catalog.v1.json").read_text(encoding="utf-8"))
        family_keys = {family["id"] for family in seed["families"]}

        unknown = sorted(
            fixture["familyKey"]
            for fixture in fixtures["fixtures"]
            if fixture["familyKey"] not in family_keys
        )

        self.assertEqual(unknown, [])

    def test_schematics_are_deterministic_and_content_hashed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            seed = root / "seed.json"
            seed.write_text(json.dumps({"families": [{"id": "lower-shelf", "publicName": "Шкаф", "row": "lower"}]}), encoding="utf-8")
            first = generate(seed, root / "public", root / "manifest.json")
            first_bytes = (root / "manifest.json").read_bytes()
            second = generate(seed, root / "public", root / "manifest.json")
            self.assertEqual(first, second)
            self.assertEqual(first_bytes, (root / "manifest.json").read_bytes())
            self.assertRegex(first["assets"][0]["publicPath"], r"lower-shelf-[a-f0-9]{12}\.svg$")

    def test_obj_bounds_and_materials(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            obj = root / "sample.obj"
            obj.write_text("v 0 0 0\nv 10 0 0\nv 10 20 30\nusemtl ЛДСП Технический\nf 1 2 3\n", encoding="utf-8")
            mtl = root / "sample.mtl"
            mtl.write_text("newmtl ЛДСП Технический\nnewmtl AGT Технический\n", encoding="utf-8")
            self.assertEqual(obj_bounds(obj)["size"], [10.0, 20.0, 30.0])
            self.assertEqual(mtl_materials(mtl), ["AGT Технический", "ЛДСП Технический"])
            model = parse_obj(obj)
            validate_dimensions(model["bounds"]["size"], [10, 20, 30], 0.01, "sample")
            svg = projected_svg(model, {"id": "sample"}, {"body": "ЛДСП Технический", "facade": "AGT Технический"})
            self.assertIn(b'data-semantic="body"', svg)
            self.assertIn(b"M", svg)

    def test_projection_discards_internal_geometry_and_stays_phone_sized(self):
        vertices = [
            (0.0, 0.0, 0.0), (600.0, 0.0, 0.0), (600.0, 880.0, 0.0), (0.0, 880.0, 0.0),
            (10.0, 10.0, 10.0), (590.0, 10.0, 10.0), (590.0, 870.0, 10.0), (10.0, 870.0, 10.0),
            (100.0, 100.0, 300.0), (110.0, 100.0, 300.0), (105.0, 110.0, 300.0),
        ]
        model = {
            "vertices": vertices,
            "faces": [
                {"material": "body-mat", "indices": [0, 1, 2, 3]},
                {"material": "facade-mat", "indices": [4, 5, 6, 7]},
                *({"material": "fastener", "indices": [8, 9, 10]} for _ in range(5000)),
            ],
            "bounds": {"min": [0.0, 0.0, 0.0], "size": [600.0, 880.0, 300.0]},
        }

        svg = projected_svg(model, {"id": "complex"}, {"body": "body-mat", "facade": "facade-mat"})

        self.assertEqual(svg.count(b"<path "), 2)
        self.assertIn(b'data-semantic="body"', svg)
        self.assertIn(b'data-semantic="facade"', svg)
        self.assertNotIn(b"fastener", svg)
        self.assertLess(len(svg), MAX_DERIVED_ASSET_BYTES)


if __name__ == "__main__":
    unittest.main()
