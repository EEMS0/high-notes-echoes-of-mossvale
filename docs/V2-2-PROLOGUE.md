# Separate prologue level

The Rehearsal Grove tutorial is an isolated scene rather than campaign Stage 0 or a presentation layer over Mossvale Stage I.

- `PROLOGUE_LEVEL` owns independent world bounds, spawn, palette, routes, zones, water, obstacles, labels, mentor and rehearsal objects.
- `state.stage` remains in the supported 1–4 range, preserving campaign numbering, quests, portals, multiplayer packets and old saves.
- The tutorial save record stores bounded prologue checkpoint coordinates and a bounded campaign return stage/position.
- Saving during the tutorial never writes prologue coordinates into `state.x`, `state.y` or a campaign `stagePositions` entry.
- Completion and skipping restore the saved campaign location, rebuild enemies and first-person geometry, and then save.
- Replays can begin from any campaign stage and return to that exact stage.
- Campaign encounters, bosses, miniboss arenas, remote adventure players and fast travel are suppressed inside the solo prologue.
- The map overlay renders a local Rehearsal Grove diagram while the tutorial is active.

Existing schema-21 onboarding saves retain their character and tutorial state. Saves older than onboarding continue to bypass character creation and the tutorial.
