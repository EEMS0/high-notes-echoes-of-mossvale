#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const music = require(path.join(root, 'music-runtime.js'));
const story = require(path.join(root, 'story-runtime.js'));

assert.equal(music.schemaVersion, 1);
assert.deepEqual(Array.from(music.anchorNotes), ['C', 'E', 'G', 'B'], 'legacy collectible anchors remain stable');
assert.deepEqual(Array.from(music.noteOrder), ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C5']);
assert.equal(music.notes.C.midi, 72, 'legacy C pitch remains sonically stable');
assert.equal(music.notes.C5.midi, 84, 'high C is a distinct octave voice');
assert.equal(music.normalizeNote('C4'), 'C', 'legacy octave-qualified C migrates');
assert.equal(music.normalizeNote('C↑'), 'C5');
assert.equal(music.normalizeNote('H'), '');
assert.deepEqual(music.normalizeStep(['G', 'C', 'E', 'E', 'future']), ['G', 'C', 'E']);
assert.deepEqual(music.normalizeStep('G+B+D+F'), ['G', 'B', 'D', 'F'], 'authored root and voicing order are retained');

const legacy = ['C', '-', 'E', '-', 'G', '-', 'B', '-'];
const migrated = music.sanitizeComposition(null, legacy);
assert.equal(migrated.steps.length, 16);
assert.deepEqual(migrated.steps.slice(0, 8), migrated.steps.slice(8), 'old one-bar loops repeat into two bars');
assert.deepEqual(migrated.steps[0], ['C']);
assert.deepEqual(migrated.steps[1], []);
assert.equal(music.isReady(migrated), true);

const hostile = music.sanitizeComposition({ steps: [
  ['C', 'D', 'E', 'F', 'G', 'future', 'C'],
  null,
  'A+C5+E+G',
  ...Array(30).fill(['B'])
] }, []);
assert.equal(hostile.steps.length, 16, 'composition length is bounded');
assert.deepEqual(hostile.steps[0], ['C', 'D', 'E', 'F'], 'voicings are unique, known, order-preserving, and capped');
assert.deepEqual(hostile.steps[1], []);
assert.deepEqual(hostile.steps[2], ['A', 'C5', 'E', 'G']);

let edited = music.emptyComposition();
for (const note of ['C', 'E', 'G', 'B']) edited = music.toggleNote(edited, 0, note).composition;
const rejected = music.toggleNote(edited, 0, 'D');
assert.equal(rejected.changed, false);
assert.equal(rejected.reason, 'voicing-full');
assert.equal(music.chordName(edited.steps[0]), 'C major seventh');
edited = music.setStep(edited, 1, music.findPreset('g-dominant-7').notes);
assert.equal(music.chordName(edited.steps[1]), 'G dominant seventh');
assert.deepEqual(edited.steps[1], ['G', 'B', 'D', 'F'], 'G7 keeps G as its authored bass/root');
assert.deepEqual(music.toLegacyMelody(music.sanitizeComposition({steps:[['C5']]}, []))[0], 'C');

const freePhrase = music.sanitizeComposition({steps:[['D'],['F'],['A'],['D'],[],[],[],[],[],[],[],[],[],[],[],[]]}, []);
assert.equal(music.isReady(freePhrase), true, 'new compositions are not forced to repeat all four anchors');
assert.deepEqual(music.bossAnchorSequence(freePhrase), ['C', 'E', 'G', 'B'], 'Nullspeaker pads always receive the four playable anchors');
const mixedPhrase = music.sanitizeComposition({steps:[['D'],['G'],['F'],['C5'],['B'],['A'],['E']]}, []);
assert.deepEqual(music.bossAnchorSequence(mixedPhrase), ['G', 'C', 'B', 'E'], 'authored anchors are retained and non-pad tones are ignored');

assert.equal(story.schemaVersion, 2);
assert.deepEqual(Object.keys(story.notes), ['C', 'D', 'E', 'F', 'G', 'A', 'B']);
const expectedChords = {
  'mossvale-major': ['C', 'E', 'G'],
  'rootsong-minor': ['E', 'G', 'B', 'D'],
  'skyglass-inversion': ['E', 'G', 'C', 'F', 'A'],
  'moonwake-seventh': ['C', 'E', 'G', 'B', 'D']
};
for (const [id, notes] of Object.entries(expectedChords)) {
  assert.deepEqual(Array.from(story.chords[id].notes), notes);
  assert.equal(story.evaluateChord(id, notes).complete, true);
  for (let count = 1; count < notes.length; count++) {
    assert.equal(story.evaluateChord(id, notes.slice(0, count)).status, 'partial', `${id} keeps prefix ${count}`);
  }
}
assert.deepEqual(story.sanitizePuzzleState('rootsong-minor', {
  status: 'completed', input: ['E', 'G', 'B'], rewardClaimed: true
}).input, expectedChords['rootsong-minor'], 'completed old puzzles adopt the expanded definition without losing completion');

global.MossMusic = music;
require(path.join(root, 'audio.js'));
const audio = new global.MossAudioEngine();
const progress = audio.setProgress(4, [
  ['C', 'E', 'G'], ['D'], [], ['G', 'B', 'D', 'F'], ['C5']
], music.noteOrder);
assert.deepEqual(progress.melody[0], ['C', 'E', 'G']);
assert.deepEqual(progress.melody[3], ['G', 'B', 'D', 'F']);
assert.deepEqual(progress.melody[4], ['C5']);
assert.deepEqual(audio._activeMelodyNames.sort(), ['A', 'B', 'C', 'C5', 'D', 'E', 'F', 'G'].filter((note) =>
  progress.melody.some((step) => step.includes(note))).sort());
assert.equal(audio.playMelody([]), true, 'empty preview remains a context-free cancellation');

const index = read('index.html');
const game = read('game.js');
const styles = read('styles.css');
const audioSource = read('audio.js');
assert.ok(index.indexOf('music-runtime.js') < index.indexOf('audio.js'));
assert.ok(index.indexOf('music-runtime.js') < index.indexOf('game.js'));
for (const id of ['composerNotePalette', 'composerChordPresets', 'copyComposerStepButton', 'clearComposerStepButton', 'chordNoteGrid']) {
  assert.match(index, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}
assert.match(game, /SAVE_SCHEMA_VERSION\s*=\s*26\b/);
assert.match(game, /var NOTE_ORDER = MUSIC \? Array\.from\(MUSIC\.anchorNotes\)/, 'core notes stay separate from composer notes');
assert.match(game, /clean\.composition\s*=\s*MUSIC \? MUSIC\.sanitizeComposition/);
assert.match(game, /MUSIC\.bossAnchorSequence\(state\.composition\)/);
assert.match(game, /function handleComposerKeydown\b/);
assert.match(audioSource, /previewChord\(noteNames\)/);
assert.match(audioSource, /playComposition\(composition\)/);
assert.match(styles, /\.composer-note-palette/);
assert.match(styles, /\.chord-note-grid \{ grid-template-columns: repeat\(7/);

console.log('Expanded music validation passed: 8 playable pitches, 16 polyphonic steps, 10 chord presets, 4 backward-compatible story harmonies.');
