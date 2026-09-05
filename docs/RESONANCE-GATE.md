# Resonance Gate

Resonance Gate is the campaign's four-lane Living Resonance performance. Each region places one authored 30–45 second trial between its restoration story and boss arena. A successful first clear opens that boss road permanently; retries, practice, demonstrations, and later score runs never relock it.

## Player flow

1. Complete the region's required story/restoration objective.
2. Interact with the dormant gate at the boss arena.
3. Choose a scored performance, unrecorded practice, or guided demonstration.
4. Play the regional arrangement and restore the required resonance.
5. Continue directly to the boss, or return and replay later through **Living Resonance → Gate Records**.

Losing the boss fight does not repeat the performance. Existing saves that already defeated a boss migrate that region to a cleared, reward-claimed gate so old progress cannot be relocked or paid twice.

## Controls

| Lane | Note | Shape | Keyboard | Gamepad |
| --- | --- | --- | --- | --- |
| 1 | C | leaf | `D` or Left | `X` or D-pad Left |
| 2 | E | diamond | `F` or Down | `A` or D-pad Down |
| 3 | G | wave | `J` or Up | `Y` or D-pad Up |
| 4 | B | star | `K` or Right | `B` or D-pad Right |

Touch players tap the four labelled lane buttons. Every lane is identified by position, note letter, shape, and colour. Prompts update to the active input method. `Esc`, the gamepad Menu button, or the visible Pause action safely freezes a run and starts a fresh four-beat count-in on resume.

Tap notes require one press. Chords require two lanes within a dedicated 120 ms spread window (174 ms with Wider Timing). Hold notes must remain pressed through their tail. If a run is paused during a hold, the player re-holds the shown lane during the resume count-in; Hold Assistance does this automatically.

## Timing and scoring

`resonance-gate-runtime.js` is a dependency-free pure runtime. Charts are authored in beats and use the shared 104 BPM Web Audio transport. A running `AudioContext.currentTime` is authoritative; if Web Audio cannot start after the launch gesture, that attempt locks to a monotonic wall-clock fallback so its count-in cannot freeze or jump clocks mid-run. Rendered note position never decides a judgement.

Default windows are:

- Perfect: ±55 ms
- Great: ±105 ms
- Good: ±160 ms
- Miss: outside Good

Wider Timing scales these windows by 1.45. The latency offset setting adjusts input judgement from −200 to +200 ms. Visual scroll speed changes only note travel time and never changes musical timing. Demonstrations intentionally ignore player latency calibration so their injected chart events remain exact.

Base points are 1,000 / 750 / 450 for Perfect / Great / Good. A bounded combo multiplier rises by 0.5 every ten notes and caps at ×4. Chords advance combo once. Holds add a bounded tick bonus. Optional accents can add score but never reduce campaign resonance when skipped.

Off-beat lane presses reset combo and apply a debounced resonance/accuracy penalty. Simultaneous extra buttons count as one mistake, while repeated four-lane mashing cannot satisfy the standard clear threshold. Scoring and judgement remain deterministic across render frame rates.

Ranks use weighted accuracy:

- S: 95%+
- A: 88%+
- B: 78%+
- C: a cleared result below B
- Practice: a No-Fail or guided-demonstration clear

Campaign thresholds are 50% on Story, 65% on Standard, and 72% on Hard. No-Fail guarantees progression after the chart ends and honestly marks the record as assisted.

## Authored charts

All four production charts are 68 beats at 104 BPM (about 39.2 seconds) and end with a two-beat safety buffer.

- **Mossvale — Nullspeaker Gate:** widely spaced C, E, G, and B teaching notes, a short phrase, one hold, then a safe two-note chord; warm guitar, leaf percussion, roots, and fireflies.
- **Rootsong — Rootbound Gate:** bass-led syncopation, longer holds, deliberate heavy chords, amber roots, and ground pulses.
- **Skyglass — Prism Choir Gate:** mirrored crystalline arpeggios, bounded half-beat movement, call-and-response, prisms, and refracted trails.
- **Moonwake — Tidebreaker Gate:** wave-shaped phrasing, expressive holds and chords, then a C–E–G–B resolution with moonlit water feedback.

Campaign charts are manually authored. `validateChart` rejects unsafe IDs, lanes, types, ordering, beats, holds, overlaps, chords, density, duration, count-in placement, and missing ending buffers. Malformed input returns a failed validation result rather than throwing.

## Accessibility

The Accessibility settings persist independently of campaign progress:

- Wider Timing
- No-Fail progression
- Simplified Charts
- Hold Assistance
- Reduced Motion and screen-shake controls
- Reduced Brightness
- Persistent lane labels
- High-contrast lanes
- visual scroll speed from 0.75× to 1.5×
- input latency offset from −200 to +200 ms
- separate music and SFX volumes

