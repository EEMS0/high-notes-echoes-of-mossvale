# HIGH NOTES V2 release scope

This document separates the playable V2 production slice from the deliberately labelled foundations. It prevents menu concepts, protocol scaffolding, or future-facing data from being mistaken for shipped gameplay.

## Playable and integrated

- The existing top-down action RPG remains the main campaign, with its current saves, custom sprite runtime, progression, combat, Odin, quests, home, shops, bosses, map, and mobile controls intact.
- `Stock Battle` is a complete fixed-step platform-fighter ruleset in the Version 2 hub. It includes blast-zone knockouts, three stocks, respawning, launch scaling, guard and perfect guard, dodging, hit pause, hitstun, input buffering, projectiles, ultimates, results, local two-player input, touch controls, and a recovery-aware bot.
- `Guitar Virtuoso` and `Bass Breaker` are the completed starter fighters. Each has a separate movement profile and a full ground, aerial, special, recovery, charged, and ultimate move set.
- `Mossvale Amphitheatre` is the completed original platform-fighter stage.
- Private room codes, ready/loadout state, host start, authoritative host snapshots, client input messages, safe match completion, host migration handling, relay diagnostics, and bounded reconnect behaviour are connected to protocol version 2.
- The Cloudflare Worker and SQLite Durable Object relay in `multiplayer-relay/` is deployed at `high-notes-v2-relay.jl-bmfx.workers.dev`. Public matchmaking stays disabled; the completed online path is private rooms.
- The campaign player uses the central `MossEquipmentRig` hybrid attachment system for Guitar, Bass, Synth, Drumsticks, Microphone, and Violin. It supplies directional hand/back/effect anchors, frame-aware front/rear ordering, switch visibility, and hitbox/projectile/effect/trail origins.

## Foundations, not claimed as complete

- Timed Battle, Duet Clash, Capture the Signal, King of the Stage, and Resonance Arena are visible as `FOUNDATION` entries only. They cannot be selected as playable modes.
- Public matchmaking is disabled until public-room abuse controls and broader production playtesting are complete.
- Only Guitar Virtuoso and Bass Breaker are completed platform-fighter identities. The broader campaign cast is not claimed as a complete competitive roster.
- The equipment rig uses the existing authored hero and instrument atlas as a hybrid layered renderer. It is functional original integration, but it does not claim newly hand-authored combined body/arm art for every instrument and every complex attack.
- External-network verification still requires at least two physical devices on separate networks. Same-machine tests are useful protocol checks but are not represented as cross-network proof.

## Save compatibility

- V2 data is added through bounded defaults and migration. Existing quests, skills, instruments, Resonance, collectibles, achievements, Odin progression, and player-home progression are not reset.
- Unknown or missing instrument identifiers fall back to Guitar without discarding ownership data.
- Online results never grant trusted campaign currency or rating on the authority of a browser client.

## Production acceptance checks

Before a release is reported as deployed, run:

1. `node --check` for every root JavaScript runtime.
2. `node tools/validate-production-sprites.cjs`.
3. `node tools/validate-v2-release.cjs`.
4. `npm run typecheck`, `npm test`, and `npm run deploy:dry` in `multiplayer-relay/`.
5. Browser smoke tests for campaign load, local Stock Battle, private-room start/end, mobile landscape layout, and console/network failures.
6. If Cloudflare access is authorised, deploy with Wrangler, check the real `/health` response, configure the real public `wss://` endpoint, and repeat the private-room test through the public Worker.
7. After pushing `main`, wait for the existing GitHub Pages workflow and verify the live asset versions and game runtime.

## Required external multiplayer playtest

Use the same private room code for a desktop browser on broadband and a phone on mobile data. Record browser/device versions, approximate ping, lobby join, ready/start, movement, attacks, damage, knockback, KO, respawn, result agreement, temporary disconnect/reconnect, refresh during lobby, host disconnect, background/resume, and any desynchronisation. Do not convert this checklist into a success claim until it genuinely occurs.
