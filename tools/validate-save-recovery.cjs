#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const gamePath = path.join(root, 'game.js');
const game = fs.readFileSync(gamePath, 'utf8');

new Function(game);

assert.match(game, /var SAVE_BACKUP_KEY = 'highNotesSaveV7Backup';/, 'dedicated backup key');
assert.match(game, /\[SAVE_KEY, SAVE_BACKUP_KEY, LEGACY_SAVE_KEY, OLDER_SAVE_KEY, OLDEST_SAVE_KEY, ANCIENT_SAVE_KEY\]/,
  'clear-save flow removes every current, backup, and legacy key');
assert.match(game, /function savePayloadLooksValid\(raw, allowUnversioned\)/, 'semantic save validator');
assert.match(game, /raw\.version > SAVE_SCHEMA_VERSION/, 'unsupported future save schemas are rejected');
assert.match(game, /Number\.isInteger\(raw\.stage\)/, 'campaign stage is semantically validated');
assert.match(game, /Array\.isArray\(raw\.weeds\).*Array\.isArray\(raw\.notes\)/,
  'core campaign collections are semantically validated');
assert.match(game, /function parseStoredSave\(serialized, allowUnversioned\)/, 'quiet stored-save parser');
assert.match(game, /function loadBestStoredSave\(\)[\s\S]*?\[SAVE_KEY,false\],[\s\S]*?\[SAVE_BACKUP_KEY,false\],[\s\S]*?\[LEGACY_SAVE_KEY,true\]/,
  'valid save selection prioritizes primary, backup, then legacy');
assert.match(game, /function rotatePrimarySaveToBackup\(\)[\s\S]*?parseStoredSave\(serialized,false\)[\s\S]*?writeStorage\(SAVE_BACKUP_KEY,serialized\)/,
  'only a semantically valid current primary can rotate into backup');
assert.match(game, /function saveGame\(force\)[\s\S]*?rotatePrimarySaveToBackup\(\);[\s\S]*?writeStorage\(SAVE_KEY, serialized\)/,
  'backup rotation precedes the new primary write');
assert.match(game, /function refreshContinue\(\)[\s\S]*?candidate = loadBestStoredSave\(\)[\s\S]*?setHidden\(button, !candidate\)/,
  'Continue visibility is based on a semantically valid candidate');
assert.match(game, /function continueGame\(\)[\s\S]*?if \(!candidate\) \{[\s\S]*?return false;[\s\S]*?state = candidate\.state/,
  'invalid saves cannot mutate state or launch a blank adventure');
assert.doesNotMatch(game, /safeJson\(readStorage\((?:SAVE_KEY|LEGACY_SAVE_KEY|OLDER_SAVE_KEY|OLDEST_SAVE_KEY|ANCIENT_SAVE_KEY)/,
  'all save entry points use the validated recovery path');

console.log('Save recovery validation passed: syntax, candidate validation, backup rotation, load order, and corrupt-save guard.');
