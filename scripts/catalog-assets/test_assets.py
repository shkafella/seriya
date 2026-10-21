import json
import tempfile
import unittest
from pathlib import Path

from generate_schematics import generate
from inspect_basis import mtl_materials, obj_bounds, parse_obj, projected_svg, validate_dimensions


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


if __name__ == "__main__":
    unittest.main()
