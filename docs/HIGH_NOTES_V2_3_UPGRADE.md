# HIGH NOTES schema-23 presentation and story upgrade

This document describes the menu-dismissal, mobile-action, starter-class, and four-region story systems introduced with save schema 23. The browser runtime remains dependency-free and all paths remain relative for GitHub Pages subpath hosting.

## Shared overlay dismissal

Full-screen overlays opt into one of two policies with `data-backdrop-dismiss`:

- `true` closes only the topmost visible overlay when both pointer down and pointer up land on that overlay's backdrop.
- `protected` keeps the overlay open, announces why an explicit choice is required, and gives the card a brief reduced-motion-safe pulse.

The delegated handler lives in `game.js`; new screens should use an existing close function rather than add another pointer listener. It tracks pointer IDs, rejects inside-to-outside and outside-to-inside drags, suppresses the synthetic click that can follow a touch release, clears held gameplay inputs, and restores focus to the exact opener where possible. Nested feature screens return to Pause, while the chord replay panel returns to the Map. Dialogue, character creation, the composer, the ending, native reset/skip confirmations, and an active Stock Battle remain protected.

## Mobile action state

The campaign action pad uses the same combat and interaction functions as keyboard and gamepad input. Each pointer is tracked independently so movement, right-side first-person look, a held guard or charged attack, and a momentary action can coexist. Pointer cancellation, blur, visibility loss, orientation changes, pause/dialogue/menu opening, and first-person deactivation clear all held state.

The six contextual actions are Attack, Block, Dodge, Echo Pulse, Class Ability, and Interact. Their buttons expose pressed, held, charging, cooling down, ready, unavailable, and perfect-guard states. Progress rings are updated from live combat timers rather than the cached HUD signature. Interact changes its visible verb and accessible name to actions such as TALK, ENTER, TUNE, JOIN, PLAY, LISTEN, or PICK UP.

Settings include:

- Normal or Mirrored touch layout.
- Mobile haptics, using guarded `navigator.vibrate()` calls after touch interaction only.
- Standard, Forgiving, or Relaxed chord timing.

Short landscape layouts preserve a minimum 44 CSS-pixel action target and account for all four safe-area insets. Portrait gameplay shows rotation guidance, but title and modal workflows remain usable in portrait.

## Starter classes

Classes are campaign-only modifiers. They never restrict instruments and are not read by Stock Battle.

| Class | Passive | Signature ability | Cooldown |
| --- | --- | --- | --- |
| Riffblade | Charged attacks build 12% faster and rhythm-combo grace drains 10% more slowly. | **Resonant Cleave:** a compact, one-damage forward chord burst with stagger. | 8 s |
| Groveguard | Guard drains 18% more slowly; perfect guards restore 18 extra guard stamina. | **Root Resonance:** restores guard stamina and creates a three-second, one-charge damage barrier. | 12 s |
| Echo Weaver | Echo Pulse cooldown recovers 12% faster. | **Echo Marker:** places one of at most four short-lived fields; each pulses twice for one damage and stagger. | 10 s |
| Tempo Runner | Dodge recovery is 12% shorter without adding dodge invulnerability. | **Tempo Break:** a short collision-safe dash followed by a light one-damage afterimage strike. | 9 s |

The ability binding is `C` on keyboard, both stick buttons (`L3 + R3`) on a standard gamepad, and the dedicated Class button on touch. Character creation presents playstyle, strengths, passive, ability, and recommendation text with a live preview. The Player Home permits a free first retune; later retunes cost 8 Beatcoins and never duplicate rewards or starting items.

Adventure-presence snapshots contain a whitelisted `classId`. The relay falls back to `riffblade` for missing or unknown values. Campaign classes do not enter fighter snapshots or alter platform-fighter balance.

## Four-region main story

`story-runtime.js` owns immutable arc/chord catalogs and pure chord evaluation. `game.js` remains authoritative for save data, world events, dialogue, objectives, rewards, and rendering. Story checkpoints are monotonic and advance only from real interactions, collection, Pulse, combat, composition, and boss events.

