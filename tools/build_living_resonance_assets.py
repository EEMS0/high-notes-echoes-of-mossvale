#!/usr/bin/env python3
"""Slice and optimize the approved Living Resonance ImageGen atlas.

The source atlas is a transparent 4x4 sheet whose 1254 px dimensions are not
evenly divisible by four.  Boundaries are therefore rounded from normalized
coordinates, then each non-empty cell is alpha-trimmed and centered on a square
runtime canvas.  This keeps silhouettes consistently sized without allowing a
neighbouring cell to bleed into the export.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


ASSETS = (
    ("mastery-lead-line", "Lead Line mastery path emblem", 0, 0),
    ("mastery-power-chord", "Power Chord mastery path emblem", 0, 1),
    ("mastery-deep-roots", "Deep Roots mastery path emblem", 0, 2),
    ("mastery-counterpoint", "Counterpoint mastery path emblem", 0, 3),
    ("mastery-harmonic-field", "Harmonic Field mastery path emblem", 1, 0),
    ("mastery-returning-echo", "Returning Echo mastery path emblem", 1, 1),
    ("mastery-breakbeat", "Breakbeat mastery path emblem", 1, 2),
    ("mastery-afterimage", "Afterimage mastery path emblem", 1, 3),
    ("synergy-matrix", "Class and instrument synergy overview", 2, 0),
    ("quick-wheel", "Quick-wheel and loadout navigation", 2, 1),
    ("restoration-mossvale", "Mossvale restoration identity", 2, 2),
    ("rehearsal-hall", "Boss Rehearsal Hall identity", 2, 3),
    ("restoration-skyglass", "Skyglass restoration identity", 3, 0),
    ("restoration-moonwake", "Moonwake restoration identity", 3, 1),
    ("rehearsal-challenge", "Rehearsal challenge arrangement badge", 3, 2),
    ("encore-adventure", "Encore Adventure identity", 3, 3),
)


def normalized_band(edge: int, extent: int) -> int:
    return round(edge * extent / 4)


def remove_transparent_color_spill(image: Image.Image, cutoff: int = 12) -> Image.Image:
    """Zero RGB in effectively invisible generator pixels before resampling.

    Some PNG viewers expose RGB stored under alpha 1-3, and straight-alpha
    Lanczos sampling can pull that hidden chroma into an otherwise clean edge.
    Pixels below the cutoff are visually absent, so clearing them is lossless at
    runtime scale and prevents cyan/red fringe blocks in WebP decoders.
    """
    cleaned = image.convert("RGBA")
    cleaned.putdata([
        (r, g, b, a) if a >= cutoff else (0, 0, 0, 0)
        for r, g, b, a in cleaned.getdata()
    ])
    return cleaned


def export_cell(source: Image.Image, row: int, col: int, output: Path) -> dict:
    cell = source.crop(
        (
            normalized_band(col, source.width),
            normalized_band(row, source.height),
            normalized_band(col + 1, source.width),
            normalized_band(row + 1, source.height),
        )
    )
    alpha_box = cell.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"Atlas cell {row},{col} contains no visible pixels")
    cell = cell.crop(alpha_box)
    square_edge = max(cell.width, cell.height)
    padding = max(10, round(square_edge * 0.055))
    square = Image.new("RGBA", (square_edge + padding * 2,) * 2, (0, 0, 0, 0))
    square.alpha_composite(cell, ((square.width - cell.width) // 2, (square.height - cell.height) // 2))
    runtime = remove_transparent_color_spill(
        square.resize((256, 256), Image.Resampling.LANCZOS), cutoff=8
    )
    runtime.save(output, "WEBP", lossless=True, method=6)
    alpha = runtime.getchannel("A")
    return {
        "width": runtime.width,
        "height": runtime.height,
        "alphaMin": alpha.getextrema()[0],
        "alphaMax": alpha.getextrema()[1],
        "bytes": output.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    parser.add_argument("runtime_dir", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--clean-master", type=Path)
    args = parser.parse_args()

    source = remove_transparent_color_spill(Image.open(args.atlas).convert("RGBA"))
    if source.getchannel("A").getextrema() != (0, 255):
        raise ValueError("Source atlas must contain both transparent and opaque pixels")
    args.runtime_dir.mkdir(parents=True, exist_ok=True)
    if args.clean_master:
        args.clean_master.parent.mkdir(parents=True, exist_ok=True)
        source.save(args.clean_master, "PNG", optimize=True)

    manifest_assets = []
    for asset_id, usage, row, col in ASSETS:
        output = args.runtime_dir / f"{asset_id}.webp"
        metadata = export_cell(source, row, col, output)
        manifest_assets.append(
            {
                "id": asset_id,
                "usage": usage,
                "runtimePath": f"assets/ui/living-resonance/{output.name}",
                "sourceCell": {"row": row, "column": col},
                **metadata,
            }
        )

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "source": "assets/masters/living-resonance/living-resonance-atlas-cleaned.png",
                "sourceDimensions": {"width": source.width, "height": source.height},
                "generator": "OpenAI built-in ImageGen; deterministic crop/optimization via Pillow",
                "assets": manifest_assets,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
