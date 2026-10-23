"""Assemble a production-only catalog asset package from approved inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from copy import deepcopy
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("assets"), list):
        raise ValueError(f"Unsupported asset manifest: {path}")
    keys = [asset.get("familyKey") for asset in manifest["assets"]]
    if any(not isinstance(key, str) or not key for key in keys) or len(keys) != len(set(keys)):
        raise ValueError(f"Invalid or duplicate family keys in {path}")
    return manifest


def asset_file(directory: Path, asset: dict) -> Path:
    public_path = asset.get("publicPath")
    if not isinstance(public_path, str) or not public_path.startswith("/catalog/"):
        raise ValueError(f"Invalid public asset path for {asset.get('familyKey')}")
    filename = public_path.removeprefix("/catalog/")
    if not filename or Path(filename).name != filename or not filename.endswith(".svg"):
        raise ValueError(f"Only catalog SVG files are allowed: {public_path}")
    path = directory / filename
    if not path.is_file() or sha256(path) != asset.get("derivedChecksum"):
        raise ValueError(f"Missing or mismatched asset bytes for {asset.get('familyKey')}")
    return path


def build_package(
    schematic_manifest_path: Path,
    schematic_directory: Path,
    basis_manifest_path: Path,
    basis_directory: Path,
    output_directory: Path,
) -> dict:
    schematic_manifest = read_manifest(schematic_manifest_path)
    basis_manifest = read_manifest(basis_manifest_path)
    schematic_by_key = {asset["familyKey"]: asset for asset in schematic_manifest["assets"]}
    basis_by_key = {asset["familyKey"]: asset for asset in basis_manifest["assets"]}
    unknown = sorted(set(basis_by_key) - set(schematic_by_key))
    if unknown:
        raise ValueError(f"Basis assets reference unknown catalog families: {','.join(unknown)}")
    if len(basis_by_key) < 6:
        raise ValueError(f"Expected at least six approved Basis assets, received {len(basis_by_key)}")
    if output_directory.exists() and any(output_directory.iterdir()):
        raise ValueError(f"Production output directory must be empty: {output_directory}")
    output_directory.mkdir(parents=True, exist_ok=True)

    production_assets = []
    for family_key in sorted(schematic_by_key):
        basis = basis_by_key.get(family_key)
        if basis is not None:
            if not (
                basis.get("status") == "APPROVED"
                and basis.get("rightsApproved") is True
                and basis.get("productionApproved") is True
                and isinstance(basis.get("sourceChecksum"), str)
                and len(basis["sourceChecksum"]) == 64
            ):
                raise ValueError(f"Basis asset is not production-approved: {family_key}")
            selected = deepcopy(basis)
            source = asset_file(basis_directory, selected)
        else:
            selected = deepcopy(schematic_by_key[family_key])
            if selected.get("provenance", {}).get("kind") != "seriya-owned-schematic":
                raise ValueError(f"Neutral fallback is not Seriya-owned: {family_key}")
            if selected.get("rightsApproved") is not True:
                raise ValueError(f"Neutral fallback rights are not approved: {family_key}")
            selected.update({
                "sourceChecksum": selected["derivedChecksum"],
                "status": "APPROVED",
                "rightsApproved": True,
                "productionApproved": True,
            })
            source = asset_file(schematic_directory, selected)
        destination = output_directory / source.name
        shutil.copyfile(source, destination)
        production_assets.append(selected)

    manifest = {"schemaVersion": 1, "assets": production_assets}
    (output_directory / "manifest.production.v1.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schematic-manifest", type=Path, required=True)
    parser.add_argument("--schematic-directory", type=Path, required=True)
    parser.add_argument("--basis-manifest", type=Path, required=True)
    parser.add_argument("--basis-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = build_package(
        args.schematic_manifest,
        args.schematic_directory,
        args.basis_manifest,
        args.basis_directory,
        args.output,
    )
    print(json.dumps({"productionAssets": len(manifest["assets"]), "output": str(args.output)}))


if __name__ == "__main__":
    main()
