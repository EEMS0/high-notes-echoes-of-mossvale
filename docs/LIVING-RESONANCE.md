# Living Resonance architecture

`living-resonance-runtime.js` is the dependency-free, immutable catalog and pure sanitation boundary for the Living Resonance update. It is loaded before `game.js`; campaign code queries it through `window.MossLivingResonance`. The module's own catalog format is version 2, while the current embedded game save is schema 26. Schema 24 introduced the original Living layer, schema 25 added sanitized Resonance Gate records, and schema 26 adds the separate polyphonic composition record without replacing prior Living fields.

The catalog contains definitions and safe data transformations, not a second combat, inventory, audio, world, input, or networking engine. `game.js` remains authoritative for campaign mutations. `v2-platform-fighter.js` must not import or query the catalog: class mastery, campaign synergies, equipment/loadouts, restoration, rehearsal, the quick wheel, and Encore never modify Stock Battle.

## Class mastery and balance

Each class stores XP, derived level, one selected path, up to three contiguous unlocked nodes, and a bounded respec count independently. Switching class therefore preserves every class's progress. Node IDs are globally unique; unknown, cross-class, non-contiguous, and over-level unlocks are removed during sanitation. Passives are queried from the sanitized unlocked-node list and must never be copied into permanent combat statistics, which prevents double application after load or mode changes.

| Class | Path | Nodes and capstone | Balance boundary |
|---|---|---|---|
| Riffblade | Lead Line | Pickup Measure → Carried Phrase → **Second Voice** | Timing grace and one controlled echo slash; the follow-up cannot trigger itself. |
| Riffblade | Power Chord | Held Note → Open Voicing → **Final Cadence** | Retains 35% charge, widens the arc, then adds one boss-reduced stagger beat; no damage multiplier or stun loop. |
| Groveguard | Deep Roots | Rooted Stance → Sheltering Chorus → **Heartwood Circle** | Lower guard drain and capped barrier duration; the shared ring never grants invulnerability. |
| Groveguard | Counterpoint | Answering Beat → Measured Reply → **Golden Rebuttal** | Precise guards return 12 stamina and permit one tightly capped counter pulse. |
| Echo Weaver | Harmonic Field | Wide Spectrum → Sustained Tone → **Twin Resonance** | Radius and one pulse of duration; at most two fields, with oldest-first cleanup. |
| Echo Weaver | Returning Echo | Recall Point → Pulse Alignment → **There and Back** | One readable return projectile that can strike once on each leg and cannot loop. |
| Tempo Runner | Breakbeat | Downbeat Landing → Step Sequence → **Breakbeat Finish** | Timing-led recovery and one consumed afterbeat, without passive speed or extra invulnerability. |
| Tempo Runner | Afterimage | Light Trail → Measured Step → **One More Step** | Collision-tested repositioning and one non-recursive image strike; it cannot cross gates or boundaries. |

XP thresholds are `0, 60, 150, 280, 450, 680`, producing levels 1–6. The spendable-point calculation is level minus one minus unlocked nodes. XP comes from confirmed on-beat combat hits, class objectives, story progress, and rehearsal performance—not menu actions, empty swings, or invulnerable/dead targets. Basic swings capture the shared 104 BPM audio transport when pressed and award Rhythm Combo only on their first valid enemy, weak-point, or boss contact. Respec is a protected Player Home action and removes path effects before applying a replacement path.

## Combat readability and command integrity

Basic attacks have explicit startup, active, and recovery phases. Their hit volume is anchored at commitment, movement slows during the swing, Dodge queues through the active phase, and spent recovery may be cancelled without carrying the old hitbox. A miss resolves once and cannot award combo or mastery. Directional guarding checks the incoming source against the player’s facing: perfect guards negate the hit, ordinary guards stop light damage, heavy hits retain readable chip, and attacks from behind bypass the guard.

Enemy projectile and dive attacks announce a fixed release direction with a persistent ring, progress arc, icon, and procedural warning cue before becoming dangerous. Later regions cap simultaneous committed attackers by difficulty; a live boss suppresses ordinary enemy attacks. Boss volleys receive their own warning phase. Reduced Motion removes animation-only movement but preserves every warning shape and timer. Odin uses collision-tested movement, clear-path target selection, and safe recovery positions; Fetch does not hunt, Guardian Leap belongs to Guard, and Pounce belongs to Hunt.

