#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const expansion = fs.readFileSync(path.join(root, 'v1-expansion.js'), 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing ${startMarker}`);
  assert.ok(end > start, `Missing ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

function contractGoals(slug) {
  const match = expansion.match(new RegExp(`slug:'${slug}'[^\n]*goals:\\[([^\\]]+)\\]`));
  assert.ok(match, `Missing ${slug} contract goals`);
  return match[1].split(',').map((value) => Number(value.trim()));
}

const fastTravel = section(game, 'function fastTravelTo(', 'function renderFastTravel(');
const portalTravel = section(game, 'function enterStage(', 'function beginBlock(');
const homeTravel = section(game, 'function travelHome(', 'function homeAction(');
const cleanup = section(game, 'function clearStageScopedRuntime(', 'function enterStage(');

for (const [label, source] of [['fast travel', fastTravel], ['portal travel', portalTravel]]) {
  const guardIndex = source.indexOf('worldTravelBlockReason()');
  const mutationIndex = source.indexOf('state.stagePositions');
  assert.ok(guardIndex >= 0 && mutationIndex > guardIndex, `${label} must guard before mutating stage state`);
  assert.match(source, /beginWorldTransition\(/, `${label} must acquire the transition lock`);
  assert.match(source, /clearStageScopedRuntime\(\)/, `${label} must use stage-scoped cleanup`);
  assert.match(source, /return true;/, `${label} must report a successful transition`);
}

assert.match(homeTravel, /worldTravelBlockReason\(\)/, 'home fast travel must use the shared guard');
assert.match(game, /if \(boss && !boss\.dead\) return \{code:'boss'/, 'live bosses must block travel');
assert.match(game, /state\.dreamEncore\.active \|\| dreamEncoreRuntime\.activeEnemyIds\.size/, 'Dream Encore must block travel');
assert.match(game, /projectiles\.length \|\| hazards\.length/, 'live hostile attacks must block travel');
assert.match(game, /worldTransitionRuntime = \{locked:false,serial:0,source:''\}/, 'transition lock runtime');
assert.match(game, /button\.disabled = !!blocked \|\|/, 'fast-travel UI must reflect the runtime guard');
assert.match(game, /fastTravel: function \(stage,visitShop\)/, 'browser QA fast-travel hook');

['attacks=[]', 'pulses=[]', 'particles=[]', 'floatingTextCount=0', 'projectiles=[]', 'hazards=[]',
  'classFields=[]', 'healthPickups=[]', 'boss=null', 'bossPadLatch=null',
  'encounterDirector.activeEvent=null', 'encounterDirector.weatherTimer=0', 'firstStageRuntime.attackSlots.clear()']
  .forEach((token) => assert.ok(cleanup.includes(token), `stage cleanup missing ${token}`));

const collectibleIds = [...game.matchAll(/\{id:'((?:mix|rune|prism|pearl)-\d+)'/g)].map((match) => match[1]);
assert.equal(new Set(collectibleIds).size, 16, 'world contains sixteen unique collectibles');
const secretAllowlist = game.match(/clean\.discoveredSecrets = validUnique\(raw\.discoveredSecrets, \[([^\]]+)\]\)/);
assert.ok(secretAllowlist, 'discovered-secret allowlist');
const secretIds = [...secretAllowlist[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.equal(new Set(secretIds).size, 5, 'save schema permits five unique secrets');

const recordGoals = contractGoals('record-run');
const secretGoals = contractGoals('unmarked-paths');
assert.equal(recordGoals.at(-1), 16, 'final collectible contract matches the collectible cap');
assert.equal(secretGoals.at(-1), 5, 'final secret contract matches the secret cap');
assert.ok(Math.max(...recordGoals) <= new Set(collectibleIds).size, 'no collectible contract exceeds content');
assert.ok(Math.max(...secretGoals) <= new Set(secretIds).size, 'no secret contract exceeds the save schema');

console.log('World-transition validation passed: guarded/locked travel, scoped cleanup, and attainable contract targets.');
