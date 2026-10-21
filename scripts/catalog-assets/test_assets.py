import json
import tempfile
import unittest
from pathlib import Path

from generate_schematics import generate
from inspect_basis import MAX_DERIVED_ASSET_BYTES, mtl_materials, obj_bounds, parse_obj, projected_svg, validate_dimensions


class AssetPipelineTests(unittest.TestCase):
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