Adaptive music intensity is derived from nearby committed threats, hostile projectiles/hazards, boss state, recent damage, and a bounded combo contribution. The four Resonances add sparse voices to the existing 104 BPM scheduler rather than starting independent loops.

## Class × instrument synergy registry

`synergyFor(classId, instrumentId)` is the only catalog lookup for the 24 campaign combinations. Each record carries one behaviour token, a colour, and a procedural audio-cue ID. Combat handlers apply that token once at the existing attack/guard/field/dodge event boundary. Unknown class/instrument IDs safely fall back to Riffblade + Guitar. Instrument mastery remains separate.

| Class | Guitar | Bass | Synth | Drumsticks | Microphone | Violin |
|---|---|---|---|---|---|---|
| Riffblade | **Lead Guitar:** an accurate chain extends one Cleave phrase. | **Held Foundation:** movement retains slightly more charge. | **Pocket Oscillator:** one bounded short-range note. | **Backbeat Edge:** one compact stagger beat. | **Chorus Blade:** one small self-support pulse after a strong phrase. | **Fine Bow Edge:** a narrower precision Cleave. |
| Groveguard | **Guard Riff:** one short perfect-guard counter riff. | **Root Note:** a defensive ground pulse after a heavy block. | **Prism Bark:** refracts one eligible projectile. | **Guard Groove:** brief on-beat stamina recovery. | **Shelter Chorus:** one small capped recovery pulse. | **Parry String:** a precise perfect-guard counter line. |
| Echo Weaver | **Marked Riff:** mark one nearby target for the next field pulse. | **Subharmonic Field:** slower field pulses with capped stagger. | **Mirror Patch:** one eligible projectile echoes once. | **Clocked Field:** readable synchronized field pulses. | **Support Loop:** modest ally utility instead of raw damage. | **Guided Return:** a narrow, precise return path. |
| Tempo Runner | **Dash Riff:** one quick strike at a valid dash end. | **Heavy Stop:** a compact heavy stop with no extra distance. | **Prism Slip:** one short-lived prism echo. | **Afterbeat:** one compact on-beat dodge response. | **Moving Chorus:** a short utility buff after a successful movement chain. | **Needle Step:** a narrower precision afterimage. |

Every spawned note, field, marker, pulse, projectile, and afterimage requires a bounded lifetime and is cleared on death, reload, stage/mode changes, protected overlays, and multiplayer reconnect. First-person uses the same underlying campaign action and equipment origin rather than a separate synergy calculation. Remote presence may transmit only sanitized identity needed for presentation; it never proves ownership or awards progression.

## Living Region restoration

Each region stores 0–8 restoration points. The tier is always derived, never trusted from save data: Tier 0 below 2 points, Tier 1 at 2, Tier 2 at 4, and Tier 3 at 6 or more. Claimed tier rewards use an idempotent list containing only tiers 1–3.

| Region | Deterministic props | Procedural layers |
|---|---|---|
| Mossvale Grove | fireflies, heart-flowers, repaired stage | leaf percussion, warm pad, grove melody |
| Rootsong Hollows | glowing roots, wildlife, active resonators | root bass, low percussion, root response |
| Skyglass Reach | clear prisms, bridge lights, restored chimes | glass harmony, bell pattern, sky melody |
| Moonwake Coast | calm tide, lanterns, peaceful echoes | wave rhythm, seventh pad, memory voice |

The four display names are Disturbed, Returning Rhythm, Shared Harmony, and Fully Resonant. Story, boss, chord, and selected optional progress feed points without mutating shared map definitions. Both cameras derive props from the same sanitized tier. Audio crossfades eligible layers under the existing music bus; menus do not restart the region score. Reduced ambient effects lowers particle/prop density but never removes interactive objects. A visiting player can render the host's sanitized tier while rewards remain local and authoritative.

## Boss Rehearsal Hall

The four rehearsal IDs are Nullspeaker, Rootbound, Prism Choir, and Tidebreaker. A boss remains locked until its canonical campaign defeat. Records use `boss:challenge:feedback` keys, where Feedback is clamped to 1–5.

The five arrangements are Standard Rehearsal, No Healing, Perfect Guard Study, Time Trial, and Instrument-Locked Arrangement. A small rehearsal context supplies modifiers and optional telegraphs; campaign boss definitions remain unchanged. Starting a rehearsal snapshots location, stage, health, inventory, equipment, class, instrument, and world state. Consumables operate on a temporary copy. Exit, abandon, victory, death, and reload restore that snapshot.

