# V2.2 integrated character assets

The runtime character presentation uses original HIGH NOTES pixel art generated for this repository and processed locally into transparent PNG sheets.

## Integrated instrument sheets

`assets/sprites/runtime/hero-instrument-*.png` contains one 4 × 4 sheet for each playable instrument: guitar, bass, synth, drums, microphone and violin. Columns are south, north, west and east. Rows are idle, walk, attack and dash. Every frame includes the character's hands and instrument as one authored silhouette; `game.js` therefore does not draw the legacy floating attachment when one of these sheets is available.

The original chroma-key masters are preserved in `assets/masters/v2.2/`. Runtime mappings are recorded in `assets/sprites/runtime/hero-instrument-manifest.json`.

## Directional customization

`hero-hair-directions.png` is a 4 × 4 transparent overlay atlas. Columns are Tuned Tuft, Echo Braid, Riff Crest and Moss Cap; rows are south, north, west and east. `character-runtime.js` registers each style to measured head anchors for all four animation rows and four directions, so creator previews, walking, attacks and dashes use the same attached silhouette. The shared table was measured across all six integrated instrument sheets; it replaces the former fixed world-space hair position that could leave a second hairstyle floating beside the hero.

The runtime combines this atlas with the four body palettes, five outfit palettes and six accent palettes at draw time. Together with six instruments this supports 2,880 deliberately connected appearance/instrument combinations without shipping 24 duplicate full-character sheets.

All assets are text-free, use transparent runtime backgrounds, and are kept out of the production-sprite manifest because the player renderer lazy-loads only the currently equipped instrument sheet.
