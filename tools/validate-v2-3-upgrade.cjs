#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => assert.ok(fs.existsSync(path.join(root, relative)), `Missing ${relative}`);
const story = require(path.join(root, 'story-runtime.js'));

assert.equal(story.schemaVersion, 1);
assert.deepEqual(Object.keys(story.arcs), ['1', '2', '3', '4']);
assert.deepEqual(Object.keys(story.chords), ['mossvale-major', 'rootsong-minor', 'skyglass-inversion', 'moonwake-seventh']);

const expectedChords = {
  'mossvale-major': ['C', 'E', 'G'],
  'rootsong-minor': ['E', 'G', 'B'],
  'skyglass-inversion': ['E', 'G', 'C'],
  'moonwake-seventh': ['C', 'E', 'G', 'B']
};
for (const [id, notes] of Object.entries(expectedChords)) {
  assert.deepEqual(Array.from(story.chords[id].notes), notes, `${id} must use the documented playable chord`);
  for (let count = 1; count < notes.length; count++) {
    assert.equal(story.evaluateChord(id, notes.slice(0, count)).status, 'partial', `${id} partial ${count}`);
  }
  assert.equal(story.evaluateChord(id, notes).complete, true, `${id} completes`);
  assert.equal(story.sanitizePuzzleState(id, { status: 'completed', input: ['Z'], attempts: 5000 }).attempts, 999);
}
assert.equal(story.evaluateChord('rootsong-minor', ['G']).status, 'wrong');
assert.equal(story.evaluateChord('mossvale-major', ['C', 'C']).status, 'wrong');
assert.equal(story.evaluateChord('future-chord', ['C']).status, 'invalid');
assert.equal(story.sanitizePuzzleState('future-chord', {}), null);
assert.ok(story.timingWindow('forgiving') > story.timingWindow('standard'));
assert.ok(story.timingWindow('relaxed') > story.timingWindow('forgiving'));

const index = read('index.html');
const game = read('game.js');
const input = read('input-manager.js');
const styles = read('styles.css');
assert.ok(index.indexOf('story-runtime.js') < index.indexOf('game.js'), 'story runtime must load before game.js');
for (const id of ['touchClassButton', 'touchAttackButton', 'touchBlockButton', 'touchInteractButton', 'characterClassChoices', 'chordPanel', 'touchLayout', 'mobileHaptics', 'chordTiming']) {
  assert.match(index, new RegExp(`id=["']${id}["']`), `Missing #${id}`);
}
for (const id of ['howPanel', 'settingsPanel', 'pauseScreen', 'inventoryScreen', 'shopScreen', 'skillsScreen', 'instrumentsScreen', 'homeScreen', 'statisticsScreen', 'mapScreen', 'productionHub']) {
  assert.match(index, new RegExp(`id=["']${id}["'][^>]*data-backdrop-dismiss=["']true["']`), `${id} must opt into backdrop dismissal`);
}
for (const id of ['characterCreator', 'composerScreen', 'endingScreen']) {
  assert.match(index, new RegExp(`id=["']${id}["'][^>]*data-backdrop-dismiss=["']protected["']`), `${id} must be protected`);
}
assert.match(game, /SAVE_SCHEMA_VERSION\s*=\s*24/, 'newer schemas must retain the v2.3 migration surface');
for (const id of ['riffblade', 'groveguard', 'echo-weaver', 'tempo-runner']) {
  assert.match(game, new RegExp(`['"]${id}['"]`), `Missing class ${id}`);
}
assert.match(game, /knownQuestStateIds/);
assert.match(game, /migrateStoryState\(clean,savedVersion\)/);
assert.match(game, /classFields\.length>=fieldLimit/, 'Echo fields retain an explicit bounded cap');
assert.match(input, /classAbility:\s*\['c'\]/);
assert.match(input, /L3\+R3/);
assert.match(styles, /touch-controls-mirrored/);
assert.match(styles, /menu-overlay-open \.tutorial-panel/);

const manifestPath = 'assets/ui/classes/manifest.json';
exists(manifestPath);
const manifest = JSON.parse(read(manifestPath));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.icons.length, 4);
assert.deepEqual(manifest.icons.map((icon) => icon.id), ['riffblade', 'groveguard', 'echo-weaver', 'tempo-runner']);
exists('assets/masters/classes/high-notes-starter-class-atlas-v1.png');
for (const icon of manifest.icons) {
  assert.equal(icon.width, 256);
  assert.equal(icon.height, 256);
  exists(path.posix.join('assets/ui/classes', icon.path));
}

async function validateRasterMetadata() {
  let sharp;
  try { sharp = require('sharp'); } catch (_) { return { checked: false }; }
  const master = await sharp(path.join(root, 'assets/masters/classes/high-notes-starter-class-atlas-v1.png')).metadata();
  assert.equal(master.width, 1254);
  assert.equal(master.height, 1254);
  assert.equal(master.hasAlpha, true);
  for (const icon of manifest.icons) {
    const metadata = await sharp(path.join(root, 'assets/ui/classes', icon.path)).metadata();
    assert.equal(metadata.width, icon.width, `${icon.id} width`);
    assert.equal(metadata.height, icon.height, `${icon.id} height`);
    assert.equal(metadata.hasAlpha, true, `${icon.id} alpha`);
    assert.ok(fs.statSync(path.join(root, 'assets/ui/classes', icon.path)).size < 100 * 1024, `${icon.id} runtime icon should stay under 100 KiB`);
  }
  return { checked: true };
}

validateRasterMetadata().then(({ checked }) => {
  console.log(`V2.3 upgrade validation passed: 4 story arcs, 4 playable chords, 4 starter classes; raster metadata ${checked ? 'checked' : 'skipped (sharp unavailable)'}.`);
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