While practice is active, Map, Backpack, Instruments, Skills, Player Home, Living Resonance, fast travel, and the Version 2.0 Hub are unavailable through both visible controls and their underlying action paths. Settings and read-only Statistics remain available. Pause identifies the active boss, arrangement, and Feedback level and exposes a protected **End Rehearsal** action. The shared confirmation layer releases pause isolation before opening and the results layer clears it before taking focus, preventing nested `inert` overlays or hidden-focus traps.

Records contain bounded best time, damage taken, perfect guards, rank (`C` through `S`), and completion count. Claim keys are unique and idempotent. Rehearsals cannot grant story flags, relics, portals, boss rewards, achievements, or repeatable major currency. Results expose Retry, Change Arrangement, and Return Home, with protected confirmation for start/abandon.

## Loadouts and quick wheel

There are exactly three stable loadout slots (`loadout-1` through `loadout-3`). Each stores an 18-character sanitized name, one known instrument, mutually exclusive equipment slots, active resonance, up to four known quick consumables, and a known cosmetic instrument variant. Class is deliberately absent. Applying a set rechecks ownership/unlocks, ignores missing IDs, and is permitted only outside combat, dialogue, puzzles, bosses, rehearsals, multiplayer transitions, and protected overlays. Equipment attachments and adventure presence refresh through their existing paths.

The quick wheel has eight sectors. Valid assignments are known consumables, loadout 1–3, Backpack/Map/Class/Instruments screens, or Odin/context utility. Touch holds the wheel button, drags by the opening pointer ID, and releases to choose; returning to centre cancels. Gamepad hold plus right stick and a conflict-free keyboard hold use the same selection state. A linear focusable list mirrors every sector for keyboard and assistive technology. The wheel clears on blur, visibility/orientation changes, pause, dialogue, transitions, death, and first-person deactivation. Solo may pause/slow local simulation; adventure multiplayer explicitly remains live. The wheel and its campaign HUD never appear in Stock Battle.

## Encore Adventure separation

Encore unlocks immediately after canonical Tidebreaker and the campaign finale are complete, and that flag is written before the finale save. It is a single bounded cycle with separate stage/progress/completion and reward-claim records. Normal progress remains intact and reviewable. Identity, appearance, class/instrument mastery, cosmetics, achievements/statistics, settings, accessibility, and rehearsal records carry across. A protected Normal snapshot supplies the bounded starting inventory/equipment/currency/skills/home state; mode switching never transfers earned consumables or currency back and therefore cannot duplicate rewards.

Encore has deterministic remixes, capped enemy modifiers, extended C/E/G/B patterns, additional boss arrangements, and cosmetic rewards. It neither repeats character creation nor forces the prologue. Switching is limited to title/Player Home outside combat, dialogue, puzzles, bosses, rehearsal, or multiplayer. Encore state and bonuses never enter Stock Battle.

## Schema-25 migration and sanitation

The `living` record returned by `MossLivingResonance.freshState()` contains four per-class mastery records, four restoration records, four regional Resonance Gate records, rehearsal records/claims, three loadouts, eight wheel assignments, Encore state, and global reward claims. Migration from schema 23 or 24 must be pure: it clamps and infers state without calling reward, toast, audio, spawn, or combat functions.

- Existing campaign, identity, tutorial, story/chords, inventory/equipment, currency, skills, instrument mastery, Player Home, statistics, settings, and multiplayer profile remain untouched.
- Existing defeated bosses infer a cleared, reward-claimed regional Gate during the schema-25 migration so an old save is never relocked or granted a duplicate first-clear reward.
- Gate attempts, scores, accuracy, ranks, combos, assisted-first-clear history, unlock state, and reward state are bounded. A later assisted replay cannot rewrite an earlier unassisted first clear.
- Completed campaigns unlock Encore. Partial saves infer restoration from canonical story/chord/boss flags and never receive duplicate rewards.
- XP, levels, respecs, restoration points, records, stages, counters, lists, feedback level, and Encore cycle are bounded.
- Unknown class nodes, paths, regions, bosses, challenges, instruments, equipment, consumables, assignments, cosmetics, run IDs, and claim formats fail closed.
- Mastery level and restoration tier are recomputed from sanitized XP/points. Loadout slot IDs cannot be forged.
- Reward/claim arrays are de-duplicated and capped. Passives are derived at use time and are never accumulated during migration.

