#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const living = require(path.join(root, 'living-resonance-runtime.js'));

const expectedClasses = ['riffblade', 'groveguard', 'echo-weaver', 'tempo-runner'];
const expectedInstruments = ['guitar', 'bass', 'synth', 'drums', 'microphone', 'violin'];
const expectedRegions = ['mossvale', 'rootsong', 'skyglass', 'moonwake'];
const expectedBosses = ['nullspeaker', 'rootbound', 'prism-choir', 'tidebreaker'];
const expectedChallenges = ['standard', 'no-healing', 'perfect-guard', 'time-trial', 'instrument-locked'];
const expectedTiers = ['Disturbed', 'Returning Rhythm', 'Shared Harmony', 'Fully Resonant'];

assert.equal(living.schemaVersion, 2, 'Living Resonance catalog schema');
assert.deepEqual(Array.from(living.classIds), expectedClasses, 'four known campaign classes');
assert.deepEqual(Array.from(living.instrumentIds), expectedInstruments, 'six known instruments');
assert.deepEqual(Array.from(living.regionIds), expectedRegions, 'four known regions');
assert.deepEqual(Array.from(living.bossIds), expectedBosses, 'four rehearsal bosses');
assert.deepEqual(Array.from(living.challengeIds), expectedChallenges, 'five rehearsal arrangements');

// Mastery is a complete 4 x 2 catalog. Node IDs must be globally unique so
// sanitation cannot unlock a node belonging to another class or path.
const nodeIds = new Set();
for (const classId of expectedClasses) {
  const classDef = living.mastery[classId];
  assert.ok(classDef, `missing mastery definition for ${classId}`);
  assert.equal(classDef.classId, classId, `${classId} mastery owner`);
  const paths = Object.values(classDef.paths);
  assert.equal(paths.length, 2, `${classId} must expose exactly two paths`);
  assert.equal(new Set(paths.map((entry) => entry.id)).size, 2, `${classId} path IDs must be unique`);
  for (const pathDef of paths) {
    assert.ok(pathDef.name && pathDef.summary && pathDef.emblem, `${classId}/${pathDef.id} presentation metadata`);
    assert.ok(pathDef.nodes.length >= 3, `${classId}/${pathDef.id} needs at least three nodes`);
    pathDef.nodes.forEach((node, index) => {
      assert.equal(node.pathId, pathDef.id.includes(classId) ? pathDef.id : `${classId}-${pathDef.id}`,
        `${node.id} path ownership`);
      assert.equal(node.tier, index + 1, `${node.id} tier ordering`);
      assert.equal(node.capstone, index === pathDef.nodes.length - 1, `${node.id} capstone flag`);
      assert.ok(node.name && node.effect && node.description, `${node.id} gameplay description`);
      assert.equal(nodeIds.has(node.id), false, `duplicate mastery node ${node.id}`);
      nodeIds.add(node.id);
      assert.equal(living.nodeById(classId, node.id), node, `${node.id} lookup`);
      assert.equal(living.pathForNode(classId, node.id), pathDef.id, `${node.id} path lookup`);
    });
  }
}
assert.equal(nodeIds.size >= 24, true, 'at least 24 mastery nodes across eight paths');

// Every class/instrument pair appears once and resolves through the central registry.
const synergies = Object.values(living.synergies);
assert.equal(synergies.length, 24, '4 x 6 synergy matrix');
assert.equal(new Set(synergies.map((entry) => entry.id)).size, 24, 'synergy IDs are unique');
for (const classId of expectedClasses) {
  for (const instrumentId of expectedInstruments) {
    const id = `${classId}-${instrumentId}`;
    const entry = living.synergyFor(classId, instrumentId);
    assert.equal(entry, living.synergies[id], `${id} central lookup`);
    assert.equal(entry.classId, classId, `${id} class`);
    assert.equal(entry.instrumentId, instrumentId, `${id} instrument`);
    assert.ok(entry.name && entry.summary && entry.effect && entry.audioCue && entry.color, `${id} identity`);
  }
}

for (const regionId of expectedRegions) {
  const region = living.regions[regionId];
  assert.ok(region, `missing restoration definition for ${regionId}`);
  assert.deepEqual(Array.from(region.tiers), expectedTiers, `${regionId} restoration tiers`);
  assert.equal(region.layers.length, 3, `${regionId} procedural audio layers`);
  assert.equal(region.props.length, 3, `${regionId} restoration prop groups`);
}
assert.deepEqual(Object.keys(living.challenges), expectedChallenges, 'challenge catalog is complete');
for (const challengeId of expectedChallenges) {
  assert.ok(living.challenges[challengeId].name && living.challenges[challengeId].description,
    `${challengeId} challenge presentation`);
}

