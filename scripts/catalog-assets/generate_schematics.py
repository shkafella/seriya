"""Generate deterministic, Seriya-owned development schematics for catalog families."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path


def schematic(family: dict) -> bytes:
    key = family["id"]
    name = html.escape(family["publicName"])
    row = family["row"]
    body_y, body_h = (110, 330) if row == "lower" else ((70, 260) if row == "wall" else ((45, 180) if row == "mezzanine" else (185, 120)))
    accent = {"lower": "#4f6b5a", "wall": "#687a9a", "mezzanine": "#927757", "accessory": "#866b72"}[row]
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 520" role="img" aria-labelledby="title desc">
  <title id="title">{name}</title>
  <desc id="desc">Схематичное изображение семейства серийной кухонной мебели</desc>
  <rect width="640" height="520" rx="32" fill="#f5f1e8"/>
  <rect x="130" y="{body_y}" width="380" height="{body_h}" rx="8" fill="#fffdf8" stroke="#2f342f" stroke-width="6"/>
  <path d="M320 {body_y}V{body_y + body_h}" stroke="#2f342f" stroke-width="4"/>
  <rect x="153" y="{body_y + 24}" width="144" height="12" rx="6" fill="{accent}"/>
  <rect x="343" y="{body_y + 24}" width="144" height="12" rx="6" fill="{accent}"/>
  <path d="M90 470H550" stroke="#b4aa98" stroke-width="4" stroke-linecap="round"/>
  <text x="320" y="495" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#343833">Серийка · {html.escape(key)}</text>
</svg>
'''
    return svg.encode("utf-8")


def generate(seed_path: Path, output_dir: Path, manifest_path: Path) -> dict:
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    output_dir.mkdir(parents=True, exist_ok=True)
    assets = []
    for family in sorted(seed["families"], key=lambda item: item["id"]):
        content = schematic(family)
        checksum = hashlib.sha256(content).hexdigest()
        filename = f'{family["id"]}-{checksum[:12]}.svg'
        (output_dir / filename).write_bytes(content)
        assets.append({
            "familyKey": family["id"],
            "publicPath": f"/catalog/{filename}",
            "derivedChecksum": checksum,
            "status": "DEVELOPMENT",
            "rightsApproved": True,
            "productionApproved": False,
            "provenance": {"kind": "seriya-owned-schematic", "generatorVersion": 1},
            "geometry": {"viewBox": [0, 0, 640, 520]},
            "masks": {"body": "cabinet", "facade": "doors"},
        })
    manifest = {"schemaVersion": 1, "assets": assets}
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    manifest = generate(args.seed, args.output, args.manifest)
    print(json.dumps({"families": len(manifest["assets"]), "manifest": str(args.manifest)}))


if __name__ == "__main__":
    main()
