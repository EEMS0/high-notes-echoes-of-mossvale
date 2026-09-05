# Expanded musical language

High Notes save schema 26 separates the campaign's four collectible **anchor notes** from its playable musical palette. C, E, G, and B remain the Mossvale relics, the four Nullspeaker floor pads, and the four accessible Resonance Gate lanes. Recovering those anchors now awakens a full composer octave: **C, D, E, F, G, A, B, and high C**.

This boundary is intentional. Adding D, F, and A to the collectible list would require nonexistent shrines and relock old saves; feeding them to the Nullspeaker's four-pad shield could make the boss impossible. `music-runtime.js` owns the wider performance catalog while `game.js` keeps `NOTE_ORDER` tied to the original four progression anchors.

## Living Score composer

EEMS' Mossbox is a two-bar, 16-step sequencer at the game's shared 104 BPM pulse. Each step is an eighth note and may contain zero to four voices:

- An empty step is a rest.
- One voice is a melody note.
- Two voices form an interval.
- Three or four voices form a bounded chord voicing.

Select a step, then toggle tones individually or replace the step with one of ten presets: C, Dm, Em, F, G, Am, Cmaj7, Dm7, G7, or Am7. Presets are voicings rather than progression requirements; players can freely alter any result. A score becomes saveable after it has at least four sounding steps and three distinct pitch classes. It does not have to repeat all four anchors, so players can create genuinely different melodies.

Controls:

- Mouse/touch: select a step, then use tone or voicing buttons.
- Keyboard `1–8`: toggle C through high C on the selected step.
- Keyboard arrows: move through the 8 × 2 step grid.
- Keyboard `0`, Backspace, or Delete: clear the selected step.
- **Copy previous**: repeat the preceding voicing, wrapping step 1 to step 16.
- **Play Score**: preview all 16 steps with a synchronized visual playhead; pressing it again stops playback.

Every tone has a persistent text label, symbol, position, and colour. Chords never rely on colour alone. All tone and preset controls are native buttons with visible focus states, and the sequencer exposes selected-step and voicing descriptions to assistive technology.

## Audio behaviour

`audio.js` consumes either legacy flat melody arrays or nested polyphonic steps. It derives frequencies from the central MIDI catalog rather than a separate four-note table.

Voices start within a bounded 7 ms spread so chords read as one musical event without producing a click spike. Per-voice gain falls with the square root of voice count, three- and four-note chords receive a restrained lower root, and the final sounding step receives a quiet octave shimmer. Composer previews remain on the existing SFX bus and are cancelled before a new preview, on stop, and when the composer closes. The adaptive score can also use the player's nested composition without restarting its 104 BPM transport.

## Regional harmony

The first Grove Major puzzle remains the approachable C–E–G triad. Later patterns append new tones to their old sequence rather than replacing the learned prefix:

| Region | Pattern | Harmony |
| --- | --- | --- |
| Mossvale | C–E–G | C major |
| Rootsong | E–G–B–D | E minor seventh |
| Skyglass | E–G–C–F–A | reflected F major ninth colour |
| Moonwake | C–E–G–B–D | C major ninth |

Appending tones preserves every valid partial input from schema-25 saves. A previously completed puzzle remains completed, keeps its claimed reward, and sanitizes to the new full definition without granting currency again.

The Resonance Gate deliberately retains four C/E/G/B lanes, identical scoring events, and the same personal-best envelope. It is a timing challenge with keyboard, controller, and two-finger touch constraints; the freeform composer and story resonators are where the wider pitch language lives. A future advanced Gate chart should use a separate chart/record ID rather than silently making old scores incomparable.

## Save migration and safety

Schema 26 adds:

```js
composition: {
  version: 1,
  steps: [
    ['C', 'E', 'G'],
    [],
    ['D'],
    // 13 more bounded steps
  ]
}
```

Sanitation accepts only the eight known pitches, removes duplicates, preserves authored voicing/root order, caps a step at four notes, and caps the phrase at 16 steps. Preserving order matters because G–B–D and A–C–E must keep G and A as their grounded roots even when the single-octave display folds an upper chord tone downward. Missing or malformed data migrates from the legacy eight-step `melody` array by repeating that one-bar loop into both bars. `melody` remains as an eight-step compatibility projection for older call sites and external QA fixtures.

The Nullspeaker sequence is derived separately with `bossAnchorSequence()`: non-pad D/F/A tones are ignored, high C maps to C, duplicate anchors are removed, and any missing pads are filled from C/E/G/B. A valid free composition can therefore never soft-lock the stage-one boss.

## Validation

Run:

```powershell
node tools/validate-expanded-music.cjs
node tools/qa-expanded-music-browser.cjs
```

The focused validator covers the note catalog, high-C distinction, old melody migration, hostile composition sanitation, four-voice caps, chord recognition, presets, free composition readiness, legacy melody projection, Nullspeaker pad safety, expanded story prefixes/completion sanitation, nested audio progress, script dependency order, UI integration, and schema wiring.

The normal release, story, Living Resonance, Resonance Gate, save-recovery, and browser playthrough checks remain required because the composition is part of the canonical campaign save.