const fresh = living.freshState();
assert.equal(fresh.loadouts.length, 3, 'exactly three loadout slots');
assert.deepEqual(fresh.loadouts.map((entry) => entry.id), ['loadout-1', 'loadout-2', 'loadout-3']);
assert.equal(fresh.quickWheel.length, 8, 'exactly eight quick-wheel sectors');
assert.equal(fresh.quickWheel.every(living.validWheelAssignment), true, 'fresh wheel assignments are valid');
assert.deepEqual(Object.keys(fresh.classMastery), expectedClasses, 'fresh mastery records are per class');
assert.deepEqual(Object.keys(fresh.restoration), expectedRegions, 'fresh restoration records are per region');
assert.deepEqual(Object.keys(fresh.rhythmTrials), expectedRegions, 'fresh rhythm records are per region');
assert.equal(Object.values(fresh.rhythmTrials).every((record) => !record.cleared && record.bestScore === 0), true,
  'fresh rhythm records begin safely uncleared');

// Corrupt/forward-looking data must clamp or fail closed without mutating the input.
const corrupt = {
  classMastery: {
    riffblade: {
      xp: Number.POSITIVE_INFINITY,
      level: 999,
      selectedPath: 'future-path',
      unlockedNodes: ['riffblade-lead-line-1', 'future-node', 'riffblade-power-chord-3'],
      respecs: 100000
    },
    'future-class': {xp: 500, unlockedNodes: ['future-node']}
  },
  restoration: {
    mossvale: {points: 9999, tier: -42, claimedTiers: [1, 1, 2, 7, '3']},
    rootsong: {points: -80, claimedTiers: [0, 4]},
    'future-region': {points: 8, claimedTiers: [1, 2, 3]}
  },
  rehearsal: {
    records: {
      'nullspeaker:standard:5': {bestTime: 1e9, bestDamageTaken: 1e9, bestPerfectGuards: 1e9, rank: 'Z', completions: 1e9},
      'future-boss:standard:1': {bestTime: 1},
      'rootbound:future-mode:1': {bestTime: 1},
      'rootbound:no-healing:9': {bestTime: 1}
    },
    claimedRewards: ['nullspeaker:standard:5', 'nullspeaker:standard:5', 'future-boss:standard:1']
  },
  loadouts: [{
    id: 'loadout-99',
    name: '<script>Long unsupported loadout title!</script>',
    instrument: 'future-instrument',
    equipment: {armour: 'future-armour', footwear: 'moss-boots', ring: 'tempo-ring', futureSlot: 'ironbark-plate'},
    resonance: 'future-resonance',
    quickConsumables: ['field-tonic', 'field-tonic', 'future-tonic', 'tempo-tea', 'spore-tonic', 'thorn-ward', 'revival-seed'],
    cosmeticVariant: 'future-variant',
    saved: 1
  }, null, {}, {id: 'loadout-4', saved: true}],
  quickWheel: ['future:value', 'consumable:field-tonic', 'screen:map', 'screen:future', 'loadout:loadout-9', 'utility:odin', 7],
  encoreAdventure: {
    unlocked: 1,
    active: true,
    completed: true,
    cycle: 999,
    stage: 99,
    stageProgress: {mossvale: 999, rootsong: -5, future: 40},
    claimedRewards: ['encore-mossvale', 'encore-mossvale', 'encore-future'],
    cosmetics: ['encore-aura', 'future-cosmetic'],
    runId: '../unsafe',
    introSeen: 1,
    normalSnapshot: []
    ,encoreSnapshot: []
  },
  rewardClaims: ['mastery:riffblade:lead-line', 'mastery:riffblade:lead-line', '../unsafe', 'future reward']
};
const corruptBefore = JSON.stringify(corrupt);
const clean = living.sanitizeState(corrupt);
assert.equal(JSON.stringify(corrupt), corruptBefore, 'sanitation does not mutate source data');
assert.deepEqual(Object.keys(clean.classMastery), expectedClasses, 'unknown classes are removed');
assert.equal(clean.classMastery.riffblade.xp, 999999, 'non-finite XP clamps to the bounded maximum');
assert.equal(clean.classMastery.riffblade.level, 6, 'level is derived from sanitized XP');
assert.equal(clean.classMastery.riffblade.selectedPath, 'lead-line', 'unknown path is replaced by the first valid unlocked path');
assert.deepEqual(clean.classMastery.riffblade.unlockedNodes, ['riffblade-lead-line-1'], 'unknown and cross-path nodes are removed');
assert.equal(clean.classMastery.riffblade.respecs, 999, 'respec counter is bounded');
assert.equal(clean.restoration.mossvale.points, 8, 'restoration points clamp high');
assert.equal(clean.restoration.mossvale.tier, 3, 'restoration tier is derived, never trusted');
assert.deepEqual(clean.restoration.mossvale.claimedTiers, [1, 2], 'tier claims are known and unique');
assert.equal(clean.restoration.rootsong.points, 0, 'restoration points clamp low');
assert.equal('future-region' in clean.restoration, false, 'unknown regions are removed');
assert.deepEqual(Object.keys(clean.rehearsal.records), ['nullspeaker:standard:5'], 'unknown rehearsal IDs are removed');
assert.deepEqual(clean.rehearsal.records['nullspeaker:standard:5'], {
  bestTime: 99999,
  bestDamageTaken: 9999,
  bestPerfectGuards: 9999,
  rank: '',
  completions: 9999
}, 'rehearsal metrics clamp and unknown ranks fail closed');
assert.deepEqual(clean.rehearsal.claimedRewards, ['nullspeaker:standard:5'], 'rehearsal claims are valid and unique');
assert.equal(clean.loadouts.length, 3, 'excess loadouts are dropped');
assert.equal(clean.loadouts[0].id, 'loadout-1', 'loadout slot identity cannot be forged');
assert.ok(clean.loadouts[0].name.length <= 18 && !/[<>!]/.test(clean.loadouts[0].name), 'loadout name is bounded and filtered');
assert.equal(clean.loadouts[0].instrument, '', 'unknown instrument is removed');
assert.equal(clean.loadouts[0].equipment.armour, '', 'unknown equipment is removed');
assert.equal(clean.loadouts[0].equipment.footwear, 'moss-boots', 'known equipment survives');
assert.equal('futureSlot' in clean.loadouts[0].equipment, false, 'unknown equipment slots are removed');
assert.deepEqual(clean.loadouts[0].quickConsumables, ['field-tonic', 'tempo-tea', 'spore-tonic', 'thorn-ward'], 'consumables are known, unique, and capped');
assert.equal(clean.quickWheel.length, 8, 'wheel sanitation restores eight sectors');
assert.equal(clean.quickWheel.every(living.validWheelAssignment), true, 'invalid wheel assignments fail closed');
assert.equal(clean.encoreAdventure.cycle, 1, 'Encore is capped to one cycle');
assert.equal(clean.encoreAdventure.stage, 4, 'Encore stage is bounded');
assert.equal(clean.encoreAdventure.stageProgress.mossvale, 99, 'Encore progress clamps high');
assert.equal(clean.encoreAdventure.stageProgress.rootsong, 0, 'Encore progress clamps low');
assert.deepEqual(clean.encoreAdventure.claimedRewards, ['encore-mossvale'], 'Encore claims are known and unique');
assert.deepEqual(clean.encoreAdventure.cosmetics, ['encore-aura'], 'unknown Encore cosmetics are removed');
assert.equal(clean.encoreAdventure.runId, '', 'unsafe run IDs are removed');
assert.equal(clean.encoreAdventure.normalSnapshot, null, 'arrays cannot masquerade as Normal snapshots');
assert.equal(clean.encoreAdventure.encoreSnapshot, null, 'arrays cannot masquerade as Encore snapshots');
assert.deepEqual(clean.rewardClaims, ['mastery:riffblade:lead-line'], 'global claims are known-format and unique');
assert.equal(living.rehearsalKey('future-boss', 'future-mode', 99), 'nullspeaker:standard:5', 'rehearsal key fallback');
assert.deepEqual([0, 1, 2, 3].map((tier) => living.restorationTier([0, 2, 4, 6][tier])), [0, 1, 2, 3]);

