#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing ${relativePath}`);
}

function finitePoint(point, label) {
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y), `${label} must be finite`);
}

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(read('equipment-runtime.js'), sandbox, { filename: 'equipment-runtime.js' });

const rig = sandbox.window.MossEquipmentRig;
assert.ok(rig, 'MossEquipmentRig did not register');
assert.equal(rig.schemaVersion, 2);

const description = rig.describe();
const expectedEquipment = ['guitar', 'bass', 'synth', 'drums', 'microphone', 'violin'];
const expectedDirections = ['north', 'south', 'east', 'west'];
const requiredStates = [
  'idle', 'walk', 'run', 'attack', 'charged', 'special', 'block', 'dash',
  'dodge', 'hurt', 'stun', 'death', 'respawn', 'switch', 'victory', 'defeat'
];

assert.deepEqual(Array.from(description.equipmentIds), expectedEquipment);
for (const equipmentId of expectedEquipment) {
  assert.equal(rig.validateEquipmentId(equipmentId), true, `${equipmentId} must be registered`);
  for (const direction of expectedDirections) {
    for (const animationId of requiredStates) {
      const pose = rig.resolvePose({ equipmentId, direction, animationId, progress: 0.5 });
      assert.equal(pose.equipmentId, equipmentId);
      assert.equal(pose.direction, direction);
      assert.equal(pose.animationId, animationId);
      assert.ok(Number.isInteger(pose.frameIndex) && pose.frameIndex >= 0 && pose.frameIndex < pose.frameCount);
      assert.ok(['rear-effects', 'rear', 'body', 'front', 'front-effects'].includes(pose.item.layer));
      assert.ok(Number.isFinite(pose.item.x) && Number.isFinite(pose.item.y));
      assert.ok(Number.isFinite(pose.item.rotation) && Number.isFinite(pose.item.scale));
      finitePoint(pose.anchors.primaryHand, `${equipmentId}/${direction}/${animationId} primary hand`);
      finitePoint(pose.anchors.secondaryHand, `${equipmentId}/${direction}/${animationId} secondary hand`);
      finitePoint(pose.origins.hitbox, `${equipmentId}/${direction}/${animationId} hitbox`);
      finitePoint(pose.origins.projectile, `${equipmentId}/${direction}/${animationId} projectile`);
      finitePoint(pose.origins.effect, `${equipmentId}/${direction}/${animationId} effect`);
      finitePoint(pose.origins.trail, `${equipmentId}/${direction}/${animationId} trail`);
    }
  }

  const switchHidden = rig.resolvePose({ equipmentId, direction: 'east', animationId: 'switch', progress: 0.5 });
  assert.equal(switchHidden.item.visible, false, `${equipmentId} switch must include a hidden hand-off frame`);
  const packet = rig.networkSnapshot(rig.resolvePose({ equipmentId, direction: 'west', animationId: 'block' }), 'standard');
  assert.equal(packet.equipmentId, equipmentId);
  assert.equal(packet.animationState, 'block');
  assert.equal(packet.facingDirection, 'west');
  assert.ok(Number.isInteger(packet.networkStateId));
  assert.ok(!('token' in packet) && !('reconnectToken' in packet), 'Equipment snapshot must not expose credentials');
}

const east = rig.resolvePose({ equipmentId: 'guitar', direction: 'east', animationId: 'attack', progress: 0.5 });
const west = rig.resolvePose({ equipmentId: 'guitar', direction: 'west', animationId: 'attack', progress: 0.5 });
assert.notEqual(east.item.flipX, west.item.flipX, 'Horizontal directions require explicit orientation changes');
assert.ok(east.origins.projectile.x > 0 && west.origins.projectile.x < 0, 'Projectile origins must follow facing');