| Stage | Arc | Checkpoint sequence | Musical focus |
| --- | --- | --- | --- |
| 1 — Mossvale Grove | Four Notes, One Grove | EEMS; six Glowweed; Jimbo's Pruner Edge; Blu/Echo Pulse; four notes; resonator; composition; Nullspeaker | C–E–G, a C-major triad in any order |
| 2 — Rootsong Hollows | The Rootsong Below | Pip; three root resonators; chord response; three discord roots; relic; Rootbound Colossus | E–G–B–D, an ordered E-minor-seventh arpeggio |
| 3 — Skyglass Reach | A Melody in Many Skies | Zephra; three refracted chimes; true reflection; three false echoes; relic; Prism Choir | E–G–C–F–A, an ordered reflected F-major-ninth colour |
| 4 — Moonwake Coast | Moonwake Remembers | Tavi; three shell memories; three memory echoes; final pattern; relic; Tidebreaker | C–E–G–B–D, an ordered C-major-ninth arpeggio |

Schema 26 keeps C, E, G, and B as the four collectible anchor frequencies while expanding playable story tones to the full C-major pitch classes C, D, E, F, G, A, and B. Later patterns append D/F/A to their schema-23 prefix so a partial old attempt remains valid. Ordered/arpeggiated input avoids unreliable multi-finger chords on phones. Every tone has a label, colour, and distinct symbol/shape, synchronized sound and visual feedback, a replay-heard-pattern action, and a timing window of 2.4, 4.2, or 8 seconds. Failure costs no resources. Completed puzzles can be replayed from the Main Story journal without repeating their 3-Beatcoin progression reward. The separate Living Score composer adds high C and simultaneous voicings; see `EXPANDED-MUSIC.md`.

## Save schema and migration

The embedded schema is 23; the existing `highNotesSaveV7` storage key is intentionally unchanged.

New sanitized fields include:

- `character.classId`, restricted to the four known IDs and otherwise set to `riffblade`.
- `classState.cooldown` (0–30 seconds), `firstRespecUsed`, and a bounded ability-use count.
- Four whitelisted story checkpoint IDs and four whitelisted puzzle records.
- Puzzle status, known-note input, bounded attempts, and an idempotent `rewardClaimed` flag.
- `touchLayout`, `mobileHaptics`, and `chordTiming` settings.

For pre-schema-23 saves, canonical stage progress is reconciled before story inference. Reaching a later stage or defeating its boss marks earlier arcs and puzzles complete without running reward/toast code. A relic resumes at its boss step; completed regional objects resume at the chord/report boundary; partial objects resume at restoration. Existing campaign-complete saves bypass all new arcs, while a genuinely fresh save receives the complete character-creation, prologue, and Stage 1 path. Unknown class, quest, chord, step, note, and excessive counter data fail closed or clamp to safe bounds.

## Runtime art

The four class icons are transparent WebP assets under `assets/ui/classes/` and are referenced by the class catalog in `game.js`. The lossless generation master is kept under `assets/masters/classes/` and is not loaded by the game. See `assets/ui/classes/README.md` and `manifest.json` for source, dimensions, runtime paths, and usage.

## Validation

The focused validator is `node tools/validate-v2-3-upgrade.cjs`. It checks all four story arcs and musical definitions, class/save integration, overlay and input wiring, relative asset references, image dimensions/alpha when `sharp` is available, and representative schema-23 migration cases. `tools/qa-v2-3-browser.cjs` drives the supported viewport matrix, overlay policies, multi-pointer mobile controls, first-person input, chord rewards/replay, save/reload, and browser console/resource-failure checks through Playwright.

The optional Cloudflare pool test runner may require a compatible workerd/Miniflare host. `multiplayer-relay/vitest.protocol.config.ts` provides a focused Node-hosted protocol validation for the relay boundary, including class-ID sanitation, without changing production deployment configuration.
