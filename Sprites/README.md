# HIGH NOTES: Echoes of Mossvale — Production Sprites

This library is the engine-ready character and creature art contract for the game. Source masters remain in `_Masters/`; production sheets are transparent PNGs in the requested hierarchy.

## Standard sheet contract

- 12 columns; 26 rows.
- NPC/enemy frames: 64×64 px.
- Elite frames: 96×96 px.
- Boss/miniboss frames: 128×128 px.
- Odin frames: 80×80 px.
- Nearest-neighbour filtering, lossless compression, no trimming, pivot/origin 0.5 × 0.92.
- Every character folder contains its PNG plus a JSON manifest with exact frame rectangles, timing, loop flags, origin, sampled palette, shadow row and portrait paths.

| Rows | Animation | Frames |
|---:|---|---:|
| 0–3 | Idle south, north, east, west | 4 each |
| 4–7 | Walk south, north, east, west | 8 each |
| 8–11 | Run south, north, east, west | 8 each |
| 12 | Hurt | 4 |
| 13 | Attack A | 8 |
| 14 | Attack B | 8 |
| 15 | Unique death profile | 12 |
| 16 | Special ability | 8 |
| 17 | Stunned loop | 4 |
| 18 | Spawn | 8 |
| 19 | Matching shadow | 1 |
| 20–25 | Neutral, happy, angry, surprised, sad, talking portraits | 1 each |

Odin additionally has `Companions/Odin/odin-expanded-actions-sheet.png`, containing 18 separately timed eight-frame-or-shorter animations for sleep, sit, roll, happy, excited, eat, drink, dig, sniff, play, guard, growl, attack, dash, carry item, celebrate, petting reaction and spirit howl.

## Engine import

- **HTML5 Canvas / PixiJS / Phaser:** load the per-character JSON, create frames from each `animations.*.frames` rectangle, and use `frameDurationMs`.
- **Godot:** import with Filter off, Mipmaps off, Lossless compression; use `frame.width` and `frame.height` in SpriteFrames.
- **Unity:** Sprite Mode Multiple, Pixels Per Unit to match the game camera, Filter Mode Point, Compression None; slice by the manifest frame size and set the pivot to the supplied origin.

## Palette and effects

`palette.json` and `UI/mossvale-palette.png` define the reusable world anchors. Each character manifest also includes an eight-colour sampled ramp from its actual artwork. `Effects/combat-effects-sheet.png` supplies shared slash, leaf, root, spore, crystal, lightning, tide and resonance animation families.

## Source and transparency

New raster masters were created with OpenAI's built-in ImageGen on a flat chroma background and processed locally into alpha-safe transparent PNGs. Existing shipped character and enemy art was retained where it already provided a distinct high-quality identity. The generated sources, transparent masters and final sheets are all preserved; there is no destructive overwrite of the runtime atlas.