const index = read('index.html');
const scriptOrder = [
  'audio.js', 'sprite-runtime.js', 'equipment-runtime.js', 'game.js',
  'v1-expansion.js', 'v2-platform-fighter.js'
].map((name) => index.indexOf(name));
scriptOrder.forEach((position, indexPosition) => assert.ok(position >= 0, `Missing script ${indexPosition}`));
for (let i = 1; i < scriptOrder.length; i += 1) {
  assert.ok(scriptOrder[i] > scriptOrder[i - 1], 'Runtime scripts are in the wrong dependency order');
}

const game = read('game.js');
const network = read('v1-expansion.js');
const arena = read('v2-platform-fighter.js');
const arenaSandbox = {
  window: { HighNotesV1: { multiplayerConfig: {} }, addEventListener() {} },
  document: { addEventListener() {}, body: { classList: { add() {}, remove() {} } } },
  Image: function Image() {},
  performance: { now: () => 0 },
  console
};
vm.createContext(arenaSandbox);
vm.runInContext(arena, arenaSandbox, { filename: 'v2-platform-fighter.js' });
const arenaRoster = arenaSandbox.window.HighNotesV2Arena.data.fighters;
const requiredMoves = ['neutral','forward','up','down','dash','neutralAir','forwardAir','backAir','upAir',
  'downAir','charge','neutralSpecial','sideSpecial','recovery','ultimate'];