// Source integration and isolation: the catalog loads before the campaign, the
// embedded save moved to 24, and Stock Battle never imports campaign systems.
const index = read('index.html');
const game = read('game.js');
const styles = read('styles.css');
const arena = read('v2-platform-fighter.js');
const expansion = read('v1-expansion.js');
assert.ok(index.indexOf('living-resonance-runtime.js') >= 0, 'living runtime script is included');
assert.ok(index.indexOf('living-resonance-runtime.js') < index.indexOf('game.js'), 'living runtime loads before game.js');
assert.match(game, /SAVE_SCHEMA_VERSION\s*=\s*25\b/, 'embedded save schema must be 25');
assert.ok(index.indexOf('resonance-gate-runtime.js') < index.indexOf('living-resonance-runtime.js'),
  'rhythm runtime loads before Living Resonance');
assert.match(game, /function openResonanceGate\b/, 'Resonance Gate controller is integrated');
assert.match(game, /window\.MossLivingResonance/, 'campaign consumes the central Living Resonance catalog');
assert.match(game, /function triggerLivingSynergy\b/, 'central synergy event hook is implemented');
for (const entry of synergies) assert.ok(game.includes(`case'${entry.effect}'`), `${entry.id} has a bounded gameplay hook`);
for (const hook of ['startRehearsal','finishRehearsal','openQuickWheel','closeQuickWheel','switchEncoreMode','drawLivingRestoration']) {
  assert.match(game, new RegExp(`function ${hook}\\b`), `${hook} runtime integration`);
}
assert.match(game, /rehearsalRuntime\.active\)\{finishRehearsal\(true\)/, 'rehearsal boss clear bypasses canonical rewards');
assert.match(game, /rehearsalRuntime\.active\)\{finishRehearsal\(false\)/, 'rehearsal defeat restores the canonical snapshot');
assert.match(index, /id="pauseEndRehearsalButton"/, 'pause menu exposes a protected rehearsal exit');
assert.match(game, /function confirmRehearsalStart\b/, 'rehearsal start uses a protected confirmation');
assert.match(game, /function confirmAbandonRehearsal\b/, 'rehearsal abandon uses a protected confirmation');
assert.match(game, /function rehearsalBlocksSideMode\b/, 'rehearsal state blocks unsafe side-mode transitions');
for (const screen of ['Map and quests','The backpack','Instruments','Skills','Player Home','Living Resonance']) {
  assert.ok(game.includes(`rehearsalBlocksSideMode('${screen}')`), `${screen} is isolated from rehearsal state`);
}
assert.match(game, /setOverlayIsolation\('pause','pauseScreen',false\);setHidden\(byId\('pauseScreen'\),true\);state=sanitizeState\(snapshot\.state\)/, 'rehearsal results cannot inherit the pause modal inert state');
assert.match(expansion, /production\.setHubOpen\(true\) === false\) return/, 'Version 2.0 Hub honors rehearsal isolation');
assert.match(game, /livingState\(\)\.encoreAdventure\.unlocked=true/, 'campaign finale unlocks Encore before its save');
assert.match(game, /returnFocusOnAccept:false,onConfirm:function\(\)\{switchEncoreMode/, 'Encore confirmation cannot return focus into its hidden panel');
assert.match(game, /restorationTier:livingRestoration\.tier/, 'adaptive audio receives restoration tier');
assert.match(game, /getRestoration:\s*function/, 'first-person renderer receives restoration state');
assert.match(styles, /\.quick-wheel-sectors\b/, 'radial quick-wheel styling');
assert.match(styles, /\.mastery-path-grid\b/, 'mastery screen styling');
assert.match(styles, /@media\(max-height:560px\)/, 'short-landscape Living Resonance layout');

const manifest = JSON.parse(read('assets/ui/living-resonance/manifest.json'));
assert.equal(manifest.assets.length, 16, 'generated atlas exports sixteen runtime assets');
assert.equal(new Set(manifest.assets.map((asset) => asset.id)).size, 16, 'runtime asset IDs are unique');
for (const asset of manifest.assets) {
  const runtimePath = path.join(root, asset.runtimePath);
  assert.ok(fs.existsSync(runtimePath), `${asset.id} runtime asset exists`);
  assert.ok(fs.statSync(runtimePath).size > 0 && fs.statSync(runtimePath).size < 100 * 1024, `${asset.id} is runtime-sized`);
  assert.equal(asset.width, 256, `${asset.id} width`);
  assert.equal(asset.height, 256, `${asset.id} height`);
  assert.equal(asset.alphaMin, 0, `${asset.id} retains transparency`);
  assert.equal(asset.alphaMax, 255, `${asset.id} retains opaque art`);
}
for (const forbidden of [
  /MossLivingResonance/,
  /classMastery/,
  /synerg(?:y|ies)/i,
  /restoration/,
  /rehearsalRuntime/,
  /quickWheel/,
  /encoreAdventure/,
  /campaign(?:Class|Equipment|Loadout)/
]) {
  assert.doesNotMatch(arena, forbidden, `Stock Battle isolation violated by ${forbidden}`);
}

console.log('V2.4 Living Resonance validation passed: 4 classes, 8 mastery paths, ' +
  `${nodeIds.size} nodes, 24 synergies, 4 regions, 4 bosses, 5 challenges, ` +
  '3 loadouts, 8 wheel sectors, corrupt-state sanitation, and Stock Battle isolation.');
