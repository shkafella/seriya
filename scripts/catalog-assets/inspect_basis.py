"""Validate and convert private Basis OBJ packages without committing raw inputs."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
from pathlib import Path

SOURCE_EXTENSIONS = {".obj", ".mtl", ".xml", ".pdf", ".b3d"}
MAX_DERIVED_ASSET_BYTES = 64 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_obj(path: Path) -> dict:
    vertices: list[tuple[float, float, float]] = []
    faces: list[dict] = []
    material = "unassigned"
    with path.open(encoding="utf-8", errors="replace") as stream:
        for raw_line in stream:
            line = raw_line.strip()
            if line.startswith("v "):
                parts = line.split()
                if len(parts) >= 4:
                    vertices.append(tuple(float(value) for value in parts[1:4]))
            elif line.startswith("usemtl "):
                material = line.split(maxsplit=1)[1].strip()
            elif line.startswith("f "):
                indices = []
                for token in line.split()[1:]:
                    index = int(token.split("/", 1)[0])
                    indices.append(index - 1 if index > 0 else len(vertices) + index)
                if len(indices) >= 3 and all(0 <= index < len(vertices) for index in indices):
                    faces.append({"material": material, "indices": indices})
    if not vertices or not faces:
        raise ValueError(f"OBJ vertices and faces are required in {path}")
    minimum = [min(point[index] for point in vertices) for index in range(3)]
    maximum = [max(point[index] for point in vertices) for index in range(3)]
    size = [maximum[index] - minimum[index] for index in range(3)]
    if not all(math.isfinite(value) and value > 0 for value in size):
        raise ValueError(f"Invalid OBJ bounds in {path}")
    return {
        "vertices": vertices,
        "faces": faces,
        "bounds": {"min": minimum, "max": maximum, "size": size, "vertexCount": len(vertices), "faceCount": len(faces)},
    }


def obj_bounds(path: Path) -> dict:
    return parse_obj(path)["bounds"]


def mtl_materials(path: Path) -> list[str]:
    return sorted(line.split(maxsplit=1)[1].strip() for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.startswith("newmtl "))


def validate_dimensions(actual: list[float], expected: list[float], tolerance: float, fixture_id: str) -> None:
    if len(expected) != 3 or any(abs(actual[index] - expected[index]) > tolerance for index in range(3)):
        raise ValueError(f"Nominal dimensions mismatch for {fixture_id}: actual={actual}, expected={expected}, tolerance={tolerance}")


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    unique = sorted(set(points))
    if len(unique) <= 2:
        return unique

    def cross(origin: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])

    lower: list[tuple[float, float]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def projected_svg(model: dict, fixture: dict, masks: dict[str, str]) -> bytes:
    vertices = model["vertices"]
    bounds = model["bounds"]
    minimum = bounds["min"]
    size = bounds["size"]
    width, height = 900.0, 900.0
    padding = 35.0
    scale = min((width - padding * 2) / size[0], (height - padding * 2) / size[1])

    def point(index: int) -> tuple[float, float]:
        x, y, _ = vertices[index]
        return padding + (x - minimum[0]) * scale, height - padding - (y - minimum[1]) * scale

    groups: dict[str, set[int]] = {"body": set(), "facade": set()}
    for face in model["faces"]:
        semantic = next((name for name, mapped in masks.items() if face["material"] == mapped), None)
        if semantic in groups:
            groups[semantic].update(face["indices"])

    colors = {"body": "#d8d2c7", "facade": "#ede9df"}
    paths = []
    for semantic in ("body", "facade"):
        hull = convex_hull([point(index) for index in groups[semantic]])
        if len(hull) < 3:
            continue
        command = "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in hull) + " Z"
        paths.append(
            f'<path id="mask-{semantic}" d="{command}" '
            f'fill="{colors[semantic]}" stroke="#383b37" stroke-width="2"/>'
        )
    title = html.escape(fixture["id"])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" role="img" aria-labelledby="title">\n'
            f'<title id="title">Basis projection {title}</title>\n{"\n".join(paths)}\n</svg>\n').encode("utf-8")


def inspect(source: Path, manifest_path: Path, output: Path) -> dict:
    config = json.loads(manifest_path.read_text(encoding="utf-8"))
    results = []
    assets = []
    output.mkdir(parents=True, exist_ok=True)
    for fixture in config["fixtures"]:
        directory = source / fixture["directory"]
        if not directory.is_dir():
            raise FileNotFoundError(directory)
        files = sorted((item for item in directory.iterdir() if item.suffix.lower() in SOURCE_EXTENSIONS), key=lambda item: item.name.lower())
        obj = next((item for item in files if item.suffix.lower() == ".obj"), None)
        mtl = next((item for item in files if item.suffix.lower() == ".mtl"), None)
        if not obj or not mtl:
            raise ValueError(f"OBJ and MTL are required in {directory}")
        model = parse_obj(obj)
        expected = fixture["expectedDimensionsMm"]
        tolerance = float(fixture.get("dimensionToleranceMm", 1.0))
        validate_dimensions(model["bounds"]["size"], expected, tolerance, fixture["id"])
        materials = mtl_materials(mtl)
        resolved_mapping = {}
        for semantic in ("body", "facade"):
            fragment = fixture["materialMapping"][semantic]
            resolved = next((material for material in materials if fragment in material), None)
            if not resolved:
                raise ValueError(f"Missing {semantic} material mapping in {directory}")
            resolved_mapping[semantic] = resolved
        if not all(any(face["material"] == material for face in model["faces"]) for material in resolved_mapping.values()):
            raise ValueError(f"Mapped materials have no OBJ faces in {directory}")
        sources = [{"name": item.name, "sha256": sha256(item)} for item in files]
        source_checksum = hashlib.sha256(json.dumps(sources, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        svg = projected_svg(model, fixture, resolved_mapping)
        if len(svg) > MAX_DERIVED_ASSET_BYTES:
            raise ValueError(f'Derived asset exceeds {MAX_DERIVED_ASSET_BYTES} bytes for {fixture["id"]}: {len(svg)}')
        derived_checksum = hashlib.sha256(svg).hexdigest()
        filename = f'{fixture["familyKey"]}-{derived_checksum[:12]}.svg'
        (output / filename).write_bytes(svg)
        rights_approved = fixture["rightsStatus"] == "approved"
        record = {
            "fixtureId": fixture["id"], "familyKey": fixture["familyKey"], "rightsStatus": fixture["rightsStatus"],
            "sources": sources, "sourceChecksum": source_checksum, "bounds": model["bounds"],
            "nominalDimensionsMm": expected, "dimensionToleranceMm": tolerance,
            "placementAnchor": fixture["placementAnchor"], "materials": materials, "masks": resolved_mapping,
            "output": filename, "derivedChecksum": derived_checksum,
        }
        results.append(record)
        assets.append({
            "familyKey": fixture["familyKey"], "publicPath": f"/catalog/{filename}",
            "sourceChecksum": source_checksum, "derivedChecksum": derived_checksum,
            "status": "APPROVED" if rights_approved else "DEVELOPMENT",
            "rightsApproved": rights_approved, "productionApproved": rights_approved,
            "provenance": {"kind": "basis-obj-derived", "converterVersion": 3, "fixtureId": fixture["id"], "sources": sources},
            "geometry": {"nominalDimensionsMm": expected, "actualDimensionsMm": model["bounds"]["size"], "dimensionToleranceMm": tolerance, "placementAnchor": fixture["placementAnchor"], "vertexCount": model["bounds"]["vertexCount"], "faceCount": model["bounds"]["faceCount"], "derivedBytes": len(svg), "semanticContourCount": svg.count(b"<path ")},
            "masks": resolved_mapping,
        })
    report = {"schemaVersion": 2, "fixtures": results}
    (output / "basis-inspection.v2.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    (output / "manifest.basis.v1.json").write_text(json.dumps({"schemaVersion": 1, "assets": assets}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = inspect(args.source, args.fixtures, args.output)
    print(json.dumps({"fixtures": len(report["fixtures"]), "output": str(args.output)}))


if __name__ == "__main__":
    main()