One paced live region announces count-in edges, tutorials, misses, hold/chord feedback, combo milestones, pauses, and the final result without repeating animation-frame updates or speaking over every note. Song and resonance meters expose progress semantics and the required clear threshold. Native Tab, Enter, and Space remain available in Gate menus; lane keys are captured only while timing is live. After a failed scored attempt the results screen offers an explicit assisted retry. After three attempts that choice also enables No-Fail rather than silently changing difficulty.

Practice and demonstration never update attempts, personal bests, rewards, or campaign progression. Wider Timing, Simplified Charts, and Hold Assistance are marked as assistance but may still produce normal letter ranks; No-Fail and demonstration use Practice rank.

## Progression and save boundary

Save schema 25 adds sanitized `living.rhythmTrials` records for `mossvale`, `rootsong`, `skyglass`, and `moonwake`:

```js
{
  unlocked: true,
  cleared: true,
  assistedClear: false,
  attempts: 3,
  bestScore: 82450,
  bestAccuracy: 91.4,
  bestRank: "A",
  maxCombo: 54,
  rewardClaimed: true
}
```

Values are clamped and unknown data fails closed. First-clear state is idempotent. An assisted replay cannot rewrite an earlier unassisted first clear. Personal best fields improve independently, and practice is never eligible. Save writes occur at attempt start, scored completion, first-clear reward, exit, and other meaningful boundaries—not per note.

The first clear grants one regional restoration point plus a small one-time Beatcoin reward based on rank. Reward claims use `rhythm:<region>:first-clear`. The boss requirement checks canonical story readiness plus the permanent gate clear. Boss defeat remains canonical and never depends on replay rank.

## Runtime ownership and cleanup

- `resonance-gate-runtime.js`: chart catalog, validation, judgement, scoring, hold suspension, rank, and record sanitation.
- `audio.js`: stable transport snapshot, pitched C/E/G/B Gate feedback, and the wider diatonic/polyphonic composer through existing buses.
- `input-manager.js`: aggregate keyboard aliases, gamepad edges, virtual touch actions, and active-method prompts.
- `game.js`: Gate state machine, canvas rendering, overlays, progression, save migration, audio adaptation, and QA bridge.
- `index.html` / `styles.css`: accessible overlay, settings, results, Gate Records, responsive layouts, and reduced effects.

The UI state machine uses `inactive`, `intro`, `count-in`, `playing`, `paused`, `resuming`, and `results`. Restart and exit cancel the animation frame and count-in timer, clear held input, suspended holds, demo releases, adaptive-audio tier, and touch button state. Inactive trials perform no animation or audio work.

The QA bridge exposes these opt-in helpers under `window.__HIGH_NOTES__.debug`:

- `openRhythmTrial(regionId)`
- `startRhythmTrial(regionId)`
- `setRhythmAssist(options)`
- `getRhythmSnapshot()`
- `injectRhythmInput(lane, audioTime)`
- `completeRhythmTrial(rank)`
- `resetRhythmTrial(regionId)`

They do nothing unless explicitly called and do not run during normal progression.

## Validation

From the repository root:

```bash
node --check resonance-gate-runtime.js
node --check audio.js
node --check input-manager.js
node --check controller-ui.js
node --check game.js
node tools/validate-resonance-gate.cjs
node tools/validate-v2-release.cjs
node tools/validate-v2-3-upgrade.cjs
node tools/validate-v2-4-living-resonance.cjs
node tools/validate-save-recovery.cjs
node tools/validate-world-transitions.cjs
```

The focused validator covers beat conversion, all charts, judgement and chord boundaries, positive/negative latency, taps, holds, pause/resume holds, anti-mash penalties, combo/multiplier/accuracy/rank, 30 versus 144 FPS determinism, malformed charts, save sanitation, permanent unlocks, one-time rewards, assisted history, input routing, repeated restart, audio-clock suspension, focus cleanup, and QA integration.

## Extension rules

- Keep chart times in beats and use the existing transport; never derive judgement from CSS/canvas position or frame count.
- New campaign charts must be authored, validated, readable on Simplified Charts, and finish with a two-beat buffer.
- Keep chords to two lanes unless touch and accessibility design are deliberately revised.
- Class, instrument, and synergy may change cosmetic trails or note timbre, never timing windows or score potential.
- New effects must be bounded and respect Reduced Motion and Reduced Brightness.
- Never relock a cleared boss road or repeat its first-clear reward.
- Add new persistent fields through sanitation and a schema migration, with corrupt-value and old-save tests.
