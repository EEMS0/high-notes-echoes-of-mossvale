# HIGH NOTES: Echoes of Mossvale

An original, dependency-free browser action-adventure about exploring an enchanted woodland, gathering magical weed, recovering lost musical notes, and arranging them into a melody with Blu, Jimbo, and EEMS.

## Run it

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
- `sprite-runtime.js` — manifest-driven production sprite loading, animation timing, and frame rendering.
- `audio.js` — music and sound synthesis.
- `manifest.webmanifest` — install metadata for browser and Home Screen launches.
- `assets/app-icon-180.png`, `app-icon-192.png`, and `app-icon-512.png` — Home Screen and web-app icons.
- `assets/mossvale-key-art.png` — original generated title/menu artwork made for this project.

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
