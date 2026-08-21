# Living Resonance atlas source

The 4×4 source sheet was created with OpenAI's built-in ImageGen for this update. It contains, in reading order, eight mastery emblems, the synergy matrix, quick wheel, Mossvale restoration, Rehearsal Hall, Skyglass restoration, Moonwake restoration, rehearsal challenge, and Encore Adventure.

The production cleanup edit asked ImageGen to preserve all sixteen original fantasy-RPG icons and their cell order while removing colored background contamination, edge spill, checkerboards, frames, labels, and text, with true alpha transparency outside each silhouette. A follow-up explicitly restored straight RGBA transparency after an intermediate edit flattened the alpha channel.

Files:

- `living-resonance-atlas-source.png`: original generated atlas.
- `living-resonance-atlas-imagegen-cleaned.png`: corrected transparent ImageGen edit.
- `living-resonance-atlas-cleaned.png`: deterministic low-alpha color-spill cleanup used by the build.
- `../../ui/living-resonance/manifest.json`: runtime mapping and dimensions.

Rebuild the 16 lossless 256×256 WebP assets with:

```text
python tools/build_living_resonance_assets.py assets/masters/living-resonance/living-resonance-atlas-imagegen-cleaned.png assets/ui/living-resonance assets/ui/living-resonance/manifest.json --clean-master assets/masters/living-resonance/living-resonance-atlas-cleaned.png
```

The script clears effectively invisible generator chroma before Lanczos resampling, alpha-trims each normalized cell, adds consistent transparent padding, and records every export in the manifest.