The browser save boundary validates minimum campaign structure before showing Continue or mutating runtime state. Each successful write rotates the last valid primary into `highNotesSaveV7Backup`; corrupt or truncated primaries never replace that backup. Load order is valid primary, valid backup, then validated historical keys, and reset removes every generation. Portals, map travel, shop travel, and map-to-home share a preflight that rejects bosses, Dream Encore, hostile attacks, nearby engaged enemies, rehearsals, protected interactions, invalid routes, and overlapping transitions before any stage state is changed. Stage-scoped effects and attack state are cleared centrally after that preflight succeeds.

Run `node tools/validate-v2-4-living-resonance.cjs` and `node tools/validate-resonance-gate.cjs` to exercise the complete catalog matrix, corrupt-state fixtures, gameplay hooks, deterministic Gate timing/scoring, generated-asset manifest, save-schema integration, rehearsal side-mode guards, and source-level Stock Battle isolation. With a local server on port `4173` and Playwright available, `node tools/qa-v2-4-living-resonance-browser.cjs` mutates temporary rehearsal state and proves exact restoration, reward isolation, accessible pause/confirmation/results focus, retry records, mastery allocation, eight-sector wheel access, and reversible Encore snapshots. `node tools/qa-release-playthrough-browser.cjs` validates all four campaign bosses, both ending flows, title-level Encore entry, and post-finale reload. Gate-specific architecture, chart rules, controls, assistance, and manual play paths are in `RESONANCE-GATE.md`.

## Assets, audio, and inputs

The eight mastery definitions reference transparent runtime emblems under `assets/ui/living-resonance/` (`mastery-lead-line.webp`, `mastery-power-chord.webp`, `mastery-deep-roots.webp`, `mastery-counterpoint.webp`, `mastery-harmonic-field.webp`, `mastery-returning-echo.webp`, `mastery-breakbeat.webp`, and `mastery-afterimage.webp`). Generated masters belong under `assets/masters/living-resonance/`; optimized assets and their manifest must record ID, dimensions, runtime path, and use. Rehearsal, restoration, quick-wheel, Encore, node, and synergy art may reuse code-authored canvas effects where that produces a clearer small-scale result; every referenced bitmap must be integrated and alpha/dimension checked.

Procedural cue IDs live on synergy records (`synergy-bright`, `synergy-low`, `synergy-glass`, `synergy-beat`, `synergy-voice`, and `synergy-string`). Unlocks, restoration crossfades, rehearsal countdown/results, Encore identity, and wheel navigation use existing music/SFX buses and provide a visual equivalent.

All new UI actions use the existing input manager, controller focus layer, shared backdrop dismissal, pointer-ID ownership, safe-area tokens, mirrored touch layout, and held-input reset path. Exact bindings are displayed from the live binding registry rather than duplicated as hard-coded help text.

## Known limitations and extension rules

- Catalog `schemaVersion: 2` versions the immutable definitions and Resonance Gate state shape; it is intentionally independent from embedded save schema 26.
- The current catalog recognizes the `standard` cosmetic instrument variant. Add future variants to the allowlist before saves may reference them.
- Normal and Encore snapshots are accepted only as plain objects by the catalog; campaign migration/application code must still sanitize the snapshot fields it reads.
- Synergy records describe event modifiers. Balance constants and effect pools remain in the established campaign systems and need focused playtesting before adjustment.
- Region restoration is deterministic and tier-based, not an endlessly simulated ecology.
- Encore is one authored cycle, not unbounded procedural difficulty.
- New IDs must be added to the appropriate immutable allowlist, sanitation fixture, presentation manifest, and this document together.

## Implemented runtime surface

The Living Resonance update has production interaction paths in `game.js`: mastery earning/allocation and home-only refunds; a central bounded switch covering all 24 synergy tokens; tier-driven top-down, first-person, HUD, and adaptive-audio restoration; four audio-clock Resonance Gates with permanent boss-road clears and Gate Records; isolated boss rehearsals with records/results; three save/apply loadouts; keyboard, gamepad-hold, touch-pointer, and linear quick-wheel input; and reversible Normal/Encore snapshots with deterministic enemy remix offsets. `styles.css` supplies responsive layouts, safe-area behavior, short-landscape compaction, focusable fallbacks, and reduced-motion behavior for the complete Living Resonance surface.
