# Echo Arena six-fighter roster

The playable Stock Battle roster now uses all six campaign instrument families. Each fighter has a complete ground and aerial normal set, charge attack, neutral special, side special, recovery special, and ultimate. Combat continues to use the existing fixed-step simulation and network snapshot protocol.

| Fighter | Role | Neutral special | Side special | Recovery | Ultimate |
| --- | --- | --- | --- | --- | --- |
| Aria · Guitar Virtuoso | Fast all-rounder | Riff Bolt | Amp Rush | Encore Rise | Aurora Headliner |
| Bram · Bass Breaker | Heavy bruiser | Subwave | Freight Train | Cabinet Lift | Faultline Finale |
| Nyx · Synth Weaver | Technical zoner | Waveform Orb | Phase Sequencer | Arpeggio Warp | Neon Starfield |
| Taro · Drum Vanguard | Armoured pressure | Rolling Tom | Rolling Thunder | Cymbal Lift | Worldbeat Cataclysm |
| Solene · Voice Tempest | Aerial rushdown | Echo Orb | Resonant Glide | High Note Rise | Choir of Stars |
| Vesper · Violin Duelist | Precision speed | Bow Beam | Tempo Lunge EX | Crescendo Leap | Moonlit Concerto |

## Art source and use

`assets/masters/arena/high-notes-fighter-roster-v1.png` is the non-destructive ImageGen master. Six optimized 256×256 WebP crops live in `assets/arena/fighters/` and are used by the fighter-selection cards. `assets/arena/fighters/manifest.json` records their fighter and in-match sprite mappings. Matches reuse the corresponding production animation sheets from `Sprites/` so every roster member has idle, movement, attack, hurt, special, knockout, and respawn animation coverage.

Built-in ImageGen final prompt:

> Create a production game fighter roster portrait atlas containing six distinct original HIGH NOTES musical-fantasy platform fighters in a strict three-column by two-row grid. In reading order: Aria Volt, a nimble moss-haired electric-guitar duelist in teal and gold; Bram Lowtide, a broad dark-skinned bass guardian in rugged amber armour; Nyx Circuit, an androgynous silver-haired synth mage with a floating crystal keyboard; Taro Thunder, an athletic red-haired drum vanguard in teal and copper; Solene Vox, an agile dark-skinned voice tempest with pale-gold braids and a crystal microphone; and Vesper String, an elegant black-violet-haired violin duelist in a tailored plum coat. Use consistent premium 16-bit-inspired pixel art, equal waist-up framing and scale, readable silhouettes, expressive determined faces, dark teal/navy vignette cells, and fighter-specific stage rim lighting. Use no text, letters, numbers, logos, trademarks, famous characters, watermarks, UI frames, labels, duplicate people, extra limbs, detached instruments, or cropped heads and instruments.

The artwork is original to HIGH NOTES and intentionally does not reproduce any Nintendo or other third-party character, costume, logo, attack, or stage design.
