# HIGH NOTES V2: Echoes of Mossvale

An original, dependency-free browser action-adventure about exploring an enchanted woodland, gathering magical weed, recovering lost musical notes, and arranging them into a melody with Blu, Jimbo, and EEMS.

## Run it

Play the hosted release at [https://eems0.github.io/high-notes-echoes-of-mossvale/](https://eems0.github.io/high-notes-echoes-of-mossvale/).

From this folder, start a small local server:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a modern browser. No packages, build tools, or internet connection are required.

## iPhone and iPad Safari

If the game is running on another computer, serve it with `python -m http.server 8000 --bind 0.0.0.0`, then open `http://<computer-LAN-IP>:8000` on the device while both are on the same Wi-Fi network.

1. Open the served game URL in Safari and rotate the device to landscape.
2. Tap **Begin the Jam** or **Continue Adventure** once to unlock game audio.
3. If the game is silent, raise the media volume and turn off Silent Mode where applicable.
4. To install it, tap **Share** (or **More**, then **Share**), choose **Add to Home Screen**, enable **Open as Web App** if shown, and tap **Add**.

Launch the new **HIGH NOTES** Home Screen icon and keep the device in landscape while playing.

## Controls

| Action | Keyboard |
| --- | --- |
| Move | `WASD` or arrow keys |
| Attack | `Space` or `J` |
| Dodge | `Shift` or `K` |
| Echo Pulse | `Q` or `L` |
| Use a stored Heartbloom | `H` |
| Interact / advance dialogue | `E` or `Enter` |
| Open map and quest log | `Tab` |
| Open backpack | `I` or `B` |
| Open instrument mastery | `V` |
| Open the Player Home | `O` |
| Pause / back | `Esc` |

Standard gamepads are supported: left stick/D-pad moves, `A` attacks, `B` dodges or closes a menu, `X` pulses, `Y` interacts, the left shoulder blocks, and Start pauses.

The composer opens when you interact with EEMS after finding four notes. Use a mouse or touchscreen to edit the melody. Landscape touch devices also get on-screen movement, attack, dodge, pulse, interact, Heal, Map, and Pause controls. Walk over a Heartbloom to store it in the medicine pouch, then tap **Heal** when hurt or use it from the backpack’s **Supplies** tab. Tap the **Pack** counter in the HUD to open the backpack.

Open **Statistics** from the title screen or pause menu to see completion, combat, exploration, economy, and boss-clear records.

## Version 2.0 hub and Echo Arena

Open **Version 2.0 Hub** from the pause menu. It preserves the connected production systems from the first release—84 regional contracts, ten professions, crafting, relationships, reputation, Dream Encore, private rooms, chat, emotes, and adventure presence—while adding a complete, deliberately bounded platform-fighter slice:

- **Stock Battle** on the original Mossvale Amphitheatre stage, with fixed-step gravity, solid and drop-through platforms, blast zones, three stocks, respawn protection, hit pause, hitstun, launch scaling, recovery, guard durability, perfect guards, dodges, a match timer, results, and rematches.
- **Guitar Virtuoso** and **Bass Breaker**, each backed by central move data for grounded directions, aerial directions, dash attacks, charge attacks, specials, recovery, projectiles, and an ultimate.
- Offline training against a recovery-aware bot, two-player split keyboard, automatic controller ownership, touch controls, and synchronized private-room play.
- PvP history and cosmetic milestones remain isolated from PvE power. Internet results are explicitly casual and never trusted for currency, ratings, inventory, achievements, or progression.

Timed Battle, Duet Clash, Capture the Beat, King of the Stage, and Resonance Clash are visible as **FOUNDATION**, not advertised as complete modes.

## Internet multiplayer relay

Same-origin tabs can still use the local peer channel for development. Players on different networks require the included Cloudflare Worker and Durable Object relay under `multiplayer-relay/`; GitHub Pages cannot host persistent WebSockets.

The client validates the relay through `GET /health` before opening a room socket, uses protocol v2 room routes, retries temporary failures, rotates reconnect credentials in memory, and exposes a safe diagnostics panel in **Version 2.0 Hub → Online**. The diagnostics deliberately exclude reconnect tokens and credentials. Public discovery and ranked matchmaking stay disabled.

To validate and deploy the relay with Node.js 22 or newer:

```bash
cd multiplayer-relay
npm ci
npm run check
npx wrangler login
npm run deploy
```

The production relay is deployed at `wss://high-notes-v2-relay.jl-bmfx.workers.dev` and is the client default. Its public health endpoint is `https://high-notes-v2-relay.jl-bmfx.workers.dev/health`; the Online panel retains an advanced override for local development or future migrations. Never commit Cloudflare tokens, cookies, passwords, or reconnect credentials. Full security, protocol, local-test, deployment, and two-device test instructions are in `multiplayer-relay/README.md`.

## Weapon-aware equipment rendering

The player no longer uses one fixed instrument transform for every pose. `equipment-runtime.js` provides a hybrid layered rig with per-instrument pivots, primary/secondary hand anchors, explicit direction overrides, frame-level motion, front/rear ordering, switch visibility, and attack/projectile/effect origins. The six existing instrument atlas cells remain the active item art, while the hero and complete Guitar/Bass PvP sheets remain the authored body layers.

This is a functional original attachment system, not a claim that six new hand-authored body-and-arm sprite libraries were produced. Its registry intentionally supports future combined attack sheets without changing saves or combat code.

## Release validation

Run the dependency-free client checks from the repository root:

```bash
node --check game.js
node --check equipment-runtime.js
node --check v1-expansion.js
node --check v2-platform-fighter.js
node tools/validate-v2-release.cjs
```

The deeper production-sprite audit uses `sharp` to inspect PNG alpha data. Run `node tools/validate-production-sprites.cjs` in a tooling environment where `sharp` is available; `sharp` is not a browser/runtime dependency and is intentionally not shipped with the static game.

Then run `npm run check` inside `multiplayer-relay/`. The exact boundary between completed V2 gameplay and labelled future foundations is documented in `docs/HIGH_NOTES_V2_RELEASE_SCOPE.md`.

## What is inside

- Six playable instruments: Electric Guitar, Bass, Synth, Drumsticks, Microphone, and Violin. Each has distinct attack geometry, charged attacks, a special, an ultimate, mastery XP, four mastery unlocks, and a legendary appearance.
- Four build-defining Resonances with instrument-specific interactions, including Nature healing melodies, Heavy Bass stagger, Psychedelic Synth chain explosions, and Conductor Guitar tempo bonuses.
- A handcrafted illustrated atlas for all four regions, with animated clouds, birds, rivers, fireflies, leaves, lighting, layered discovery markers, secrets, shrines, bosses, merchants, and fast travel.
- A seven-branch skill tree with prerequisites, rarity treatments, filters, node previews, pan/zoom controls, unlock effects, and integrated Music Resonance builds.
- A persistent Afterglow House with a trophy room, jukebox, workshop, time-growing greenhouse, Odin care and training, earned decorations, NPC visits, and four visual upgrade levels.
- Forty regional enemy species, eight elite variants, eleven optional mini-bosses, and a procedural encounter director with performance-aware world events and weather.
- An expanded main story plus optional NPC quest chains, persistent quest states, waypoints, rewards, achievements, living NPC schedules, and reactive dialogue.
- Custom named-NPC sprites and portraits, a complete Brad shop-item atlas, improved Odin animation, ambient wildlife, dynamic weather, particles, transitions, and adaptive Web Audio layers.
- A connected top-down woodland world with combat, dodging, enemies that scale in health, speed, aggression, and damage across later stages, secrets, persistent stage gates, and an Echo Pulse ability.
- A quest path built around Blu, Jimbo, EEMS, Odin, and a wider NPC cast, with directional pixel sprites and expressive dialogue portraits.
- Three full follow-on maps—Rootsong Hollows, Skyglass Reach, and Moonwake Coast—with their own terrain, enemies, puzzles, NPC layouts, health pickups, return gates, and atlas fast travel between discovered worlds.
- Four stage bosses with distinct mechanics: the Nullspeaker, Rootbound Colossus, Prism Choir, and Tidebreaker.
- Persistent Heartbloom health pickups that can be banked and triggered later, enemy Beatcoin rewards, Brad's item shop, and a six-skill training tree.
- Weed gathering, four lost notes, a categorized adventure backpack, playable step composer, proportional road map, quest log, persistent statistics, and finale.
- Procedural Web Audio music and sound effects—there are no audio downloads.
- Three difficulty modes, separate music/SFX volume, screen-shake and motion controls, an objective arrow, and a large-text option.
- Responsive 16:9 play on desktop and landscape mobile, with local progress/settings persistence where browser storage is available.

## Project files

- `index.html` — canvas, HUD, menus, overlays, composer, map, dialogue, and touch controls.
- `styles.css` — responsive presentation and accessibility states.
- `game.js` — world, story, input, combat, rendering, save state, and UI behavior.
- `equipment-runtime.js` — central hybrid equipment registry, frame attachments, layer order, and combat origins.
- `v1-expansion.js` — guild contracts, professions/crafting UI, relationships, protocol-v2 Echo Network client, health checks, and diagnostics (the legacy filename/global is retained for compatibility).
- `v2-platform-fighter.js` — fixed-step Stock Battle simulation, Guitar/Bass move data, local ownership, bot logic, host snapshots, and arena results.
- `sprite-runtime.js` — manifest-driven production sprite loading, animation timing, and frame rendering.
- `audio.js` — music and sound synthesis.
- `manifest.webmanifest` — install metadata for browser and Home Screen launches.
- `assets/app-icon-180.png`, `app-icon-192.png`, and `app-icon-512.png` — Home Screen and web-app icons.
- `assets/mossvale-key-art.png` — original generated title/menu artwork made for this project.
- `assets/echo-arena-background.webp` — original moonlit Echo Arena environment used by the hub and competitive canvas.
- `multiplayer-relay/` — deployable TypeScript Cloudflare Worker and SQLite-backed Durable Object relay with validation, rate limits, reconnect handling, tests, and deployment guide.
- `docs/HIGH_NOTES_V2_ARCHITECTURE.md` — evidence-based architecture and migration baseline captured before the V2 client work.
- `docs/HIGH_NOTES_V2_RELEASE_SCOPE.md` — honest completion boundary, save notes, release checks, and external-network playtest checklist.
- `tools/validate-v2-release.cjs` — dependency-free equipment, integration, and relay-structure regression checks.

- `Sprites/` — the active production library: 102 transparent character sheets, 612 portraits, Odin actions, combat effects, UI art, and per-sheet animation manifests.
- `Sprites/UI/Brad Shop/brad-shop-items-sheet.png` — dedicated 5×4 icon atlas for every item sold in Brad's shop.
- `assets/sprites/runtime/` — retained gameplay atlases for the player, instruments, and world items.

Additional production assets:

- `assets/world-map-illustrated.png` — the new four-region handcrafted world atlas.
- `assets/sprites/runtime/instrument-mastery-sheet.png` — normal and legendary instrument artwork.
- `Sprites/manifest.json` — central catalog used by the runtime to lazy-load the active region.
- `Sprites/qa-report.json` — dimension, transparency, portrait, and duplicate-sheet validation results.

## Original-art and copyright note

HIGH NOTES is an original fan-spirited homage to the feel of classic top-down action adventures. It is not affiliated with, endorsed by, or derived from Nintendo or *The Legend of Zelda*. No Zelda characters, names, logos, music, maps, or other copyrighted assets are included. The Mossvale setting, its characters, UI, code, and key art were created specifically for this project.

## Odin companion commands

After recruiting Odin, press `R` or tap the **ODIN** paw button to cycle between **Follow**, **Hunt**, **Guard**, and **Fetch**. Odin can learn additional skills in the training tree, including Pounce, Howl of Courage, Keen Nose item collection, Guardian Leap, and Spirit Wolf.

## Collectibles & Progression Update
- 16 persistent world collectibles across four themed sets.
- Completing a set awards a skill point and healing spark.
- Six additional skills with combat, economy, map, dash, and pulse effects.
- Five permanent shop upgrades including Collector Compass and Tempo Ring.
- Collectible progress appears in the map quest list, inventory, and statistics.
