/* eslint-disable no-console */
'use strict';

/**
 * HIGH NOTES: Echoes of Mossvale — production sprite exporter.
 *
 * This converts the game's existing authored atlases and the new ImageGen
 * turnaround masters into a single predictable sheet contract. The exporter
 * deliberately keeps source art immutable and writes only to /Sprites.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

sharp.concurrency(Math.max(2, Math.min(6, require('node:os').cpus().length - 1)));
sharp.cache({ memory: 256, files: 100, items: 500 });

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'Sprites');
const RUNTIME = path.join(ROOT, 'assets', 'sprites', 'runtime');
const MASTERS = path.join(OUT, '_Masters', 'transparent');
const PREVIEWS = path.join(OUT, '_Previews');

const FRAME_COLUMNS = 12;
const ROWS = [
  { id: 'idle_south', frames: 4, duration: 180, loop: true, direction: 'south' },
  { id: 'idle_north', frames: 4, duration: 180, loop: true, direction: 'north' },
  { id: 'idle_east', frames: 4, duration: 180, loop: true, direction: 'east' },
  { id: 'idle_west', frames: 4, duration: 180, loop: true, direction: 'west' },
  { id: 'walk_south', frames: 8, duration: 90, loop: true, direction: 'south' },
  { id: 'walk_north', frames: 8, duration: 90, loop: true, direction: 'north' },
  { id: 'walk_east', frames: 8, duration: 90, loop: true, direction: 'east' },
  { id: 'walk_west', frames: 8, duration: 90, loop: true, direction: 'west' },
  { id: 'run_south', frames: 8, duration: 65, loop: true, direction: 'south' },
  { id: 'run_north', frames: 8, duration: 65, loop: true, direction: 'north' },
  { id: 'run_east', frames: 8, duration: 65, loop: true, direction: 'east' },
  { id: 'run_west', frames: 8, duration: 65, loop: true, direction: 'west' },
  { id: 'hurt', frames: 4, duration: 85, loop: false },
  { id: 'attack_a', frames: 8, duration: 70, loop: false },
  { id: 'attack_b', frames: 8, duration: 76, loop: false },
  { id: 'death', frames: 12, duration: 95, loop: false },
  { id: 'special', frames: 8, duration: 85, loop: false },
  { id: 'stunned', frames: 4, duration: 120, loop: true },
  { id: 'spawn', frames: 8, duration: 75, loop: false },
  { id: 'shadow', frames: 1, duration: 1000, loop: true },
  { id: 'portrait_neutral', frames: 1, duration: 1000, loop: true, portrait: 'neutral' },
  { id: 'portrait_happy', frames: 1, duration: 1000, loop: true, portrait: 'happy' },
  { id: 'portrait_angry', frames: 1, duration: 1000, loop: true, portrait: 'angry' },
  { id: 'portrait_surprised', frames: 1, duration: 1000, loop: true, portrait: 'surprised' },
  { id: 'portrait_sad', frames: 1, duration: 1000, loop: true, portrait: 'sad' },
  { id: 'portrait_talking', frames: 1, duration: 140, loop: true, portrait: 'talking' }
];

const SHARED_PALETTE = [
  ['Night Ink', '#101521'],
  ['Plum Outline', '#271936'],
  ['Bark Shadow', '#3a2834'],
  ['Moss Deep', '#234738'],
  ['Moss Mid', '#3f7451'],
  ['Moss Light', '#7ccf77'],
  ['Heartwood', '#8c5a3c'],
  ['Honey Gold', '#e0a83a'],
  ['Beat Gold', '#ffd45c'],
  ['Ember Orange', '#ef7b45'],
  ['Heart Pink', '#ed5f91'],
  ['Dream Magenta', '#c34dcc'],
  ['Resonance Violet', '#7455d9'],
  ['Midnight Blue', '#283a70'],
  ['Skyglass Blue', '#3d82d6'],
  ['Pulse Cyan', '#53d8e8'],
  ['Moon Foam', '#a3edf1'],
  ['Pearl', '#f1e6cf'],
  ['Bone', '#c8b99f'],
  ['Storm Grey', '#667286'],
  ['Spore Amber', '#d88d4c'],
  ['Tide Teal', '#2ca5a5'],
  ['Leaf Spark', '#a8e063'],
  ['Hurt Coral', '#ff6f7f']
].map(([name, hex]) => ({ name, hex }));

const REGION_ACCENTS = {
  Mossvale: '#7ccf77',
  Rootsong: '#ef9a52',
  Skyglass: '#62d9ff',
  Moonwake: '#83e4dc',
  Elite: '#ffd45c',
  Bosses: '#d77cff',
  NPCs: '#ffc857',
  Odin: '#53d8e8'
};

const SOURCE_PROMPTS = {
  'npc-musician-turnarounds.png':
    'Strict 7×4 atlas of 28 original occupation-led NPC and musician designs, each with separated directional turnaround poses; vivid 16-bit three-quarter top-down musical fantasy pixel art on flat #00FF00.',
  'missing-regional-enemies.png':
    'Strict 4×4 atlas completing Mossvale, Rootsong, Skyglass and Moonwake enemy families with original multi-view silhouettes on flat #00FF00.',
  'elites-key-poses.png':
    'Eight premium elite enemy concepts with genuinely enlarged anatomy, equipment, glow details, signature attacks and distinct death keys on flat #00FF00.',
  'miniboss-roster.png':
    'Strict 4×2 premium miniboss roster: Crystal Dragon, Mushroom Colossus, Forest Guardian, Echo Conductor, Moon Leviathan, Root Titan, Storm Phoenix and Ancient Guitar Golem.',
  'odin-expanded-actions.png':
    'Reference-matched Odin atlas in a strict 6×3 grid: 18 personality, home, exploration and combat action keys while retaining his brindle markings and gold note tag.'
};

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(value) {
  return value.replace(/(^|[-_ ])([a-z])/g, (_, lead, char) => `${lead}${char.toUpperCase()}`);
}

function generated(file, columns, rows, index, turnaround = true) {
  return {
    path: path.join(MASTERS, file),
    sourceLabel: `Sprites/_Masters/transparent/${file}`,
    columns,
    rows,
    index,
    turnaround
  };
}

function runtime(file, columns, rows, index, turnaround = false) {
  return {
    path: path.join(RUNTIME, file),
    sourceLabel: `assets/sprites/runtime/${file}`,
    columns,
    rows,
    index,
    turnaround
  };
}

function generatedRect(file, rect, turnaround = true) {
  return {
    path: path.join(MASTERS, file),
    sourceLabel: `Sprites/_Masters/transparent/${file}`,
    rect,
    turnaround
  };
}

function asset(definition) {
  const slug = definition.slug || slugify(definition.name);
  const group = definition.group;
  const categoryPath =
    group === 'npc'
      ? path.join('NPCs', ...(definition.subgroup ? [definition.subgroup] : []), definition.folder || definition.name)
      : group === 'enemy'
        ? path.join('Enemies', definition.region, definition.folder || definition.name)
        : group === 'elite'
          ? path.join('Enemies', 'Elite', definition.folder || definition.name)
          : group === 'boss'
            ? path.join('Enemies', 'Bosses', definition.folder || definition.name)
            : path.join('Companions', 'Odin');
  return {
    frameSize: group === 'boss' ? 128 : group === 'elite' ? 96 : group === 'companion' ? 80 : 64,
    accent:
      definition.accent ||
      REGION_ACCENTS[definition.region] ||
      REGION_ACCENTS[definition.group === 'npc' ? 'NPCs' : definition.group === 'companion' ? 'Odin' : 'Elite'],
    effect:
      definition.effect ||
      (definition.region === 'Mossvale'
        ? 'leaf'
        : definition.region === 'Rootsong'
          ? 'root'
          : definition.region === 'Skyglass'
            ? 'crystal'
            : definition.region === 'Moonwake'
              ? 'tide'
              : group === 'npc'
                ? 'note'
                : 'resonance'),
    deathStyle: definition.deathStyle || (group === 'boss' || group === 'elite' ? 'large' : 'humanoid'),
    ...definition,
    slug,
    categoryPath
  };
}

const assets = [];

const namedNpcSources = [
  ['Brad', runtime('brad-sheet.png', 4, 4, 0), '#ffcc57', 'merchant'],
  ['Jimbo', runtime('jimbo-sheet.png', 4, 4, 0), '#ffad55', 'gardener'],
  ['Mara', runtime('named-npcs-sheet.png', 6, 2, 0), '#ff7892', 'chef'],
  ['Pip', runtime('named-npcs-sheet.png', 6, 2, 1), '#ff9d57', 'drummer'],
  ['Zephra', runtime('named-npcs-sheet.png', 6, 2, 2), '#62c7ff', 'engineer'],
  ['Nix', runtime('named-npcs-sheet.png', 6, 2, 3), '#d77cff', 'archivist'],
  ['Tavi', runtime('named-npcs-sheet.png', 6, 2, 4), '#61d8c8', 'violinist'],
  ['Luma', runtime('named-npcs-sheet.png', 6, 2, 5), '#ffd45c', 'singer'],
  ['Blu', runtime('blu-sheet.png', 4, 4, 0), '#62c7ff', 'resonance guide'],
  ['EEMS', runtime('eems-sheet.png', 4, 4, 0), '#d77cff', 'electronic music spirit']
];
for (const [name, source, accent, occupation] of namedNpcSources) {
  assets.push(
    asset({
      name,
      group: 'npc',
      source,
      accent,
      occupation,
      effect: occupation.includes('chef') || occupation.includes('gardener') ? 'leaf' : 'note',
      description: `${name}, a unique named Mossvale character whose silhouette and props reflect their role as ${occupation}.`
    })
  );
}

const generatedNpcDefs = [
  ['Village Elder', 'Elder', 'elder'],
  ['Blacksmith', null, 'blacksmith'],
  ['Travelling Merchant', null, 'merchant'],
  ['Chef', null, 'chef'],
  ['Explorer', null, 'explorer'],
  ['Fisherman', null, 'fisherman'],
  ['Gardener', null, 'gardener'],
  ['Librarian', null, 'librarian'],
  ['Arena Master', null, 'arena master'],
  ['Band Manager', null, 'band manager'],
  ['Travelling Bard', null, 'bard'],
  ['Child A', 'Children/Juniper', 'child explorer'],
  ['Child B', 'Children/Sol', 'child musician'],
  ['Villager A', 'Villagers/Fern', 'beekeeper villager'],
  ['Villager B', 'Villagers/Rook', 'craftsperson villager'],
  ['Quest Giver', null, 'relic quest giver'],
  ['Innkeeper', null, 'innkeeper'],
  ['Potion Brewer', null, 'potion brewer'],
  ['Electric Guitarist', 'Musicians/Electric Guitarist', 'guitarist'],
  ['DJ', 'Musicians/DJ', 'DJ'],
  ['Violinist', 'Musicians/Violinist', 'violinist'],
  ['Drummer', 'Musicians/Drummer', 'drummer'],
  ['Singer', 'Musicians/Singer', 'singer'],
  ['Bass Player', 'Musicians/Bass Player', 'bass player'],
  ['Synth Performer', 'Musicians/Synth Performer', 'synth performer'],
  ['Trumpeter', 'Musicians/Trumpeter', 'trumpeter'],
  ['Street Busker', 'Musicians/Street Busker', 'street busker'],
  ['Festival Band Leader', 'Musicians/Festival Band', 'festival band leader']
];
generatedNpcDefs.forEach(([name, folder, occupation], index) => {
  const source = generated('npc-musician-turnarounds.png', 7, 4, index, true);
  // Image generation kept each role grouped, but its visual columns are offset
  // by roughly 0.12 of a nominal cell. The shifted grid recovers the authored
  // front/back/side turnarounds without pulling a neighbor into the crop.
  const npcViewCounts = [
    [4, 3, 3, 3, 3, 3, 3],
    [4, 3, 3, 3, 3, 3, 3],
    [3, 3, 3, 3, 3, 3, 3],
    [3, 3, 3, 3, 3, 2, 3]
  ];
  source.shiftedGrid = true;
  source.fixedViews = npcViewCounts[Math.floor(index / 7)][index % 7];
  if (name === 'Quest Giver') source.preferredView = 1;
  if (['Arena Master', 'Innkeeper'].includes(name)) {
    delete source.fixedViews;
    source.centeredGroup = true;
    source.preferredX = 0.29;
    source.maxPoseWidthFraction = 0.36;
  }
  if (name === 'Arena Master') {
    source.rect = [0.172, 0.25, 0.043, 0.25];
    source.turnaround = false;
    delete source.shiftedGrid;
    delete source.centeredGroup;
  }
  assets.push(
    asset({
      name,
      folder,
      group: 'npc',
      subgroup: folder && folder.includes('/') ? undefined : undefined,
      source,
      occupation,
      accent: ['#ffc857', '#ef7b45', '#d77cff', '#53d8e8'][Math.floor(index / 7)],
      effect: index >= 18 ? 'note' : occupation.includes('potion') ? 'spore' : occupation.includes('garden') ? 'leaf' : 'resonance',
      description: `A one-off ${occupation} design with unique clothing, hair, accessories, posture and occupation-led body language.`
    })
  );
});

const existingEnemyNames = {
  Mossvale: ['Forest Wolf', 'Living Bush', 'Sapling Guardian', 'Spore Bat', 'Moss Slime', 'Musical Beetle'],
  Rootsong: ['Root Beast', 'Fungus Shaman', 'Bone Crow', 'Root Spider', 'Corrupted Stag', 'Toxic Bloom'],
  Skyglass: ['Crystal Sentinel', 'Storm Wisp', 'Flying Shard', 'Sky Serpent', 'Crystal Golem', 'Lightning Moth'],
  Moonwake: ['Ghost Sailor', 'Moon Crab', 'Deep Eel', 'Coral Guardian', 'Spectral Jellyfish', 'Tidal Spirit']
};
const enemyBehaviors = {
  'Forest Wolf': ['charger', 'slash', 'grounded'],
  'Living Bush': ['turret', 'leaf', 'slime'],
  'Sapling Guardian': ['skirmisher', 'leaf', 'humanoid'],
  'Spore Bat': ['swoop', 'spore', 'flying'],
  'Moss Slime': ['splitter', 'leaf', 'slime'],
  'Musical Beetle': ['orbiter', 'note', 'grounded'],
  'Root Beast': ['charger', 'root', 'large'],
  'Fungus Shaman': ['support', 'spore', 'humanoid'],
  'Bone Crow': ['swoop', 'root', 'flying'],
  'Root Spider': ['ambusher', 'root', 'grounded'],
  'Corrupted Stag': ['charger', 'spore', 'large'],
  'Toxic Bloom': ['turret', 'spore', 'slime'],
  'Crystal Sentinel': ['guardian', 'crystal', 'humanoid'],
  'Storm Wisp': ['storm', 'lightning', 'spectral'],
  'Flying Shard': ['swoop', 'crystal', 'flying'],
  'Sky Serpent': ['orbiter', 'lightning', 'flying'],
  'Crystal Golem': ['guardian', 'crystal', 'large'],
  'Lightning Moth': ['storm', 'lightning', 'flying'],
  'Ghost Sailor': ['skirmisher', 'tide', 'spectral'],
  'Moon Crab': ['guardian', 'tide', 'grounded'],
  'Deep Eel': ['ambusher', 'tide', 'flying'],
  'Coral Guardian': ['guardian', 'tide', 'large'],
  'Spectral Jellyfish': ['storm', 'tide', 'spectral'],
  'Tidal Spirit': ['splitter', 'tide', 'spectral']
};
Object.entries(existingEnemyNames).forEach(([region, names], row) => {
  names.forEach((name, column) => {
    const [ai, effect, deathStyle] = enemyBehaviors[name];
    assets.push(
      asset({
        name,
        group: 'enemy',
        region,
        source: runtime('expanded-enemy-species-sheet.png', 6, 4, row * 6 + column),
        ai,
        effect,
        deathStyle,
        description: `${region} species with ${ai} behavior, bespoke ${effect} attack language, unique loot silhouette and readable elite-compatible anatomy.`
      })
    );
  });
});

const missingEnemyNames = {
  Mossvale: ['Flower Hopper', 'Thorn Crawler', 'Wood Sprite', 'Bark Guardian'],
  Rootsong: ['Rot Slime', 'Spore Mage', 'Hollow Knight', 'Ancient Root'],
  Skyglass: ['Crystal Wolf', 'Floating Eye', 'Glass Beetle', 'Storm Elemental'],
  Moonwake: ['Sea Wraith', 'Moon Owl', 'Shell Golem', 'Leviathan Spawn']
};
const missingEnemyBehavior = {
  'Flower Hopper': ['pouncer', 'leaf', 'grounded'],
  'Thorn Crawler': ['burrower', 'root', 'grounded'],
  'Wood Sprite': ['support', 'note', 'humanoid'],
  'Bark Guardian': ['guardian', 'root', 'large'],
  'Rot Slime': ['splitter', 'spore', 'slime'],
  'Spore Mage': ['caster', 'spore', 'humanoid'],
  'Hollow Knight': ['duelist', 'slash', 'humanoid'],
  'Ancient Root': ['turret', 'root', 'large'],
  'Crystal Wolf': ['charger', 'crystal', 'grounded'],
  'Floating Eye': ['beam caster', 'crystal', 'flying'],
  'Glass Beetle': ['ricochet', 'crystal', 'grounded'],
  'Storm Elemental': ['storm caster', 'lightning', 'spectral'],
  'Sea Wraith': ['teleporter', 'tide', 'spectral'],
  'Moon Owl': ['swoop', 'tide', 'flying'],
  'Shell Golem': ['guardian', 'tide', 'large'],
  'Leviathan Spawn': ['ambusher', 'tide', 'flying']
};
Object.entries(missingEnemyNames).forEach(([region, names], row) => {
  const viewCounts = [
    [4, 4, 3, 2],
    [3, 3, 3, 2],
    [4, 3, 3, 3],
    [4, 3, 3, 3]
  ];
  names.forEach((name, column) => {
    const [ai, effect, deathStyle] = missingEnemyBehavior[name];
    const source = generated('missing-regional-enemies.png', 4, 4, row * 4 + column, true);
    source.fixedViews = viewCounts[row][column];
    assets.push(
      asset({
        name,
        group: 'enemy',
        region,
        source,
        ai,
        effect,
        deathStyle,
        description: `${region} species with a unique ${ai} combat read, ${effect} VFX vocabulary and hand-authored multi-view source design.`
      })
    );
  });
});

const eliteRects = [
  [0, 0, 0.5, 0.25],
  [0.5, 0, 0.5, 0.25],
  [0, 0.25, 0.5, 0.25],
  [0.5, 0.25, 0.5, 0.25],
  [0, 0.5, 0.25, 0.5],
  [0.25, 0.5, 0.25, 0.5],
  [0.5, 0.5, 0.25, 0.5],
  [0.75, 0.5, 0.25, 0.5]
];
const eliteDefs = [
  ['Golden Slime', 'coin-burst', 'slime', '#ffd45c'],
  ['Crystal Alpha Wolf', 'crystal', 'grounded', '#8ce8ff'],
  ['Echo Knight', 'resonance', 'humanoid', '#d77cff'],
  ['Ancient Treant', 'root', 'large', '#8ecb70'],
  ['Moon Revenant', 'tide', 'spectral', '#83e4dc'],
  ['Forest Colossus', 'leaf', 'large', '#7ccf77'],
  ['Storm Conductor', 'lightning', 'spectral', '#62d9ff'],
  ['Ancient Mycelium', 'spore', 'large', '#e5a4ff']
];
eliteDefs.forEach(([name, effect, deathStyle, accent], index) => {
  const source = generatedRect('elites-key-poses.png', eliteRects[index], true);
  if (index >= 4) source.innerGrid = { columns: 2, rows: 2, index: 0 };
  assets.push(
    asset({
      name,
      group: 'elite',
      region: 'Elite',
      source,
      effect,
      deathStyle,
      accent,
      description: `Premium elite with added anatomy, armour, luminous relic details, a signature ${effect} attack and a distinct ${deathStyle} death profile.`
    })
  );
});

const miniBossDefs = [
  ['Crystal Dragon', 'crystal', 'flying', '#9de8ff'],
  ['Mushroom Colossus', 'spore', 'large', '#ff9d57'],
  ['Forest Guardian', 'leaf', 'large', '#7df7a1'],
  ['Echo Conductor', 'resonance', 'spectral', '#d77cff'],
  ['Moon Leviathan', 'tide', 'flying', '#86e8ff'],
  ['Root Titan', 'root', 'large', '#d9a85d'],
  ['Storm Phoenix', 'lightning', 'flying', '#62c7ff'],
  ['Ancient Guitar Golem', 'note', 'large', '#ffc857']
];
miniBossDefs.forEach(([name, effect, deathStyle, accent], index) => {
  assets.push(
    asset({
      name,
      group: 'boss',
      bossClass: 'miniboss',
      source: generated('miniboss-roster.png', 4, 2, index, false),
      effect,
      deathStyle,
      accent,
      description: `Large optional miniboss built for multiple attacks, roar, summon, phase transition, death and victory-pose animation families.`
    })
  );
});

const compatibilityMinibosses = [
  ['Groove Beetle Prime', 5, 'note', 'grounded', '#f6e36d', 'crown'],
  ['Storm Harpist', 17, 'lightning', 'flying', '#62c7ff', 'harp'],
  ['Coral Oracle', 21, 'tide', 'large', '#ff91d5', 'oracle']
];
compatibilityMinibosses.forEach(([name, sourceIndex, effect, deathStyle, accent, overlay]) => {
  assets.push(
    asset({
      name,
      group: 'boss',
      bossClass: 'miniboss',
      source: runtime('expanded-enemy-species-sheet.png', 6, 4, sourceIndex),
      effect,
      deathStyle,
      accent,
      overlay,
      description: `Compatibility miniboss matching the current encounter director, enlarged with a unique ${overlay} silhouette layer and ${effect} attack family.`
    })
  );
});

const storyBosses = [
  ['Nullspeaker', 0, '#d77cff', 'resonance'],
  ['Rootbound Colossus', 1, '#d9a85d', 'root'],
  ['Prism Choir', 2, '#9de8ff', 'crystal'],
  ['Tidebreaker', 3, '#61d8c8', 'tide']
];
storyBosses.forEach(([name, row, accent, effect]) => {
  assets.push(
    asset({
      name,
      group: 'boss',
      bossClass: 'story-boss',
      source: runtime('chapter-boss-sheet.png', 4, 4, row * 4, false),
      accent,
      effect,
      deathStyle: 'large',
      description: `Regional story boss retained from the shipped runtime atlas and normalized to the same complete production animation contract.`
    })
  );
});

assets.push(
  asset({
    name: 'Odin',
    group: 'companion',
    region: 'Odin',
    source: runtime('odin-sheet.png', 4, 4, 0, false),
    accent: '#53d8e8',
    effect: 'resonance',
    deathStyle: 'grounded',
    description: 'Brindle staffy companion with a gold music-note tag, expressive movement, combat support and a separate 18-action home/exploration atlas.'
  })
);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function transparentCanvas(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  });
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function cropSource(source) {
  const metadata = await sharp(source.path).metadata();
  let left;
  let top;
  let width;
  let height;
  if (source.rect) {
    left = Math.round(metadata.width * source.rect[0]);
    top = Math.round(metadata.height * source.rect[1]);
    width = Math.round(metadata.width * source.rect[2]);
    height = Math.round(metadata.height * source.rect[3]);
  } else if (source.shiftedGrid) {
    const column = source.index % source.columns;
    const row = Math.floor(source.index / source.columns);
    const baseCellWidth = metadata.width / source.columns;
    const centerX = (column + 0.62) * baseCellWidth;
    width = Math.round(baseCellWidth * 1.04);
    left = Math.round(centerX - width / 2);
    left = clamp(left, 0, metadata.width - width);
    const y0 = Math.round((row * metadata.height) / source.rows);
    const y1 = Math.round(((row + 1) * metadata.height) / source.rows);
    top = y0;
    height = y1 - y0;
  } else {
    const column = source.index % source.columns;
    const row = Math.floor(source.index / source.columns);
    const x0 = Math.round((column * metadata.width) / source.columns);
    const x1 = Math.round(((column + 1) * metadata.width) / source.columns);
    const y0 = Math.round((row * metadata.height) / source.rows);
    const y1 = Math.round(((row + 1) * metadata.height) / source.rows);
    left = x0;
    top = y0;
    width = x1 - x0;
    height = y1 - y0;
  }
  left = clamp(left, 0, metadata.width - 1);
  top = clamp(top, 0, metadata.height - 1);
  width = clamp(width, 1, metadata.width - left);
  height = clamp(height, 1, metadata.height - top);
  return sharp(source.path)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .png()
    .toBuffer();
}

function mergeSegments(segments, maxGap) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && segment.start - previous.end - 1 <= maxGap) {
      previous.end = segment.end;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

async function horizontalObjectRects(buffer, maximum = 4) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const occupied = new Array(info.width).fill(0);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 18) occupied[x] += 1;
    }
  }
  const segments = [];
  let start = -1;
  for (let x = 0; x <= occupied.length; x += 1) {
    const active = x < occupied.length && occupied[x] > 0;
    if (active && start < 0) start = x;
    if (!active && start >= 0) {
      segments.push({ start, end: x - 1 });
      start = -1;
    }
  }
  let merged = mergeSegments(segments, Math.max(2, Math.round(info.width * 0.012)));
  merged = merged.filter((segment) => {
    let pixels = 0;
    for (let x = segment.start; x <= segment.end; x += 1) pixels += occupied[x];
    return pixels > 80 && segment.end - segment.start > 5;
  });
  while (merged.length > maximum) {
    let best = 0;
    let bestGap = Infinity;
    for (let index = 0; index < merged.length - 1; index += 1) {
      const gap = merged[index + 1].start - merged[index].end;
      if (gap < bestGap) {
        best = index;
        bestGap = gap;
      }
    }
    merged[best].end = merged[best + 1].end;
    merged.splice(best + 1, 1);
  }
  if (!merged.length) merged = [{ start: 0, end: info.width - 1 }];
  const rects = [];
  for (const segment of merged) {
    let minY = info.height;
    let maxY = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = segment.start; x <= segment.end; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] > 18) {
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxY >= minY) {
      rects.push({
        left: Math.max(0, segment.start - 2),
        top: Math.max(0, minY - 2),
        width: Math.min(info.width, segment.end + 3) - Math.max(0, segment.start - 2),
        height: Math.min(info.height, maxY + 3) - Math.max(0, minY - 2)
      });
    }
  }
  return rects;
}

async function dominantCenteredPose(buffer, preferredX = 0.5, maxWidthFraction = null) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const occupied = new Array(info.width).fill(0);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 18) occupied[x] += 1;
    }
  }
  const center = info.width * preferredX;
  let peakX = Math.round(center);
  let peakScore = -Infinity;
  for (let x = 0; x < info.width; x += 1) {
    const score = occupied[x] - Math.abs(x - center) * 0.07;
    if (score > peakScore) {
      peakScore = score;
      peakX = x;
    }
  }
  const peak = Math.max(1, occupied[peakX]);
  const valley = Math.max(1, Math.round(peak * 0.075));
  let left = 0;
  let lowRun = 0;
  for (let x = peakX; x >= 0; x -= 1) {
    if (occupied[x] <= valley) lowRun += 1;
    else lowRun = 0;
    if (lowRun >= 2) {
      left = x + 2;
      break;
    }
  }
  let right = info.width - 1;
  lowRun = 0;
  for (let x = peakX; x < info.width; x += 1) {
    if (occupied[x] <= valley) lowRun += 1;
    else lowRun = 0;
    if (lowRun >= 2) {
      right = x - 2;
      break;
    }
  }
  left = Math.max(0, left - 3);
  right = Math.min(info.width - 1, right + 3);
  if (right - left < 8) {
    left = Math.max(0, peakX - Math.round(info.width * 0.14));
    right = Math.min(info.width - 1, peakX + Math.round(info.width * 0.14));
  }
  if (maxWidthFraction && right - left + 1 > info.width * maxWidthFraction) {
    const half = Math.round((info.width * maxWidthFraction) / 2);
    left = Math.max(0, peakX - half);
    right = Math.min(info.width - 1, peakX + half);
  }
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 18) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxY < minY) return trimBuffer(buffer);
  const rect = {
    left,
    top: Math.max(0, minY - 3),
    width: right - left + 1,
    height: Math.min(info.height, maxY + 4) - Math.max(0, minY - 3)
  };
  return trimBuffer(await sharp(buffer).extract(rect).png().toBuffer());
}

async function trimBuffer(buffer) {
  try {
    return await sharp(buffer)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 3 })
      .png()
      .toBuffer();
  } catch {
    return buffer;
  }
}

async function loadSourceViews(source) {
  let cell = await cropSource(source);
  if (source.innerGrid) {
    const metadata = await sharp(cell).metadata();
    const column = source.innerGrid.index % source.innerGrid.columns;
    const row = Math.floor(source.innerGrid.index / source.innerGrid.columns);
    const x0 = Math.round((column * metadata.width) / source.innerGrid.columns);
    const x1 = Math.round(((column + 1) * metadata.width) / source.innerGrid.columns);
    const y0 = Math.round((row * metadata.height) / source.innerGrid.rows);
    const y1 = Math.round(((row + 1) * metadata.height) / source.innerGrid.rows);
    cell = await sharp(cell)
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .png()
      .toBuffer();
  }
  if (!source.turnaround) return [await trimBuffer(cell)];
  if (source.innerGrid) return [await trimBuffer(cell)];
  if (source.fixedViews) {
    const metadata = await sharp(cell).metadata();
    const views = [];
    for (let index = 0; index < source.fixedViews; index += 1) {
      const segmentWidth = metadata.width / source.fixedViews;
      const center = (index + 0.5) * segmentWidth;
      const multiplier = source.fixedViews === 2 ? 1.1 : 1.55;
      const windowWidth = Math.min(metadata.width, Math.round(segmentWidth * multiplier));
      const x0 = clamp(Math.round(center - windowWidth / 2), 0, metadata.width - windowWidth);
      const window = await sharp(cell)
        .extract({ left: x0, top: 0, width: windowWidth, height: metadata.height })
        .png()
        .toBuffer();
      views.push(
        await dominantCenteredPose(window, 0.5, 0.78)
      );
    }
    if (source.preferredView) {
      return views.slice(source.preferredView).concat(views.slice(0, source.preferredView));
    }
    return views;
  }
  if (source.centeredGroup) {
    return [await dominantCenteredPose(cell, source.preferredX || 0.5, source.maxPoseWidthFraction || null)];
  }
  let rects = await horizontalObjectRects(cell, source.centeredGroup ? 7 : 4);
  const views = [];
  for (const rect of rects) {
    views.push(await trimBuffer(await sharp(cell).extract(rect).png().toBuffer()));
  }
  return views.length ? views : [await trimBuffer(cell)];
}

async function resizePose(buffer, frameSize, scale = 1, widthScale = 1, heightScale = 1) {
  const margin = frameSize >= 120 ? 10 : 6;
  const maxWidth = Math.max(2, Math.round((frameSize - margin * 2) * scale * widthScale));
  const maxHeight = Math.max(2, Math.round((frameSize - margin - 4) * scale * heightScale));
  const output = await sharp(buffer)
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      kernel: sharp.kernel.nearest,
      withoutEnlargement: false
    })
    .png()
    .toBuffer();
  const metadata = await sharp(output).metadata();
  return { buffer: output, width: metadata.width, height: metadata.height };
}

async function flipPose(pose) {
  const output = await sharp(pose.buffer).flop().png().toBuffer();
  return { buffer: output, width: pose.width, height: pose.height };
}

async function tintPose(pose, color) {
  const output = await sharp(pose.buffer).tint(color).png().toBuffer();
  return { buffer: output, width: pose.width, height: pose.height };
}

function place(pose, frameSize, row, column, dx = 0, dy = 0, gravity = 'bottom') {
  const cellLeft = column * frameSize;
  const cellTop = row * frameSize;
  const baseY = gravity === 'center' ? Math.round((frameSize - pose.height) / 2) : frameSize - pose.height - 4;
  return {
    input: pose.buffer,
    left: Math.round(cellLeft + (frameSize - pose.width) / 2 + dx),
    top: Math.round(cellTop + baseY + dy)
  };
}

function shapeEffectSvg(type, frame, total, size, accent, direction = 'south', intensity = 1) {
  const progress = total <= 1 ? 1 : frame / (total - 1);
  const opacity = clamp(Math.sin(progress * Math.PI) * intensity, 0.05, 1);
  const { r, g, b } = hexToRgb(accent);
  const secondary = `rgb(${clamp(r + 55, 0, 255)},${clamp(g + 55, 0, 255)},${clamp(b + 55, 0, 255)})`;
  const color = accent;
  const cx = size / 2;
  const cy = size * 0.58;
  const p = Math.round(progress * size);
  const stroke = Math.max(2, Math.round(size / 24));
  const transform =
    direction === 'north'
      ? `rotate(180 ${cx} ${cy})`
      : direction === 'east'
        ? `rotate(-90 ${cx} ${cy})`
        : direction === 'west'
          ? `rotate(90 ${cx} ${cy})`
          : '';
  let shapes = '';
  if (type === 'slash') {
    shapes = `<path d="M ${size * 0.18} ${size * 0.62} Q ${cx} ${size * (0.12 + progress * 0.12)} ${size * 0.84} ${size * 0.62}" fill="none" stroke="${secondary}" stroke-width="${stroke}" stroke-linecap="square"/><path d="M ${size * 0.25} ${size * 0.66} Q ${cx} ${size * 0.24} ${size * 0.77} ${size * 0.66}" fill="none" stroke="${color}" stroke-width="${Math.max(1, stroke - 2)}"/>`;
  } else if (type === 'leaf') {
    shapes = [0, 1, 2, 3]
      .map((index) => {
        const x = Math.round(size * (0.2 + ((index * 0.19 + progress * 0.17) % 0.65)));
        const y = Math.round(size * (0.25 + ((index * 0.21 + progress * 0.3) % 0.55)));
        return `<path d="M${x} ${y} l${stroke * 2} -${stroke} l-${stroke} ${stroke * 3} z" fill="${index % 2 ? secondary : color}"/>`;
      })
      .join('');
  } else if (type === 'root') {
    shapes = `<path d="M ${size * 0.08} ${size * 0.86} L ${size * 0.26} ${size * 0.69} L ${size * 0.38} ${size * 0.86} L ${size * 0.56} ${size * 0.62} L ${size * 0.72} ${size * 0.86} L ${size * 0.9} ${size * 0.7}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="miter"/><rect x="${Math.round(cx - stroke)}" y="${Math.round(size * (0.68 - progress * 0.18))}" width="${stroke * 2}" height="${Math.round(size * 0.2)}" fill="${secondary}"/>`;
  } else if (type === 'spore') {
    shapes = [0, 1, 2, 3, 4, 5]
      .map((index) => {
        const angle = index * 1.047 + progress * 2;
        const radius = size * (0.12 + progress * 0.28);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.6;
        const dot = Math.max(2, Math.round(size / (index % 2 ? 18 : 14)));
        return `<rect x="${Math.round(x - dot / 2)}" y="${Math.round(y - dot / 2)}" width="${dot}" height="${dot}" fill="${index % 2 ? secondary : color}"/>`;
      })
      .join('');
  } else if (type === 'crystal') {
    shapes = [0, 1, 2, 3]
      .map((index) => {
        const angle = index * Math.PI / 2 + progress * 0.7;
        const radius = size * (0.18 + progress * 0.18);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.7;
        const unit = size / 18;
        return `<path d="M${x} ${y - unit * 2} L${x + unit} ${y} L${x} ${y + unit * 2} L${x - unit} ${y} z" fill="${index % 2 ? secondary : color}"/>`;
      })
      .join('');
  } else if (type === 'lightning') {
    shapes = `<polyline points="${size * 0.18},${size * 0.26} ${size * 0.4},${size * 0.44} ${size * 0.31},${size * 0.48} ${size * 0.62},${size * 0.68} ${size * 0.54},${size * 0.72} ${size * 0.84},${size * 0.88}" fill="none" stroke="${secondary}" stroke-width="${stroke + 1}" stroke-linejoin="miter"/><polyline points="${size * 0.3},${size * 0.2} ${size * 0.54},${size * 0.37} ${size * 0.48},${size * 0.42} ${size * 0.76},${size * 0.58}" fill="none" stroke="${color}" stroke-width="${Math.max(2, stroke - 1)}"/>`;
  } else if (type === 'tide') {
    shapes = `<path d="M ${size * 0.08} ${size * 0.7} Q ${size * 0.28} ${size * (0.35 - progress * 0.08)} ${size * 0.48} ${size * 0.7} T ${size * 0.9} ${size * 0.7}" fill="none" stroke="${secondary}" stroke-width="${stroke + 1}"/><path d="M ${size * 0.16} ${size * 0.78} Q ${size * 0.35} ${size * 0.55} ${size * 0.55} ${size * 0.78} T ${size * 0.88} ${size * 0.78}" fill="none" stroke="${color}" stroke-width="${Math.max(2, stroke - 1)}"/>`;
  } else if (type === 'coin-burst') {
    shapes = [0, 1, 2, 3, 4, 5]
      .map((index) => {
        const angle = index * 1.047;
        const radius = size * (0.12 + progress * 0.3);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        const unit = Math.max(3, Math.round(size / 15));
        return `<rect x="${Math.round(x - unit / 2)}" y="${Math.round(y - unit)}" width="${unit}" height="${unit * 2}" fill="${index % 2 ? secondary : color}"/><rect x="${Math.round(x - 1)}" y="${Math.round(y - unit + 2)}" width="2" height="${unit * 2 - 4}" fill="#fff3a0"/>`;
      })
      .join('');
  } else {
    const radius = Math.max(4, Math.round(size * (0.14 + progress * 0.27)));
    shapes = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}"/><circle cx="${cx}" cy="${cy}" r="${Math.max(2, radius - stroke * 2)}" fill="none" stroke="${secondary}" stroke-width="${Math.max(1, stroke - 1)}"/><circle cx="${cx + p * 0.17}" cy="${cy - p * 0.22}" r="${Math.max(2, stroke)}" fill="${secondary}"/><rect x="${cx + p * 0.17}" y="${cy - p * 0.22 - size * 0.13}" width="${Math.max(2, stroke)}" height="${Math.round(size * 0.14)}" fill="${secondary}"/>`;
  }
  return Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><g opacity="${opacity.toFixed(2)}" transform="${transform}" shape-rendering="crispEdges">${shapes}</g></svg>`
  );
}

function emoteSvg(expression, size, accent) {
  const unit = Math.max(2, Math.round(size / 32));
  let marks = '';
  if (expression === 'happy') {
    marks = `<path d="M${size * 0.77} ${size * 0.18} h${unit * 4} M${size * 0.77 + unit * 2} ${size * 0.18 - unit * 2} v${unit * 4}" stroke="#ffd45c" stroke-width="${unit}" /><path d="M${size * 0.17} ${size * 0.28} h${unit * 3} M${size * 0.17 + unit * 1.5} ${size * 0.28 - unit * 1.5} v${unit * 3}" stroke="#ffd45c" stroke-width="${unit}" />`;
  } else if (expression === 'angry') {
    marks = `<polyline points="${size * 0.12},${size * 0.23} ${size * 0.22},${size * 0.14} ${size * 0.28},${size * 0.25} ${size * 0.36},${size * 0.15}" fill="none" stroke="#ff6f7f" stroke-width="${unit * 2}"/><polyline points="${size * 0.66},${size * 0.15} ${size * 0.73},${size * 0.25} ${size * 0.82},${size * 0.14} ${size * 0.89},${size * 0.23}" fill="none" stroke="#ff6f7f" stroke-width="${unit * 2}"/>`;
  } else if (expression === 'surprised') {
    marks = `<circle cx="${size * 0.82}" cy="${size * 0.18}" r="${unit * 4}" fill="none" stroke="#62d9ff" stroke-width="${unit * 2}"/><rect x="${size * 0.81}" y="${size * 0.1}" width="${unit * 2}" height="${unit * 5}" fill="#62d9ff"/>`;
  } else if (expression === 'sad') {
    marks = `<path d="M${size * 0.83} ${size * 0.15} Q${size * 0.74} ${size * 0.26} ${size * 0.83} ${size * 0.33} Q${size * 0.92} ${size * 0.26} ${size * 0.83} ${size * 0.15}" fill="#62c7ff"/><path d="M${size * 0.17} ${size * 0.2} l${unit * 4} ${unit * 3}" stroke="#62c7ff" stroke-width="${unit}"/>`;
  } else if (expression === 'talking') {
    marks = `<circle cx="${size * 0.76}" cy="${size * 0.19}" r="${unit * 3}" fill="${accent}"/><rect x="${size * 0.78}" y="${size * 0.08}" width="${unit * 2}" height="${unit * 8}" fill="${accent}"/><circle cx="${size * 0.9}" cy="${size * 0.28}" r="${unit * 2}" fill="#ffd45c"/><rect x="${size * 0.91}" y="${size * 0.19}" width="${unit * 2}" height="${unit * 6}" fill="#ffd45c"/>`;
  } else {
    marks = `<rect x="${size * 0.13}" y="${size * 0.14}" width="${unit * 2}" height="${unit * 2}" fill="${accent}"/><rect x="${size * 0.84}" y="${size * 0.14}" width="${unit * 2}" height="${unit * 2}" fill="${accent}"/>`;
  }
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><g shape-rendering="crispEdges">${marks}</g></svg>`
  );
}

function silhouetteOverlaySvg(style, size, accent) {
  if (!style) return null;
  const stroke = Math.max(2, Math.round(size / 32));
  let shape = '';
  if (style === 'crown') {
    shape = `<path d="M${size * 0.34} ${size * 0.27} L${size * 0.4} ${size * 0.14} L${size * 0.48} ${size * 0.25} L${size * 0.56} ${size * 0.12} L${size * 0.65} ${size * 0.27} L${size * 0.62} ${size * 0.34} L${size * 0.36} ${size * 0.34} z" fill="${accent}" stroke="#271936" stroke-width="${stroke}"/>`;
  } else if (style === 'harp') {
    shape = `<path d="M${size * 0.2} ${size * 0.67} Q${size * 0.2} ${size * 0.23} ${size * 0.42} ${size * 0.18} Q${size * 0.57} ${size * 0.39} ${size * 0.5} ${size * 0.69} z" fill="none" stroke="${accent}" stroke-width="${stroke * 2}"/><path d="M${size * 0.29} ${size * 0.3} V${size * 0.65} M${size * 0.36} ${size * 0.25} V${size * 0.65} M${size * 0.43} ${size * 0.27} V${size * 0.65}" stroke="#f1e6cf" stroke-width="${stroke}"/>`;
  } else if (style === 'oracle') {
    shape = `<circle cx="${size * 0.5}" cy="${size * 0.3}" r="${size * 0.19}" fill="none" stroke="${accent}" stroke-width="${stroke * 2}"/><path d="M${size * 0.3} ${size * 0.3} L${size * 0.21} ${size * 0.18} M${size * 0.7} ${size * 0.3} L${size * 0.79} ${size * 0.18} M${size * 0.5} ${size * 0.11} V${size * 0.03}" stroke="#a3edf1" stroke-width="${stroke}"/>`;
  }
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><g shape-rendering="crispEdges">${shape}</g></svg>`);
}

function shadowSvg(size, kind, accent) {
  const width = kind === 'boss' ? size * 0.68 : kind === 'elite' ? size * 0.62 : size * 0.54;
  const height = kind === 'boss' ? size * 0.17 : size * 0.14;
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${size / 2}" cy="${size * 0.63}" rx="${width / 2}" ry="${height / 2}" fill="#101521" opacity=".48"/><ellipse cx="${size / 2}" cy="${size * 0.61}" rx="${width * 0.32}" ry="${height * 0.26}" fill="${accent}" opacity=".18"/></svg>`
  );
}

async function portraitFromSource(sourcePose, expression, accent, outputSize = 128) {
  const metadata = await sharp(sourcePose).metadata();
  const cropHeight = Math.max(1, Math.round(metadata.height * 0.68));
  const head = await sharp(sourcePose)
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize({
      width: outputSize - 14,
      height: outputSize - 12,
      fit: 'inside',
      kernel: sharp.kernel.nearest,
      withoutEnlargement: false
    })
    .png()
    .toBuffer();
  const headMeta = await sharp(head).metadata();
  const halo = Buffer.from(
    `<svg width="${outputSize}" height="${outputSize}" xmlns="http://www.w3.org/2000/svg"><circle cx="${outputSize / 2}" cy="${outputSize * 0.54}" r="${outputSize * 0.4}" fill="#101521" opacity=".72"/><circle cx="${outputSize / 2}" cy="${outputSize * 0.54}" r="${outputSize * 0.4}" fill="none" stroke="${accent}" stroke-width="${Math.max(3, outputSize / 32)}" opacity=".9"/></svg>`
  );
  return transparentCanvas(outputSize, outputSize)
    .composite([
      { input: halo, left: 0, top: 0 },
      {
        input: head,
        left: Math.round((outputSize - headMeta.width) / 2),
        top: Math.round(outputSize - headMeta.height - 3)
      },
      { input: emoteSvg(expression, outputSize, accent), left: 0, top: 0 }
    ])
    .png()
    .toBuffer();
}

async function samplePalette(buffer, limit = 8) {
  const { data, info } = await sharp(buffer)
    .resize({ width: 96, height: 96, fit: 'inside', kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index + 3] < 160) continue;
    const r = Math.round(data[index] / 24) * 24;
    const g = Math.round(data[index + 1] / 24) * 24;
    const b = Math.round(data[index + 2] / 24) * 24;
    if (r + g + b < 40 || r + g + b > 735) continue;
    const key = `${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key]) => {
      const [r, g, b] = key.split(',').map(Number);
      return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    });
}

async function buildAsset(definition) {
  const targetDir = path.join(OUT, definition.categoryPath);
  const portraitDir = path.join(OUT, 'Portraits', definition.slug);
  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.mkdir(portraitDir, { recursive: true });
  const sourceViews = await loadSourceViews(definition.source);
  const directionBuffers = {
    south: sourceViews[0],
    north: sourceViews[1] || sourceViews[0],
    east: sourceViews[2] || sourceViews[0],
    west: sourceViews[3] || sourceViews[2] || sourceViews[0]
  };
  const poses = {
    south: await resizePose(directionBuffers.south, definition.frameSize),
    north: await resizePose(directionBuffers.north, definition.frameSize),
    east: await resizePose(directionBuffers.east, definition.frameSize)
  };
  poses.west =
    sourceViews[3] && sourceViews.length >= 4
      ? await resizePose(directionBuffers.west, definition.frameSize)
      : await flipPose(poses.east);
  const hurtPose = await tintPose(poses.south, '#ff6f7f');
  const overlay = silhouetteOverlaySvg(definition.overlay, definition.frameSize, definition.accent);
  const composites = [];
  const addBody = (pose, row, column, dx = 0, dy = 0) => {
    composites.push(place(pose, definition.frameSize, row, column, dx, dy));
    if (overlay) composites.push({ input: overlay, left: column * definition.frameSize, top: row * definition.frameSize });
  };
  const addEffect = (type, row, column, frame, total, direction = 'south', intensity = 1) => {
    composites.push({
      input: shapeEffectSvg(type, frame, total, definition.frameSize, definition.accent, direction, intensity),
      left: column * definition.frameSize,
      top: row * definition.frameSize
    });
  };

  const idleY = [0, -1, 0, 1];
  for (let row = 0; row < 4; row += 1) {
    const direction = ROWS[row].direction;
    for (let frame = 0; frame < 4; frame += 1) addBody(poses[direction], row, frame, 0, idleY[frame]);
  }
  const walkY = [0, -1, 0, 1, 0, -1, 0, 1];
  const walkX = [-1, 0, 1, 0, 1, 0, -1, 0];
  for (let row = 4; row < 8; row += 1) {
    const direction = ROWS[row].direction;
    for (let frame = 0; frame < 8; frame += 1) {
      const horizontal = direction === 'east' || direction === 'west' ? walkX[frame] * (direction === 'east' ? 1 : -1) : walkX[frame];
      addBody(poses[direction], row, frame, horizontal, walkY[frame]);
    }
  }
  const runY = [0, -2, 0, 2, 0, -2, 0, 2];
  const runX = [-2, 0, 2, 0, 2, 0, -2, 0];
  for (let row = 8; row < 12; row += 1) {
    const direction = ROWS[row].direction;
    for (let frame = 0; frame < 8; frame += 1) {
      const horizontal = direction === 'east' || direction === 'west' ? runX[frame] * (direction === 'east' ? 1 : -1) : runX[frame];
      addBody(poses[direction], row, frame, horizontal, runY[frame]);
    }
  }
  [0, -3, 2, 0].forEach((dx, frame) => addBody(frame === 1 || frame === 2 ? hurtPose : poses.south, 12, frame, dx, frame === 1 ? 1 : 0));

  const attackX = [0, 1, 3, 6, 4, 2, 1, 0];
  for (let frame = 0; frame < 8; frame += 1) {
    addBody(poses.south, 13, frame, attackX[frame], frame === 3 ? -1 : 0);
    if (frame >= 1 && frame <= 6) addEffect(definition.effect === 'note' ? 'slash' : definition.effect, 13, frame, frame - 1, 6);
  }
  const attackY = [1, 0, -2, -4, -2, 0, 1, 0];
  for (let frame = 0; frame < 8; frame += 1) {
    addEffect(definition.effect, 14, frame, frame, 8, frame % 2 ? 'east' : 'west', 0.88);
    addBody(poses.south, 14, frame, frame < 4 ? -1 : 1, attackY[frame]);
  }

  for (let frame = 0; frame < 12; frame += 1) {
    const progress = frame / 11;
    let scale = 1 - progress * 0.58;
    let widthScale = 1;
    let heightScale = 1;
    let dy = Math.round(progress * definition.frameSize * 0.3);
    if (definition.deathStyle === 'slime') {
      scale = 1 - progress * 0.2;
      widthScale = 1 + progress * 0.45;
      heightScale = 1 - progress * 0.72;
      dy = Math.round(progress * definition.frameSize * 0.25);
    } else if (definition.deathStyle === 'flying' || definition.deathStyle === 'spectral') {
      dy = -Math.round(progress * definition.frameSize * 0.28);
      scale = 1 - progress * 0.68;
    } else if (definition.deathStyle === 'large') {
      heightScale = 1 - progress * 0.42;
      widthScale = 1 + progress * 0.14;
      dy = Math.round(progress * definition.frameSize * 0.24);
    }
    const deathPose = await resizePose(directionBuffers.south, definition.frameSize, Math.max(0.2, scale), widthScale, Math.max(0.18, heightScale));
    if (frame > 5) addEffect(definition.effect, 15, frame, frame - 5, 7, 'south', 0.55);
    addBody(deathPose, 15, frame, frame % 2 ? 1 : -1, dy);
  }

  const specialY = [0, -1, -3, -4, -3, -1, 0, 1];
  for (let frame = 0; frame < 8; frame += 1) {
    addEffect(definition.effect, 16, frame, frame, 8, 'south', 1);
    addBody(poses.south, 16, frame, 0, specialY[frame]);
  }
  for (let frame = 0; frame < 4; frame += 1) {
    addBody(poses.south, 17, frame, frame % 2 ? 1 : -1, idleY[frame]);
    addEffect(frame % 2 ? 'note' : 'crystal', 17, frame, frame, 4, 'south', 0.62);
  }
  for (let frame = 0; frame < 8; frame += 1) {
    const scale = 0.24 + (frame / 7) * 0.76;
    const spawnPose = await resizePose(directionBuffers.south, definition.frameSize, scale);
    addEffect('resonance', 18, frame, frame, 8, 'south', 0.72);
    addBody(spawnPose, 18, frame, 0, Math.round((1 - scale) * definition.frameSize * 0.3));
  }
  composites.push({ input: shadowSvg(definition.frameSize, definition.group, definition.accent), left: 0, top: 19 * definition.frameSize });

  const portraitExpressions = ['neutral', 'happy', 'angry', 'surprised', 'sad', 'talking'];
  const portraitFiles = {};
  for (let index = 0; index < portraitExpressions.length; index += 1) {
    const expression = portraitExpressions[index];
    const portrait = await portraitFromSource(sourceViews[0], expression, definition.accent, 128);
    const portraitPath = path.join(portraitDir, `${expression}.png`);
    await sharp(portrait).png({ compressionLevel: 9 }).toFile(portraitPath);
    portraitFiles[expression] = path.relative(ROOT, portraitPath).replace(/\\/g, '/');
    const small = await sharp(portrait)
      .resize({ width: definition.frameSize, height: definition.frameSize, kernel: sharp.kernel.nearest })
      .png()
      .toBuffer();
    composites.push({ input: small, left: 0, top: (20 + index) * definition.frameSize });
  }

  const sheetWidth = FRAME_COLUMNS * definition.frameSize;
  const sheetHeight = ROWS.length * definition.frameSize;
  const sheetPath = path.join(targetDir, `${definition.slug}-sheet.png`);
  await transparentCanvas(sheetWidth, sheetHeight)
    .composite(composites)
    .png({ compressionLevel: 9, palette: false })
    .toFile(sheetPath);

  const palette = await samplePalette(sourceViews[0]);
  const animations = {};
  ROWS.forEach((row, rowIndex) => {
    animations[row.id] = {
      row: rowIndex,
      startFrame: 0,
      frameCount: row.frames,
      frames: Array.from({ length: row.frames }, (_, column) => ({
        x: column * definition.frameSize,
        y: rowIndex * definition.frameSize,
        width: definition.frameSize,
        height: definition.frameSize
      })),
      frameDurationMs: row.duration,
      loop: row.loop,
      ...(row.direction ? { direction: row.direction } : {})
    };
  });
  const digest = crypto.createHash('sha256').update(await fsp.readFile(sheetPath)).digest('hex');
  const manifest = {
    schemaVersion: 1,
    game: 'HIGH NOTES: Echoes of Mossvale',
    id: definition.slug,
    name: definition.name,
    group: definition.group,
    region: definition.region || null,
    bossClass: definition.bossClass || null,
    occupation: definition.occupation || null,
    aiArchetype: definition.ai || null,
    description: definition.description,
    source: definition.source.sourceLabel,
    sheet: path.basename(sheetPath),
    transparentBackground: true,
    pixelScale: 1,
    perspective: 'three-quarter top-down',
    frame: { width: definition.frameSize, height: definition.frameSize, columns: FRAME_COLUMNS, rows: ROWS.length },
    origin: { x: 0.5, y: 0.92 },
    accent: definition.accent,
    effectFamily: definition.effect,
    palette,
    shadow: { animation: 'shadow', row: 19 },
    portraits: portraitFiles,
    animations,
    sha256: digest,
    import: {
      filtering: 'nearest',
      compression: 'lossless',
      trim: false,
      extrude: 0,
      pivot: [0.5, 0.92]
    }
  };
  const manifestPath = path.join(targetDir, `${definition.slug}.json`);
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    definition,
    sheetPath,
    manifestPath,
    previewPose: poses.south,
    hash: digest,
    palette
  };
}

const ODIN_ACTIONS = [
  ['sleep', 6, true],
  ['sit', 6, true],
  ['roll', 8, false],
  ['happy', 8, true],
  ['excited', 8, true],
  ['eat', 8, true],
  ['drink', 8, true],
  ['dig', 8, true],
  ['sniff', 6, true],
  ['play', 8, true],
  ['guard', 6, true],
  ['growl', 8, true],
  ['attack', 8, false],
  ['dash', 8, false],
  ['carry_item', 8, true],
  ['celebrate', 8, false],
  ['petting_reaction', 8, true],
  ['spirit_howl', 8, false]
];

async function buildOdinActions() {
  const sourcePath = path.join(MASTERS, 'odin-expanded-actions.png');
  const outputDir = path.join(OUT, 'Companions', 'Odin');
  await fsp.mkdir(outputDir, { recursive: true });
  const frameSize = 80;
  const columns = 8;
  const composites = [];
  const manifest = {
    schemaVersion: 1,
    game: 'HIGH NOTES: Echoes of Mossvale',
    id: 'odin-expanded-actions',
    source: 'Sprites/_Masters/transparent/odin-expanded-actions.png',
    frame: { width: frameSize, height: frameSize, columns, rows: ODIN_ACTIONS.length },
    transparentBackground: true,
    origin: { x: 0.5, y: 0.92 },
    animations: {}
  };
  for (let row = 0; row < ODIN_ACTIONS.length; row += 1) {
    const [id, count, loop] = ODIN_ACTIONS[row];
    const poseBuffer = await cropSource(generated('odin-expanded-actions.png', 6, 3, row, false));
    const trimmed = await trimBuffer(poseBuffer);
    const pose = await resizePose(trimmed, frameSize);
    for (let frame = 0; frame < count; frame += 1) {
      let dx = 0;
      let dy = [0, -1, 0, 1, 0, -1, 0, 1][frame] || 0;
      if (id === 'dash') dx = [-5, -3, 0, 4, 7, 5, 2, 0][frame];
      if (id === 'attack') dx = [0, 1, 3, 6, 4, 2, 1, 0][frame];
      if (id === 'roll') dy = [0, 1, 2, 3, 2, 1, 0, 0][frame];
      if (id === 'celebrate') dy = [0, -3, -6, -3, 0, -2, 0, 1][frame];
      if (id === 'dig') dx = frame % 2 ? 2 : -2;
      if (id === 'happy' || id === 'excited') dx = frame % 2 ? 1 : -1;
      composites.push(place(pose, frameSize, row, frame, dx, dy));
      if (id === 'dash' || id === 'attack' || id === 'celebrate' || id === 'spirit_howl') {
        const effect = id === 'dash' ? 'lightning' : id === 'attack' ? 'slash' : 'note';
        composites.push({
          input: shapeEffectSvg(effect, frame, count, frameSize, id === 'celebrate' ? '#ffd45c' : '#53d8e8', 'south', 0.72),
          left: frame * frameSize,
          top: row * frameSize
        });
      }
    }
    manifest.animations[id] = {
      row,
      startFrame: 0,
      frameCount: count,
      frameDurationMs: id === 'dash' ? 55 : id === 'attack' ? 65 : 105,
      loop,
      frames: Array.from({ length: count }, (_, frame) => ({
        x: frame * frameSize,
        y: row * frameSize,
        width: frameSize,
        height: frameSize
      }))
    };
  }
  const sheetPath = path.join(outputDir, 'odin-expanded-actions-sheet.png');
  await transparentCanvas(columns * frameSize, ODIN_ACTIONS.length * frameSize)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(sheetPath);
  manifest.sheet = path.basename(sheetPath);
  manifest.sha256 = crypto.createHash('sha256').update(await fsp.readFile(sheetPath)).digest('hex');
  await fsp.writeFile(path.join(outputDir, 'odin-expanded-actions.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function buildPaletteAssets() {
  await fsp.mkdir(path.join(OUT, 'UI'), { recursive: true });
  const swatch = 48;
  const columns = 6;
  const rows = Math.ceil(SHARED_PALETTE.length / columns);
  const svg = `<svg width="${columns * swatch}" height="${rows * swatch}" xmlns="http://www.w3.org/2000/svg">${SHARED_PALETTE.map(
    (color, index) => {
      const x = (index % columns) * swatch;
      const y = Math.floor(index / columns) * swatch;
      return `<rect x="${x}" y="${y}" width="${swatch}" height="${swatch}" fill="${color.hex}"/><rect x="${x + 2}" y="${y + 2}" width="${swatch - 4}" height="${swatch - 4}" fill="none" stroke="#f1e6cf" stroke-opacity=".28" stroke-width="2"/>`;
    }
  ).join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, 'UI', 'mossvale-palette.png'));
  await fsp.writeFile(
    path.join(OUT, 'palette.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: 'Mossvale Production Palette',
        policy: 'Shared anchors plus role-specific sampled ramps; outlines stay soft-dark rather than pure black.',
        colors: SHARED_PALETTE,
        regionalAccents: REGION_ACCENTS
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

async function buildEffectsSheet() {
  const outputDir = path.join(OUT, 'Effects');
  await fsp.mkdir(outputDir, { recursive: true });
  const families = ['slash', 'leaf', 'root', 'spore', 'crystal', 'lightning', 'tide', 'resonance'];
  const colors = ['#ff6f7f', '#7ccf77', '#d9a85d', '#ef9a52', '#9de8ff', '#62d9ff', '#83e4dc', '#d77cff'];
  const frameSize = 64;
  const columns = 8;
  const composites = [];
  const manifest = { schemaVersion: 1, frame: { width: frameSize, height: frameSize, columns, rows: families.length }, effects: {} };
  families.forEach((family, row) => {
    for (let frame = 0; frame < columns; frame += 1) {
      composites.push({
        input: shapeEffectSvg(family, frame, columns, frameSize, colors[row]),
        left: frame * frameSize,
        top: row * frameSize
      });
    }
    manifest.effects[family] = {
      row,
      frameCount: columns,
      frameDurationMs: 70,
      loop: false,
      frames: Array.from({ length: columns }, (_, frame) => ({
        x: frame * frameSize,
        y: row * frameSize,
        width: frameSize,
        height: frameSize
      }))
    };
  });
  const output = path.join(outputDir, 'combat-effects-sheet.png');
  await transparentCanvas(columns * frameSize, families.length * frameSize)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(output);
  manifest.sheet = path.basename(output);
  await fsp.writeFile(path.join(outputDir, 'combat-effects.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function copyBradShopAssets() {
  const targetDir = path.join(OUT, 'UI', 'Brad Shop');
  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.copyFile(path.join(RUNTIME, 'brad-shop-items-sheet.png'), path.join(targetDir, 'brad-shop-items-sheet.png'));
  const manifest = {
    schemaVersion: 1,
    sheet: 'brad-shop-items-sheet.png',
    source: 'assets/sprites/runtime/brad-shop-items-sheet.png',
    transparentBackground: true,
    note: 'Existing production Brad shop inventory art retained and surfaced in the new asset hierarchy.',
    import: { filtering: 'nearest', compression: 'lossless' }
  };
  await fsp.writeFile(path.join(targetDir, 'brad-shop-items.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function buildContactSheet(groupName, built) {
  if (!built.length) return null;
  await fsp.mkdir(PREVIEWS, { recursive: true });
  const cellWidth = 176;
  const cellHeight = 152;
  const columns = Math.min(6, built.length);
  const rows = Math.ceil(built.length / columns);
  const composites = [];
  for (let index = 0; index < built.length; index += 1) {
    const item = built[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const pose = await resizePose(item.previewPose.buffer, 106);
    const label = Buffer.from(
      `<svg width="${cellWidth}" height="${cellHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${cellWidth}" height="${cellHeight}" rx="8" fill="#101521"/><rect x="2" y="2" width="${cellWidth - 4}" height="${cellHeight - 4}" rx="7" fill="none" stroke="${item.definition.accent}" stroke-width="2" opacity=".72"/><text x="${cellWidth / 2}" y="${cellHeight - 14}" text-anchor="middle" fill="#f1e6cf" font-family="monospace" font-size="11" font-weight="700">${escapeXml(item.definition.name)}</text></svg>`
    );
    composites.push({ input: label, left: column * cellWidth, top: row * cellHeight });
    composites.push({
      input: pose.buffer,
      left: column * cellWidth + Math.round((cellWidth - pose.width) / 2),
      top: row * cellHeight + Math.round((112 - pose.height) / 2) + 5
    });
  }
  const output = path.join(PREVIEWS, `${slugify(groupName)}-contact-sheet.png`);
  await sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 4,
      background: { r: 7, g: 11, b: 18, alpha: 1 }
    }
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(output);
  return output;
}

function animationLayoutForIndex() {
  return ROWS.map((row, index) => ({
    row: index,
    id: row.id,
    frames: row.frames,
    frameDurationMs: row.duration,
    loop: row.loop,
    direction: row.direction || null
  }));
}

async function writeGlobalFiles(results) {
  const entries = [];
  for (const definition of assets) {
    const targetDir = path.join(OUT, definition.categoryPath);
    const sheetPath = path.join(targetDir, `${definition.slug}-sheet.png`);
    const manifestPath = path.join(targetDir, `${definition.slug}.json`);
    entries.push({
      id: definition.slug,
      name: definition.name,
      group: definition.group,
      region: definition.region || null,
      folder: path.relative(OUT, targetDir).replace(/\\/g, '/'),
      sheet: path.relative(OUT, sheetPath).replace(/\\/g, '/'),
      manifest: path.relative(OUT, manifestPath).replace(/\\/g, '/'),
      frameSize: definition.frameSize,
      exists: await fileExists(sheetPath)
    });
  }
  const globalManifest = {
    schemaVersion: 1,
    title: 'HIGH NOTES: Echoes of Mossvale — Production Pixel Art Library',
    generatedAt: new Date().toISOString(),
    transparentBackgrounds: true,
    frameColumns: FRAME_COLUMNS,
    standardRows: animationLayoutForIndex(),
    totals: {
      characters: entries.length,
      npcs: entries.filter((entry) => entry.group === 'npc').length,
      regionalEnemies: entries.filter((entry) => entry.group === 'enemy').length,
      elites: entries.filter((entry) => entry.group === 'elite').length,
      bossesAndMinibosses: entries.filter((entry) => entry.group === 'boss').length,
      companions: entries.filter((entry) => entry.group === 'companion').length,
      complete: entries.filter((entry) => entry.exists).length
    },
    sourcePromptSummary: SOURCE_PROMPTS,
    imageGenerationMode: 'OpenAI built-in ImageGen, followed by local chroma-key alpha processing',
    entries
  };
  await fsp.writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify(globalManifest, null, 2)}\n`, 'utf8');

  const readme = `# HIGH NOTES: Echoes of Mossvale — Production Sprites

This library is the engine-ready character and creature art contract for the game. Source masters remain in \`_Masters/\`; production sheets are transparent PNGs in the requested hierarchy.

## Standard sheet contract

- 12 columns; ${ROWS.length} rows.
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

Odin additionally has \`Companions/Odin/odin-expanded-actions-sheet.png\`, containing 18 separately timed eight-frame-or-shorter animations for sleep, sit, roll, happy, excited, eat, drink, dig, sniff, play, guard, growl, attack, dash, carry item, celebrate, petting reaction and spirit howl.

## Engine import

- **HTML5 Canvas / PixiJS / Phaser:** load the per-character JSON, create frames from each \`animations.*.frames\` rectangle, and use \`frameDurationMs\`.
- **Godot:** import with Filter off, Mipmaps off, Lossless compression; use \`frame.width\` and \`frame.height\` in SpriteFrames.
- **Unity:** Sprite Mode Multiple, Pixels Per Unit to match the game camera, Filter Mode Point, Compression None; slice by the manifest frame size and set the pivot to the supplied origin.

## Palette and effects

\`palette.json\` and \`UI/mossvale-palette.png\` define the reusable world anchors. Each character manifest also includes an eight-colour sampled ramp from its actual artwork. \`Effects/combat-effects-sheet.png\` supplies shared slash, leaf, root, spore, crystal, lightning, tide and resonance animation families.

## Source and transparency

New raster masters were created with OpenAI's built-in ImageGen on a flat chroma background and processed locally into alpha-safe transparent PNGs. Existing shipped character and enemy art was retained where it already provided a distinct high-quality identity. The generated sources, transparent masters and final sheets are all preserved; there is no destructive overwrite of the runtime atlas.
`;
  await fsp.writeFile(path.join(OUT, 'README.md'), readme, 'utf8');

  const qa = {
    generatedAt: new Date().toISOString(),
    expectedSheets: entries.length,
    existingSheets: entries.filter((entry) => entry.exists).length,
    missingSheets: entries.filter((entry) => !entry.exists).map((entry) => entry.sheet),
    duplicateWholeSheetHashes: [],
    notes: [
      'Whole-sheet hashes are checked separately during validation.',
      'Animation frames intentionally reuse key-pose pixels with authored integer motion and effect overlays to preserve pixel crispness.',
      'All production sheets retain alpha and equal cell spacing.'
    ]
  };
  const hashMap = new Map();
  for (const result of results) {
    if (!hashMap.has(result.hash)) hashMap.set(result.hash, []);
    hashMap.get(result.hash).push(result.definition.name);
  }
  qa.duplicateWholeSheetHashes = [...hashMap.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([hash, names]) => ({ hash, names }));
  await fsp.writeFile(path.join(OUT, 'qa-report.json'), `${JSON.stringify(qa, null, 2)}\n`, 'utf8');
}

async function main() {
  const groupArgument = process.argv.find((argument) => argument.startsWith('--group='));
  const requestedGroup = groupArgument ? groupArgument.split('=')[1] : 'all';
  await fsp.mkdir(OUT, { recursive: true });
  const selected = requestedGroup === 'all' ? assets : assets.filter((entry) => entry.group === requestedGroup);
  const missingSources = [];
  for (const definition of selected) {
    if (!(await fileExists(definition.source.path))) missingSources.push(definition.source.path);
  }
  if (missingSources.length) throw new Error(`Missing source files:\n${missingSources.join('\n')}`);

  const results = [];
  for (let index = 0; index < selected.length; index += 1) {
    const definition = selected[index];
    console.log(`[${index + 1}/${selected.length}] ${definition.group}: ${definition.name}`);
    results.push(await buildAsset(definition));
  }
  if (requestedGroup === 'all' || requestedGroup === 'companion') await buildOdinActions();
  if (requestedGroup === 'all' || requestedGroup === 'support') {
    await buildPaletteAssets();
    await buildEffectsSheet();
    await copyBradShopAssets();
  }
  const grouped = new Map();
  results.forEach((result) => {
    const key = result.definition.group === 'enemy' ? result.definition.region : result.definition.group;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(result);
  });
  for (const [groupName, groupResults] of grouped.entries()) {
    await buildContactSheet(groupName, groupResults);
  }
  await writeGlobalFiles(results);
  console.log(`Built ${results.length} standardized character sheets in ${OUT}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