assert.deepEqual(Object.keys(arenaRoster), expectedEquipment);
Object.values(arenaRoster).forEach((fighter) => {
  assert.deepEqual(Object.keys(fighter.moves), requiredMoves, `${fighter.id} has an incomplete move set`);
  assert.equal(new Set(Object.values(fighter.moves).map((move) => move.id)).size, requiredMoves.length,
    `${fighter.id} contains duplicate move ids`);
  assert.ok(fighter.weight >= 75 && fighter.weight <= 125, `${fighter.id} weight is outside the roster envelope`);
  assert.ok(fighter.moves.neutralSpecial.projectile, `${fighter.id} needs a projectile identity`);
  assert.ok(fighter.moves.recovery.recoveryImpulse, `${fighter.id} needs a recovery special`);
});
assert.match(game, /GAME_VERSION\s*=\s*['"]2\.0\.0['"]/);
assert.match(game, /MossEquipmentRig/);
assert.match(game, /equipment:\s*currentEquipmentNetworkSnapshot/);
assert.match(game, /sanitizeOnlineEquipment/);
assert.match(game, /remote\.facingDirection/);
assert.match(game, /hero-instrument-guitar/);
assert.match(game, /beginAttack:\s*function/);
assert.match(game, /var PROLOGUE_LEVEL\s*=\s*\{/);
assert.match(game, /isPrologue:true/);
assert.match(game, /state\.tutorial\.prologueX/);
assert.match(game, /getLevelData:\s*function \(\) \{ return currentLevel/);
assert.doesNotMatch(game, /instrumentById\(remote\.instrument\)\s*\?/);
assert.match(network, /protocolVersion\s*:\s*PROTOCOL_VERSION/);
assert.match(network, /sanitizeEquipmentNetworkSnapshot/);
assert.match(network, /equipment:\s*equipment/);
assert.match(network, /animationElapsed:\s*clamp\(remote\.equipment\.animationElapsed\s*\+\s*predictionSeconds/);
assert.match(network, /\/health/);
assert.match(network, /defaultRelayUrl/);
assert.match(network, /wss:\/\//);
assert.match(network, /copyable|copy diagnostics|diagnostics/i);
assert.match(network, /selfControlEcho/);
assert.match(network, /\['room-welcome','host-migrate','match-start','rematch'\]/);
assert.match(network, /if \(!this\.relayUrl\) this\.migrateHost\(\)/);
assert.match(network, /prepareForUnload/);
assert.match(network, /lastRoomWelcome/);
assert.match(network, /requestRoomSync/);
assert.match(arena, /FIXED_STEP/);
assert.match(arena, /window\.HighNotesV2Arena/);
assert.match(arena, /dataset\.arenaState/);
assert.match(arena, /Relay connection required/);
assert.match(arena, /rehydrated:true/);
assert.match(arena, /hydrateRoomState/);
assert.match(arena, /roomSyncRequestedFor/);
assert.match(arena, /data-v2-action="recovery"/);
assert.match(arena, /touchPointers/);
assert.match(arena, /arena-match-active/);
assert.match(arena, /releaseInputs/);
assert.match(arena, /function synthMoves\(\)/);
assert.match(arena, /function drumMoves\(\)/);
assert.match(arena, /function microphoneMoves\(\)/);
assert.match(arena, /function violinMoves\(\)/);
assert.match(arena, /Waveform Orb/);
assert.match(arena, /Worldbeat Cataclysm/);
assert.match(arena, /Choir of Stars/);
assert.match(arena, /Moonlit Concerto/);
assert.match(arena, /previousDx/);
assert.match(arena, /projectile\.move && projectile\.move\.id/);
assert.match(arena, /attackHits:fighter\.attack \? Array\.from\(fighter\.attack\.hit\)/);
assert.match(arena, /hits:Array\.from\(projectile\.hit \|\| \[\]\)/);
assert.match(arena, /this\.snapshotHost !== message\.from/);
assert.match(arena, /this\.networkInputs\.delete\(message\.from\)/);
assert.match(arena, /fighter\.x = fighter\.previousX = nextX/);
assert.match(network, /HighNotesV2Arena\.stop\('tab-changed'\)/);
assert.doesNotMatch(network, /wss:\/\/your-relay\.example/i);

const relayValidation = read('multiplayer-relay/src/validation.ts');
assert.match(relayValidation, /projectiles\.push\(\{ id, owner, x, y, vx, life, radius, colour, move, hits \}\)/);
assert.match(relayValidation, /knockouts, falls, disconnected/);

[
  'multiplayer-relay/src/index.ts',
  'multiplayer-relay/src/GameRoom.ts',
  'multiplayer-relay/src/Matchmaker.ts',
  'multiplayer-relay/src/protocol.ts',
  'multiplayer-relay/src/validation.ts',
  'multiplayer-relay/src/rateLimit.ts',
  'multiplayer-relay/src/security.ts',
  'multiplayer-relay/wrangler.jsonc',
  'multiplayer-relay/package-lock.json',
  'docs/HIGH_NOTES_V2_ARCHITECTURE.md',
  'docs/V2-2-CHARACTER-ASSETS.md',
  'docs/V2-2-PROLOGUE.md',
  'docs/V2-2-ARENA-ROSTER.md',
  'assets/masters/arena/high-notes-fighter-roster-v1.png',
  'assets/arena/fighters/manifest.json',
  'assets/sprites/runtime/hero-hair-directions.png',
  'assets/sprites/runtime/hero-instrument-manifest.json',
  ...expectedEquipment.map((id) => `assets/sprites/runtime/hero-instrument-${id}.png`),
  ...expectedEquipment.map((id) => `assets/arena/fighters/${id}-portrait.webp`)
].forEach(exists);

const integratedManifest = JSON.parse(read('assets/sprites/runtime/hero-instrument-manifest.json'));
assert.deepEqual(Object.keys(integratedManifest.sheets), expectedEquipment);

const fighterArtManifest = JSON.parse(read('assets/arena/fighters/manifest.json'));
assert.deepEqual(fighterArtManifest.fighters.map((fighter) => fighter.id), expectedEquipment);

const manifest = JSON.parse(read('manifest.webmanifest'));
assert.match(manifest.name, /HIGH NOTES/i);
assert.match(manifest.description, /Mossvale|music|action RPG/i);

console.log(`V2 release validation passed: ${expectedEquipment.length} instruments x ${expectedDirections.length} directions x ${requiredStates.length} animation states.`);
